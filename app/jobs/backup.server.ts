import { Worker } from "bullmq";
import prisma from "../db.server";
import { QUEUE_NAMES, redisConnection, type BackupJobData } from "../lib/queue.server";
import { adminGraphqlClient } from "../lib/admin-graphql.server";
import { setMetafields } from "../lib/metafields.server";
import { chunk } from "../lib/metafields";
import { upsertEntry } from "../lib/metaobjects.server";
import { uploadFile, getFileContent, buildFileKey } from "../lib/r2.server";
import {
  BACKUP_VERSION,
  collectMetafieldDefinitions,
  collectMetafields,
  collectMetaobjectDefinitions,
  collectMetaobjects,
  type Snapshot,
} from "./snapshot.server";
import { buildRestoreDiff } from "./restore-diff.server";
import { notifyJobFinished } from "../lib/notify.server";

/**
 * Agency backup & restore.
 *
 * Backup  — snapshot every metafield (across owner types) and every metaobject
 *           entry into a single JSON document stored via the storage layer.
 * Preview — compare a snapshot against the live store and store the resulting
 *           create/update/skip plan, so restore is a confirmed action.
 * Restore — read a snapshot back and re-apply it (metafieldsSet for metafields,
 *           metaobjectUpsert by handle for metaobjects), batched 25 at a time.
 */

const RETENTION_DAYS = 30;

export type { Snapshot } from "./snapshot.server";

async function runBackup(data: BackupJobData): Promise<void> {
  const { jobId, shopId, shopDomain, accessToken } = data;
  await prisma.backupJob.update({ where: { id: jobId }, data: { status: "running" } });

  try {
    const admin = adminGraphqlClient(shopDomain, accessToken);
    // Metafield collection runs bulk queries, which are one-at-a-time per shop,
    // so it must not race the metaobject walk's own paging.
    const metafields = await collectMetafields(admin);
    const [metaobjects, metafieldDefinitions, metaobjectDefinitions] = await Promise.all([
      collectMetaobjects(admin),
      collectMetafieldDefinitions(admin),
      collectMetaobjectDefinitions(admin),
    ]);

    const snapshot: Snapshot = {
      version: BACKUP_VERSION,
      shop: shopDomain,
      createdAt: new Date().toISOString(),
      metafields,
      metaobjects,
      metafieldDefinitions,
      metaobjectDefinitions,
    };

    const key = buildFileKey(shopId, "backup", jobId, "json");
    const body = JSON.stringify(snapshot, null, 2);
    await uploadFile(key, body, "application/json");

    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await prisma.backupJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        fileUrl: key,
        expiresAt,
        sizeBytes: Buffer.byteLength(body, "utf8"),
        itemCount: metafields.length + metaobjects.length,
      },
    });

    await prisma.activityLog.create({
      data: {
        shopId,
        action: "backup",
        resourceType: "snapshot",
        rowCount: metafields.length + metaobjects.length,
      },
    });

    await notifyJobFinished({ shopId, type: "backup", status: "completed", fileKey: key });
  } catch (err) {
    await prisma.backupJob.update({ where: { id: jobId }, data: { status: "failed" } });
    await notifyJobFinished({
      shopId,
      type: "backup",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function readSnapshot(backupKey: string): Promise<Snapshot> {
  const raw = await getFileContent(backupKey);
  if (!raw) throw new Error("Backup file is empty or missing");
  return JSON.parse(raw) as Snapshot;
}

/**
 * Step 1 of a restore: diff the snapshot against the live store and persist the
 * plan. The UI polls the tracking ImportJob and renders the counts before the
 * merchant commits to writing anything.
 */
async function runPreview(data: BackupJobData): Promise<void> {
  const { shopId, shopDomain, accessToken, backupKey, previewJobId } = data;
  if (!backupKey || !previewJobId) {
    throw new Error("Preview requires backupKey and previewJobId");
  }

  await prisma.importJob.update({ where: { id: previewJobId }, data: { status: "running" } });

  try {
    const snapshot = await readSnapshot(backupKey);
    const admin = adminGraphqlClient(shopDomain, accessToken);
    const diff = await buildRestoreDiff(admin, snapshot);

    const key = buildFileKey(shopId, "restore-preview", previewJobId, "json");
    await uploadFile(key, JSON.stringify(diff), "application/json");

    await prisma.importJob.update({
      where: { id: previewJobId },
      data: {
        status: "completed",
        fileUrl: key,
        totalRows: diff.counts.create + diff.counts.update + diff.counts.skip,
        successRows: diff.counts.create + diff.counts.update,
        failedRows: 0,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.importJob.update({
      where: { id: previewJobId },
      data: { status: "failed", completedAt: new Date() },
    });
    throw err;
  }
}

async function runRestore(data: BackupJobData): Promise<void> {
  const { shopId, shopDomain, accessToken, backupKey, restoreJobId } = data;
  if (!backupKey || !restoreJobId) throw new Error("Restore requires backupKey and restoreJobId");

  await prisma.importJob.update({ where: { id: restoreJobId }, data: { status: "running" } });

  try {
    const snapshot = await readSnapshot(backupKey);
    const admin = adminGraphqlClient(shopDomain, accessToken);

    const metafields = snapshot.metafields ?? [];
    const metaobjects = snapshot.metaobjects ?? [];
    const total = metafields.length + metaobjects.length;

    // Publish the denominator up front so the UI can show real progress rather
    // than an indeterminate spinner.
    await prisma.importJob.update({
      where: { id: restoreJobId },
      data: { totalRows: total, successRows: 0, failedRows: 0 },
    });

    let success = 0;
    let failed = 0;
    const flushProgress = () =>
      prisma.importJob.update({
        where: { id: restoreJobId },
        data: { successRows: success, failedRows: failed },
      });

    // --- metafields ---
    for (const batch of chunk(metafields, 25)) {
      try {
        const result = await setMetafields(
          admin,
          batch.map((m) => ({
            ownerId: m.ownerId,
            namespace: m.namespace,
            key: m.key,
            type: m.type,
            value: m.value,
          })),
        );
        const errs = result.userErrors.length;
        success += batch.length - errs;
        failed += errs;
      } catch {
        failed += batch.length;
      }
      await flushProgress();
    }

    // --- metaobjects ---
    for (const batch of chunk(metaobjects, 25)) {
      const outcomes = await Promise.all(
        batch.map(async (m): Promise<boolean> => {
          try {
            const res = await upsertEntry(admin, {
              type: m.type,
              handle: m.handle,
              fields: m.fields,
            });
            return res.userErrors.length === 0 && !!res.entry;
          } catch {
            return false;
          }
        }),
      );
      const ok = outcomes.filter(Boolean).length;
      success += ok;
      failed += outcomes.length - ok;
      await flushProgress();
    }

    await prisma.importJob.update({
      where: { id: restoreJobId },
      data: {
        status: "completed",
        totalRows: total,
        successRows: success,
        failedRows: failed,
        completedAt: new Date(),
      },
    });

    await prisma.activityLog.create({
      data: { shopId, action: "restore", resourceType: "snapshot", rowCount: success },
    });

    await notifyJobFinished({ shopId, type: "restore", status: "completed" });
  } catch (err) {
    await prisma.importJob.update({
      where: { id: restoreJobId },
      data: { status: "failed", completedAt: new Date() },
    });
    await notifyJobFinished({
      shopId,
      type: "restore",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function processBackupJob(data: BackupJobData): Promise<void> {
  if (data.mode === "preview") return runPreview(data);
  if (data.mode === "restore") return runRestore(data);
  return runBackup(data);
}

export function createBackupWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.BACKUP,
    async (job) => {
      await processBackupJob(job.data as BackupJobData);
    },
    { connection: redisConnection },
  );
}

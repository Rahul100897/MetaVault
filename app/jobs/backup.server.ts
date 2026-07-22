import { Worker } from "bullmq";
import prisma from "../db.server";
import { QUEUE_NAMES, redisConnection, type BackupJobData } from "../lib/queue.server";
import { adminGraphqlClient } from "../lib/admin-graphql.server";
import { listMetafields, setMetafields } from "../lib/metafields.server";
import { OWNER_TYPES, chunk, type OwnerType } from "../lib/metafields";
import { listDefinitions, listEntries, upsertEntry } from "../lib/metaobjects.server";
import { uploadFile, getFileContent, buildFileKey } from "../lib/r2.server";

/**
 * Agency backup & restore.
 *
 * Backup  — snapshot every metafield (across owner types) and every metaobject
 *           entry into a single JSON document stored via the storage layer.
 * Restore — read a snapshot back and re-apply it (metafieldsSet for metafields,
 *           metaobjectUpsert by handle for metaobjects), batched 25 at a time.
 */

const BACKUP_VERSION = 1;
const RETENTION_DAYS = 30;

export type SnapshotMetafield = {
  ownerType: string;
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export type SnapshotMetaobject = {
  type: string;
  handle: string;
  status: string | null;
  fields: Array<{ key: string; value: string }>;
};

export type Snapshot = {
  version: number;
  shop: string;
  createdAt: string;
  metafields: SnapshotMetafield[];
  metaobjects: SnapshotMetaobject[];
};

type Admin = ReturnType<typeof adminGraphqlClient>;

async function collectMetafields(admin: Admin): Promise<SnapshotMetafield[]> {
  const out: SnapshotMetafield[] = [];
  for (const ownerType of OWNER_TYPES as OwnerType[]) {
    let after: string | null = null;
    do {
      const page = await listMetafields(admin, { ownerType, first: 50, after });
      for (const r of page.rows) {
        out.push({
          ownerType,
          ownerId: r.ownerId,
          namespace: r.namespace,
          key: r.key,
          type: r.type,
          value: r.value,
        });
      }
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);
  }
  return out;
}

async function collectMetaobjects(admin: Admin): Promise<SnapshotMetaobject[]> {
  const out: SnapshotMetaobject[] = [];
  const definitions = await listDefinitions(admin);
  for (const def of definitions) {
    let after: string | null = null;
    do {
      const page = await listEntries(admin, { type: def.type, first: 100, after });
      for (const e of page.entries) {
        out.push({
          type: def.type,
          handle: e.handle,
          status: e.status,
          fields: Object.values(e.fields).map((f) => ({ key: f.key, value: f.value })),
        });
      }
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);
  }
  return out;
}

async function runBackup(data: BackupJobData): Promise<void> {
  const { jobId, shopId, shopDomain, accessToken } = data;
  await prisma.backupJob.update({ where: { id: jobId }, data: { status: "running" } });

  try {
    const admin = adminGraphqlClient(shopDomain, accessToken);
    const [metafields, metaobjects] = await Promise.all([
      collectMetafields(admin),
      collectMetaobjects(admin),
    ]);

    const snapshot: Snapshot = {
      version: BACKUP_VERSION,
      shop: shopDomain,
      createdAt: new Date().toISOString(),
      metafields,
      metaobjects,
    };

    const key = buildFileKey(shopId, "backup", jobId, "json");
    await uploadFile(key, JSON.stringify(snapshot, null, 2), "application/json");

    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await prisma.backupJob.update({
      where: { id: jobId },
      data: { status: "completed", fileUrl: key, expiresAt },
    });

    await prisma.activityLog.create({
      data: {
        shopId,
        action: "backup",
        resourceType: "snapshot",
        rowCount: metafields.length + metaobjects.length,
      },
    });
  } catch (err) {
    await prisma.backupJob.update({ where: { id: jobId }, data: { status: "failed" } });
    throw err;
  }
}

async function runRestore(data: BackupJobData): Promise<void> {
  const { shopId, shopDomain, accessToken, backupKey, restoreJobId } = data;
  if (!backupKey || !restoreJobId) throw new Error("Restore requires backupKey and restoreJobId");

  await prisma.importJob.update({ where: { id: restoreJobId }, data: { status: "running" } });

  try {
    const raw = await getFileContent(backupKey);
    if (!raw) throw new Error("Backup file is empty or missing");
    const snapshot = JSON.parse(raw) as Snapshot;
    const admin = adminGraphqlClient(shopDomain, accessToken);

    let success = 0;
    let failed = 0;

    // --- metafields ---
    for (const batch of chunk(snapshot.metafields ?? [], 25)) {
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
    }

    // --- metaobjects ---
    for (const batch of chunk(snapshot.metaobjects ?? [], 25)) {
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
    }

    const total = (snapshot.metafields?.length ?? 0) + (snapshot.metaobjects?.length ?? 0);
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
  } catch (err) {
    await prisma.importJob.update({
      where: { id: restoreJobId },
      data: { status: "failed", completedAt: new Date() },
    });
    throw err;
  }
}

export async function processBackupJob(data: BackupJobData): Promise<void> {
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

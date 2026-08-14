import { Worker } from "bullmq";
import prisma from "../db.server";
import { QUEUE_NAMES, cleanupQueue, redisConnection } from "../lib/queue.server";
import { deleteFile } from "../lib/r2.server";

/**
 * Retention sweep for backup snapshots.
 *
 * runBackup() stamps every snapshot with `expiresAt` (createdAt + 30 days) and
 * the backups table shows merchants that date — but nothing ever acted on it,
 * so snapshots lived in object storage forever. This sweep is what makes the
 * displayed expiry real.
 *
 * Deliberately narrow: it only touches rows that are completed, still hold a
 * file pointer, and carry an expiry that has already passed. Rows with a null
 * `expiresAt` are never swept — a missing expiry means "no policy recorded",
 * not "expire immediately".
 *
 * Export/import CSVs are NOT swept. They have no `expiresAt` and the UI makes
 * no retention promise about them, so choosing a lifetime for them is a product
 * decision rather than a bug fix.
 */

/** Rows per run. Bounded so one sweep can't hold a connection open for minutes. */
const BATCH_SIZE = 200;

/** Daily at 03:17 UTC — off the hour, where scheduled load tends to pile up. */
const SWEEP_CRON = "17 3 * * *";

export type CleanupResult = {
  /** Snapshots whose object was removed and pointer cleared. */
  deleted: number;
  /** Snapshots left alone this run because deletion failed; retried next sweep. */
  failed: number;
};

export async function runCleanup(): Promise<CleanupResult> {
  const expired = await prisma.backupJob.findMany({
    where: {
      status: "completed",
      fileUrl: { not: null },
      expiresAt: { lt: new Date() },
    },
    orderBy: { expiresAt: "asc" },
    take: BATCH_SIZE,
  });

  let deleted = 0;
  let failed = 0;

  for (const backup of expired) {
    const key = backup.fileUrl;
    if (!key) continue;

    try {
      // S3/R2 DeleteObject is idempotent, so an already-missing object still
      // resolves and we fall through to clearing the pointer. A throw here is a
      // real failure (network, credentials) — leave the pointer intact so the
      // next sweep retries rather than orphaning the object.
      await deleteFile(key);
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(
        `[metavault] cleanup: could not delete ${key}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    await prisma.backupJob.update({
      where: { id: backup.id },
      data: { fileUrl: null },
    });
    deleted++;
  }

  return { deleted, failed };
}

/**
 * Registers the repeating sweep. BullMQ keys a repeatable job by its name and
 * repeat options, so calling this on every worker boot is idempotent — it will
 * not stack duplicate schedules.
 */
export async function scheduleCleanup(): Promise<void> {
  await cleanupQueue.add("sweep", {}, { repeat: { pattern: SWEEP_CRON } });
}

export function createCleanupWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.CLEANUP,
    async () => {
      const { deleted, failed } = await runCleanup();
      if (deleted || failed) {
        // eslint-disable-next-line no-console
        console.log(`[metavault] cleanup: ${deleted} expired backup(s) removed, ${failed} failed`);
      }
    },
    { connection: redisConnection },
  );
}

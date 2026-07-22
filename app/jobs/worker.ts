/**
 * BullMQ worker entrypoint. Run as a separate process from the web server:
 *   npm run worker
 *
 * On Railway this is a dedicated worker service sharing the same Redis/Postgres.
 */
import { createExportWorker } from "./export.server";
import { createImportWorker } from "./import.server";
import { createBackupWorker } from "./backup.server";

const workers = [createExportWorker(), createImportWorker(), createBackupWorker()];

// eslint-disable-next-line no-console
console.log(`[metavault] started ${workers.length} worker(s)`);

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[metavault] job ${job?.id} failed:`, err.message);
  });
  worker.on("completed", (job) => {
    // eslint-disable-next-line no-console
    console.log(`[metavault] job ${job.id} completed`);
  });
  // Swallow benign Redis socket resets (Railway drops idle sockets; ioredis
  // auto-reconnects). Surface anything else.
  worker.on("error", (err) => {
    if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE/.test(err.message)) return;
    // eslint-disable-next-line no-console
    console.error("[metavault] worker error:", err.message);
  });
}

async function shutdown() {
  // eslint-disable-next-line no-console
  console.log("[metavault] shutting down workers…");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

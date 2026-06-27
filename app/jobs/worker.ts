/**
 * BullMQ worker entrypoint. Run as a separate process from the web server:
 *   npm run worker
 *
 * On Railway this is a dedicated worker service sharing the same Redis/Postgres.
 */
import { createExportWorker } from "./export.server";
import { createImportWorker } from "./import.server";

const workers = [createExportWorker(), createImportWorker()];

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
}

async function shutdown() {
  // eslint-disable-next-line no-console
  console.log("[metavault] shutting down workers…");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

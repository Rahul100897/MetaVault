import { Worker } from "bullmq";
import prisma from "../db.server";
import { QUEUE_NAMES, redisConnection, type ImportJobData } from "../lib/queue.server";
import { adminGraphqlClient } from "../lib/admin-graphql.server";
import { setMetafields } from "../lib/metafields.server";
import { chunk } from "../lib/metafields";
import { validateImportCsv, type ValidatedRow } from "../lib/metafield-import.server";
import { generateCsv, type CsvRow } from "../lib/csv.server";
import { getFileContent, uploadFile, buildFileKey } from "../lib/r2.server";

/**
 * Import pipeline:
 *   download CSV from R2 → validate → metafieldsSet in batches of 25 →
 *   collect failed rows → write error-report CSV → finalize ImportJob.
 */

function failureRow(row: ValidatedRow, error: string): CsvRow {
  return {
    owner_id: String(row.raw.owner_id ?? ""),
    namespace: String(row.raw.namespace ?? ""),
    key: String(row.raw.key ?? ""),
    type: String(row.raw.type ?? ""),
    value: String(row.raw.value ?? ""),
    error,
  };
}

export async function processImportJob(data: ImportJobData): Promise<void> {
  if (data.type === "metaobjects") {
    const { processMetaobjectImport } = await import("./metaobject-import.server");
    return processMetaobjectImport(data);
  }

  const { jobId, shopId, shopDomain, accessToken, fileUrl } = data;

  await prisma.importJob.update({ where: { id: jobId }, data: { status: "running" } });

  try {
    const csvText = await getFileContent(fileUrl);
    const summary = validateImportCsv(csvText);
    const admin = adminGraphqlClient(shopDomain, accessToken);

    const failures: CsvRow[] = [];
    // Rows that fail validation never reach Shopify.
    for (const row of summary.rows) {
      if (!row.input) failures.push(failureRow(row, row.errors.join("; ")));
    }

    let successCount = 0;
    const validRows = summary.rows.filter((r): r is ValidatedRow & { input: NonNullable<ValidatedRow["input"]> } =>
      r.input !== null,
    );

    for (const batch of chunk(validRows, 25)) {
      const inputs = batch.map((r) => r.input);
      const result = await setMetafields(admin, inputs);

      // metafieldsSet returns per-metafield userErrors with a field path like
      // ["metafields", "<index>", "value"]; map them back to batch positions.
      const errorByIndex = new Map<number, string>();
      for (const e of result.userErrors) {
        const idx = e.field && e.field[1] != null ? Number(e.field[1]) : NaN;
        if (!Number.isNaN(idx)) errorByIndex.set(idx, e.message);
      }

      batch.forEach((row, i) => {
        const error = errorByIndex.get(i);
        if (error) failures.push(failureRow(row, error));
      });
      // Unique failed indices in this batch; the rest succeeded.
      successCount += batch.length - errorByIndex.size;
    }

    // Error report CSV → R2 (only if there were any failures).
    let errorReportUrl: string | null = null;
    if (failures.length) {
      const key = buildFileKey(shopId, "import-errors", jobId, "csv");
      await uploadFile(key, generateCsv(failures), "text/csv");
      errorReportUrl = key;
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        totalRows: summary.total,
        successRows: successCount,
        failedRows: failures.length,
        errorReportUrl,
        completedAt: new Date(),
      },
    });

    if (successCount > 0) {
      await prisma.activityLog.create({
        data: {
          shopId,
          action: "import",
          resourceType: "metafield",
          rowCount: successCount,
        },
      });
    }
  } catch (err) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "failed", completedAt: new Date() },
    });
    throw err;
  }
}

export function createImportWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.IMPORT,
    async (job) => {
      await processImportJob(job.data as ImportJobData);
    },
    { connection: redisConnection },
  );
}

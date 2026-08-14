import prisma from "../db.server";
import type { ImportJobData } from "../lib/queue.server";
import { adminGraphqlClient } from "../lib/admin-graphql.server";
import { listDefinitions, upsertEntry } from "../lib/metaobjects.server";
import { mapRows } from "../lib/metaobject-import.server";
import { chunk } from "../lib/metafields";
import { generateCsv, type CsvRow } from "../lib/csv.server";
import { getFileContent, uploadFile, buildFileKey } from "../lib/r2.server";
import { notifyJobFinished } from "../lib/notify.server";

/**
 * Metaobject CSV import: download → map/validate → metaobjectUpsert (by handle,
 * batched) → error-report CSV → finalize ImportJob.
 */
export async function processMetaobjectImport(data: ImportJobData): Promise<void> {
  const { jobId, shopId, shopDomain, accessToken, fileUrl } = data;
  const type = data.resourceType ?? "";
  const mapping = data.mapping ?? {};

  await prisma.importJob.update({ where: { id: jobId }, data: { status: "running" } });

  try {
    const admin = adminGraphqlClient(shopDomain, accessToken);
    const definitions = await listDefinitions(admin);
    const definition = definitions.find((d) => d.type === type);
    if (!definition) throw new Error(`Definition not found: ${type}`);

    const csvText = await getFileContent(fileUrl);
    const rows = mapRows(
      csvText,
      mapping,
      definition.fieldDefinitions.map((f) => ({ key: f.key, type: f.type, required: f.required })),
    );

    const failures: CsvRow[] = [];
    let success = 0;

    for (const batch of chunk(rows, 25)) {
      const outcomes = await Promise.all(
        batch.map(async (r): Promise<boolean> => {
          if (r.errors.length) {
            failures.push({ line: String(r.line), handle: r.handle, error: r.errors.join("; ") });
            return false;
          }
          try {
            const res = await upsertEntry(admin, { type, handle: r.handle, fields: r.fields });
            if (res.userErrors.length || !res.entry) {
              failures.push({
                line: String(r.line),
                handle: r.handle,
                error: res.userErrors[0]?.message ?? "Upsert failed",
              });
              return false;
            }
            return true;
          } catch (err) {
            failures.push({
              line: String(r.line),
              handle: r.handle,
              error: err instanceof Error ? err.message : "Upsert failed",
            });
            return false;
          }
        }),
      );
      success += outcomes.filter(Boolean).length;
    }

    let errorReportUrl: string | null = null;
    if (failures.length) {
      const key = buildFileKey(shopId, "metaobject-import-errors", jobId, "csv");
      await uploadFile(key, generateCsv(failures), "text/csv");
      errorReportUrl = key;
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        totalRows: rows.length,
        successRows: success,
        failedRows: failures.length,
        errorReportUrl,
        completedAt: new Date(),
      },
    });

    if (success > 0) {
      await prisma.activityLog.create({
        data: { shopId, action: "metaobject_imported", resourceType: type, rowCount: success },
      });
    }

    await notifyJobFinished({
      shopId,
      type: "import",
      status: "completed",
      fileKey: errorReportUrl,
      fileRole: "errorReport",
      stats: [
        { label: "Entries written", value: String(success) },
        { label: "Entries rejected", value: String(failures.length) },
      ],
    });
  } catch (err) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "failed", completedAt: new Date() },
    });
    await notifyJobFinished({
      shopId,
      type: "import",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

import prisma from "../db.server";
import type { ExportJobData } from "../lib/queue.server";
import { adminGraphqlClient } from "../lib/admin-graphql.server";
import { listDefinitions, listEntries } from "../lib/metaobjects.server";
import { inputKindForType, type MetaobjectFieldValue } from "../lib/metaobjects";
import { generateCsv, type CsvRow } from "../lib/csv.server";
import { uploadFile, buildFileKey } from "../lib/r2.server";
import { notifyJobFinished } from "../lib/notify.server";

/**
 * Flat one-row-per-entry CSV export for metaobjects (the key differentiator).
 * Columns: "handle" + each field key. Reference/typed values are flattened to
 * friendly forms (file URL, referenced handle, ISO date, true/false).
 */

function flatValue(field: MetaobjectFieldValue | undefined): string {
  if (!field) return "";
  const kind = inputKindForType(field.type);
  switch (kind) {
    case "file":
      return field.fileUrl ?? field.value;
    case "metaobject":
      return field.refHandle ?? field.value;
    default:
      // boolean already "true"/"false", date/date_time already ISO.
      return field.value;
  }
}

export async function processMetaobjectExport(data: ExportJobData): Promise<void> {
  const { jobId, shopId, shopDomain, accessToken } = data;
  const type = data.resourceType ?? "";

  await prisma.exportJob.update({ where: { id: jobId }, data: { status: "running" } });

  try {
    const admin = adminGraphqlClient(shopDomain, accessToken);

    const definitions = await listDefinitions(admin);
    const definition = definitions.find((d) => d.type === type);
    if (!definition) throw new Error(`Definition not found: ${type}`);
    const fieldKeys = definition.fieldDefinitions.map((f) => f.key);

    // Page through all entries.
    const rows: CsvRow[] = [];
    let after: string | null = null;
    do {
      const page = await listEntries(admin, { type, first: 100, after });
      for (const entry of page.entries) {
        const row: CsvRow = { handle: entry.handle };
        for (const key of fieldKeys) row[key] = flatValue(entry.fields[key]);
        rows.push(row);
      }
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);

    // Always emit headers, even with zero entries.
    const csv = rows.length
      ? generateCsv(rows)
      : ["handle", ...fieldKeys].join(",");

    const key = buildFileKey(shopId, "metaobject-export", jobId, "csv");
    await uploadFile(key, csv, "text/csv");

    await prisma.exportJob.update({
      where: { id: jobId },
      data: { status: "completed", fileUrl: key, completedAt: new Date() },
    });

    await notifyJobFinished({
      shopId,
      type: "export",
      status: "completed",
      fileKey: key,
      fileRole: "result",
    });
  } catch (err) {
    await prisma.exportJob.update({
      where: { id: jobId },
      data: { status: "failed", completedAt: new Date() },
    });
    await notifyJobFinished({
      shopId,
      type: "export",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

import { Worker } from "bullmq";
import prisma from "../db.server";
import { QUEUE_NAMES, redisConnection, type ExportJobData } from "../lib/queue.server";
import { adminGraphqlClient } from "../lib/admin-graphql.server";
import { generateCsv, type CsvRow } from "../lib/csv.server";
import { uploadFile, buildFileKey } from "../lib/r2.server";
import { OWNER_CONFIG, isOwnerType, type OwnerType } from "../lib/metafields";
import { notifyJobFinished } from "../lib/notify.server";

/**
 * Bulk export pipeline:
 *   bulkOperationRunQuery → poll currentBulkOperation → download JSONL →
 *   flatten to one-row-per-metafield CSV → upload to R2 → mark ExportJob done.
 */

const START_MUTATION = `#graphql
  mutation StartBulkExport($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }`;

const POLL_QUERY = `#graphql
  query CurrentBulkExport {
    currentBulkOperation(type: QUERY) {
      id
      status
      errorCode
      objectCount
      url
    }
  }`;

/** Per-owner-type bulk query — one row per owner, with its metafields nested. */
function bulkQueryFor(ownerType: OwnerType): string {
  const cfg = OWNER_CONFIG[ownerType];
  return `{
    ${cfg.field} {
      edges {
        node {
          id
          ${cfg.labelField}
          metafields {
            edges { node { namespace key value type } }
          }
        }
      }
    }
  }`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Parse Shopify bulk JSONL (flat lines linked by __parentId) into flat CSV rows.
 * Owner lines have no __parentId; metafield lines reference their owner via it.
 */
export function transformBulkJsonl(jsonl: string, ownerType: OwnerType): CsvRow[] {
  const cfg = OWNER_CONFIG[ownerType];
  const ownerLabels = new Map<string, string>();
  const metafields: Array<Record<string, string>> = [];

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof obj.__parentId === "string") {
      metafields.push(obj as Record<string, string>);
    } else if (typeof obj.id === "string") {
      const label = obj[cfg.labelField];
      ownerLabels.set(obj.id, typeof label === "string" ? label : obj.id);
    }
  }

  return metafields.map((m) => ({
    owner_type: ownerType.toLowerCase(),
    owner_id: String(m.__parentId ?? ""),
    owner: ownerLabels.get(String(m.__parentId ?? "")) ?? "",
    namespace: String(m.namespace ?? ""),
    key: String(m.key ?? ""),
    type: String(m.type ?? ""),
    value: String(m.value ?? ""),
  }));
}

export async function processExportJob(data: ExportJobData): Promise<void> {
  if (data.type === "metaobjects") {
    const { processMetaobjectExport } = await import("./metaobject-export.server");
    return processMetaobjectExport(data);
  }

  const { jobId, shopId, shopDomain, accessToken } = data;
  const ownerType: OwnerType =
    data.resourceType && isOwnerType(data.resourceType) ? data.resourceType : "PRODUCT";

  await prisma.exportJob.update({ where: { id: jobId }, data: { status: "running" } });

  try {
    const admin = adminGraphqlClient(shopDomain, accessToken);

    // 1. Kick off the bulk operation.
    const startRes = await admin.graphql(START_MUTATION, {
      variables: { query: bulkQueryFor(ownerType) },
    });
    const startBody = (await startRes.json()) as {
      data?: { bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: Array<{ message: string }> } };
    };
    const userErrors = startBody.data?.bulkOperationRunQuery.userErrors ?? [];
    if (userErrors.length || !startBody.data?.bulkOperationRunQuery.bulkOperation) {
      throw new Error(userErrors.map((e) => e.message).join("; ") || "Failed to start bulk export");
    }

    // 2. Poll until the operation completes.
    let downloadUrl: string | null = null;
    const maxPolls = 120; // ~10 min at 5s intervals
    for (let i = 0; i < maxPolls; i++) {
      await sleep(5000);
      const pollRes = await admin.graphql(POLL_QUERY);
      const pollBody = (await pollRes.json()) as {
        data?: { currentBulkOperation: { status: string; errorCode: string | null; url: string | null } | null };
      };
      const op = pollBody.data?.currentBulkOperation;
      if (!op) continue;
      if (op.status === "COMPLETED") {
        downloadUrl = op.url;
        break;
      }
      if (op.status === "FAILED" || op.status === "CANCELED") {
        throw new Error(`Bulk export ${op.status}${op.errorCode ? `: ${op.errorCode}` : ""}`);
      }
    }

    // 3. Download + transform. A null url means the result set was empty.
    let csv = "";
    let rowCount = 0;
    if (downloadUrl) {
      const jsonl = await (await fetch(downloadUrl)).text();
      const rows = transformBulkJsonl(jsonl, ownerType);
      rowCount = rows.length;
      csv = generateCsv(rows);
    }
    if (!csv) {
      // Header-only file so the download is still valid.
      csv = "owner_type,owner_id,owner,namespace,key,type,value";
    }

    // 4. Upload to R2 and finalize.
    const key = buildFileKey(shopId, "export", jobId, "csv");
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
      stats: [
        { label: "Resource type", value: OWNER_CONFIG[ownerType].label },
        { label: "Metafields exported", value: String(rowCount) },
      ],
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

export function createExportWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.EXPORT,
    async (job) => {
      await processExportJob(job.data as ExportJobData);
    },
    { connection: redisConnection },
  );
}

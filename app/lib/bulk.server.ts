/**
 * Shopify bulk operations (bulkOperationRunQuery).
 *
 * Paginating a whole store's metafields 50 owners at a time burns rate limit
 * and takes minutes on a large catalog. A bulk operation hands the query to
 * Shopify, which runs it asynchronously and produces a JSONL file — one line
 * per node, with child nodes carrying a `__parentId` pointing at their parent.
 *
 * Only one bulk *query* can run per app+shop at a time, so `runBulkQuery`
 * serializes by cancelling any operation left behind by an earlier run.
 */

import { graphqlRequest, type AdminClient } from "./graphql.server";

const RUN_MUTATION = `#graphql
  mutation BulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }`;

const CURRENT_QUERY = `#graphql
  query CurrentBulkOperation {
    currentBulkOperation(type: QUERY) {
      id
      status
      errorCode
      objectCount
      url
    }
  }`;

const CANCEL_MUTATION = `#graphql
  mutation BulkOperationCancel($id: ID!) {
    bulkOperationCancel(id: $id) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }`;

type BulkOperation = {
  id: string;
  status: string;
  errorCode: string | null;
  objectCount: string | null;
  url: string | null;
};

/** Statuses that mean the operation is no longer occupying the shop's slot. */
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELED", "EXPIRED"]);

async function currentOperation(admin: AdminClient): Promise<BulkOperation | null> {
  const data = await graphqlRequest<{ currentBulkOperation: BulkOperation | null }>(
    admin,
    CURRENT_QUERY,
  );
  return data.currentBulkOperation;
}

async function cancelIfRunning(admin: AdminClient): Promise<void> {
  const op = await currentOperation(admin);
  if (!op || TERMINAL.has(op.status)) return;
  try {
    await graphqlRequest(admin, CANCEL_MUTATION, { id: op.id });
  } catch {
    // Racing with Shopify finishing the op is fine — the poll below handles it.
  }
  // Give the cancel a moment to land before claiming the slot.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const next = await currentOperation(admin);
    if (!next || TERMINAL.has(next.status)) return;
  }
}

export type BulkQueryOptions = {
  /** Give up after this long. Defaults to 10 minutes. */
  timeoutMs?: number;
  /** Delay between status polls. Defaults to 2s. */
  pollIntervalMs?: number;
};

/**
 * Run `query` as a bulk operation and return the resulting JSONL rows, already
 * parsed. Resolves to an empty array when the operation produced no objects
 * (Shopify returns a null url in that case).
 */
export async function runBulkQuery<T = Record<string, unknown>>(
  admin: AdminClient,
  query: string,
  { timeoutMs = 10 * 60_000, pollIntervalMs = 2000 }: BulkQueryOptions = {},
): Promise<T[]> {
  await cancelIfRunning(admin);

  const started = await graphqlRequest<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(admin, RUN_MUTATION, { query });

  const errors = started.bulkOperationRunQuery.userErrors;
  if (errors.length) {
    throw new Error(`Bulk query rejected: ${errors.map((e) => e.message).join("; ")}`);
  }

  const deadline = Date.now() + timeoutMs;
  let op: BulkOperation | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    op = await currentOperation(admin);
    if (op && TERMINAL.has(op.status)) break;
  }

  if (!op || !TERMINAL.has(op.status)) {
    throw new Error("Bulk query timed out");
  }
  if (op.status !== "COMPLETED") {
    throw new Error(`Bulk query ${op.status.toLowerCase()}${op.errorCode ? `: ${op.errorCode}` : ""}`);
  }
  // No matching objects — Shopify omits the result file entirely.
  if (!op.url) return [];

  const res = await fetch(op.url);
  if (!res.ok) throw new Error(`Could not download bulk result (HTTP ${res.status})`);
  const body = await res.text();

  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

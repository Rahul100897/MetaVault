import { parseCsv, type CsvRow } from "./csv.server";
import type { MetafieldSetInput } from "./metafields";

/**
 * Shared CSV import validation, used both for the dry-run preview (in the route
 * action) and the actual import (in the worker), so the rules never drift.
 *
 * Expected flat format (same as export):
 *   owner_id, namespace, key, type, value   (owner_type, owner are optional)
 */

export const IMPORT_COLUMNS = ["owner_id", "namespace", "key", "type", "value"] as const;

export type ValidatedRow = {
  /** 1-based row number in the source CSV (excludes header). */
  line: number;
  raw: CsvRow;
  input: MetafieldSetInput | null;
  errors: string[];
};

export type ValidationSummary = {
  rows: ValidatedRow[];
  total: number;
  valid: number;
  invalid: number;
  missingColumns: string[];
};

function validateRow(raw: CsvRow): { input: MetafieldSetInput | null; errors: string[] } {
  const errors: string[] = [];
  const ownerId = (raw.owner_id ?? "").trim();
  const namespace = (raw.namespace ?? "").trim();
  const key = (raw.key ?? "").trim();
  const type = (raw.type ?? "").trim();
  const value = raw.value ?? "";

  if (!ownerId) errors.push("owner_id is required");
  else if (!ownerId.startsWith("gid://shopify/")) errors.push("owner_id must be a Shopify GID (gid://shopify/…)");

  if (!namespace) errors.push("namespace is required");
  else if (namespace.length > 255) errors.push("namespace exceeds 255 characters");

  if (!key) errors.push("key is required");
  else if (key.length > 64) errors.push("key exceeds 64 characters");

  if (!type) errors.push("type is required");

  if (errors.length) return { input: null, errors };
  return { input: { ownerId, namespace, key, type, value }, errors };
}

export function validateImportCsv(csvText: string): ValidationSummary {
  const parsed = parseCsv(csvText);
  const headers = parsed.length ? Object.keys(parsed[0]) : [];
  const missingColumns = IMPORT_COLUMNS.filter(
    (c) => c !== "value" && !headers.includes(c),
  );

  const rows: ValidatedRow[] = parsed.map((raw, i) => {
    const { input, errors } = validateRow(raw);
    return { line: i + 1, raw, input, errors };
  });

  return {
    rows,
    total: rows.length,
    valid: rows.filter((r) => r.input).length,
    invalid: rows.filter((r) => !r.input).length,
    missingColumns,
  };
}

import { parseCsv } from "./csv.server";
import { inputKindForType } from "./metaobjects";
import type { FieldInput } from "./metaobjects.server";

/**
 * Shared metaobject CSV import logic: applies a column→field mapping, validates
 * values by field type, and classifies rows. Used by both the dry-run preview
 * (route action) and the worker so the rules never drift.
 */

export type MoFieldDefLite = { key: string; type: string; required: boolean };

export type MappedRow = {
  line: number;
  handle: string;
  fields: FieldInput[];
  errors: string[];
};

export function validateFieldValue(type: string, value: string): string | null {
  if (value === "") return null;
  switch (inputKindForType(type)) {
    case "number":
      return /^-?\d+(\.\d+)?$/.test(value) ? null : "must be a number";
    case "boolean":
      return value === "true" || value === "false" ? null : 'must be "true" or "false"';
    case "url":
      try {
        new URL(value);
        return null;
      } catch {
        return "must be a valid URL";
      }
    case "date":
    case "datetime":
      return Number.isNaN(Date.parse(value)) ? "must be a valid date" : null;
    default:
      return null;
  }
}

/** Map parsed CSV rows to {handle, fields} using the column mapping. */
export function mapRows(
  csvText: string,
  mapping: Record<string, string>,
  fieldDefs: MoFieldDefLite[],
): MappedRow[] {
  const parsed = parseCsv(csvText);
  const defByKey = new Map(fieldDefs.map((f) => [f.key, f]));

  return parsed.map((raw, i) => {
    const errors: string[] = [];
    let handle = "";
    const fields: FieldInput[] = [];

    for (const [col, target] of Object.entries(mapping)) {
      if (!target) continue;
      const value = raw[col] ?? "";
      if (target === "handle") {
        handle = value.trim();
        continue;
      }
      const def = defByKey.get(target);
      if (!def) continue;
      const err = validateFieldValue(def.type, value);
      if (err) errors.push(`${def.key}: ${err}`);
      if (value !== "") fields.push({ key: target, value });
    }

    if (!handle) errors.push("handle is required");
    for (const f of fieldDefs) {
      if (f.required && !fields.some((x) => x.key === f.key)) {
        errors.push(`${f.key} is required`);
      }
    }

    return { line: i + 1, handle, fields, errors };
  });
}

export type ImportAnalysis = {
  total: number;
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  errors: Array<{ line: number; handle: string; message: string }>;
};

export function analyzeImport(rows: MappedRow[], existing: Set<string>): ImportAnalysis {
  let willCreate = 0;
  let willUpdate = 0;
  let willSkip = 0;
  const errors: ImportAnalysis["errors"] = [];

  for (const r of rows) {
    if (r.errors.length) {
      willSkip++;
      errors.push({ line: r.line, handle: r.handle, message: r.errors.join("; ") });
      continue;
    }
    if (existing.has(r.handle)) willUpdate++;
    else willCreate++;
  }

  return { total: rows.length, willCreate, willUpdate, willSkip, errors };
}

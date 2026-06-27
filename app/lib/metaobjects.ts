/**
 * Client-safe metaobject types and pure helpers (no network, no secrets).
 * Imported by both route components and server code. GraphQL operations live
 * in metaobjects.server.ts.
 */

export type MoFieldDef = {
  key: string;
  name: string;
  type: string;
  required: boolean;
};

export type MetaobjectDefinitionSummary = {
  id: string;
  type: string;
  name: string;
  displayNameKey: string | null;
  publishable: boolean;
  fieldDefinitions: MoFieldDef[];
  entryCount: number;
};

/** A single field value on an entry, with server-resolved reference info. */
export type MetaobjectFieldValue = {
  key: string;
  value: string; // raw value (GID for references, "true"/"false" for booleans, etc.)
  type: string;
  refDisplay?: string | null; // referenced metaobject display name
  refHandle?: string | null; // referenced metaobject handle (used in flat CSV)
  fileUrl?: string | null; // resolved file/image URL
  thumbnailUrl?: string | null; // image URL for a thumbnail
  fileName?: string | null;
};

export type MetaobjectEntry = {
  id: string;
  handle: string;
  displayName: string;
  status: string | null; // "ACTIVE" | "DRAFT" | null (non-publishable)
  updatedAt: string;
  fields: Record<string, MetaobjectFieldValue>;
};

export type MetaobjectPage = {
  entries: MetaobjectEntry[];
  hasNextPage: boolean;
  endCursor: string | null;
};

/** Input kind used to choose the editor control and rendering for a field. */
export type FieldKind =
  | "text"
  | "multiline"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "url"
  | "file"
  | "metaobject"
  | "json"
  | "other";

export function inputKindForType(type: string): FieldKind {
  switch (type) {
    case "single_line_text_field":
      return "text";
    case "multi_line_text_field":
      return "multiline";
    case "number_integer":
    case "number_decimal":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "date_time":
      return "datetime";
    case "url":
      return "url";
    case "file_reference":
    case "image_reference":
      return "file";
    case "metaobject_reference":
      return "metaobject";
    case "json":
      return "json";
    default:
      return type.startsWith("list.") ? "other" : "other";
  }
}

export function isReferenceType(type: string): boolean {
  return type.endsWith("_reference") || type.startsWith("list.");
}

/** Slugify a string into a valid metaobject handle. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
}

export function truncate(value: string, max = 40): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}

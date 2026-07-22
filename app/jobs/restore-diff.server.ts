/**
 * Restore planning.
 *
 * Restoring overwrites live data, so it runs in two steps: build a diff of the
 * snapshot against the current store, show the merchant what will change, and
 * only then execute. This module is step one.
 *
 * The diff is computed in the worker (not in a loader) because it reads the
 * store's entire metafield and metaobject set, which can take minutes.
 */

import {
  collectMetafieldDefinitions,
  collectMetafields,
  collectMetaobjectDefinitions,
  collectMetaobjects,
  type Admin,
  type Snapshot,
} from "./snapshot.server";

/** How many example rows we keep per bucket; counts are always exact. */
const SAMPLE_LIMIT = 200;

export type DiffEntry = {
  kind: "metafield" | "metaobject" | "metafield-definition" | "metaobject-definition";
  /** Human-readable identifier, e.g. "product · specs.material". */
  label: string;
  /** What changes, e.g. "\"cotton\" → \"linen\"". */
  detail: string;
};

export type RestoreDiff = {
  snapshotCreatedAt: string;
  snapshotShop: string;
  counts: {
    create: number;
    update: number;
    skip: number;
    definitions: number;
  };
  /** Capped at SAMPLE_LIMIT each — see `truncated`. */
  create: DiffEntry[];
  update: DiffEntry[];
  skip: DiffEntry[];
  definitions: DiffEntry[];
  truncated: boolean;
};

function metafieldId(m: { ownerId: string; namespace: string; key: string }): string {
  return `${m.ownerId}|${m.namespace}|${m.key}`;
}

function metaobjectId(m: { type: string; handle: string }): string {
  return `${m.type}|${m.handle}`;
}

/** Stable serialization of an entry's fields, so ordering doesn't read as a change. */
function serializeFields(fields: Array<{ key: string; value: string }>): string {
  return JSON.stringify(
    [...fields].sort((a, b) => a.key.localeCompare(b.key)).map((f) => [f.key, f.value]),
  );
}

function preview(value: string, max = 40): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

export async function buildRestoreDiff(admin: Admin, snapshot: Snapshot): Promise<RestoreDiff> {
  // Bulk metafield collection holds the shop's single bulk-query slot, so it
  // runs before anything else that might contend for it.
  const liveMetafields = await collectMetafields(admin);
  const [liveMetaobjects, liveMetafieldDefs, liveMetaobjectDefs] = await Promise.all([
    collectMetaobjects(admin),
    collectMetafieldDefinitions(admin),
    collectMetaobjectDefinitions(admin),
  ]);

  const liveMetafieldByKey = new Map(liveMetafields.map((m) => [metafieldId(m), m.value]));
  const liveMetaobjectByKey = new Map(
    liveMetaobjects.map((m) => [metaobjectId(m), serializeFields(m.fields)]),
  );

  const create: DiffEntry[] = [];
  const update: DiffEntry[] = [];
  const skip: DiffEntry[] = [];
  const definitions: DiffEntry[] = [];
  const counts = { create: 0, update: 0, skip: 0, definitions: 0 };
  let truncated = false;

  const push = (bucket: DiffEntry[], key: keyof typeof counts, entry: DiffEntry) => {
    counts[key]++;
    if (bucket.length < SAMPLE_LIMIT) bucket.push(entry);
    else truncated = true;
  };

  // --- metafields ---
  for (const m of snapshot.metafields ?? []) {
    const label = `${m.ownerType.toLowerCase()} · ${m.namespace}.${m.key}`;
    const current = liveMetafieldByKey.get(metafieldId(m));
    if (current === undefined) {
      push(create, "create", { kind: "metafield", label, detail: preview(m.value) });
    } else if (current !== m.value) {
      push(update, "update", {
        kind: "metafield",
        label,
        detail: `${preview(current, 24)} → ${preview(m.value, 24)}`,
      });
    } else {
      push(skip, "skip", { kind: "metafield", label, detail: "unchanged" });
    }
  }

  // --- metaobjects ---
  for (const m of snapshot.metaobjects ?? []) {
    const label = `${m.type} · ${m.handle}`;
    const current = liveMetaobjectByKey.get(metaobjectId(m));
    const next = serializeFields(m.fields);
    if (current === undefined) {
      push(create, "create", {
        kind: "metaobject",
        label,
        detail: `${m.fields.length} field${m.fields.length === 1 ? "" : "s"}`,
      });
    } else if (current !== next) {
      push(update, "update", {
        kind: "metaobject",
        label,
        detail: "field values differ",
      });
    } else {
      push(skip, "skip", { kind: "metaobject", label, detail: "unchanged" });
    }
  }

  // --- definitions that the target store is missing ---
  const liveMetafieldDefKeys = new Set(
    liveMetafieldDefs.map((d) => `${d.ownerType}|${d.namespace}|${d.key}`),
  );
  for (const d of snapshot.metafieldDefinitions ?? []) {
    if (liveMetafieldDefKeys.has(`${d.ownerType}|${d.namespace}|${d.key}`)) continue;
    push(definitions, "definitions", {
      kind: "metafield-definition",
      label: `${d.ownerType.toLowerCase()} · ${d.namespace}.${d.key}`,
      detail: d.name,
    });
  }

  const liveMetaobjectDefTypes = new Set(liveMetaobjectDefs.map((d) => d.type));
  // v1 snapshots predate stored definitions — derive the types from the entries
  // themselves so an old snapshot still reports what's missing.
  const snapshotMetaobjectDefs =
    snapshot.metaobjectDefinitions ??
    [...new Set((snapshot.metaobjects ?? []).map((m) => m.type))].map((type) => ({
      type,
      name: type,
    }));
  for (const d of snapshotMetaobjectDefs) {
    if (liveMetaobjectDefTypes.has(d.type)) continue;
    push(definitions, "definitions", {
      kind: "metaobject-definition",
      label: d.type,
      detail: d.name,
    });
  }

  return {
    snapshotCreatedAt: snapshot.createdAt,
    snapshotShop: snapshot.shop,
    counts,
    create,
    update,
    skip,
    definitions,
    truncated,
  };
}

/**
 * Snapshot shape and collection.
 *
 * Shared by the backup writer (backup.server.ts) and the restore diff planner
 * (restore-diff.server.ts), which both need to read the store's current
 * metafields, metaobjects and definitions.
 */

import type { adminGraphqlClient } from "../lib/admin-graphql.server";
import { listMetafields, listMetafieldDefinitions } from "../lib/metafields.server";
import { OWNER_CONFIG, OWNER_TYPES, type OwnerType } from "../lib/metafields";
import { listDefinitions, listEntries } from "../lib/metaobjects.server";
import { runBulkQuery } from "../lib/bulk.server";

/**
 * v1 snapshots carry data only. v2 adds the definitions behind that data, so a
 * restore into a different store can report which definitions are missing.
 */
export const BACKUP_VERSION = 2;

export type SnapshotMetafield = {
  ownerType: string;
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export type SnapshotMetaobject = {
  type: string;
  handle: string;
  status: string | null;
  fields: Array<{ key: string; value: string }>;
};

export type SnapshotMetafieldDefinition = {
  ownerType: string;
  namespace: string;
  key: string;
  name: string;
};

export type SnapshotMetaobjectDefinition = {
  type: string;
  name: string;
};

export type Snapshot = {
  version: number;
  shop: string;
  createdAt: string;
  metafields: SnapshotMetafield[];
  metaobjects: SnapshotMetaobject[];
  /** Absent on v1 snapshots. */
  metafieldDefinitions?: SnapshotMetafieldDefinition[];
  /** Absent on v1 snapshots. */
  metaobjectDefinitions?: SnapshotMetaobjectDefinition[];
};

export type Admin = ReturnType<typeof adminGraphqlClient>;

// --- Metafields --------------------------------------------------------------

/** A metafield line from a bulk result: children carry their owner's GID. */
type BulkMetafieldLine = {
  id: string;
  namespace?: string;
  key?: string;
  value?: string;
  type?: string;
  __parentId?: string;
};

/**
 * One bulk query per owner type. Bulk results are flat JSONL: the owner node
 * arrives on its own line and each of its metafields follows with a
 * `__parentId` back-reference, which is the ownerId we need for restore.
 */
async function collectMetafieldsBulk(
  admin: Admin,
  ownerType: OwnerType,
): Promise<SnapshotMetafield[]> {
  const cfg = OWNER_CONFIG[ownerType];
  const query = `
    {
      ${cfg.field} {
        edges {
          node {
            id
            metafields {
              edges { node { id namespace key value type } }
            }
          }
        }
      }
    }`;

  const lines = await runBulkQuery<BulkMetafieldLine>(admin, query);
  const out: SnapshotMetafield[] = [];
  for (const line of lines) {
    // Owner lines have no __parentId; only metafield children do.
    if (!line.__parentId || !line.namespace || !line.key) continue;
    out.push({
      ownerType,
      ownerId: line.__parentId,
      namespace: line.namespace,
      key: line.key,
      type: line.type ?? "single_line_text_field",
      value: line.value ?? "",
    });
  }
  return out;
}

/** Cursor-paginated collection — the fallback when a bulk query isn't usable. */
async function collectMetafieldsPaged(
  admin: Admin,
  ownerType: OwnerType,
): Promise<SnapshotMetafield[]> {
  const out: SnapshotMetafield[] = [];
  let after: string | null = null;
  do {
    const page = await listMetafields(admin, { ownerType, first: 50, after });
    for (const r of page.rows) {
      out.push({
        ownerType,
        ownerId: r.ownerId,
        namespace: r.namespace,
        key: r.key,
        type: r.type,
        value: r.value,
      });
    }
    after = page.hasNextPage ? page.endCursor : null;
  } while (after);
  return out;
}

export async function collectMetafields(admin: Admin): Promise<SnapshotMetafield[]> {
  const out: SnapshotMetafield[] = [];
  // Sequential, not parallel: a shop may only run one bulk query at a time.
  for (const ownerType of OWNER_TYPES as OwnerType[]) {
    try {
      out.push(...(await collectMetafieldsBulk(admin, ownerType)));
    } catch (err) {
      // Bulk can be unavailable for a resource (e.g. protected customer data
      // not yet granted). Losing a whole owner type would silently produce an
      // incomplete snapshot, so fall back to paging it.
      // eslint-disable-next-line no-console
      console.warn(
        `[metavault] bulk metafield query failed for ${ownerType}, paging instead:`,
        err instanceof Error ? err.message : err,
      );
      out.push(...(await collectMetafieldsPaged(admin, ownerType)));
    }
  }
  return out;
}

// --- Metaobjects -------------------------------------------------------------

export async function collectMetaobjects(admin: Admin): Promise<SnapshotMetaobject[]> {
  const out: SnapshotMetaobject[] = [];
  const definitions = await listDefinitions(admin);
  for (const def of definitions) {
    let after: string | null = null;
    do {
      const page = await listEntries(admin, { type: def.type, first: 100, after });
      for (const e of page.entries) {
        out.push({
          type: def.type,
          handle: e.handle,
          status: e.status,
          fields: Object.values(e.fields).map((f) => ({ key: f.key, value: f.value })),
        });
      }
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);
  }
  return out;
}

// --- Definitions -------------------------------------------------------------

export async function collectMetafieldDefinitions(
  admin: Admin,
): Promise<SnapshotMetafieldDefinition[]> {
  const out: SnapshotMetafieldDefinition[] = [];
  for (const ownerType of OWNER_TYPES as OwnerType[]) {
    try {
      const defs = await listMetafieldDefinitions(admin, ownerType);
      for (const d of defs) {
        out.push({ ownerType, namespace: d.namespace, key: d.key, name: d.name });
      }
    } catch {
      // A denied owner type just contributes no definitions.
    }
  }
  return out;
}

export async function collectMetaobjectDefinitions(
  admin: Admin,
): Promise<SnapshotMetaobjectDefinition[]> {
  const defs = await listDefinitions(admin);
  return defs.map((d) => ({ type: d.type, name: d.name }));
}

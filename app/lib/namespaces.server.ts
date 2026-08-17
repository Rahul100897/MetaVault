/**
 * Namespace inspection.
 *
 * A namespace groups a store's metafields. Some are backed by metafield
 * definitions or owned by an installed app (Shopify-managed, safe); the rest
 * are ad-hoc namespaces whose definitions were deleted or which a since-removed
 * app left behind — "orphan" namespaces worth reviewing and possibly clearing.
 */

import {
  listMetafields,
  listMetafieldDefinitions,
  deleteMetafields,
  type AdminClient,
} from "./metafields.server";
import { OWNER_TYPES, chunk, type OwnerType } from "./metafields";

/**
 * Prefixes Shopify manages itself. App-owned metafields use the reserved
 * `app--{id}--…` form; `shopify` covers standard/reserved namespaces. These are
 * never orphans — deleting them would fight the platform.
 */
const RESERVED_PREFIXES = ["app--", "shopify--", "shopify"];

function isReservedNamespace(namespace: string): boolean {
  return RESERVED_PREFIXES.some((p) => namespace === p || namespace.startsWith(p));
}

export type NamespaceSummary = {
  namespace: string;
  count: number;
  ownerTypes: OwnerType[];
  hasDefinition: boolean;
  reserved: boolean;
  status: "active" | "orphan";
};

/** A metafield identifier, the unit metafieldsDelete operates on. */
export type NamespaceMetafield = {
  ownerType: OwnerType;
  ownerId: string;
  namespace: string;
  key: string;
};

type Scan = {
  summaries: NamespaceSummary[];
  scanned: number;
};

/**
 * Walk every owner type, grouping metafields by namespace. A namespace is
 * "active" if it has a definition or is Shopify-reserved; everything else is an
 * "orphan" candidate.
 */
export async function scanNamespaces(admin: AdminClient): Promise<Scan> {
  const byNamespace = new Map<
    string,
    { count: number; ownerTypes: Set<OwnerType>; hasDefinition: boolean }
  >();
  let scanned = 0;

  const ensure = (namespace: string) => {
    let entry = byNamespace.get(namespace);
    if (!entry) {
      entry = { count: 0, ownerTypes: new Set(), hasDefinition: false };
      byNamespace.set(namespace, entry);
    }
    return entry;
  };

  for (const ownerType of OWNER_TYPES as OwnerType[]) {
    try {
      // Definitions first: a namespace can be "active" even with zero live values.
      const defs = await listMetafieldDefinitions(admin, ownerType);
      for (const d of defs) {
        ensure(d.namespace).hasDefinition = true;
      }

      let after: string | null = null;
      do {
        const page = await listMetafields(admin, { ownerType, first: 50, after });
        for (const row of page.rows) {
          scanned++;
          const entry = ensure(row.namespace);
          entry.count++;
          entry.ownerTypes.add(ownerType);
        }
        after = page.hasNextPage ? page.endCursor : null;
      } while (after);
    } catch (err) {
      // Skip owner types the app can't read (e.g. Customers/Orders without
      // Protected Customer Data approval) rather than failing the whole scan.
      // eslint-disable-next-line no-console
      console.warn(
        `[metavault] namespace scan skipping ${ownerType}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const summaries: NamespaceSummary[] = [...byNamespace.entries()]
    .map(([namespace, e]) => {
      const reserved = isReservedNamespace(namespace);
      const active = e.hasDefinition || reserved;
      return {
        namespace,
        count: e.count,
        ownerTypes: [...e.ownerTypes],
        hasDefinition: e.hasDefinition,
        reserved,
        status: active ? ("active" as const) : ("orphan" as const),
      };
    })
    // Only namespaces that actually hold data are worth listing/deleting.
    .filter((s) => s.count > 0)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "orphan" ? -1 : 1;
      return b.count - a.count;
    });

  return { summaries, scanned };
}

/** Every metafield identifier in a namespace, across all owner types. */
export async function collectNamespaceMetafields(
  admin: AdminClient,
  namespace: string,
): Promise<NamespaceMetafield[]> {
  const out: NamespaceMetafield[] = [];
  for (const ownerType of OWNER_TYPES as OwnerType[]) {
    try {
      let after: string | null = null;
      do {
        // Filter in the query, not in the loop: this used to pull every
        // metafield on every owner and discard the ones in other namespaces.
        const page = await listMetafields(admin, { ownerType, first: 50, after, namespace });
        for (const row of page.rows) {
          out.push({ ownerType, ownerId: row.ownerId, namespace: row.namespace, key: row.key });
        }
        after = page.hasNextPage ? page.endCursor : null;
      } while (after);
    } catch {
      // Inaccessible owner type — skip (see scanNamespaces).
    }
  }
  return out;
}

/** Delete every metafield in a namespace, 25 per request. */
export async function deleteNamespace(
  admin: AdminClient,
  namespace: string,
): Promise<{ deleted: number; failed: number }> {
  const items = await collectNamespaceMetafields(admin, namespace);
  let deleted = 0;
  let failed = 0;

  for (const batch of chunk(items, 25)) {
    try {
      const result = await deleteMetafields(
        admin,
        batch.map(({ ownerId, namespace: ns, key }) => ({ ownerId, namespace: ns, key })),
      );
      deleted += result.deletedMetafields.length;
      failed += batch.length - result.deletedMetafields.length;
    } catch {
      failed += batch.length;
    }
  }

  return { deleted, failed };
}

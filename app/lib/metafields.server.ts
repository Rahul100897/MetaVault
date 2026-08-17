/**
 * Metafields GraphQL operations.
 *
 * Shopify has no single "list all metafields" query — metafields belong to an
 * owner resource (products, collections, customers, orders). We query the owner
 * connection and flatten each owner's metafields into one row per metafield,
 * which is what the spreadsheet editor renders.
 *
 * Client-safe types/constants/helpers live in ./metafields.ts.
 */

import {
  OWNER_CONFIG,
  type OwnerType,
  type MetafieldPage,
  type MetafieldRow,
  type MetafieldSetInput,
  type SetResult,
  type MetafieldIdentifier,
  type DeleteResult,
} from "./metafields";
// Backoff + response parsing live in ./graphql.server so there is one place
// that knows Shopify's error shapes. Shopify mutations are rate limited, so
// every mutation goes through `withBackoff`, which retries THROTTLED and
// nothing else. `parseGraphql` is a local alias — the call sites below read
// better with the shorter name.
import {
  withBackoff,
  parseGraphqlResponse as parseGraphql,
} from "./graphql.server";

// Minimal shape of the Shopify admin GraphQL client from authenticate.admin()
export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * List metafields for an owner type, one row per metafield. Pagination cursors
 * the owner connection, so a page is "up to `first` owners' worth" of rows.
 */
export async function listMetafields(
  admin: AdminClient,
  {
    ownerType,
    first = 25,
    after = null,
    namespace = null,
    search = null,
  }: {
    ownerType: OwnerType;
    first?: number;
    after?: string | null;
    /**
     * Restrict to one namespace, applied by Shopify rather than by us. This is
     * the difference between "filter the rows we happened to load" and "filter
     * the catalog" — without it, a namespace filter over a paged list silently
     * misses everything past the current page.
     *
     * One namespace only: `metafields(namespace:)` takes a single string.
     */
    namespace?: string | null;
    /**
     * Owner search, passed to the owner connection's `query` argument. A bare
     * term does a case-insensitive full-text match on the owner (product title,
     * customer name/email, order name), so no search syntax is imposed on the
     * merchant.
     *
     * Note this matches the **owner**, not metafield keys or values — Shopify
     * offers no cross-owner metafield search, so those stay client-side.
     */
    search?: string | null;
  },
): Promise<MetafieldPage> {
  const cfg = OWNER_CONFIG[ownerType];
  // Null for either variable means "no filter" — verified against the API, not
  // assumed, because a mishandled null would silently return an empty page.
  const query = `#graphql
    query ListMetafields($first: Int!, $after: String, $namespace: String, $query: String) {
      ${cfg.field}(first: $first, after: $after, query: $query) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          ${cfg.labelField}
          metafields(first: 50, namespace: $namespace) {
            nodes { id namespace key value type }
          }
        }
      }
    }`;

  const data = await withBackoff(async () => {
    const res = await admin.graphql(query, {
      variables: {
        first,
        after,
        namespace: namespace || null,
        query: search?.trim() || null,
      },
    });
    return parseGraphql<{
      [field: string]: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          [labelField: string]: unknown;
          metafields: {
            nodes: Array<{
              id: string;
              namespace: string;
              key: string;
              value: string;
              type: string;
            }>;
          };
        }>;
      };
    }>(res);
  });

  const connection = data[cfg.field];
  const rows: MetafieldRow[] = [];
  for (const owner of connection.nodes) {
    const ownerLabel = String(owner[cfg.labelField] ?? owner.id);
    for (const mf of owner.metafields.nodes) {
      rows.push({
        id: mf.id,
        ownerId: owner.id,
        ownerLabel,
        namespace: mf.namespace,
        key: mf.key,
        type: mf.type,
        value: mf.value,
      });
    }
  }

  return {
    rows,
    hasNextPage: connection.pageInfo.hasNextPage,
    endCursor: connection.pageInfo.endCursor,
  };
}

/**
 * All metafield definitions for an owner type. A metafield whose
 * (namespace, key) has no definition is "orphaned" — it still holds data but
 * isn't managed/visible as structured data in the Shopify admin.
 */
export async function listMetafieldDefinitions(
  admin: AdminClient,
  ownerType: OwnerType,
): Promise<Array<{ namespace: string; key: string; name: string }>> {
  const query = `#graphql
    query MetafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!) {
      metafieldDefinitions(ownerType: $ownerType, first: $first) {
        nodes { namespace key name }
      }
    }`;
  const data = await withBackoff(async () => {
    const res = await admin.graphql(query, { variables: { ownerType, first: 250 } });
    return parseGraphql<{
      metafieldDefinitions: { nodes: Array<{ namespace: string; key: string; name: string }> };
    }>(res);
  });
  return data.metafieldDefinitions.nodes;
}

/**
 * Upsert up to 25 metafields atomically (Shopify metafieldsSet constraint).
 * Caller is responsible for chunking larger sets into batches of 25.
 */
export async function setMetafields(
  admin: AdminClient,
  metafields: MetafieldSetInput[],
): Promise<SetResult> {
  if (metafields.length > 25) {
    throw new Error("metafieldsSet accepts at most 25 metafields per request");
  }
  const mutation = `#graphql
    mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value type }
        userErrors { field message code }
      }
    }`;

  return withBackoff(async () => {
    const res = await admin.graphql(mutation, { variables: { metafields } });
    const data = await parseGraphql<{ metafieldsSet: SetResult }>(res);
    return data.metafieldsSet;
  });
}

/** Delete up to 25 metafields by (ownerId, namespace, key) identifier. */
export async function deleteMetafields(
  admin: AdminClient,
  identifiers: MetafieldIdentifier[],
): Promise<DeleteResult> {
  if (identifiers.length > 25) {
    throw new Error("metafieldsDelete accepts at most 25 metafields per request");
  }
  const mutation = `#graphql
    mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { ownerId namespace key }
        userErrors { field message }
      }
    }`;

  return withBackoff(async () => {
    const res = await admin.graphql(mutation, { variables: { metafields: identifiers } });
    const data = await parseGraphql<{ metafieldsDelete: DeleteResult }>(res);
    return data.metafieldsDelete;
  });
}

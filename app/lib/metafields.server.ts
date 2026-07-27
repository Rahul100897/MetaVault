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

// Minimal shape of the Shopify admin GraphQL client from authenticate.admin()
export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Wrap a GraphQL call with exponential backoff on THROTTLED errors and
 * transient network failures. Shopify mutations are rate limited, so every
 * mutation goes through this.
 */
async function withBackoff<T>(
  fn: () => Promise<T>,
  { maxRetries = 5, baseDelayMs = 500 }: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const throttled = isThrottled(err);
      if (!throttled || attempt >= maxRetries) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

function isThrottled(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return /throttl/i.test(message);
}

/** Throw if the GraphQL response carries top-level errors (incl. THROTTLED). */
async function parseGraphql<T>(res: Response): Promise<T> {
  const body = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  if (body.errors?.length) {
    const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
    const message = body.errors.map((e) => e.message).join("; ");
    const error = new Error(throttled ? `THROTTLED: ${message}` : message);
    throw error;
  }
  if (!body.data) throw new Error("Empty GraphQL response");
  return body.data;
}

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
  }: { ownerType: OwnerType; first?: number; after?: string | null },
): Promise<MetafieldPage> {
  const cfg = OWNER_CONFIG[ownerType];
  const query = `#graphql
    query ListMetafields($first: Int!, $after: String) {
      ${cfg.field}(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          ${cfg.labelField}
          metafields(first: 50) {
            nodes { id namespace key value type }
          }
        }
      }
    }`;

  const data = await withBackoff(async () => {
    const res = await admin.graphql(query, { variables: { first, after } });
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

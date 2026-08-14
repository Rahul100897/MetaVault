/**
 * Dashboard stat queries. Kept separate from metafields.server / metaobjects.server
 * because the dashboard spans both domains and only needs cheap aggregates.
 */
import { graphqlRequest, type AdminClient } from "./graphql.server";
import { OWNER_TYPES } from "./metafields";
import type { DefinitionCount, DefinitionCounts } from "./dashboard";

// Page sizes proven elsewhere in this app: 250 for metafieldDefinitions
// (listMetafieldDefinitions) and 100 for metaobjectDefinitions (listDefinitions).
const METAFIELD_PAGE = 250;
const METAOBJECT_PAGE = 100;

type Connection = {
  nodes: Array<{ id: string }>;
  pageInfo: { hasNextPage: boolean };
};

/**
 * Counts metafield and metaobject *definitions* in a single Admin GraphQL
 * request (metafieldDefinitions requires an ownerType, so the owner types are
 * aliased into one query rather than sent as N round trips).
 *
 * Definitions — not values: there is no cheap store-wide count of metafield
 * values, and paginating them would cost many calls on a large store.
 */
export async function countDefinitions(admin: AdminClient): Promise<DefinitionCounts> {
  const ownerAliases = OWNER_TYPES.map(
    (ownerType) =>
      `${ownerType.toLowerCase()}: metafieldDefinitions(ownerType: ${ownerType}, first: ${METAFIELD_PAGE}) {
        nodes { id }
        pageInfo { hasNextPage }
      }`,
  ).join("\n      ");

  const query = `#graphql
    query DashboardDefinitionCounts {
      ${ownerAliases}
      metaobjectDefinitions(first: ${METAOBJECT_PAGE}) {
        nodes { id }
        pageInfo { hasNextPage }
      }
    }`;

  const data = await graphqlRequest<Record<string, Connection>>(admin, query);

  const metafields = OWNER_TYPES.reduce<DefinitionCount>(
    (acc, ownerType) => {
      const conn = data[ownerType.toLowerCase()];
      if (!conn) return acc;
      return {
        total: acc.total + conn.nodes.length,
        capped: acc.capped || conn.pageInfo.hasNextPage,
      };
    },
    { total: 0, capped: false },
  );

  const metaobjectConn = data.metaobjectDefinitions;

  return {
    metafields,
    metaobjects: {
      total: metaobjectConn?.nodes.length ?? 0,
      capped: metaobjectConn?.pageInfo.hasNextPage ?? false,
    },
  };
}

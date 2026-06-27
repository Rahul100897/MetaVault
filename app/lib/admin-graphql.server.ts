import { ApiVersion } from "@shopify/shopify-app-remix/server";
import type { AdminClient } from "./metafields.server";

// Defined locally (not imported from shopify.server) so worker processes don't
// construct the full Shopify app — which would require SHOPIFY_APP_URL.
const apiVersion = ApiVersion.April25;

/**
 * A minimal fetch-based Admin GraphQL client for use OUTSIDE a request context
 * (e.g. BullMQ workers), where `authenticate.admin()` is not available. Built
 * from an offline access token + shop domain. Shape matches AdminClient so the
 * same helpers (listMetafields, setMetafields, …) can be reused.
 */
export function adminGraphqlClient(shop: string, accessToken: string): AdminClient {
  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  return {
    graphql(query: string, options?: { variables?: Record<string, unknown> }) {
      return fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables: options?.variables ?? {} }),
      });
    },
  };
}

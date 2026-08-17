/**
 * Getting a usable Admin client for a store we are NOT currently handling a
 * request from — i.e. the target of a cross-store copy.
 *
 * ## Why this exists
 *
 * `shopify.server` sets `future.expiringOfflineAccessTokens: true`, so the
 * offline access token in the `Session` row **expires after 24 hours**. The row
 * is only rewritten when that store's own merchant opens the app (token
 * exchange) or when something walks the refresh path. Reading `Session`
 * directly and using `accessToken` therefore works right after the target
 * merchant last used MetaVault and 401s for the rest of the day — which is
 * exactly what cross-store copy used to do.
 *
 * `unauthenticated.admin(shop)` is the supported path: it loads the offline
 * session, and if the token is expired (or within 5 minutes of it) it spends
 * the stored refresh token to mint a new one and writes it back.
 *
 * ## Why not the client credentials grant
 *
 * It would be perfect here — client id + secret, no user interaction, straight
 * to a 24h token. But Shopify restricts it to apps installed in stores in your
 * *own* organization; public App Store apps get `shop_not_permitted`. It
 * succeeds against our dev store and would fail for every real merchant, so it
 * is deliberately not used.
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 *
 * That leaves refresh as the only automatic repair. When the refresh token is
 * also dead the only way back is a token exchange, which needs a session token
 * from that store's admin — so the merchant has to open MetaVault there once.
 * `reason: "reauth_required"` says precisely that, instead of surfacing a bare
 * 401 as a copy failure.
 *
 * Server-only, and route-only: it pulls in `shopify.server`, which needs
 * `SHOPIFY_APP_URL`. Worker processes must keep using the job payload's token
 * via `adminGraphqlClient` (see ./admin-graphql.server).
 */

import { SessionNotFoundError } from "@shopify/shopify-app-remix/server";
import { unauthenticated } from "../shopify.server";
import { adminGraphqlClient } from "./admin-graphql.server";
import { graphqlRequest, isAuthError, type AdminClient } from "./graphql.server";

/** Refresh anything this close to expiry, matching the Shopify library's own margin. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export type OfflineAdminResult =
  | { ok: true; admin: AdminClient }
  | { ok: false; reason: "not_installed" | "reauth_required"; error: string };

function notInstalled(shop: string): OfflineAdminResult {
  return {
    ok: false,
    reason: "not_installed",
    error: `MetaVault isn't installed on ${shop}. Install it there, then try again.`,
  };
}

function reauthRequired(shop: string): OfflineAdminResult {
  return {
    ok: false,
    reason: "reauth_required",
    error:
      `MetaVault's access to ${shop} has expired. Open MetaVault on that store once ` +
      `to reconnect it, then try again.`,
  };
}

/**
 * An Admin client for `shop` backed by a token that has been proven to work.
 *
 * The proving matters: this is the last checkpoint before writing to a store
 * other than the one the merchant is looking at, and a dead token would
 * otherwise show up as "0 copied, N failed" with no reason attached.
 */
export async function offlineAdminFor(shop: string): Promise<OfflineAdminResult> {
  let accessToken: string;
  let expires: Date | undefined;

  try {
    // Loads the offline session and refreshes it in place when it is expiring.
    const { session } = await unauthenticated.admin(shop);
    if (!session.accessToken) return notInstalled(shop);
    accessToken = session.accessToken;
    expires = session.expires;
  } catch (err) {
    // SessionNotFoundError when the row is gone (app uninstalled). The Shopify
    // library throws a bare `Response` when a refresh is rejected — that one
    // must not escape, or it would become this route's reply. Match on the
    // class, not `err.name`: ShopifyError leaves that as plain "Error".
    if (err instanceof SessionNotFoundError) return notInstalled(shop);
    return reauthRequired(shop);
  }

  // A session that is still expired here had no usable refresh token, so
  // `unauthenticated.admin` handed back the stale row unchanged.
  if (expires && expires.getTime() - Date.now() < EXPIRY_MARGIN_MS) {
    return reauthRequired(shop);
  }

  const admin = adminGraphqlClient(shop, accessToken);
  try {
    await graphqlRequest<{ shop: { name: string } }>(admin, `#graphql
      query MetaVaultTargetStoreCheck { shop { name } }`);
  } catch (err) {
    if (isAuthError(err)) return reauthRequired(shop);
    throw err;
  }

  return { ok: true, admin };
}

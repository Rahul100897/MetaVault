import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { syncPlanFromShopify } from "../lib/billing.server";

/**
 * Keeps the mirrored plan in ShopSettings honest.
 *
 * Shopify's `currentAppInstallation.activeSubscriptions` is the source of
 * truth, but `getPlan()` reads the DB mirror so it stays a single indexed
 * lookup on every page load. Without this webhook the mirror was only
 * refreshed when a merchant happened to open Plans & Billing — so a declined
 * card, a cancellation from the Shopify admin, or a lapsed trial would leave
 * the shop on paid features indefinitely.
 *
 * Fires on activation, cancellation, decline, expiry and trial transitions.
 * We re-read the live subscription rather than trusting the payload, so the
 * mirror always reflects what Shopify actually has.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, topic } = await authenticate.webhook(request);

  // `admin` is absent once the app is uninstalled; there is nothing to sync
  // and shop/redact will clear the row.
  if (!admin) return new Response();

  try {
    const snapshot = await syncPlanFromShopify(admin, shop);
    // eslint-disable-next-line no-console
    console.log(`[metavault] ${topic} for ${shop}: plan is now ${snapshot.plan}`);
  } catch (err) {
    // Never 500 back at Shopify — that triggers retries and eventually gets the
    // subscription removed. The next billing-page visit re-syncs anyway.
    // eslint-disable-next-line no-console
    console.error(
      `[metavault] ${topic} sync failed for ${shop}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return new Response();
};

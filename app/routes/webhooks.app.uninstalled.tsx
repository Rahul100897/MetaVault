import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Reset the mirrored plan.
  //
  // Uninstalling cancels the Shopify subscription, but `getPlan()` reads the
  // ShopSettings mirror rather than Shopify on every page load. Deleting only
  // the session left `plan: "agency"` behind, and `app_subscriptions/update`
  // bails out on uninstall because `admin` is gone — so a merchant who
  // reinstalled before `shop/redact` arrived (up to 48h later) got paid
  // features back with no active subscription. App Store requirement 1.2.2
  // expects the app to ask for charge approval again on reinstall.
  //
  // The row itself is kept so notification preferences survive a reinstall;
  // only the billing fields are cleared. updateMany is a no-op when no row
  // exists, so repeated webhook deliveries are safe.
  await db.shopSettings.updateMany({
    where: { shopId: shop },
    data: {
      plan: "free",
      subscriptionGid: null,
      subscriptionName: null,
      subscriptionStatus: "CANCELLED",
      currentPeriodEnd: null,
      trialEndsAt: null,
    },
  });

  return new Response();
};

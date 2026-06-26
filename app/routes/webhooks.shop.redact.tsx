import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} received for shop: ${shop}`);
  console.log("[GDPR] shop/redact payload:", JSON.stringify(payload));

  // Delete all shop data 48 hours after app uninstall (Shopify gives 48h window).
  // Remove all shop-keyed records from our database.
  await Promise.all([
    prisma.importJob.deleteMany({ where: { shopId: shop } }),
    prisma.exportJob.deleteMany({ where: { shopId: shop } }),
    prisma.backupJob.deleteMany({ where: { shopId: shop } }),
    prisma.activityLog.deleteMany({ where: { shopId: shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);

  console.log(`[GDPR] shop/redact completed for shop: ${shop}`);
  return new Response(null, { status: 200 });
};

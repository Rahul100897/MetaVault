import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} received for shop: ${shop}`);
  console.log("[GDPR] customers/data_request payload:", JSON.stringify(payload));

  // MetaVault stores: Session records (OAuth), ImportJob, ExportJob, BackupJob, ActivityLog
  // All records are keyed by shopId / shop domain, not by individual customer ID.
  // We do not store personally identifiable customer data beyond what Shopify's session
  // management requires. No action is needed for this compliance topic.

  return new Response(null, { status: 200 });
};

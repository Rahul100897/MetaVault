import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} received for shop: ${shop}`);
  console.log("[GDPR] customers/redact payload:", JSON.stringify(payload));

  // MetaVault does not store customer PII. No redaction required.
  // If future features store customer-linked data, implement deletion here.

  return new Response(null, { status: 200 });
};

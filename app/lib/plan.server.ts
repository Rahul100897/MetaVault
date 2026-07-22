import prisma from "../db.server";
import { isPro as planIsPro, isAgency as planIsAgency, type Plan } from "./plans";

/**
 * Resolve the plan a shop is on.
 *
 * Reads the mirrored subscription state in ShopSettings, which
 * `syncPlanFromShopify` (billing.server.ts) keeps in step with Shopify's
 * `currentAppInstallation.activeSubscriptions`. Reading from the DB keeps this
 * a single indexed lookup, so it's safe to call on every page load.
 *
 * SHOP_PLAN_OVERRIDE remains as a **development-only** escape hatch for testing
 * gated features without creating charges; it is ignored in production.
 */
export async function getPlan(shopId: string): Promise<Plan> {
  const override = process.env.SHOP_PLAN_OVERRIDE;
  if (
    process.env.NODE_ENV !== "production" &&
    (override === "pro" || override === "agency" || override === "free")
  ) {
    return override;
  }

  const settings = await prisma.shopSettings.findUnique({
    where: { shopId },
    select: { plan: true },
  });
  const plan = settings?.plan;
  if (plan === "pro" || plan === "agency" || plan === "free") return plan;
  return "free";
}

/** True when the shop is on Pro or Agency. */
export async function isPro(shopId: string): Promise<boolean> {
  return planIsPro(await getPlan(shopId));
}

/** True when the shop is on Agency. */
export async function isAgency(shopId: string): Promise<boolean> {
  return planIsAgency(await getPlan(shopId));
}

/**
 * Number of metafields a shop has changed today (edits + deletes + imports),
 * used to enforce the Free plan's 50/day cap.
 */
export async function getDailyEditCount(shopId: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const agg = await prisma.activityLog.aggregate({
    _sum: { rowCount: true },
    where: {
      shopId,
      action: { in: ["edit", "delete", "import"] },
      createdAt: { gte: start },
    },
  });
  return agg._sum.rowCount ?? 0;
}

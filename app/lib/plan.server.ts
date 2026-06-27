import prisma from "../db.server";
import type { Plan } from "./plans";

/**
 * Resolve the plan a shop is on.
 *
 * Billing is not yet wired (Phase 3), so this defaults to "free" and honors a
 * SHOP_PLAN_OVERRIDE env var for development/testing. When App Store billing
 * lands, swap this for an appSubscription query / Subscription table lookup.
 */
export async function getPlan(_shopId: string): Promise<Plan> {
  const override = process.env.SHOP_PLAN_OVERRIDE;
  if (override === "pro" || override === "agency" || override === "free") {
    return override;
  }
  return "free";
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

/**
 * Plan definitions and feature gates. Pure / client-safe (no DB, no secrets) so
 * it can be imported by both the server (plan.server.ts) and UI components
 * (UpgradeModal). Resolution of *which* plan a shop is on lives in plan.server.ts.
 */

export type Plan = "free" | "pro" | "agency";
export type PaidPlan = Exclude<Plan, "free">;

export const FREE_DAILY_LIMIT = 50;

export type BillingPlanConfig = {
  id: PaidPlan;
  /** Name shown on the merchant's Shopify invoice — also how we map back to a plan. */
  name: string;
  amount: number;
  currencyCode: string;
  trialDays: number;
};

/**
 * Recurring subscription config. Client-safe (no secrets): the billing server
 * builds the appSubscriptionCreate mutation from it, and the billing UI reads
 * trial length from it.
 */
export const BILLING_PLANS: Record<PaidPlan, BillingPlanConfig> = {
  // No free trial, deliberately. Every paid capability here is burst-shaped —
  // one backup, one migration, one bulk CSV, copy the Liquid snippet once — so a
  // trial is effectively a giveaway: a merchant can take the whole value and
  // cancel before day 8 having paid nothing. Removing it doesn't lose that
  // merchant, it charges them: Shopify does not prorate a recurring charge on
  // cancellation, so a one-off user now pays the full month. Evaluation is
  // covered by the Free plan, which is why no trial is needed here.
  pro: { id: "pro", name: "MetaVault Pro", amount: 15, currencyCode: "USD", trialDays: 0 },
  agency: { id: "agency", name: "MetaVault Agency", amount: 29, currencyCode: "USD", trialDays: 0 },
};

export function isPaidPlan(value: string): value is PaidPlan {
  return value === "pro" || value === "agency";
}

export function isPro(plan: Plan): boolean {
  return plan === "pro" || plan === "agency";
}

export function isAgency(plan: Plan): boolean {
  return plan === "agency";
}

export function canImportExport(plan: Plan): boolean {
  return isPro(plan);
}

export function canBulkDelete(plan: Plan): boolean {
  return isPro(plan);
}

export function canBackup(plan: Plan): boolean {
  return isAgency(plan);
}

export function canCrossStoreCopy(plan: Plan): boolean {
  return isAgency(plan);
}

export function canLiquidSnippets(plan: Plan): boolean {
  return isAgency(plan);
}

export function canCleanOrphans(plan: Plan): boolean {
  return isAgency(plan);
}

export type PlanDetail = {
  id: Plan;
  name: string;
  price: string;
  tagline: string;
  features: string[];
};

export const PLAN_DETAILS: PlanDetail[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    tagline: "Get started",
    features: [
      "View & edit up to 50 metafields/day",
      "Metaobjects viewer",
      "Single delete",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$15/mo",
    tagline: "For growing catalogs",
    features: [
      "Unlimited edits",
      "CSV import & export",
      "Bulk delete",
      "Job history",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    price: "$29/mo",
    tagline: "For agencies & power users",
    features: [
      "Everything in Pro",
      "Backup & restore",
      "Cross-store copy",
      "Liquid snippet generator",
      "Orphan cleaner",
    ],
  },
];

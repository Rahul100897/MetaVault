/**
 * Plan definitions and feature gates. Pure / client-safe (no DB, no secrets) so
 * it can be imported by both the server (plan.server.ts) and UI components
 * (UpgradeModal). Resolution of *which* plan a shop is on lives in plan.server.ts.
 */

export type Plan = "free" | "pro" | "agency";

export const FREE_DAILY_LIMIT = 50;

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

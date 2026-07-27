/**
 * Shopify App Store billing.
 *
 * Three plans (see PLAN_DETAILS in ./plans): Free is the implicit default and
 * never creates a charge; Pro and Agency are recurring appSubscriptions created
 * through `appSubscriptionCreate`, each with a 7-day trial.
 *
 * The source of truth for "what plan is this shop on" is Shopify's
 * `currentAppInstallation.activeSubscriptions`. We mirror it into ShopSettings
 * so plan lookups on every page load are a single indexed DB read instead of a
 * GraphQL round-trip — see plan.server.ts.
 */

import prisma from "../db.server";
import { graphqlRequest, type AdminClient } from "./graphql.server";
import { BILLING_PLANS, isPaidPlan, type Plan, type PaidPlan } from "./plans";

// Re-exported for existing importers; the config itself is client-safe (plans.ts).
export { BILLING_PLANS, isPaidPlan };
export type { PaidPlan };

/**
 * Charges are test charges outside production so development installs never
 * bill a real card. Shopify also forces test mode on development stores.
 */
export function billingTestMode(): boolean {
  if (process.env.SHOPIFY_BILLING_TEST === "false") return false;
  return process.env.NODE_ENV !== "production" || process.env.SHOPIFY_BILLING_TEST === "true";
}

/** Map a Shopify subscription name back to one of our plans. */
function planFromSubscriptionName(name: string): Plan {
  const normalized = name.trim().toLowerCase();
  for (const cfg of Object.values(BILLING_PLANS)) {
    if (normalized === cfg.name.toLowerCase()) return cfg.id;
  }
  // Tolerate renamed/legacy charges ("MetaVault Agency Plan", "Agency", …).
  if (normalized.includes("agency")) return "agency";
  if (normalized.includes("pro")) return "pro";
  return "free";
}

// --- Reading the live subscription ------------------------------------------

export type ActiveSubscription = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  createdAt: string;
  currentPeriodEnd: string | null;
};

type ActiveSubscriptionsQuery = {
  currentAppInstallation: {
    activeSubscriptions: ActiveSubscription[];
  };
};

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
      }
    }
  }`;

/** The shop's current ACTIVE subscription, or null when on Free. */
export async function fetchActiveSubscription(
  admin: AdminClient,
): Promise<ActiveSubscription | null> {
  const data = await graphqlRequest<ActiveSubscriptionsQuery>(admin, ACTIVE_SUBSCRIPTIONS_QUERY);
  const subs = data.currentAppInstallation?.activeSubscriptions ?? [];
  return subs.find((s) => s.status === "ACTIVE") ?? subs[0] ?? null;
}

export type PlanSnapshot = {
  plan: Plan;
  subscriptionGid: string | null;
  subscriptionName: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  isTest: boolean;
};

/**
 * Query Shopify for the live subscription and mirror it into ShopSettings.
 * Called from the billing page, the billing return URL, and anywhere a stale
 * plan would be user-visible. Returns the freshly resolved snapshot.
 */
export async function syncPlanFromShopify(
  admin: AdminClient,
  shopId: string,
): Promise<PlanSnapshot> {
  const sub = await fetchActiveSubscription(admin);

  const snapshot: PlanSnapshot = sub
    ? {
        plan: sub.status === "ACTIVE" ? planFromSubscriptionName(sub.name) : "free",
        subscriptionGid: sub.id,
        subscriptionName: sub.name,
        subscriptionStatus: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        trialEndsAt:
          sub.trialDays > 0
            ? new Date(
                new Date(sub.createdAt).getTime() + sub.trialDays * 24 * 60 * 60 * 1000,
              ).toISOString()
            : null,
        isTest: sub.test,
      }
    : {
        plan: "free",
        subscriptionGid: null,
        subscriptionName: null,
        subscriptionStatus: null,
        currentPeriodEnd: null,
        trialEndsAt: null,
        isTest: false,
      };

  const record = {
    plan: snapshot.plan,
    subscriptionGid: snapshot.subscriptionGid,
    subscriptionName: snapshot.subscriptionName,
    subscriptionStatus: snapshot.subscriptionStatus,
    currentPeriodEnd: snapshot.currentPeriodEnd ? new Date(snapshot.currentPeriodEnd) : null,
    trialEndsAt: snapshot.trialEndsAt ? new Date(snapshot.trialEndsAt) : null,
    isTest: snapshot.isTest,
  };

  await prisma.shopSettings.upsert({
    where: { shopId },
    create: { shopId, ...record },
    update: record,
  });

  return snapshot;
}

// --- Creating / cancelling a subscription ------------------------------------

type SubscriptionCreateResult = {
  appSubscriptionCreate: {
    confirmationUrl: string | null;
    appSubscription: { id: string; name: string; status: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

const SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $trialDays: Int!
    $test: Boolean!
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      lineItems: $lineItems
    ) {
      confirmationUrl
      appSubscription { id name status }
      userErrors { field message }
    }
  }`;

/**
 * Start a subscription. Returns the Shopify-hosted approval URL the merchant
 * must be redirected to — the charge only becomes ACTIVE after they approve,
 * at which point Shopify sends them back to `returnUrl`.
 */
export async function createSubscription(
  admin: AdminClient,
  { plan, returnUrl }: { plan: PaidPlan; returnUrl: string },
): Promise<{ confirmationUrl: string } | { error: string }> {
  const cfg = BILLING_PLANS[plan];

  const data = await graphqlRequest<SubscriptionCreateResult>(
    admin,
    SUBSCRIPTION_CREATE_MUTATION,
    {
      name: cfg.name,
      returnUrl,
      trialDays: cfg.trialDays,
      test: billingTestMode(),
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: cfg.amount, currencyCode: cfg.currencyCode },
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
    },
  );

  const result = data.appSubscriptionCreate;
  if (result.userErrors.length) {
    return { error: result.userErrors.map((e) => e.message).join("; ") };
  }
  if (!result.confirmationUrl) {
    return { error: "Shopify did not return an approval URL for this charge." };
  }
  return { confirmationUrl: result.confirmationUrl };
}

type SubscriptionCancelResult = {
  appSubscriptionCancel: {
    appSubscription: { id: string; status: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

const SUBSCRIPTION_CANCEL_MUTATION = `#graphql
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }`;

/** Cancel the active subscription and drop the shop back to Free. */
export async function cancelSubscription(
  admin: AdminClient,
  shopId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const settings = await prisma.shopSettings.findUnique({ where: { shopId } });
  const gid = settings?.subscriptionGid;
  if (!gid) return { ok: false, error: "No active subscription to cancel." };

  const data = await graphqlRequest<SubscriptionCancelResult>(
    admin,
    SUBSCRIPTION_CANCEL_MUTATION,
    { id: gid },
  );
  const result = data.appSubscriptionCancel;
  if (result.userErrors.length) {
    return { ok: false, error: result.userErrors.map((e) => e.message).join("; ") };
  }

  await syncPlanFromShopify(admin, shopId);
  return { ok: true };
}

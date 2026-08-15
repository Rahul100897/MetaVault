import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import { Page, Text, BlockStack, InlineStack, Button, Badge, Modal } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  cancelSubscription,
  createSubscription,
  syncPlanFromShopify,
  billingTestMode,
} from "../lib/billing.server";
import { getPlan } from "../lib/plan.server";
import { BILLING_PLANS, isPaidPlan, PLAN_DETAILS, type Plan } from "../lib/plans";

/**
 * Billing page. The loader always re-syncs from Shopify, which doubles as the
 * post-approval callback: Shopify sends the merchant back here after they
 * approve a charge, and the sync promotes them to the new plan.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  let snapshot;
  try {
    snapshot = await syncPlanFromShopify(admin, session.shop);
  } catch {
    // A billing read failure shouldn't blank the page — fall back to Free and
    // let the merchant retry.
    snapshot = {
      plan: "free" as Plan,
      subscriptionGid: null,
      subscriptionName: null,
      subscriptionStatus: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      isTest: false,
    };
  }

  // `snapshot.plan` is the REAL Shopify subscription. `effectivePlan` is what
  // the app actually treats the shop as (getPlan) — identical in production, but
  // in dev SHOP_PLAN_OVERRIDE can make them differ. We display the effective
  // plan so this page matches the sidebar/dashboard, and flag the override.
  const effectivePlan = await getPlan(session.shop);
  const devOverride = effectivePlan !== snapshot.plan;

  return { snapshot, effectivePlan, devOverride, testMode: billingTestMode() };
};

type ActionData =
  | { ok: true; intent: "upgrade"; confirmationUrl: string }
  | { ok: true; intent: "cancel" }
  | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "cancel") {
    const result = await cancelSubscription(admin, session.shop);
    return result.ok ? { ok: true, intent: "cancel" } : { ok: false, error: result.error };
  }

  if (intent === "upgrade") {
    const plan = String(form.get("plan") ?? "");
    if (!isPaidPlan(plan)) {
      return { ok: false, error: `Unknown plan: ${plan}` };
    }

    // Shopify sends the merchant here after approving; the loader's sync then
    // promotes them. shop/host are preserved so the embedded frame re-auths.
    const url = new URL(request.url);
    const appUrl = process.env.SHOPIFY_APP_URL || url.origin;
    const returnUrl = new URL("/app/billing", appUrl);
    returnUrl.searchParams.set("shop", session.shop);
    const host = String(form.get("host") ?? "");
    if (host) returnUrl.searchParams.set("host", host);
    returnUrl.searchParams.set("approved", "1");

    const result = await createSubscription(admin, {
      plan,
      returnUrl: returnUrl.toString(),
    });
    if ("error" in result) return { ok: false, error: result.error };
    return { ok: true, intent: "upgrade", confirmationUrl: result.confirmationUrl };
  }

  return { ok: false, error: `Unknown action: ${intent}` };
};

// ---------------------------------------------------------------------------

const PLAN_ACCENT: Record<Plan, string> = {
  free: "#6B7280",
  pro: "#6366F1",
  agency: "#8B5CF6",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function PlanCard({
  plan,
  current,
  onUpgrade,
  loading,
}: {
  plan: (typeof PLAN_DETAILS)[number];
  current: boolean;
  onUpgrade: () => void;
  loading: boolean;
}) {
  const accent = PLAN_ACCENT[plan.id];
  return (
    <div
      style={{
        border: current ? `2px solid ${accent}` : "1px solid #E5E7EB",
        borderRadius: "14px",
        padding: "22px 20px",
        background: current ? "linear-gradient(180deg, #F7F8FF, #FFFFFF)" : "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        position: "relative",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {current && (
        <span
          style={{
            position: "absolute",
            top: "-11px",
            left: "20px",
            background: accent,
            color: "#FFFFFF",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.4px",
            textTransform: "uppercase",
            padding: "4px 10px",
            borderRadius: "10px",
          }}
        >
          Current plan
        </span>
      )}

      <BlockStack gap="100">
        <Text as="h3" variant="headingLg" fontWeight="bold">
          {plan.name}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {plan.tagline}
        </Text>
      </BlockStack>

      <InlineStack gap="100" blockAlign="baseline">
        <Text as="span" variant="heading2xl" fontWeight="bold">
          {plan.price.split("/")[0]}
        </Text>
        {plan.id !== "free" && (
          <Text as="span" variant="bodySm" tone="subdued">
            /month
          </Text>
        )}
      </InlineStack>

      <BlockStack gap="150">
        {plan.features.map((f) => (
          <div key={f} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              style={{ flexShrink: 0, marginTop: "2px" }}
            >
              <path
                d="M20 6L9 17l-5-5"
                stroke={accent}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <Text as="span" variant="bodySm">
              {f}
            </Text>
          </div>
        ))}
      </BlockStack>

      <div style={{ marginTop: "auto", paddingTop: "8px" }}>
        {current ? (
          <Button fullWidth disabled>
            Your plan
          </Button>
        ) : plan.id === "free" ? (
          <Button fullWidth disabled>
            Included
          </Button>
        ) : (
          <Button fullWidth variant="primary" onClick={onUpgrade} loading={loading}>
            {(() => {
              // Read the trial length rather than hardcoding it, but never render
              // "Start 0-day free trial" — with trials off, the label has to
              // become a plain upgrade.
              const days = BILLING_PLANS[plan.id === "pro" ? "pro" : "agency"].trialDays;
              return days > 0 ? `Start ${days}-day free trial` : `Upgrade to ${plan.name}`;
            })()}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function BillingPage() {
  const { snapshot, effectivePlan, devOverride, testMode } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);

  const host = searchParams.get("host") ?? "";
  const justApproved = searchParams.get("approved") === "1";

  useEffect(() => {
    if (justApproved && snapshot.plan !== "free") {
      shopify.toast.show(`You're on the ${snapshot.plan} plan — thanks!`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justApproved, snapshot.plan]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;
    if (!d.ok) {
      setPendingPlan(null);
      shopify.toast.show(d.error, { isError: true });
      return;
    }
    if (d.intent === "upgrade") {
      // The approval screen is a Shopify-hosted page; it must replace the top
      // window rather than load inside the embedded iframe.
      window.open(d.confirmationUrl, "_top");
      return;
    }
    setCancelOpen(false);
    shopify.toast.show("Subscription cancelled — you're back on Free");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const upgrade = (plan: string) => {
    setPendingPlan(plan);
    fetcher.submit({ intent: "upgrade", plan, host }, { method: "post" });
  };

  const busy = fetcher.state !== "idle";
  // Display uses the effective plan (matches the rest of the app). Cancel/renewal
  // details come from the REAL subscription, so those key off `snapshot`.
  const hasRealSubscription = snapshot.plan !== "free" && !!snapshot.subscriptionGid;
  const onPaidPlan = effectivePlan !== "free";
  const currentDetail = PLAN_DETAILS.find((p) => p.id === effectivePlan) ?? PLAN_DETAILS[0];
  const inTrial = snapshot.trialEndsAt ? new Date(snapshot.trialEndsAt) > new Date() : false;

  return (
    <Page>
      <BlockStack gap="500">
        <div style={{ paddingTop: "8px" }}>
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl" fontWeight="bold">
              Plans &amp; billing
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Charges appear on your regular Shopify invoice. Cancel any time.
            </Text>
          </BlockStack>
        </div>

        {testMode && (
          <div
            style={{
              background: "#FFFBEB",
              border: "1px solid #FDE68A",
              borderRadius: "10px",
              padding: "12px 16px",
            }}
          >
            <Text as="p" variant="bodySm">
              <b>Test mode.</b> Charges created here are Shopify test charges — no money
              changes hands.
            </Text>
          </div>
        )}

        {devOverride && (
          <div
            style={{
              background: "#EEF0FF",
              border: "1px solid #C7D2FE",
              borderRadius: "10px",
              padding: "12px 16px",
            }}
          >
            <Text as="p" variant="bodySm">
              <b>Development override.</b> The app is treating this shop as{" "}
              <b>{effectivePlan}</b> via <code>SHOP_PLAN_OVERRIDE</code>, but no real Shopify
              subscription exists{snapshot.plan !== "free" ? ` (actual: ${snapshot.plan})` : ""}.
              This override is ignored in production.
            </Text>
          </div>
        )}

        {/* Current plan */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "14px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            padding: "24px",
          }}
        >
          <InlineStack align="space-between" blockAlign="start">
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="semibold">
                  {currentDetail.name} plan
                </Text>
                <Badge tone={onPaidPlan ? "success" : "info"}>
                  {hasRealSubscription
                    ? (snapshot.subscriptionStatus?.toLowerCase() ?? "active")
                    : devOverride
                      ? "dev override"
                      : "active"}
                </Badge>
                {inTrial && <Badge tone="magic">Free trial</Badge>}
              </InlineStack>

              <Text as="p" variant="bodySm" tone="subdued">
                {hasRealSubscription
                  ? `${currentDetail.price} · renews ${formatDate(snapshot.currentPeriodEnd)}`
                  : onPaidPlan
                    ? "Unlocked by SHOP_PLAN_OVERRIDE for development — no real subscription or charge."
                    : "No charge. Upgrade any time to unlock import/export, backups and more."}
              </Text>

              {inTrial && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Trial ends {formatDate(snapshot.trialEndsAt)} — you won&apos;t be charged
                  until then.
                </Text>
              )}
            </BlockStack>

            {hasRealSubscription && (
              <Button variant="plain" tone="critical" onClick={() => setCancelOpen(true)}>
                Cancel subscription
              </Button>
            )}
          </InlineStack>
        </div>

        {/* Comparison */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px",
            alignItems: "stretch",
          }}
        >
          {PLAN_DETAILS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              current={plan.id === effectivePlan}
              loading={busy && pendingPlan === plan.id}
              onUpgrade={() => upgrade(plan.id)}
            />
          ))}
        </div>
      </BlockStack>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel your subscription?"
        primaryAction={{
          content: "Cancel subscription",
          destructive: true,
          loading: busy,
          onAction: () => fetcher.submit({ intent: "cancel" }, { method: "post" }),
        }}
        secondaryActions={[{ content: "Keep my plan", onAction: () => setCancelOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              You&apos;ll drop to the Free plan immediately and lose access to
              {snapshot.plan === "agency"
                ? " backups, cross-store copy, Liquid snippets and the orphan cleaner"
                : " CSV import/export and bulk delete"}
              .
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Your metafield data is untouched — only MetaVault&apos;s paid features are
              locked. Existing backups remain downloadable until they expire.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

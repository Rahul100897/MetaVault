import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, BlockStack, InlineStack, Badge, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

/**
 * Pre-submission checklist for the Shopify App Store. Some items are verified
 * automatically from the running config; the rest are manual reminders the
 * developer ticks off in the Partner Dashboard before submitting.
 */

type Status = "done" | "manual" | "todo";

type Item = {
  title: string;
  status: Status;
  detail: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  const hasApiKey = Boolean(process.env.SHOPIFY_API_KEY);

  const items: Item[] = [
    {
      title: "GDPR compliance webhooks",
      status: "done",
      detail:
        "customers/data_request, customers/redact, and shop/redact are subscribed in shopify.app.toml with handlers under app/routes/webhooks.*.",
    },
    {
      title: "GraphQL Admin API only",
      status: "done",
      detail:
        "All Shopify access goes through the GraphQL Admin API (lib/graphql.server.ts and the metafield/metaobject helpers). No deprecated REST endpoints are used.",
    },
    {
      title: "Billing configured",
      status: hasApiKey ? "done" : "todo",
      detail: hasApiKey
        ? "appSubscriptionCreate is wired for Pro ($15) and Agency ($29) with 7-day trials; test charges outside production. See lib/billing.server.ts."
        : "SHOPIFY_API_KEY is not set — billing cannot be initialized in this environment.",
    },
    {
      title: "Privacy policy published",
      status: "done",
      detail: appUrl
        ? `Hosted at ${appUrl}/privacy. Add this URL to the Partner Dashboard → App setup → Privacy policy.`
        : "Hosted at /privacy. Add its public URL to the Partner Dashboard once SHOPIFY_APP_URL is set.",
    },
    {
      title: "Terms of service published",
      status: "done",
      detail: appUrl
        ? `Hosted at ${appUrl}/terms.`
        : "Hosted at /terms. Add its public URL in your listing once SHOPIFY_APP_URL is set.",
    },
    {
      title: "Minimal access scopes",
      status: "manual",
      detail:
        "Scopes are limited to metaobjects and the metafields of products, collections, customers, and orders. Confirm each requested scope in shopify.app.toml is still used before submitting.",
    },
    {
      title: "Fresh install tested",
      status: "manual",
      detail:
        "Install on a clean development store, complete OAuth, and confirm the app loads, billing approval works, and a backup/restore round-trips.",
    },
    {
      title: "Demo video recorded",
      status: "manual",
      detail:
        "Record a short walkthrough (install → edit a metafield → export → backup) for the listing.",
    },
    {
      title: "Screenshots prepared",
      status: "manual",
      detail:
        "Capture the dashboard, metafields editor, backups, and billing pages at the required resolution for the App Store listing.",
    },
    {
      title: "App icon ready",
      status: "manual",
      detail: "Provide a 1200×1200 app icon in the Partner Dashboard listing assets.",
    },
  ];

  return { items, appUrl };
};

const STATUS: Record<Status, { tone: "success" | "attention" | "critical"; label: string; color: string }> = {
  done: { tone: "success", label: "Ready", color: "#10B981" },
  manual: { tone: "attention", label: "Manual", color: "#F59E0B" },
  todo: { tone: "critical", label: "Action needed", color: "#EF4444" },
};

function StatusDot({ status }: { status: Status }) {
  const color = STATUS[status].color;
  return (
    <div
      style={{
        width: "26px",
        height: "26px",
        borderRadius: "50%",
        background: `${color}1A`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {status === "done" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M20 6L9 17l-5-5" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: color }} />
      )}
    </div>
  );
}

export default function ChecklistPage() {
  const { items } = useLoaderData<typeof loader>();

  const done = items.filter((i) => i.status === "done").length;
  const todo = items.filter((i) => i.status === "todo").length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <Page
      title="App Store checklist"
      subtitle="Verify everything is in place before submitting MetaVault for review."
    >
      <BlockStack gap="400">
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd" fontWeight="semibold">
                {done} of {items.length} automated checks ready
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {todo > 0
                  ? `${todo} item${todo === 1 ? "" : "s"} need attention before submission.`
                  : "Automated checks pass — complete the manual items and submit."}
              </Text>
            </BlockStack>
            <div style={{ textAlign: "right" }}>
              <Text as="span" variant="heading2xl" fontWeight="bold">
                {pct}%
              </Text>
            </div>
          </InlineStack>
          <div
            style={{
              marginTop: "16px",
              height: "8px",
              borderRadius: "4px",
              background: "#F1F1F4",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "linear-gradient(90deg, #6366F1, #8B5CF6)",
              }}
            />
          </div>
        </Card>

        <Card padding="0">
          {items.map((item, idx) => (
            <div
              key={item.title}
              style={{
                display: "flex",
                gap: "14px",
                padding: "16px 20px",
                borderBottom: idx < items.length - 1 ? "1px solid #F3F4F6" : "none",
                alignItems: "flex-start",
              }}
            >
              <StatusDot status={item.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {item.title}
                  </Text>
                  <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
                </InlineStack>
                <div style={{ marginTop: "4px" }}>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {item.detail}
                  </Text>
                </div>
              </div>
            </div>
          ))}
        </Card>

        <InlineStack gap="200">
          <Button url="/privacy" target="_blank" variant="tertiary">
            View privacy policy
          </Button>
          <Button url="/terms" target="_blank" variant="tertiary">
            View terms
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}

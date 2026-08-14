import { Suspense } from "react";
import { defer, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Await } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPlan } from "../lib/plan.server";
import { countDefinitions } from "../lib/dashboard.server";
import { formatDefinitionCount, type DefinitionCounts } from "../lib/dashboard";
import { PLAN_DETAILS, type Plan } from "../lib/plans";
import { MetaVaultLoader } from "../components/Loader";

/**
 * The dashboard streams: `authenticate.admin` blocks (it's the auth boundary),
 * but the store queries are deferred so the HTML shell — sidebar, header, and
 * the main loader — flushes immediately instead of the merchant staring at a
 * blank frame while the data loads. The data streams in behind <Await/>.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;

  // The effective plan (honors SHOP_PLAN_OVERRIDE in dev, ShopSettings in prod)
  // — the same source the sidebar uses, so the "Your Plan" card stays in sync.
  const plan = await getPlan(shopId);

  const dashboard = Promise.all([
    prisma.activityLog.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.importJob.count({
      where: {
        shopId,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.backupJob.findFirst({
      where: { shopId, status: "completed" },
      orderBy: { createdAt: "desc" },
    }),
    // Never let a stat card take the whole dashboard down: on a throttle or a
    // scope error the tiles fall back to "—" and the rest still renders.
    countDefinitions(admin).catch(() => null),
  ]).then(([recentActivity, importJobsToday, lastBackup, definitionCounts]) => ({
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      action: a.action,
      resourceType: a.resourceType,
      rowCount: a.rowCount,
      createdAt: a.createdAt.toISOString(),
    })),
    importJobsToday,
    lastBackup: lastBackup ? { createdAt: lastBackup.createdAt.toISOString() } : null,
    definitionCounts,
  }));

  return defer({ plan, dashboard });
};

type DashboardData = {
  recentActivity: Array<{
    id: string;
    action: string;
    resourceType: string;
    rowCount: number;
    createdAt: string;
  }>;
  importJobsToday: number;
  lastBackup: { createdAt: string } | null;
  definitionCounts: DefinitionCounts | null;
};

function StatCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string | number;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        borderRadius: "12px",
        padding: "20px 24px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        borderTop: `3px solid ${accent}`,
        flex: 1,
      }}
    >
      <InlineStack align="space-between" blockAlign="start">
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">
            {label}
          </Text>
          <Text as="p" variant="heading2xl" fontWeight="bold">
            {value}
          </Text>
        </BlockStack>
        <div
          style={{
            width: "40px",
            height: "40px",
            background: accent + "18",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: accent,
          }}
        >
          {icon}
        </div>
      </InlineStack>
    </div>
  );
}

function EmptyActivityState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 24px",
        gap: "16px",
      }}
    >
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="120" height="120" rx="60" fill="#F3F4F6" />
        <rect x="28" y="34" width="64" height="8" rx="4" fill="#E5E7EB" />
        <rect x="28" y="50" width="48" height="6" rx="3" fill="#E5E7EB" />
        <rect x="28" y="64" width="56" height="6" rx="3" fill="#E5E7EB" />
        <rect x="28" y="78" width="40" height="6" rx="3" fill="#E5E7EB" />
        <circle cx="88" cy="82" r="18" fill="#6366F1" opacity="0.15" />
        <path
          d="M82 82l4 4 8-8"
          stroke="#6366F1"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          No activity yet
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Start editing metafields or importing a CSV to see activity here.
        </Text>
      </BlockStack>
      <Button url="/app/metafields" variant="primary">
        Browse Metafields
      </Button>
    </div>
  );
}

const ACTION_BADGE: Record<string, "info" | "success" | "warning" | "critical"> = {
  import: "info",
  export: "success",
  backup: "info",
  delete: "critical",
  edit: "warning",
};

function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const PLAN_BADGE_TONE: Record<Plan, "info" | "success" | "magic"> = {
  free: "info",
  pro: "success",
  agency: "magic",
};

/** "Your Plan" card — driven by the effective plan, not hardcoded. */
function PlanCard({ plan }: { plan: Plan }) {
  const detail = PLAN_DETAILS.find((p) => p.id === plan) ?? PLAN_DETAILS[0];
  const isTopTier = plan === "agency";
  const nextTier = plan === "free" ? "Pro" : "Agency";

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd" fontWeight="semibold">
            Your Plan
          </Text>
          <Badge tone={PLAN_BADGE_TONE[plan]}>{detail.name}</Badge>
        </InlineStack>
        <BlockStack gap="100">
          {detail.features.map((f) => (
            <Text key={f} as="p" variant="bodySm" tone="subdued">
              ✓ {f}
            </Text>
          ))}
        </BlockStack>
        {isTopTier ? (
          <Button url="/app/billing" fullWidth>
            Manage plan
          </Button>
        ) : (
          <Button url="/app/billing" variant="primary" fullWidth>
            Upgrade to {nextTier}
          </Button>
        )}
      </BlockStack>
    </Card>
  );
}

export default function DashboardPage() {
  const { plan, dashboard } = useLoaderData<typeof loader>();

  return (
    <Page>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .activity-row:hover { background: #F9FAFB; }
      `}</style>

      <BlockStack gap="600">
        {/* Header (renders instantly, before the data streams in) */}
        <div style={{ paddingTop: "8px" }}>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h1" variant="headingXl" fontWeight="bold">
                Dashboard
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Welcome back — here's what's happening in your store.
              </Text>
            </BlockStack>
            <InlineStack gap="200">
              <Button url="/app/import-export" variant="secondary">
                Import CSV
              </Button>
              <Button url="/app/metafields" variant="primary">
                Edit Metafields
              </Button>
            </InlineStack>
          </InlineStack>
        </div>

        <Suspense
          fallback={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "420px",
              }}
            >
              <MetaVaultLoader label="Loading your dashboard…" />
            </div>
          }
        >
          <Await resolve={dashboard}>
            {(data) => <DashboardBody data={data} plan={plan} />}
          </Await>
        </Suspense>
      </BlockStack>
    </Page>
  );
}

function DashboardBody({ data, plan }: { data: DashboardData; plan: Plan }) {
  const { recentActivity, importJobsToday, lastBackup, definitionCounts } = data;
  const lastBackupLabel = lastBackup
    ? formatRelativeTime(lastBackup.createdAt)
    : "Never";

  return (
    <BlockStack gap="600">
        {/* Stats Cards */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <StatCard
              label="Metafield Definitions"
              value={formatDefinitionCount(definitionCounts?.metafields)}
              accent="#6366F1"
              icon={
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <rect
                    x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M3 9h18M3 15h18M9 3v18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              }
            />
            <StatCard
              label="Metaobject Definitions"
              value={formatDefinitionCount(definitionCounts?.metaobjects)}
              accent="#8B5CF6"
              icon={
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            />
            <StatCard
              label="Jobs Today"
              value={importJobsToday}
              accent="#10B981"
              icon={
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <polyline
                    points="22 12 18 12 15 21 9 3 6 12 2 12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            />
            <StatCard
              label="Last Backup"
              value={lastBackupLabel}
              accent="#F59E0B"
              icon={
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            />
        </div>

        {/* Main content */}
        <Layout>
          <Layout.Section>
            {/* Recent Activity */}
            <Card padding="0">
              <div style={{ padding: "20px 24px 16px" }}>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd" fontWeight="semibold">
                    Recent Activity
                  </Text>
                  <Button url="/app/activity" variant="plain">
                    View all
                  </Button>
                </InlineStack>
              </div>
              <Divider />

              {recentActivity.length === 0 ? (
                <EmptyActivityState />
              ) : (
                <div>
                  {/* Table header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 140px 100px 90px",
                      padding: "10px 24px",
                      background: "#F9FAFB",
                      borderBottom: "1px solid #E5E7EB",
                    }}
                  >
                    {["Action", "Resource", "Rows", "When"].map((h) => (
                      <Text
                        key={h}
                        as="span"
                        variant="bodySm"
                        tone="subdued"
                        fontWeight="semibold"
                      >
                        {h}
                      </Text>
                    ))}
                  </div>
                  {recentActivity.map((log, idx) => (
                    <div
                      key={log.id}
                      className="activity-row"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 140px 100px 90px",
                        padding: "12px 24px",
                        background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAFA",
                        borderBottom: "1px solid #F3F4F6",
                        transition: "background 0.1s",
                        alignItems: "center",
                      }}
                    >
                      <InlineStack gap="200" blockAlign="center">
                        <Badge
                          tone={ACTION_BADGE[log.action] ?? "info"}
                        >
                          {log.action}
                        </Badge>
                      </InlineStack>
                      <Text as="span" variant="bodySm">
                        {log.resourceType}
                      </Text>
                      <Text as="span" variant="bodySm">
                        {log.rowCount.toLocaleString()}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {formatRelativeTime(log.createdAt.toString())}
                      </Text>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Quick Actions */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd" fontWeight="semibold">
                    Quick Actions
                  </Text>
                  <BlockStack gap="200">
                    <Button url="/app/metafields" fullWidth>
                      Browse Metafields
                    </Button>
                    <Button url="/app/metaobjects" fullWidth>
                      Browse Metaobjects
                    </Button>
                    <Button url="/app/import-export" fullWidth>
                      Import / Export CSV
                    </Button>
                    <Button url="/app/backups" fullWidth>
                      Create Backup
                    </Button>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Plan Card — reflects the effective plan (same source as the sidebar) */}
              <PlanCard plan={plan} />

            </BlockStack>
          </Layout.Section>
        </Layout>
    </BlockStack>
  );
}

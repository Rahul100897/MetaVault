import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [recentActivity, importJobsToday, lastBackup] = await Promise.all([
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
  ]);

  return {
    shopId,
    recentActivity,
    importJobsToday,
    lastBackup: lastBackup
      ? { createdAt: lastBackup.createdAt.toISOString() }
      : null,
  };
};

function SkeletonCard() {
  return (
    <div
      style={{
        background: "#FFFFFF",
        borderRadius: "12px",
        padding: "20px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          height: "14px",
          width: "60%",
          background: "#E5E7EB",
          borderRadius: "4px",
          marginBottom: "12px",
          animation: "pulse 1.5s infinite",
        }}
      />
      <div
        style={{
          height: "32px",
          width: "40%",
          background: "#E5E7EB",
          borderRadius: "4px",
          animation: "pulse 1.5s infinite",
        }}
      />
    </div>
  );
}

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

export default function DashboardPage() {
  const { recentActivity, importJobsToday, lastBackup } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const lastBackupLabel = lastBackup
    ? formatRelativeTime(lastBackup.createdAt)
    : "Never";

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
        {/* Header */}
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

        {/* Stats Cards */}
        {isLoading ? (
          <div style={{ display: "flex", gap: "16px" }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <StatCard
              label="Metafields"
              value="—"
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
              label="Metaobjects"
              value="—"
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
        )}

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

              {isLoading ? (
                <div style={{ padding: "24px" }}>
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: "12px",
                        marginBottom: "16px",
                      }}
                    >
                      <div
                        style={{
                          height: "14px",
                          flex: 1,
                          background: "#E5E7EB",
                          borderRadius: "4px",
                          animation: "pulse 1.5s infinite",
                        }}
                      />
                      <div
                        style={{
                          height: "14px",
                          width: "80px",
                          background: "#E5E7EB",
                          borderRadius: "4px",
                          animation: "pulse 1.5s infinite",
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : recentActivity.length === 0 ? (
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

              {/* Plan Card */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd" fontWeight="semibold">
                      Your Plan
                    </Text>
                    <Badge tone="info">Free</Badge>
                  </InlineStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      ✓ View &amp; edit up to 50 metafields/day
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      ✓ Metaobjects viewer
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      ✗ CSV Import / Export
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      ✗ Backup &amp; Restore
                    </Text>
                  </BlockStack>
                  <Button url="/app/settings" variant="primary" fullWidth>
                    Upgrade to Pro — $15/mo
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

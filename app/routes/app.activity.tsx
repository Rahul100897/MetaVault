import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, Badge, InlineStack, BlockStack, Divider } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const logs = await prisma.activityLog.findMany({
    where: { shopId: session.shop },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return { logs };
};

const ACTION_BADGE: Record<string, "info" | "success" | "warning" | "critical"> = {
  import: "info",
  export: "success",
  backup: "info",
  delete: "critical",
  edit: "warning",
};

export default function ActivityPage() {
  const { logs } = useLoaderData<typeof loader>();

  return (
    <Page title="Activity Log">
      <Card padding="0">
        {logs.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <Text as="p" variant="bodyMd" tone="subdued">
              No activity recorded yet. Actions like imports, exports, and edits will appear here.
            </Text>
          </div>
        ) : (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 160px 100px 120px 140px",
                padding: "10px 24px",
                background: "#F9FAFB",
                borderBottom: "1px solid #E5E7EB",
              }}
            >
              {["Action", "Resource", "Rows", "Staff", "Date"].map((h) => (
                <Text key={h} as="span" variant="bodySm" tone="subdued" fontWeight="semibold">
                  {h}
                </Text>
              ))}
            </div>
            {logs.map((log, idx) => (
              <div
                key={log.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 160px 100px 120px 140px",
                  padding: "12px 24px",
                  background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAFA",
                  borderBottom: "1px solid #F3F4F6",
                  alignItems: "center",
                }}
              >
                <Badge tone={ACTION_BADGE[log.action] ?? "info"}>{log.action}</Badge>
                <Text as="span" variant="bodySm">{log.resourceType}</Text>
                <Text as="span" variant="bodySm">{log.rowCount.toLocaleString()}</Text>
                <Text as="span" variant="bodySm" tone="subdued">{log.staffAccount ?? "—"}</Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {new Date(log.createdAt).toLocaleDateString()}
                </Text>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}

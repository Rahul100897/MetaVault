import { useMemo } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigation, Link } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import {
  Page,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Select,
  TextField,
  Button,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateCsv } from "../lib/csv.server";

const PAGE_SIZE = 50;

const ACTION_OPTIONS = [
  { label: "All actions", value: "" },
  { label: "Import", value: "import" },
  { label: "Export", value: "export" },
  { label: "Backup", value: "backup" },
  { label: "Restore", value: "restore" },
  { label: "Edit", value: "edit" },
  { label: "Delete", value: "delete" },
];

/** Build the Prisma filter shared by the page query and the CSV export. */
function buildWhere(shopId: string, url: URL): Prisma.ActivityLogWhereInput {
  const action = url.searchParams.get("action") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  const where: Prisma.ActivityLogWhereInput = { shopId };
  if (action) where.action = action;

  const createdAt: Prisma.DateTimeFilter = {};
  if (from) {
    const d = new Date(`${from}T00:00:00`);
    if (!Number.isNaN(d.getTime())) createdAt.gte = d;
  }
  if (to) {
    const d = new Date(`${to}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) createdAt.lte = d;
  }
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  return where;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const where = buildWhere(session.shop, url);

  // CSV export: stream every matching row (respecting the active filters).
  if (url.searchParams.get("format") === "csv") {
    const all = await prisma.activityLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50_000,
    });
    const csv = generateCsv(
      all.map((l) => ({
        date: l.createdAt.toISOString(),
        action: l.action,
        resource: l.resourceType,
        rows: String(l.rowCount),
        staff: l.staffAccount ?? "",
      })),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="activity-log-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  }

  const cursor = url.searchParams.get("cursor");
  // Fetch one extra to know whether a next page exists.
  const logs = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNext = logs.length > PAGE_SIZE;
  const pageLogs = hasNext ? logs.slice(0, PAGE_SIZE) : logs;
  const nextCursor = hasNext ? pageLogs[pageLogs.length - 1].id : null;

  return {
    logs: pageLogs.map((l) => ({
      id: l.id,
      action: l.action,
      resourceType: l.resourceType,
      rowCount: l.rowCount,
      staffAccount: l.staffAccount,
      createdAt: l.createdAt.toISOString(),
    })),
    nextCursor,
    filters: {
      action: url.searchParams.get("action") ?? "",
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
    },
  };
};

const ACTION_BADGE: Record<string, "info" | "success" | "warning" | "critical" | "attention"> = {
  import: "info",
  export: "success",
  backup: "info",
  restore: "attention",
  delete: "critical",
  edit: "warning",
};

const GRID = "1fr 200px 100px 140px 180px";

type LogRow = {
  id: string;
  action: string;
  resourceType: string;
  rowCount: number;
  staffAccount: string | null;
  createdAt: string;
};

type PageData = {
  logs: LogRow[];
  nextCursor: string | null;
  filters: { action: string; from: string; to: string };
};

export default function ActivityPage() {
  // The loader also has a CSV branch that returns a raw Response, which widens
  // the inferred type; the page only ever renders the data branch.
  const { logs, nextCursor, filters } = useLoaderData() as PageData;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();

  const loading = navigation.state === "loading";

  /** Update a filter and reset pagination (cursor) to page one. */
  const setFilter = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("cursor");
      return next;
    });
  };

  const goNext = () => {
    if (!nextCursor) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("cursor", nextCursor);
      return next;
    });
  };

  const clearFilters = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      ["action", "from", "to", "cursor"].forEach((k) => next.delete(k));
      return next;
    });

  const hasFilters = Boolean(filters.action || filters.from || filters.to);
  const onFirstPage = !searchParams.get("cursor");

  // Preserve active filters on the CSV export link.
  const csvHref = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    params.set("format", "csv");
    return `/app/activity?${params.toString()}`;
  }, [filters]);

  return (
    <Page
      title="Activity Log"
      primaryAction={
        logs.length > 0
          ? { content: "Export CSV", url: csvHref, external: true, target: "_blank" }
          : undefined
      }
    >
      <BlockStack gap="400">
        {/* Filters */}
        <Card>
          <InlineStack gap="300" blockAlign="end" wrap>
            <div style={{ minWidth: "180px" }}>
              <Select
                label="Action type"
                options={ACTION_OPTIONS}
                value={filters.action}
                onChange={(v) => setFilter("action", v)}
              />
            </div>
            <div style={{ minWidth: "170px" }}>
              <TextField
                label="From"
                type="date"
                value={filters.from}
                onChange={(v) => setFilter("from", v)}
                autoComplete="off"
              />
            </div>
            <div style={{ minWidth: "170px" }}>
              <TextField
                label="To"
                type="date"
                value={filters.to}
                onChange={(v) => setFilter("to", v)}
                autoComplete="off"
              />
            </div>
            {hasFilters && (
              <Button variant="tertiary" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </InlineStack>
        </Card>

        <Card padding="0">
          {logs.length === 0 ? (
            <div style={{ padding: "48px 24px", textAlign: "center" }}>
              <Text as="p" variant="bodyMd" tone="subdued">
                {hasFilters
                  ? "No activity matches these filters."
                  : "No activity recorded yet. Actions like imports, exports, and edits will appear here."}
              </Text>
            </div>
          ) : (
            <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity 0.1s" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  padding: "10px 24px",
                  background: "#0A0F1E",
                }}
              >
                {["Action", "Resource", "Rows", "Staff", "Date"].map((h) => (
                  <Text
                    key={h}
                    as="span"
                    variant="bodySm"
                    tone="text-inverse"
                    fontWeight="semibold"
                  >
                    {h}
                  </Text>
                ))}
              </div>
              {logs.map((log, idx) => (
                <div
                  key={log.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID,
                    padding: "12px 24px",
                    background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAFB",
                    borderBottom: "1px solid #F3F4F6",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <Badge tone={ACTION_BADGE[log.action] ?? "info"}>{log.action}</Badge>
                  </div>
                  <Text as="span" variant="bodySm">
                    {log.resourceType}
                  </Text>
                  <Text as="span" variant="bodySm">
                    {log.rowCount.toLocaleString()}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {log.staffAccount ?? "—"}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {new Date(log.createdAt).toLocaleString()}
                  </Text>
                </div>
              ))}

              {/* Pagination */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "14px 24px",
                  background: "#F9FAFB",
                }}
              >
                <Text as="span" variant="bodySm" tone="subdued">
                  {logs.length} row{logs.length === 1 ? "" : "s"}
                </Text>
                <InlineStack gap="200">
                  {!onFirstPage && (
                    <Link to="/app/activity" style={{ textDecoration: "none" }}>
                      <Button variant="tertiary">First page</Button>
                    </Link>
                  )}
                  <Button onClick={goNext} disabled={!nextCursor} loading={loading}>
                    Next page
                  </Button>
                </InlineStack>
              </div>
            </div>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

import { useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import { Page, Text, BlockStack, InlineStack, Button, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getDownloadUrl } from "../lib/r2.server";

type JobKind = "import" | "export" | "backup";

type UnifiedJob = {
  id: string;
  kind: JobKind;
  status: string;
  createdAt: string;
  completedAt: string | null;
  totalRows: number | null;
  successRows: number | null;
  failedRows: number | null;
  downloadUrl: string | null;
  errorReportUrl: string | null;
};

async function signSafe(key: string | null): Promise<string | null> {
  if (!key || !process.env.R2_ENDPOINT) return null;
  try {
    return await getDownloadUrl(key, 3600);
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [imports, exports, backups] = await Promise.all([
    prisma.importJob.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.exportJob.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.backupJob.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const jobs: UnifiedJob[] = await Promise.all([
    ...imports.map(async (j) => ({
      id: j.id,
      kind: "import" as const,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
      totalRows: j.totalRows,
      successRows: j.successRows,
      failedRows: j.failedRows,
      downloadUrl: await signSafe(j.fileUrl),
      errorReportUrl: await signSafe(j.errorReportUrl),
    })),
    ...exports.map(async (j) => ({
      id: j.id,
      kind: "export" as const,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
      totalRows: null,
      successRows: null,
      failedRows: null,
      downloadUrl: await signSafe(j.fileUrl),
      errorReportUrl: null,
    })),
    ...backups.map(async (j) => ({
      id: j.id,
      kind: "backup" as const,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
      completedAt: null,
      totalRows: null,
      successRows: null,
      failedRows: null,
      downloadUrl: await signSafe(j.fileUrl),
      errorReportUrl: null,
    })),
  ]);

  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const hasActive = jobs.some((j) => j.status === "queued" || j.status === "running");
  return { jobs, hasActive };
};

const STATUS_TONE: Record<string, "info" | "success" | "critical" | "attention" | "warning"> = {
  queued: "info",
  running: "attention",
  completed: "success",
  failed: "critical",
};

const KIND_META: Record<JobKind, { label: string; color: string }> = {
  import: { label: "Import", color: "#6366F1" },
  export: { label: "Export", color: "#10B981" },
  backup: { label: "Backup", color: "#F59E0B" },
};

function formatTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

const GRID = "120px 110px 1fr 140px 160px";

function JobsSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: "16px",
            padding: "14px 20px",
            borderBottom: "1px solid #F3F4F6",
          }}
        >
          {[70, 60, 80, 50, 60].map((w, j) => (
            <div
              key={j}
              style={{
                height: "14px",
                width: `${w}%`,
                background: "#E5E7EB",
                borderRadius: "4px",
                animation: "pulse 1.5s infinite",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyJobs() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "64px 24px", gap: "16px" }}>
      <svg width="130" height="130" viewBox="0 0 130 130" fill="none">
        <rect width="130" height="130" rx="65" fill="#F3F4F6" />
        <rect x="40" y="42" width="50" height="46" rx="6" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
        <line x1="48" y1="54" x2="82" y2="54" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" />
        <line x1="48" y1="64" x2="74" y2="64" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" />
        <line x1="48" y1="74" x2="78" y2="74" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" />
        <circle cx="90" cy="86" r="16" fill="#6366F1" opacity="0.15" />
        <path d="M90 79v8M90 91h.01" stroke="#6366F1" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          No jobs yet
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Import, export, and backup jobs will appear here with their status and downloads.
        </Text>
      </BlockStack>
      <Button url="/app/import-export" variant="primary">
        Import or export CSV
      </Button>
    </div>
  );
}

export default function JobsPage() {
  const { jobs, hasActive } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // Auto-refresh while any job is queued/running.
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => revalidator.revalidate(), 5000);
    return () => clearInterval(id);
  }, [hasActive, revalidator]);

  return (
    <Page>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .mv-job-row:hover { background: #F1F1FF !important; }`}</style>

      <BlockStack gap="500">
        <div style={{ paddingTop: "8px" }}>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h1" variant="headingXl" fontWeight="bold">
                Jobs
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                History of your import, export, and backup jobs.
              </Text>
            </BlockStack>
            <InlineStack gap="200" blockAlign="center">
              {hasActive && (
                <Badge tone="attention" progress="partiallyComplete">
                  Live
                </Badge>
              )}
              <Button
                onClick={() => revalidator.revalidate()}
                loading={revalidator.state === "loading"}
              >
                Refresh
              </Button>
            </InlineStack>
          </InlineStack>
        </div>

        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: "16px",
              padding: "12px 20px",
              background: "#0A0F1E",
            }}
          >
            {["Type", "Status", "Rows", "Created", ""].map((h, i) => (
              <Text key={i} as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
                {h}
              </Text>
            ))}
          </div>

          {revalidator.state === "loading" && jobs.length === 0 ? (
            <JobsSkeleton />
          ) : jobs.length === 0 ? (
            <EmptyJobs />
          ) : (
            jobs.map((job, idx) => (
              <div
                key={`${job.kind}-${job.id}`}
                className="mv-job-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: "16px",
                  padding: "14px 20px",
                  background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAFB",
                  borderBottom: "1px solid #F3F4F6",
                  alignItems: "center",
                  transition: "background 0.1s",
                }}
              >
                <InlineStack gap="150" blockAlign="center">
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: KIND_META[job.kind].color }} />
                  <Text as="span" variant="bodySm" fontWeight="medium">
                    {KIND_META[job.kind].label}
                  </Text>
                </InlineStack>

                <div>
                  <Badge tone={STATUS_TONE[job.status] ?? "info"}>{job.status}</Badge>
                </div>

                <Text as="span" variant="bodySm" tone="subdued">
                  {job.kind === "import" && job.totalRows != null
                    ? `${job.successRows ?? 0}/${job.totalRows} ok${job.failedRows ? ` · ${job.failedRows} failed` : ""}`
                    : "—"}
                </Text>

                <Text as="span" variant="bodySm" tone="subdued">
                  {formatTime(job.createdAt)}
                </Text>

                <InlineStack gap="150">
                  {job.downloadUrl && (
                    <a href={job.downloadUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      <Button size="slim" variant="tertiary">
                        Download
                      </Button>
                    </a>
                  )}
                  {job.errorReportUrl && (
                    <a href={job.errorReportUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      <Button size="slim" variant="tertiary" tone="critical">
                        Errors
                      </Button>
                    </a>
                  )}
                </InlineStack>
              </div>
            ))
          )}
        </div>
      </BlockStack>
    </Page>
  );
}

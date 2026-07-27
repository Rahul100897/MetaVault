import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import {
  Page,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Modal,
  Collapsible,
  ProgressBar,
  Spinner,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { backupQueue } from "../lib/queue.server";
import { getDownloadUrl, getFileContent } from "../lib/r2.server";
import type { RestoreDiff, DiffEntry } from "../jobs/restore-diff.server";
import { getPlan } from "../lib/plan.server";
import { canBackup } from "../lib/plans";
import UpgradeModal from "../components/UpgradeModal";

type BackupRow = {
  id: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  sizeBytes: number | null;
  itemCount: number | null;
  downloadUrl: string | null;
};

type RestoreRow = {
  id: string;
  status: string;
  createdAt: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
};

async function signSafe(key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return await getDownloadUrl(key, 3600);
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const plan = await getPlan(shopId);
  const allowed = canBackup(plan);

  const [backupJobs, restoreJobs] = await Promise.all([
    prisma.backupJob.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.importJob.findMany({
      where: { shopId, type: "restore" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const backups: BackupRow[] = await Promise.all(
    backupJobs.map(async (b) => ({
      id: b.id,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
      expiresAt: b.expiresAt?.toISOString() ?? null,
      sizeBytes: b.sizeBytes,
      itemCount: b.itemCount,
      downloadUrl: await signSafe(b.fileUrl),
    })),
  );

  const restores: RestoreRow[] = restoreJobs.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    totalRows: r.totalRows,
    successRows: r.successRows,
    failedRows: r.failedRows,
  }));

  const hasActive =
    backups.some((b) => b.status === "queued" || b.status === "running") ||
    restores.some((r) => r.status === "queued" || r.status === "running");

  const lastCompleted = backups.find((b) => b.status === "completed") ?? null;

  return { plan, allowed, backups, restores, hasActive, lastCompleted };
};

type ActionData =
  | { ok: true; intent: "backup" | "restore" | "preview"; id: string }
  | { ok: true; intent: "preview-status"; status: string; diff: RestoreDiff | null }
  | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const plan = await getPlan(shopId);
  if (!canBackup(plan)) {
    return { ok: false, intent, error: "Backup & restore is an Agency feature." };
  }

  // Step 1 of a restore: queue a diff of the snapshot against the live store.
  if (intent === "preview") {
    const backupId = String(form.get("backupId") ?? "");
    const backup = await prisma.backupJob.findFirst({ where: { id: backupId, shopId } });
    if (!backup?.fileUrl) {
      return { ok: false, intent, error: "That backup is not available to restore." };
    }
    const previewJob = await prisma.importJob.create({
      data: { shopId, type: "restore-preview", status: "queued" },
    });
    await backupQueue.add("preview-restore", {
      jobId: backup.id,
      shopId,
      shopDomain: shopId,
      accessToken: String(session.accessToken ?? ""),
      mode: "preview",
      backupKey: backup.fileUrl,
      previewJobId: previewJob.id,
    });
    return { ok: true, intent: "preview", id: previewJob.id };
  }

  if (intent === "preview-status") {
    const jobId = String(form.get("jobId") ?? "");
    const job = await prisma.importJob.findFirst({
      where: { id: jobId, shopId, type: "restore-preview" },
    });
    if (!job) return { ok: false, intent, error: "Preview not found." };
    if (job.status !== "completed" || !job.fileUrl) {
      return { ok: true, intent: "preview-status", status: job.status, diff: null };
    }
    const raw = await getFileContent(job.fileUrl);
    return {
      ok: true,
      intent: "preview-status",
      status: "completed",
      diff: raw ? (JSON.parse(raw) as RestoreDiff) : null,
    };
  }

  if (intent === "backup") {
    const job = await prisma.backupJob.create({ data: { shopId, status: "queued" } });
    await backupQueue.add("create-backup", {
      jobId: job.id,
      shopId,
      shopDomain: shopId,
      accessToken: String(session.accessToken ?? ""),
      mode: "backup",
    });
    return { ok: true, intent: "backup", id: job.id };
  }

  if (intent === "restore") {
    const backupId = String(form.get("backupId") ?? "");
    const backup = await prisma.backupJob.findFirst({ where: { id: backupId, shopId } });
    if (!backup?.fileUrl) {
      return { ok: false, intent, error: "That backup is not available to restore." };
    }
    const restoreJob = await prisma.importJob.create({
      data: { shopId, type: "restore", status: "queued" },
    });
    await backupQueue.add("restore-backup", {
      jobId: backup.id,
      shopId,
      shopDomain: shopId,
      accessToken: String(session.accessToken ?? ""),
      mode: "restore",
      backupKey: backup.fileUrl,
      restoreJobId: restoreJob.id,
    });
    return { ok: true, intent: "restore", id: restoreJob.id };
  }

  return { ok: false, intent, error: `Unknown action: ${intent}` };
};

// ---------------------------------------------------------------------------

const STATUS_TONE: Record<string, "info" | "success" | "critical" | "attention"> = {
  queued: "info",
  running: "attention",
  completed: "success",
  failed: "critical",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function BackupsEmpty() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "56px 24px",
        gap: "14px",
      }}
    >
      <svg width="110" height="110" viewBox="0 0 130 130" fill="none">
        <rect width="130" height="130" rx="65" fill="#F3F4F6" />
        <path
          d="M65 34l-26 10v20c0 17 11 27 26 32 15-5 26-15 26-32V44l-26-10z"
          fill="#FFFFFF"
          stroke="#E5E7EB"
          strokeWidth="2"
        />
        <path
          d="M56 66l7 7 14-14"
          stroke="#6366F1"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          No backups yet
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Create your first snapshot from the panel on the left. Backups are kept for
          30 days.
        </Text>
      </BlockStack>
    </div>
  );
}

function LockedPanel({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "56px 24px",
        gap: "16px",
        background: "#FFFFFF",
        borderRadius: "12px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          width: "72px",
          height: "72px",
          borderRadius: "18px",
          background: "linear-gradient(135deg, #8B5CF6, #6366F1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <rect x="5" y="11" width="14" height="9" rx="2" stroke="#fff" strokeWidth="2" />
          <path d="M8 11V8a4 4 0 018 0v3" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          Backup &amp; Restore is an Agency feature
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Snapshot every metafield and metaobject, and roll back to any point in the last
          30 days.
        </Text>
      </BlockStack>
      <Button variant="primary" onClick={onUpgrade}>
        See plans
      </Button>
    </div>
  );
}

const GRID = "1.4fr 110px 90px 1.2fr 170px";

function CreatePanel({
  onCreate,
  loading,
  lastCompleted,
  hasActive,
}: {
  onCreate: () => void;
  loading: boolean;
  lastCompleted: BackupRow | null;
  hasActive: boolean;
}) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        borderRadius: "12px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        padding: "22px 20px",
        position: "sticky",
        top: "8px",
      }}
    >
      <BlockStack gap="400">
        <BlockStack gap="150">
          <Text as="h2" variant="headingMd" fontWeight="semibold">
            Create a backup
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Captures every metafield across products, collections, customers and orders,
            plus every metaobject entry, into a single downloadable snapshot.
          </Text>
        </BlockStack>

        <div style={{ background: "#F8F9FF", borderRadius: "10px", padding: "14px 16px" }}>
          <BlockStack gap="150">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              Last successful backup
            </Text>
            {lastCompleted ? (
              <BlockStack gap="050">
                <Text as="p" variant="bodySm">
                  {formatDate(lastCompleted.createdAt)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {lastCompleted.itemCount?.toLocaleString() ?? "—"} items ·{" "}
                  {formatSize(lastCompleted.sizeBytes)}
                </Text>
              </BlockStack>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                None yet
              </Text>
            )}
          </BlockStack>
        </div>

        <Button variant="primary" fullWidth onClick={onCreate} loading={loading}>
          {hasActive ? "Backup in progress…" : "Create backup"}
        </Button>

        <Text as="p" variant="bodySm" tone="subdued">
          Large stores can take a few minutes. Snapshots are retained for 30 days, then
          deleted automatically.
        </Text>
      </BlockStack>
    </div>
  );
}

/** One collapsible bucket of the restore plan. */
function DiffSection({
  title,
  tone,
  count,
  entries,
  description,
}: {
  title: string;
  tone: string;
  count: number;
  entries: DiffEntry[];
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const id = `diff-${title.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: "10px", overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={count === 0}
        aria-expanded={open}
        aria-controls={id}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "12px 14px",
          background: "#FFFFFF",
          border: "none",
          cursor: count === 0 ? "default" : "pointer",
          textAlign: "left",
        }}
      >
        <InlineStack gap="200" blockAlign="center">
          <span
            style={{
              minWidth: "34px",
              textAlign: "center",
              background: `${tone}18`,
              color: tone,
              borderRadius: "6px",
              padding: "2px 8px",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            {count.toLocaleString()}
          </span>
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {title}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {description}
            </Text>
          </BlockStack>
        </InlineStack>
        {count > 0 && (
          <Text as="span" variant="bodySm" tone="subdued">
            {open ? "Hide" : "Show"}
          </Text>
        )}
      </button>

      <Collapsible open={open} id={id} transition={{ duration: "150ms" }}>
        <div style={{ borderTop: "1px solid #F3F4F6", maxHeight: "240px", overflowY: "auto" }}>
          {entries.map((e, i) => (
            <div
              key={`${e.label}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                padding: "8px 14px",
                background: i % 2 === 0 ? "#FFFFFF" : "#FAFAFB",
              }}
            >
              <Text as="span" variant="bodySm" truncate>
                {e.label}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued" truncate>
                {e.detail}
              </Text>
            </div>
          ))}
          {count > entries.length && (
            <div style={{ padding: "8px 14px" }}>
              <Text as="span" variant="bodySm" tone="subdued">
                …and {(count - entries.length).toLocaleString()} more
              </Text>
            </div>
          )}
        </div>
      </Collapsible>
    </div>
  );
}

export default function BackupsPage() {
  const { allowed, backups, restores, hasActive, lastCompleted } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const backupFetcher = useFetcher<typeof action>();
  const restoreFetcher = useFetcher<typeof action>();

  const previewFetcher = useFetcher<typeof action>();

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [diff, setDiff] = useState<RestoreDiff | null>(null);

  // Auto-refresh while a backup/restore is in flight.
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => revalidator.revalidate(), 5000);
    return () => clearInterval(id);
  }, [hasActive, revalidator]);

  useEffect(() => {
    if (backupFetcher.state !== "idle" || !backupFetcher.data) return;
    const d = backupFetcher.data;
    if (d.ok) {
      shopify.toast.show("Backup started — this can take a minute");
      revalidator.revalidate();
    } else {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupFetcher.state, backupFetcher.data]);

  useEffect(() => {
    if (restoreFetcher.state !== "idle" || !restoreFetcher.data) return;
    const d = restoreFetcher.data;
    if (d.ok) {
      shopify.toast.show("Restore started — track progress below");
      closeRestore();
      revalidator.revalidate();
    } else {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreFetcher.state, restoreFetcher.data]);

  // Preview: capture the tracking job id, then the diff once it lands.
  useEffect(() => {
    if (previewFetcher.state !== "idle" || !previewFetcher.data) return;
    const d = previewFetcher.data;
    if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
      return;
    }
    if (d.intent === "preview") setPreviewJobId(d.id);
    if (d.intent === "preview-status" && d.diff) setDiff(d.diff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFetcher.state, previewFetcher.data]);

  // Poll the preview job until its diff is ready.
  useEffect(() => {
    if (!previewJobId || diff) return;
    const poll = () =>
      previewFetcher.submit(
        { intent: "preview-status", jobId: previewJobId },
        { method: "post" },
      );
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewJobId, diff]);

  const startBackup = () => {
    if (!allowed) {
      setUpgradeOpen(true);
      return;
    }
    backupFetcher.submit({ intent: "backup" }, { method: "post" });
  };

  /** Step 1 — open the modal and queue the diff. */
  const openRestore = (backup: BackupRow) => {
    setRestoreTarget(backup);
    setPreviewJobId(null);
    setDiff(null);
    previewFetcher.submit({ intent: "preview", backupId: backup.id }, { method: "post" });
  };

  function closeRestore() {
    setRestoreTarget(null);
    setPreviewJobId(null);
    setDiff(null);
  }

  /** Step 2 — the merchant has seen the plan; write it. */
  const confirmRestore = () => {
    if (restoreTarget) {
      restoreFetcher.submit(
        { intent: "restore", backupId: restoreTarget.id },
        { method: "post" },
      );
    }
  };

  const activeRestore = restores.find(
    (r) => r.status === "running" || r.status === "queued",
  );

  const isBackingUp = backupFetcher.state !== "idle";
  const isRestoring = restoreFetcher.state !== "idle";

  return (
    <Page>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .mv-backup-row:hover { background: #EEF2FF !important; }
        .mv-backup-cols { display: grid; grid-template-columns: 320px 1fr; gap: 20px; align-items: start; }
        @media (max-width: 1100px) { .mv-backup-cols { grid-template-columns: 1fr; } }
      `}</style>

      <BlockStack gap="500">
        <div style={{ paddingTop: "8px" }}>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h1" variant="headingXl" fontWeight="bold">
                  Backups
                </Text>
                <Badge tone="magic">Agency</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Snapshot every metafield and metaobject, and restore when you need to.
              </Text>
            </BlockStack>
            {allowed && hasActive && (
              <Badge tone="attention" progress="partiallyComplete">
                Live
              </Badge>
            )}
          </InlineStack>
        </div>

        {!allowed ? (
          <LockedPanel onUpgrade={() => setUpgradeOpen(true)} />
        ) : (
          <div className="mv-backup-cols">
            {/* Left — create */}
            <CreatePanel
              onCreate={startBackup}
              loading={isBackingUp}
              lastCompleted={lastCompleted}
              hasActive={hasActive}
            />

            {/* Right — history */}
            <BlockStack gap="400">
              {activeRestore && (
                <div
                  style={{
                    background: "#FFFFFF",
                    borderRadius: "12px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    padding: "18px 20px",
                    borderLeft: "3px solid #6366F1",
                  }}
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Restore in progress
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {activeRestore.totalRows > 0
                          ? `${(
                              activeRestore.successRows + activeRestore.failedRows
                            ).toLocaleString()} of ${activeRestore.totalRows.toLocaleString()}`
                          : "Preparing…"}
                      </Text>
                    </InlineStack>
                    <ProgressBar
                      progress={
                        activeRestore.totalRows > 0
                          ? Math.min(
                              100,
                              Math.round(
                                ((activeRestore.successRows + activeRestore.failedRows) /
                                  activeRestore.totalRows) *
                                  100,
                              ),
                            )
                          : 0
                      }
                      size="small"
                      tone="primary"
                    />
                    {activeRestore.failedRows > 0 && (
                      <Text as="p" variant="bodySm" tone="critical">
                        {activeRestore.failedRows.toLocaleString()} item
                        {activeRestore.failedRows === 1 ? "" : "s"} could not be written.
                      </Text>
                    )}
                  </BlockStack>
                </div>
              )}

              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: "12px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
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
                  {["Created", "Status", "Size", "Expires", "Actions"].map((h, i) => (
                    <Text
                      key={i}
                      as="span"
                      variant="bodySm"
                      fontWeight="semibold"
                      tone="text-inverse"
                    >
                      {h}
                    </Text>
                  ))}
                </div>

                {backups.length === 0 ? (
                  <BackupsEmpty />
                ) : (
                  backups.map((b, idx) => (
                    <div
                      key={b.id}
                      className="mv-backup-row"
                      style={{
                        display: "grid",
                        gridTemplateColumns: GRID,
                        gap: "16px",
                        padding: "14px 20px",
                        background: idx % 2 === 0 ? "#FFFFFF" : "#F8F9FF",
                        borderBottom: "1px solid #F3F4F6",
                        alignItems: "center",
                      }}
                    >
                      <Text as="span" variant="bodySm">
                        {formatDate(b.createdAt)}
                      </Text>
                      <div>
                        <Badge tone={STATUS_TONE[b.status] ?? "info"}>{b.status}</Badge>
                      </div>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {formatSize(b.sizeBytes)}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {b.expiresAt ? formatDate(b.expiresAt) : "—"}
                      </Text>
                      <InlineStack gap="150">
                        {b.downloadUrl && (
                          <a
                            href={b.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ textDecoration: "none" }}
                          >
                            <Button size="slim" variant="tertiary">
                              Download
                            </Button>
                          </a>
                        )}
                        {b.status === "completed" && (
                          <Button
                            size="slim"
                            variant="tertiary"
                            tone="critical"
                            onClick={() => openRestore(b)}
                          >
                            Restore
                          </Button>
                        )}
                      </InlineStack>
                    </div>
                  ))
                )}
              </div>

              {restores.length > 0 && (
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd" fontWeight="semibold">
                    Recent restores
                  </Text>
                  <div
                    style={{
                      background: "#FFFFFF",
                      borderRadius: "12px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                      overflow: "hidden",
                    }}
                  >
                    {restores.map((r, idx) => (
                      <div
                        key={r.id}
                        style={{
                          display: "flex",
                          gap: "16px",
                          alignItems: "center",
                          padding: "12px 20px",
                          background: idx % 2 === 0 ? "#FFFFFF" : "#F8F9FF",
                          borderBottom: "1px solid #F3F4F6",
                        }}
                      >
                        <Badge tone={STATUS_TONE[r.status] ?? "info"}>{r.status}</Badge>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {formatDate(r.createdAt)}
                        </Text>
                        <Text as="span" variant="bodySm">
                          {r.successRows}/{r.totalRows} restored
                          {r.failedRows ? ` · ${r.failedRows} failed` : ""}
                        </Text>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              )}
            </BlockStack>
          </div>
        )}
      </BlockStack>

      {/* Restore — step 1 shows the plan, step 2 writes it */}
      <Modal
        open={restoreTarget !== null}
        onClose={closeRestore}
        title="Review this restore"
        size="large"
        primaryAction={{
          content: "Restore backup",
          destructive: true,
          loading: isRestoring,
          disabled: !diff,
          onAction: confirmRestore,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeRestore }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">
              Snapshot taken{" "}
              <Text as="span" fontWeight="semibold">
                {restoreTarget ? formatDate(restoreTarget.createdAt) : ""}
              </Text>
              {diff && diff.snapshotShop ? ` from ${diff.snapshotShop}` : ""}.
            </Text>

            {!diff ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "12px",
                  padding: "36px 0",
                }}
              >
                <Spinner size="small" accessibilityLabel="Comparing snapshot with your store" />
                <Text as="p" variant="bodySm" tone="subdued">
                  Comparing the snapshot with your store…
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Nothing is written until you confirm.
                </Text>
              </div>
            ) : (
              <BlockStack gap="300">
                <DiffSection
                  title="Will create"
                  tone="#10B981"
                  count={diff.counts.create}
                  entries={diff.create}
                  description="Not present in your store today"
                />
                <DiffSection
                  title="Will update"
                  tone="#F59E0B"
                  count={diff.counts.update}
                  entries={diff.update}
                  description="Exists with a different value — will be overwritten"
                />
                <DiffSection
                  title="Will skip"
                  tone="#6B7280"
                  count={diff.counts.skip}
                  entries={diff.skip}
                  description="Already identical to the snapshot"
                />
                <DiffSection
                  title="Definitions to create"
                  tone="#6366F1"
                  count={diff.counts.definitions}
                  entries={diff.definitions}
                  description="Missing here — create these first or the values won't show in the admin"
                />

                <div
                  style={{
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    borderRadius: "8px",
                    padding: "12px 14px",
                  }}
                >
                  <Text as="p" variant="bodySm" tone="critical">
                    The {diff.counts.update.toLocaleString()} item
                    {diff.counts.update === 1 ? "" : "s"} above will be overwritten with the
                    snapshot&apos;s values. Entries created after the snapshot are not
                    removed. This cannot be undone — consider taking a fresh backup first.
                  </Text>
                </div>
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        highlight="agency"
        reason="Backup & restore is available on the Agency plan."
      />
    </Page>
  );
}

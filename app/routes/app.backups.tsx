import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import { Page, Text, BlockStack, InlineStack, Button, Badge, Modal } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { backupQueue } from "../lib/queue.server";
import { getDownloadUrl } from "../lib/r2.server";
import { getPlan } from "../lib/plan.server";
import { canBackup } from "../lib/plans";
import UpgradeModal from "../components/UpgradeModal";

type BackupRow = {
  id: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
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

  return { plan, allowed, backups, restores, hasActive };
};

type ActionData =
  | { ok: true; intent: "backup" | "restore"; id: string }
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

function BackupsEmpty({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "64px 24px", gap: "16px" }}>
      <svg width="130" height="130" viewBox="0 0 130 130" fill="none">
        <rect width="130" height="130" rx="65" fill="#F3F4F6" />
        <path d="M65 34l-26 10v20c0 17 11 27 26 32 15-5 26-15 26-32V44l-26-10z" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
        <path d="M56 66l7 7 14-14" stroke="#6366F1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          No backups yet
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Create a snapshot of every metafield and metaobject in your store. Backups are kept for 30 days.
        </Text>
      </BlockStack>
      <Button variant="primary" onClick={onCreate} disabled={disabled}>
        Create your first backup
      </Button>
    </div>
  );
}

function LockedPanel({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 24px", gap: "16px", background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ width: "72px", height: "72px", borderRadius: "18px", background: "linear-gradient(135deg, #8B5CF6, #6366F1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
          Snapshot every metafield and metaobject, and roll back to any point in the last 30 days.
        </Text>
      </BlockStack>
      <Button variant="primary" onClick={onUpgrade}>
        See plans
      </Button>
    </div>
  );
}

const GRID = "200px 120px 200px 1fr 210px";

export default function BackupsPage() {
  const { allowed, backups, restores, hasActive } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const backupFetcher = useFetcher<typeof action>();
  const restoreFetcher = useFetcher<typeof action>();

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);

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
      setRestoreTarget(null);
      revalidator.revalidate();
    } else {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreFetcher.state, restoreFetcher.data]);

  const startBackup = () => {
    if (!allowed) {
      setUpgradeOpen(true);
      return;
    }
    backupFetcher.submit({ intent: "backup" }, { method: "post" });
  };

  const confirmRestore = () => {
    if (restoreTarget) {
      restoreFetcher.submit({ intent: "restore", backupId: restoreTarget.id }, { method: "post" });
    }
  };

  const isBackingUp = backupFetcher.state !== "idle";
  const isRestoring = restoreFetcher.state !== "idle";

  return (
    <Page>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .mv-backup-row:hover { background: #EEF2FF !important; }
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
            {allowed && (
              <InlineStack gap="200" blockAlign="center">
                {hasActive && (
                  <Badge tone="attention" progress="partiallyComplete">
                    Live
                  </Badge>
                )}
                <Button variant="primary" onClick={startBackup} loading={isBackingUp}>
                  Create backup
                </Button>
              </InlineStack>
            )}
          </InlineStack>
        </div>

        {!allowed ? (
          <LockedPanel onUpgrade={() => setUpgradeOpen(true)} />
        ) : (
          <>
            <div style={{ background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: GRID, gap: "16px", padding: "12px 20px", background: "#0A0F1E" }}>
                {["Created", "Status", "Expires", "", "Actions"].map((h, i) => (
                  <Text key={i} as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
                    {h}
                  </Text>
                ))}
              </div>

              {backups.length === 0 ? (
                <BackupsEmpty onCreate={startBackup} disabled={isBackingUp} />
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
                      {b.expiresAt ? formatDate(b.expiresAt) : "—"}
                    </Text>
                    <span />
                    <InlineStack gap="150">
                      {b.downloadUrl && (
                        <a href={b.downloadUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                          <Button size="slim" variant="tertiary">
                            Download
                          </Button>
                        </a>
                      )}
                      {b.status === "completed" && (
                        <Button size="slim" variant="tertiary" tone="critical" onClick={() => setRestoreTarget(b)}>
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
                <div style={{ background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }}>
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
          </>
        )}
      </BlockStack>

      {/* Restore confirmation — destructive */}
      <Modal
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        title="Restore this backup?"
        primaryAction={{
          content: "Restore backup",
          destructive: true,
          loading: isRestoring,
          onAction: confirmRestore,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setRestoreTarget(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              This will re-apply the snapshot taken on{" "}
              <Text as="span" fontWeight="semibold">
                {restoreTarget ? formatDate(restoreTarget.createdAt) : ""}
              </Text>
              .
            </Text>
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 14px" }}>
              <Text as="p" variant="bodySm" tone="critical">
                Metafields and metaobjects with the same keys/handles will be overwritten
                with the values from this backup. Entries created after the snapshot are
                not removed. This cannot be undone — consider taking a fresh backup first.
              </Text>
            </div>
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

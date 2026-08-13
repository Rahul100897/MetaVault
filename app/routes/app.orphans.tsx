import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Text, BlockStack, InlineStack, Button, Badge, Modal } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  listMetafields,
  listMetafieldDefinitions,
  deleteMetafields,
} from "../lib/metafields.server";
import { OWNER_CONFIG, OWNER_TYPES, chunk, type OwnerType } from "../lib/metafields";
import { getPlan } from "../lib/plan.server";
import { canCleanOrphans } from "../lib/plans";
import UpgradeModal from "../components/UpgradeModal";

function truncate(value: string, max = 40): string {
  return value.length <= max ? value : value.slice(0, max) + "…";
}

/** A metafield with no matching metafield definition. */
type Orphan = {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  ownerLabel: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const plan = await getPlan(session.shop);
  // Orphan cleaner is part of the Agency toolkit.
  return { plan, allowed: canCleanOrphans(plan) };
};

type ActionData =
  | { ok: true; intent: "scan"; orphans: Orphan[]; scanned: number }
  | { ok: true; intent: "delete"; deletedIds: string[]; failed: number }
  | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const plan = await getPlan(session.shop);
  if (!canCleanOrphans(plan)) {
    return { ok: false, intent, error: "The orphan cleaner is an Agency feature." };
  }

  if (intent === "scan") {
    const orphans: Orphan[] = [];
    let scanned = 0;

    for (const ownerType of OWNER_TYPES as OwnerType[]) {
      try {
        const defs = await listMetafieldDefinitions(admin, ownerType);
        const defined = new Set(defs.map((d) => `${d.namespace}.${d.key}`));

        let after: string | null = null;
        do {
          const page = await listMetafields(admin, { ownerType, first: 50, after });
          for (const row of page.rows) {
            scanned++;
            if (!defined.has(`${row.namespace}.${row.key}`)) {
              orphans.push({
                id: row.id,
                ownerType,
                ownerId: row.ownerId,
                ownerLabel: row.ownerLabel,
                namespace: row.namespace,
                key: row.key,
                type: row.type,
                value: row.value,
              });
            }
          }
          after = page.hasNextPage ? page.endCursor : null;
        } while (after);
      } catch (err) {
        // Skip owner types the app can't read (e.g. Customers/Orders without
        // Protected Customer Data approval) rather than failing the whole scan.
        // eslint-disable-next-line no-console
        console.warn(
          `[metavault] orphan scan skipping ${ownerType}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { ok: true, intent: "scan", orphans, scanned };
  }

  if (intent === "delete") {
    let items: Array<{ id: string; ownerId: string; namespace: string; key: string }> = [];
    try {
      items = JSON.parse(String(form.get("items") ?? "[]"));
    } catch {
      items = [];
    }
    if (!items.length) return { ok: false, intent, error: "Nothing selected" };

    const deletedIds: string[] = [];
    let failed = 0;
    for (const batch of chunk(items, 25)) {
      try {
        const result = await deleteMetafields(
          admin,
          batch.map(({ ownerId, namespace, key }) => ({ ownerId, namespace, key })),
        );
        for (const d of result.deletedMetafields) {
          const match = batch.find(
            (b) => b.ownerId === d.ownerId && b.namespace === d.namespace && b.key === d.key,
          );
          if (match) deletedIds.push(match.id);
        }
        failed += batch.length - result.deletedMetafields.length;
      } catch {
        failed += batch.length;
      }
    }

    if (deletedIds.length) {
      await prisma.activityLog.create({
        data: {
          shopId: session.shop,
          action: "delete",
          resourceType: "orphan_metafield",
          rowCount: deletedIds.length,
        },
      });
    }
    return { ok: true, intent: "delete", deletedIds, failed };
  }

  return { ok: false, intent, error: `Unknown action: ${intent}` };
};

// ---------------------------------------------------------------------------

function ScanEmpty({ scanned }: { scanned: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "64px 24px", gap: "16px" }}>
      <svg width="130" height="130" viewBox="0 0 130 130" fill="none">
        <rect width="130" height="130" rx="65" fill="#ECFDF5" />
        <circle cx="65" cy="65" r="30" fill="#FFFFFF" stroke="#A7F3D0" strokeWidth="2" />
        <path d="M53 65l8 8 17-17" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          No orphans found
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Scanned {scanned.toLocaleString()} metafields — every one maps to a definition.
        </Text>
      </BlockStack>
    </div>
  );
}

function Intro({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "64px 24px", gap: "16px" }}>
      <svg width="130" height="130" viewBox="0 0 130 130" fill="none">
        <rect width="130" height="130" rx="65" fill="#F3F4F6" />
        <circle cx="59" cy="59" r="21" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="3" />
        <path d="M75 75l16 16" stroke="#6366F1" strokeWidth="4" strokeLinecap="round" />
        <path d="M52 59h14M59 52v14" stroke="#C7D2FE" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          Find orphaned metafields
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Orphans are metafields whose namespace/key has no matching definition. They
          still store data but aren&apos;t managed as structured data in Shopify admin.
        </Text>
      </BlockStack>
      <Button variant="primary" onClick={onScan} loading={scanning}>
        Scan for orphans
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
          Orphan cleaner is an Agency feature
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Find and remove metafields left behind by deleted definitions.
        </Text>
      </BlockStack>
      <Button variant="primary" onClick={onUpgrade}>
        See plans
      </Button>
    </div>
  );
}

const GRID = "36px 150px 1fr 150px 150px minmax(160px, 1.4fr)";

export default function OrphansPage() {
  const { allowed } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const scanFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();

  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const scanning = scanFetcher.state !== "idle";
  const deleting = deleteFetcher.state !== "idle";

  useEffect(() => {
    if (scanFetcher.state !== "idle" || !scanFetcher.data) return;
    const d = scanFetcher.data;
    if (d.ok && d.intent === "scan") {
      setOrphans(d.orphans);
      setScanned(d.scanned);
      setSelected([]);
      shopify.toast.show(
        d.orphans.length
          ? `Found ${d.orphans.length} orphaned metafield${d.orphans.length === 1 ? "" : "s"}`
          : "No orphans found",
      );
    } else if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanFetcher.state, scanFetcher.data]);

  useEffect(() => {
    if (deleteFetcher.state !== "idle" || !deleteFetcher.data) return;
    const d = deleteFetcher.data;
    if (d.ok && d.intent === "delete") {
      const removed = new Set(d.deletedIds);
      setOrphans((prev) => (prev ? prev.filter((o) => !removed.has(o.id)) : prev));
      setSelected([]);
      setConfirmOpen(false);
      if (d.failed) {
        shopify.toast.show(`Deleted ${d.deletedIds.length}, ${d.failed} failed`, { isError: true });
      } else {
        shopify.toast.show(`Deleted ${d.deletedIds.length} orphaned metafield${d.deletedIds.length === 1 ? "" : "s"}`);
      }
    } else if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state, deleteFetcher.data]);

  const startScan = () => {
    if (!allowed) {
      setUpgradeOpen(true);
      return;
    }
    scanFetcher.submit({ intent: "scan" }, { method: "post" });
  };

  const toggleRow = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const rows = orphans ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selectedSet.has(r.id));
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((r) => r.id));

  const confirmDelete = () => {
    const items = rows
      .filter((r) => selectedSet.has(r.id))
      .map((r) => ({ id: r.id, ownerId: r.ownerId, namespace: r.namespace, key: r.key }));
    deleteFetcher.submit({ intent: "delete", items: JSON.stringify(items) }, { method: "post" });
  };

  return (
    <Page>
      <style>{`.mv-orphan-row:hover { background: #EEF2FF !important; }
        .mv-check { width: 16px; height: 16px; cursor: pointer; accent-color: #6366F1; }`}</style>

      <BlockStack gap="500">
        <div style={{ paddingTop: "8px" }}>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h1" variant="headingXl" fontWeight="bold">
                  Orphan cleaner
                </Text>
                <Badge tone="magic">Agency</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Find metafields whose definition no longer exists, and clean them up.
              </Text>
            </BlockStack>
            {allowed && orphans !== null && (
              <Button onClick={startScan} loading={scanning}>
                Re-scan
              </Button>
            )}
          </InlineStack>
        </div>

        {!allowed ? (
          <LockedPanel onUpgrade={() => setUpgradeOpen(true)} />
        ) : (
          <div style={{ background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }}>
            {orphans === null ? (
              <Intro onScan={startScan} scanning={scanning} />
            ) : rows.length === 0 ? (
              <ScanEmpty scanned={scanned} />
            ) : (
              <>
                {selected.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 20px",
                      background: "linear-gradient(135deg, #0A0F1E, #1E1B4B)",
                    }}
                  >
                    <InlineStack gap="300" blockAlign="center">
                      <span style={{ background: "#6366F1", color: "#fff", borderRadius: "20px", padding: "2px 10px", fontSize: "12px", fontWeight: 600 }}>
                        {selected.length} selected
                      </span>
                      <button type="button" onClick={() => setSelected([])} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", fontSize: "13px", cursor: "pointer" }}>
                        Clear
                      </button>
                    </InlineStack>
                    <Button variant="primary" tone="critical" loading={deleting} onClick={() => setConfirmOpen(true)}>
                      Delete selected
                    </Button>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: GRID, gap: "16px", padding: "12px 20px", background: "#0A0F1E" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <input type="checkbox" className="mv-check" aria-label="Select all" checked={allSelected} onChange={toggleAll} />
                  </div>
                  {["Owner type", "Owner", "Namespace", "Key", "Value"].map((h) => (
                    <Text key={h} as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
                      {h}
                    </Text>
                  ))}
                </div>

                {rows.map((o, idx) => (
                  <div
                    key={o.id}
                    className="mv-orphan-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: GRID,
                      gap: "16px",
                      padding: "12px 20px",
                      background: selectedSet.has(o.id) ? "#EEF0FF" : idx % 2 === 0 ? "#FFFFFF" : "#F8F9FF",
                      borderBottom: "1px solid #F3F4F6",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <input
                        type="checkbox"
                        className="mv-check"
                        aria-label={`Select ${o.namespace}.${o.key}`}
                        checked={selectedSet.has(o.id)}
                        onChange={() => toggleRow(o.id)}
                      />
                    </div>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {OWNER_CONFIG[o.ownerType]?.label ?? o.ownerType}
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="medium">
                      {o.ownerLabel}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {o.namespace}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {o.key}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {truncate(o.value, 40)}
                    </Text>
                  </div>
                ))}

                <div style={{ padding: "12px 20px", background: "#F9FAFB", borderTop: "1px solid #E5E7EB" }}>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {rows.length} orphan{rows.length === 1 ? "" : "s"} of {scanned.toLocaleString()} metafields scanned
                  </Text>
                </div>
              </>
            )}
          </div>
        )}
      </BlockStack>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Delete ${selected.length} orphaned metafield${selected.length === 1 ? "" : "s"}?`}
        primaryAction={{
          content: `Delete ${selected.length}`,
          destructive: true,
          loading: deleting,
          onAction: confirmDelete,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              You&apos;re about to permanently delete{" "}
              <Text as="span" fontWeight="semibold">
                {selected.length} orphaned metafield{selected.length === 1 ? "" : "s"}
              </Text>
              .
            </Text>
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 14px" }}>
              <Text as="p" variant="bodySm" tone="critical">
                This cannot be undone. These metafields still contain data — if a theme or
                app reads them directly by namespace/key, it will stop finding them. Take a
                backup first if you&apos;re unsure.
              </Text>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        highlight="agency"
        reason="The orphan cleaner is available on the Agency plan."
      />
    </Page>
  );
}

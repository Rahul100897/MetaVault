import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  Badge,
  Button,
  InlineStack,
  Divider,
  Collapsible,
  Spinner,
  Modal,
  Checkbox,
  TextField,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPlan } from "../lib/plan.server";
import { canCleanOrphans, PLAN_DETAILS, type Plan } from "../lib/plans";
import {
  scanNamespaces,
  deleteNamespace,
  collectNamespaceMetafields,
  type NamespaceSummary,
} from "../lib/namespaces.server";
import { OWNER_CONFIG } from "../lib/metafields";
import UpgradeModal from "../components/UpgradeModal";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const plan = await getPlan(session.shop);
  const settings = await prisma.shopSettings.findUnique({ where: { shopId: session.shop } });
  return {
    plan,
    canInspect: canCleanOrphans(plan),
    notifications: {
      enabled: settings?.emailNotifications ?? true,
      email: settings?.notifyEmail ?? "",
    },
  };
};

type ActionData =
  | { ok: true; intent: "scan"; summaries: NamespaceSummary[]; scanned: number }
  | { ok: true; intent: "preview"; namespace: string; keys: string[]; total: number }
  | { ok: true; intent: "delete"; namespace: string; deleted: number; failed: number }
  | { ok: true; intent: "notifications" }
  | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // Notification prefs are available on every plan and touch no admin data.
  if (intent === "notifications") {
    const enabled = form.get("enabled") === "true";
    const email = String(form.get("email") ?? "").trim();
    await prisma.shopSettings.upsert({
      where: { shopId: session.shop },
      create: { shopId: session.shop, emailNotifications: enabled, notifyEmail: email || null },
      update: { emailNotifications: enabled, notifyEmail: email || null },
    });
    return { ok: true, intent: "notifications" };
  }

  const plan = await getPlan(session.shop);
  if (!canCleanOrphans(plan)) {
    return { ok: false, intent, error: "The namespace inspector is an Agency feature." };
  }

  if (intent === "scan") {
    const { summaries, scanned } = await scanNamespaces(admin);
    return { ok: true, intent: "scan", summaries, scanned };
  }

  if (intent === "preview") {
    const namespace = String(form.get("namespace") ?? "");
    const items = await collectNamespaceMetafields(admin, namespace);
    // Distinct keys give a readable preview without dumping every owner row.
    const keys = [...new Set(items.map((i) => i.key))].sort();
    return { ok: true, intent: "preview", namespace, keys, total: items.length };
  }

  if (intent === "delete") {
    const namespace = String(form.get("namespace") ?? "");
    if (!namespace) return { ok: false, intent, error: "No namespace specified." };
    const { deleted, failed } = await deleteNamespace(admin, namespace);

    if (deleted > 0) {
      await prisma.activityLog.create({
        data: {
          shopId: session.shop,
          action: "delete",
          resourceType: `namespace:${namespace}`,
          rowCount: deleted,
        },
      });
    }
    return { ok: true, intent: "delete", namespace, deleted, failed };
  }

  return { ok: false, intent, error: `Unknown action: ${intent}` };
};

// ---------------------------------------------------------------------------

function SubscriptionCard({ plan }: { plan: Plan }) {
  const detail = PLAN_DETAILS.find((p) => p.id === plan) ?? PLAN_DETAILS[0];
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd" fontWeight="semibold">
          Subscription
        </Text>
        <Divider />
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {detail.name} Plan
              </Text>
              <Badge tone="info">Current</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {detail.features.slice(0, 3).join(" · ")}
            </Text>
          </BlockStack>
          <Button url="/app/billing" variant="primary">
            Manage plan
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function NotificationsCard({
  initial,
}: {
  initial: { enabled: boolean; email: string };
}) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [email, setEmail] = useState(initial.email);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok && fetcher.data.intent === "notifications") {
      shopify.toast.show("Notification settings saved");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const save = () =>
    fetcher.submit(
      { intent: "notifications", enabled: String(enabled), email },
      { method: "post" },
    );

  const dirty = enabled !== initial.enabled || email !== initial.email;

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd" fontWeight="semibold">
          Email notifications
        </Text>
        <Divider />
        <Checkbox
          label="Email me when a job finishes"
          helpText="Get a message when an import, export, backup, or restore completes or fails."
          checked={enabled}
          onChange={setEnabled}
        />
        <div style={{ maxWidth: "360px" }}>
          <TextField
            label="Notification email"
            type="email"
            value={email}
            onChange={setEmail}
            disabled={!enabled}
            placeholder="Defaults to the store owner's email"
            helpText="Leave blank to use the store owner's email."
            autoComplete="email"
          />
        </div>
        <InlineStack align="end">
          <Button
            variant="primary"
            onClick={save}
            disabled={!dirty}
            loading={fetcher.state !== "idle"}
          >
            Save
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function NamespaceRow({
  summary,
  onDelete,
}: {
  summary: NamespaceSummary;
  onDelete: (ns: NamespaceSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const previewFetcher = useFetcher<typeof action>();

  const preview =
    previewFetcher.data && previewFetcher.data.ok && previewFetcher.data.intent === "preview"
      ? previewFetcher.data
      : null;

  const togglePreview = () => {
    const next = !open;
    setOpen(next);
    if (next && !preview && previewFetcher.state === "idle") {
      previewFetcher.submit(
        { intent: "preview", namespace: summary.namespace },
        { method: "post" },
      );
    }
  };

  const orphan = summary.status === "orphan";

  return (
    <div style={{ borderBottom: "1px solid #F3F4F6" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 120px 120px 220px",
          gap: "16px",
          padding: "12px 20px",
          alignItems: "center",
        }}
      >
        <BlockStack gap="050">
          <Text as="span" variant="bodySm" fontWeight="medium">
            {summary.namespace}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {summary.ownerTypes.map((t) => OWNER_CONFIG[t]?.label ?? t).join(", ")}
          </Text>
        </BlockStack>
        <Text as="span" variant="bodySm">
          {summary.count.toLocaleString()}
        </Text>
        <div>
          {orphan ? (
            <Badge tone="warning">Orphan</Badge>
          ) : (
            <Badge tone="success">{summary.reserved ? "Reserved" : "Active"}</Badge>
          )}
        </div>
        <InlineStack gap="150">
          <Button size="slim" variant="tertiary" onClick={togglePreview}>
            {open ? "Hide" : "Preview"}
          </Button>
          {orphan && (
            <Button
              size="slim"
              variant="tertiary"
              tone="critical"
              onClick={() => onDelete(summary)}
            >
              Delete namespace
            </Button>
          )}
        </InlineStack>
      </div>

      <Collapsible open={open} id={`ns-${summary.namespace}`} transition={{ duration: "150ms" }}>
        <div style={{ padding: "0 20px 14px 20px" }}>
          {!preview ? (
            <InlineStack gap="150" blockAlign="center">
              <Spinner size="small" accessibilityLabel="Loading keys" />
              <Text as="span" variant="bodySm" tone="subdued">
                Loading keys…
              </Text>
            </InlineStack>
          ) : (
            <div style={{ background: "#F8F9FF", borderRadius: "8px", padding: "12px 14px" }}>
              <BlockStack gap="150">
                <Text as="span" variant="bodySm" tone="subdued">
                  {preview.total.toLocaleString()} metafield
                  {preview.total === 1 ? "" : "s"} across {preview.keys.length} key
                  {preview.keys.length === 1 ? "" : "s"}:
                </Text>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {preview.keys.slice(0, 40).map((k) => (
                    <span
                      key={k}
                      style={{
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: "12px",
                        background: "#FFFFFF",
                        border: "1px solid #E5E7EB",
                        borderRadius: "6px",
                        padding: "2px 8px",
                      }}
                    >
                      {summary.namespace}.{k}
                    </span>
                  ))}
                  {preview.keys.length > 40 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      +{preview.keys.length - 40} more
                    </Text>
                  )}
                </div>
              </BlockStack>
            </div>
          )}
        </div>
      </Collapsible>
    </div>
  );
}

function NamespaceInspector({ canInspect }: { canInspect: boolean }) {
  const shopify = useAppBridge();
  const scanFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();

  const [summaries, setSummaries] = useState<NamespaceSummary[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<NamespaceSummary | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const scanning = scanFetcher.state !== "idle";
  const deleting = deleteFetcher.state !== "idle";

  useEffect(() => {
    if (scanFetcher.state !== "idle" || !scanFetcher.data) return;
    const d = scanFetcher.data;
    if (d.ok && d.intent === "scan") {
      setSummaries(d.summaries);
      setScanned(d.scanned);
    } else if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanFetcher.state, scanFetcher.data]);

  useEffect(() => {
    if (deleteFetcher.state !== "idle" || !deleteFetcher.data) return;
    const d = deleteFetcher.data;
    if (d.ok && d.intent === "delete") {
      setSummaries((prev) => (prev ? prev.filter((s) => s.namespace !== d.namespace) : prev));
      setDeleteTarget(null);
      shopify.toast.show(
        d.failed
          ? `Deleted ${d.deleted} from ${d.namespace}, ${d.failed} failed`
          : `Deleted namespace “${d.namespace}” (${d.deleted} metafields)`,
        d.failed ? { isError: true } : undefined,
      );
    } else if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state, deleteFetcher.data]);

  const startScan = () => {
    if (!canInspect) {
      setUpgradeOpen(true);
      return;
    }
    scanFetcher.submit({ intent: "scan" }, { method: "post" });
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteFetcher.submit(
        { intent: "delete", namespace: deleteTarget.namespace },
        { method: "post" },
      );
    }
  };

  const orphanCount = useMemo(
    () => (summaries ?? []).filter((s) => s.status === "orphan").length,
    [summaries],
  );

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd" fontWeight="semibold">
                Namespace inspector
              </Text>
              <Badge tone="magic">Agency</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Group metafields by namespace and clear out ones left behind by removed
              apps or deleted definitions.
            </Text>
          </BlockStack>
          {summaries !== null && (
            <Button onClick={startScan} loading={scanning}>
              Re-scan
            </Button>
          )}
        </InlineStack>

        <Divider />

        {!canInspect ? (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <BlockStack gap="200" inlineAlign="center">
              <Text as="p" variant="bodyMd">
                The namespace inspector is an Agency feature.
              </Text>
              <Button variant="primary" onClick={() => setUpgradeOpen(true)}>
                See plans
              </Button>
            </BlockStack>
          </div>
        ) : summaries === null ? (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <BlockStack gap="300" inlineAlign="center">
              <Text as="p" variant="bodySm" tone="subdued">
                Scan your store to group every metafield by namespace.
              </Text>
              <Button variant="primary" onClick={startScan} loading={scanning}>
                Scan namespaces
              </Button>
            </BlockStack>
          </div>
        ) : summaries.length === 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            No metafields found. Scanned {scanned.toLocaleString()} rows.
          </Text>
        ) : (
          <div style={{ border: "1px solid #ECECF1", borderRadius: "10px", overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 120px 120px 220px",
                gap: "16px",
                padding: "10px 20px",
                background: "#0A0F1E",
              }}
            >
              {["Namespace", "Metafields", "Status", ""].map((h, i) => (
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
            {summaries.map((s) => (
              <NamespaceRow key={s.namespace} summary={s} onDelete={setDeleteTarget} />
            ))}
            <div style={{ padding: "10px 20px", background: "#F9FAFB" }}>
              <Text as="span" variant="bodySm" tone="subdued">
                {summaries.length} namespace{summaries.length === 1 ? "" : "s"} · {orphanCount}{" "}
                orphan{orphanCount === 1 ? "" : "s"} · {scanned.toLocaleString()} metafields
                scanned
              </Text>
            </div>
          </div>
        )}
      </BlockStack>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Delete namespace “${deleteTarget?.namespace ?? ""}”?`}
        primaryAction={{
          content: "Delete namespace",
          destructive: true,
          loading: deleting,
          onAction: confirmDelete,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteTarget(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              This permanently deletes all{" "}
              <Text as="span" fontWeight="semibold">
                {deleteTarget?.count.toLocaleString()} metafield
                {deleteTarget?.count === 1 ? "" : "s"}
              </Text>{" "}
              in the{" "}
              <Text as="span" fontWeight="semibold">
                {deleteTarget?.namespace}
              </Text>{" "}
              namespace, across every owner type.
            </Text>
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: "8px",
                padding: "12px 14px",
              }}
            >
              <Text as="p" variant="bodySm" tone="critical">
                This cannot be undone. If a theme or app still reads these by namespace/key,
                it will stop finding them. Take a backup first if you&apos;re unsure.
              </Text>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        highlight="agency"
        reason="The namespace inspector is available on the Agency plan."
      />
    </Card>
  );
}

export default function SettingsPage() {
  const { plan, canInspect, notifications } = useLoaderData<typeof loader>();

  return (
    <Page title="Settings">
      <BlockStack gap="400">
        <SubscriptionCard plan={plan} />
        <NotificationsCard initial={notifications} />
        <NamespaceInspector canInspect={canInspect} />
      </BlockStack>
    </Page>
  );
}

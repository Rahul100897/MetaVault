import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Text, BlockStack, InlineStack, Button, Badge, Select, Banner, Modal, TextField, Card } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { adminGraphqlClient } from "../lib/admin-graphql.server";
import { listDefinitions, listEntries, upsertEntry } from "../lib/metaobjects.server";
import { chunk } from "../lib/metafields";
import { getPlan } from "../lib/plan.server";
import { canCrossStoreCopy } from "../lib/plans";
import {
  areConnected,
  disconnect as disconnectStore,
  generateConnectionCode,
  getPendingCode,
  listConnectedStores,
  redeemConnectionCode,
  type ConnectedStore,
} from "../lib/connections.server";
import UpgradeModal from "../components/UpgradeModal";

/**
 * Cross-store copy.
 *
 * Only metaobjects are copied: their identity is the handle, which is portable
 * between stores. Metafield *values* are attached to owner resource GIDs that
 * don't exist in the target store, so they are intentionally out of scope.
 */

async function targetAdminFor(shop: string) {
  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { expires: "desc" },
  });
  if (!session?.accessToken) return null;
  return adminGraphqlClient(shop, session.accessToken);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;
  const plan = await getPlan(shopId);
  const allowed = canCrossStoreCopy(plan);

  if (!allowed) {
    return {
      allowed,
      shopId,
      connections: [] as ConnectedStore[],
      pendingCode: null as { code: string; expiresAt: string } | null,
      definitions: [] as Array<{ type: string; name: string; entryCount: number }>,
    };
  }

  const [connections, pending, defs] = await Promise.all([
    listConnectedStores(shopId),
    getPendingCode(shopId),
    listDefinitions(admin),
  ]);

  const definitions = defs.map((d) => ({
    type: d.type,
    name: d.name,
    entryCount: d.entryCount,
  }));

  return {
    allowed,
    shopId,
    connections,
    pendingCode: pending
      ? { code: pending.code, expiresAt: pending.expiresAt.toISOString() }
      : null,
    definitions,
  };
};

type ActionData =
  | {
      ok: true;
      intent: "preview";
      sourceCount: number;
      targetHasDefinition: boolean;
      willUpdate: number;
      willCreate: number;
    }
  | { ok: true; intent: "copy"; copied: number; failed: number }
  | { ok: true; intent: "generate-code"; code: string; expiresAt: string }
  | { ok: true; intent: "redeem-code"; partnerShop: string }
  | { ok: true; intent: "disconnect" }
  | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const plan = await getPlan(shopId);
  if (!canCrossStoreCopy(plan)) {
    return { ok: false, intent, error: "Cross-store copy is an Agency feature." };
  }

  // --- Pairing ---
  if (intent === "generate-code") {
    const { code, expiresAt } = await generateConnectionCode(shopId);
    return { ok: true, intent: "generate-code", code, expiresAt: expiresAt.toISOString() };
  }

  if (intent === "redeem-code") {
    const result = await redeemConnectionCode(String(form.get("code") ?? ""), shopId);
    return result.ok
      ? { ok: true, intent: "redeem-code", partnerShop: result.partnerShop }
      : { ok: false, intent, error: result.error };
  }

  if (intent === "disconnect") {
    await disconnectStore(shopId, String(form.get("connectionId") ?? ""));
    return { ok: true, intent: "disconnect" };
  }

  // --- Copy (preview / copy) ---
  const targetShop = String(form.get("targetShop") ?? "");
  const type = String(form.get("type") ?? "");
  if (!targetShop || !type) {
    return { ok: false, intent, error: "Pick both a definition and a target store." };
  }
  if (targetShop === shopId) {
    return { ok: false, intent, error: "Source and target store must be different." };
  }

  // SECURITY: only ever write to a store the merchant has explicitly linked.
  if (!(await areConnected(shopId, targetShop))) {
    return {
      ok: false,
      intent,
      error: "That store isn't connected. Link it first with a connection code.",
    };
  }

  const targetAdmin = await targetAdminFor(targetShop);
  if (!targetAdmin) {
    return {
      ok: false,
      intent,
      error: `No offline session for ${targetShop}. Install MetaVault on that store first.`,
    };
  }

  // Read all source entries for this definition.
  const sourceEntries: Array<{ handle: string; fields: Array<{ key: string; value: string }> }> = [];
  let after: string | null = null;
  do {
    const page = await listEntries(admin, { type, first: 100, after });
    for (const e of page.entries) {
      sourceEntries.push({
        handle: e.handle,
        fields: Object.values(e.fields).map((f) => ({ key: f.key, value: f.value })),
      });
    }
    after = page.hasNextPage ? page.endCursor : null;
  } while (after);

  if (intent === "preview") {
    const targetDefs = await listDefinitions(targetAdmin);
    const targetHasDefinition = targetDefs.some((d) => d.type === type);

    let willUpdate = 0;
    if (targetHasDefinition) {
      const existing = new Set<string>();
      let tAfter: string | null = null;
      do {
        const page = await listEntries(targetAdmin, { type, first: 250, after: tAfter });
        for (const e of page.entries) existing.add(e.handle);
        tAfter = page.hasNextPage ? page.endCursor : null;
      } while (tAfter);
      willUpdate = sourceEntries.filter((e) => existing.has(e.handle)).length;
    }

    return {
      ok: true,
      intent: "preview",
      sourceCount: sourceEntries.length,
      targetHasDefinition,
      willUpdate,
      willCreate: sourceEntries.length - willUpdate,
    };
  }

  if (intent === "copy") {
    let copied = 0;
    let failed = 0;
    for (const batch of chunk(sourceEntries, 25)) {
      const outcomes = await Promise.all(
        batch.map(async (e): Promise<boolean> => {
          try {
            const res = await upsertEntry(targetAdmin, {
              type,
              handle: e.handle,
              fields: e.fields,
            });
            return res.userErrors.length === 0 && !!res.entry;
          } catch {
            return false;
          }
        }),
      );
      const ok = outcomes.filter(Boolean).length;
      copied += ok;
      failed += outcomes.length - ok;
    }

    if (copied) {
      await prisma.activityLog.create({
        data: {
          shopId,
          action: "cross_store_copy",
          resourceType: type,
          rowCount: copied,
        },
      });
    }
    return { ok: true, intent: "copy", copied, failed };
  }

  return { ok: false, intent, error: `Unknown action: ${intent}` };
};

// ---------------------------------------------------------------------------

function LockedPanel({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 24px", gap: "16px", background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ width: "72px", height: "72px", borderRadius: "18px", background: "linear-gradient(135deg, #8B5CF6, #6366F1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path d="M4 7h10M4 7l3-3M4 7l3 3M20 17H10M20 17l-3-3M20 17l-3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          Cross-store copy is an Agency feature
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Push metaobject entries from this store to another store you manage.
        </Text>
      </BlockStack>
      <Button variant="primary" onClick={onUpgrade}>
        See plans
      </Button>
    </div>
  );
}

export default function CrossStorePage() {
  const { allowed, shopId, connections, pendingCode, definitions } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const previewFetcher = useFetcher<typeof action>();
  const copyFetcher = useFetcher<typeof action>();
  const linkFetcher = useFetcher<typeof action>();

  // Only connected stores that still have the app installed can be written to.
  const installedTargets = connections.filter((c) => c.installed).map((c) => c.shop);

  const [type, setType] = useState(definitions[0]?.type ?? "");
  const [targetShop, setTargetShop] = useState(installedTargets[0] ?? "");
  const [codeInput, setCodeInput] = useState("");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview =
    previewFetcher.data?.ok && previewFetcher.data.intent === "preview" ? previewFetcher.data : null;

  // Keep a valid target selected as connections come and go.
  useEffect(() => {
    if (!targetShop && installedTargets.length) setTargetShop(installedTargets[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installedTargets.join(",")]);

  useEffect(() => {
    if (previewFetcher.state !== "idle" || !previewFetcher.data) return;
    if (!previewFetcher.data.ok) {
      shopify.toast.show(previewFetcher.data.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFetcher.state, previewFetcher.data]);

  useEffect(() => {
    if (copyFetcher.state !== "idle" || !copyFetcher.data) return;
    const d = copyFetcher.data;
    if (d.ok && d.intent === "copy") {
      setConfirmOpen(false);
      if (d.failed) {
        shopify.toast.show(`Copied ${d.copied}, ${d.failed} failed`, { isError: true });
      } else {
        shopify.toast.show(`Copied ${d.copied} entr${d.copied === 1 ? "y" : "ies"} to ${targetShop}`);
      }
    } else if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyFetcher.state, copyFetcher.data]);

  useEffect(() => {
    if (linkFetcher.state !== "idle" || !linkFetcher.data) return;
    const d = linkFetcher.data;
    if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
      return;
    }
    if (d.intent === "redeem-code") {
      setCodeInput("");
      shopify.toast.show(`Connected to ${d.partnerShop}`);
    } else if (d.intent === "disconnect") {
      shopify.toast.show("Store disconnected");
    }
    // generate-code surfaces via revalidation (pendingCode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkFetcher.state, linkFetcher.data]);

  const runPreview = () =>
    previewFetcher.submit({ intent: "preview", type, targetShop }, { method: "post" });
  const runCopy = () => copyFetcher.submit({ intent: "copy", type, targetShop }, { method: "post" });
  const generateCode = () => linkFetcher.submit({ intent: "generate-code" }, { method: "post" });
  const redeemCode = () =>
    linkFetcher.submit({ intent: "redeem-code", code: codeInput.trim() }, { method: "post" });
  const disconnect = (connectionId: string) =>
    linkFetcher.submit({ intent: "disconnect", connectionId }, { method: "post" });
  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      shopify.toast.show("Code copied");
    } catch {
      shopify.toast.show("Couldn't copy — select the code manually", { isError: true });
    }
  };

  const previewing = previewFetcher.state !== "idle";
  const copying = copyFetcher.state !== "idle";
  const linking = linkFetcher.state !== "idle";

  return (
    <Page>
      <BlockStack gap="500">
        <div style={{ paddingTop: "8px" }}>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h1" variant="headingXl" fontWeight="bold">
                Cross-store copy
              </Text>
              <Badge tone="magic">Agency</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Copy metaobject entries from {shopId} to another store you manage.
            </Text>
          </BlockStack>
        </div>

        {!allowed ? (
          <LockedPanel onUpgrade={() => setUpgradeOpen(true)} />
        ) : (
          <BlockStack gap="400">
            <Banner tone="info" title="Metaobjects only">
              <Text as="p" variant="bodySm">
                Metaobjects are matched by <b>handle</b>, so they copy cleanly between
                stores. Metafield <i>values</i> are attached to product/customer IDs that
                only exist in this store, so they can&apos;t be copied — use CSV export/import
                for those.
              </Text>
            </Banner>

            {/* Connect a store — the security boundary: copy is only allowed
                between stores the merchant has deliberately linked. */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd" fontWeight="semibold">
                    Connect a store
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Link another store you manage (both must have MetaVault installed). Copy
                    is only ever allowed between connected stores.
                  </Text>
                </BlockStack>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "20px",
                    alignItems: "start",
                  }}
                >
                  {/* Share a code */}
                  <BlockStack gap="200">
                    <Text as="h3" variant="bodyMd" fontWeight="semibold">
                      1. Share a code
                    </Text>
                    {pendingCode ? (
                      <BlockStack gap="150">
                        <InlineStack gap="200" blockAlign="center">
                          <span
                            style={{
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: "18px",
                              fontWeight: 700,
                              letterSpacing: "1px",
                              background: "#F1F1F4",
                              padding: "6px 12px",
                              borderRadius: "8px",
                            }}
                          >
                            {pendingCode.code}
                          </span>
                          <Button size="slim" onClick={() => copyCode(pendingCode.code)}>
                            Copy
                          </Button>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Open MetaVault on the other store → Cross-store copy → paste this
                          under “Enter a code”. Expires{" "}
                          {new Date(pendingCode.expiresAt).toLocaleTimeString()}.
                        </Text>
                        <div>
                          <Button variant="plain" onClick={generateCode} loading={linking}>
                            Generate a new code
                          </Button>
                        </div>
                      </BlockStack>
                    ) : (
                      <>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Generate a code here, then enter it on the store you want to link.
                        </Text>
                        <div>
                          <Button onClick={generateCode} loading={linking}>
                            Generate connection code
                          </Button>
                        </div>
                      </>
                    )}
                  </BlockStack>

                  {/* Enter a code */}
                  <BlockStack gap="200">
                    <Text as="h3" variant="bodyMd" fontWeight="semibold">
                      2. Enter a code
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Paste a code generated on another store to link it here.
                    </Text>
                    <InlineStack gap="200" blockAlign="end">
                      <div style={{ minWidth: "180px" }}>
                        <TextField
                          label="Connection code"
                          labelHidden
                          value={codeInput}
                          onChange={setCodeInput}
                          placeholder="MV-XXXX-XXXX"
                          autoComplete="off"
                        />
                      </div>
                      <Button
                        onClick={redeemCode}
                        loading={linking}
                        disabled={!codeInput.trim()}
                      >
                        Connect
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </div>

                {connections.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="h3" variant="bodyMd" fontWeight="semibold">
                      Connected stores
                    </Text>
                    <div style={{ border: "1px solid #ECECF1", borderRadius: "10px", overflow: "hidden" }}>
                      {connections.map((c, idx) => (
                        <div
                          key={c.connectionId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "12px 16px",
                            background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAFB",
                            borderBottom: "1px solid #F3F4F6",
                          }}
                        >
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodySm" fontWeight="medium">
                              {c.shop}
                            </Text>
                            {c.installed ? (
                              <Badge tone="success">Connected</Badge>
                            ) : (
                              <Badge tone="warning">App removed</Badge>
                            )}
                          </InlineStack>
                          <Button
                            variant="plain"
                            tone="critical"
                            onClick={() => disconnect(c.connectionId)}
                          >
                            Disconnect
                          </Button>
                        </div>
                      ))}
                    </div>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {installedTargets.length === 0 ? (
              <Banner tone="warning" title="No connected stores yet">
                <Text as="p" variant="bodySm">
                  Connect a store above to use it as a copy target. Both stores must have
                  MetaVault installed.
                </Text>
              </Banner>
            ) : (
              <div style={{ background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: "20px 24px" }}>
                <BlockStack gap="400">
                  <InlineStack gap="300" blockAlign="end">
                    <div style={{ minWidth: "260px" }}>
                      <Select
                        label="Metaobject definition"
                        options={definitions.map((d) => ({
                          label: `${d.name} (${d.entryCount} entries)`,
                          value: d.type,
                        }))}
                        value={type}
                        onChange={setType}
                      />
                    </div>
                    <div style={{ minWidth: "260px" }}>
                      <Select
                        label="Target store"
                        options={installedTargets.map((t) => ({ label: t, value: t }))}
                        value={targetShop}
                        onChange={setTargetShop}
                      />
                    </div>
                    <Button onClick={runPreview} loading={previewing} disabled={!type || !targetShop}>
                      Preview
                    </Button>
                  </InlineStack>

                  {preview && (
                    <BlockStack gap="300">
                      {!preview.targetHasDefinition ? (
                        <Banner tone="critical" title="Target store is missing this definition">
                          <Text as="p" variant="bodySm">
                            Create the <b>{type}</b> metaobject definition on {targetShop} first
                            (Settings → Custom data), then preview again.
                          </Text>
                        </Banner>
                      ) : (
                        <>
                          <InlineStack gap="200">
                            <Badge tone="success">{`${preview.willCreate} to create`}</Badge>
                            <Badge tone="info">{`${preview.willUpdate} to overwrite`}</Badge>
                            <Badge>{`${preview.sourceCount} total`}</Badge>
                          </InlineStack>
                          <InlineStack align="end">
                            <Button
                              variant="primary"
                              disabled={preview.sourceCount === 0}
                              loading={copying}
                              onClick={() => setConfirmOpen(true)}
                            >
                              {`Copy ${preview.sourceCount} to ${targetShop}`}
                            </Button>
                          </InlineStack>
                        </>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </div>
            )}
          </BlockStack>
        )}
      </BlockStack>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Copy to ${targetShop}?`}
        primaryAction={{
          content: "Copy entries",
          destructive: true,
          loading: copying,
          onAction: runCopy,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              This writes{" "}
              <Text as="span" fontWeight="semibold">
                {preview?.sourceCount ?? 0} {type} entries
              </Text>{" "}
              into{" "}
              <Text as="span" fontWeight="semibold">
                {targetShop}
              </Text>
              .
            </Text>
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 14px" }}>
              <Text as="p" variant="bodySm" tone="critical">
                {preview?.willUpdate ?? 0} existing entries on the target store share a
                handle and will be <b>overwritten</b>. This modifies a different store and
                cannot be undone — back up the target first if you&apos;re unsure.
              </Text>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        highlight="agency"
        reason="Cross-store copy is available on the Agency plan."
      />
    </Page>
  );
}

import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Text, BlockStack, InlineStack, Button, Badge } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listMetafieldDefinitions } from "../lib/metafields.server";
import { listDefinitions } from "../lib/metaobjects.server";
import { OWNER_CONFIG, OWNER_TYPES, type OwnerType } from "../lib/metafields";
import { generateSnippet, snippetHint, type SnippetTarget } from "../lib/liquid";
import { getPlan } from "../lib/plan.server";
import { canBackup } from "../lib/plans";
import UpgradeModal from "../components/UpgradeModal";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getPlan(session.shop);
  const allowed = canBackup(plan);

  if (!allowed) {
    return { allowed, metafieldDefs: [], metaobjectDefs: [] };
  }

  const metafieldDefs: Array<{
    ownerType: OwnerType;
    namespace: string;
    key: string;
    name: string;
    type: string;
  }> = [];

  // metafieldDefinitions doesn't return the value type in our helper, so we
  // pair each definition with a sensible default; the generator keys off type.
  for (const ownerType of OWNER_TYPES as OwnerType[]) {
    const defs = await listMetafieldDefinitions(admin, ownerType);
    for (const d of defs) {
      metafieldDefs.push({
        ownerType,
        namespace: d.namespace,
        key: d.key,
        name: d.name,
        type: "single_line_text_field",
      });
    }
  }

  const defs = await listDefinitions(admin);
  const metaobjectDefs = defs.map((d) => ({
    type: d.type,
    name: d.name,
    fields: d.fieldDefinitions.map((f) => ({ key: f.key, name: f.name, type: f.type })),
  }));

  return { allowed, metafieldDefs, metaobjectDefs };
};

function LockedPanel({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 24px", gap: "16px", background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ width: "72px", height: "72px", borderRadius: "18px", background: "linear-gradient(135deg, #8B5CF6, #6366F1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          Liquid snippets are an Agency feature
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Generate ready-to-paste Liquid for any metafield or metaobject definition.
        </Text>
      </BlockStack>
      <Button variant="primary" onClick={onUpgrade}>
        See plans
      </Button>
    </div>
  );
}

function EmptyDefs() {
  return (
    <div style={{ padding: "64px 24px", textAlign: "center" }}>
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" style={{ margin: "0 auto" }}>
        <rect width="120" height="120" rx="60" fill="#F3F4F6" />
        <path d="M46 46l-12 14 12 14M74 46l12 14-12 14M66 38l-12 44" stroke="#C7D2FE" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ marginTop: "16px" }}>
        <BlockStack gap="100" inlineAlign="center">
          <Text as="p" variant="headingMd" alignment="center">
            No definitions found
          </Text>
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            Create a metafield or metaobject definition in Shopify admin → Settings → Custom data.
          </Text>
        </BlockStack>
      </div>
    </div>
  );
}

export default function SnippetsPage() {
  const { allowed, metafieldDefs, metaobjectDefs } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [selected, setSelected] = useState<SnippetTarget | null>(null);

  const snippet = useMemo(() => (selected ? generateSnippet(selected) : ""), [selected]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      shopify.toast.show("Snippet copied to clipboard");
    } catch {
      shopify.toast.show("Couldn't copy — select the text and copy manually", { isError: true });
    }
  };

  const hasAny = metafieldDefs.length > 0 || metaobjectDefs.length > 0;

  return (
    <Page fullWidth>
      <style>{`.mv-def:hover { background: #F1F1FF; }`}</style>

      <BlockStack gap="500">
        <div style={{ paddingTop: "8px" }}>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h1" variant="headingXl" fontWeight="bold">
                Liquid snippets
              </Text>
              <Badge tone="magic">Agency</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Pick a definition and copy ready-to-paste Liquid for your theme.
            </Text>
          </BlockStack>
        </div>

        {!allowed ? (
          <LockedPanel onUpgrade={() => setUpgradeOpen(true)} />
        ) : !hasAny ? (
          <div style={{ background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <EmptyDefs />
          </div>
        ) : (
          <div style={{ display: "flex", background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden", minHeight: "540px" }}>
            {/* Definition picker */}
            <aside style={{ width: "300px", minWidth: "300px", borderRight: "1px solid #ECECF1", background: "#FBFBFD", overflowY: "auto" }}>
              {metafieldDefs.length > 0 && (
                <>
                  <div style={{ padding: "14px 18px 8px" }}>
                    <Text as="h2" variant="headingSm" fontWeight="semibold">
                      Metafields
                    </Text>
                  </div>
                  {metafieldDefs.map((d) => {
                    const active =
                      selected?.kind === "metafield" &&
                      selected.namespace === d.namespace &&
                      selected.key === d.key &&
                      selected.ownerType === d.ownerType;
                    return (
                      <button
                        key={`${d.ownerType}-${d.namespace}-${d.key}`}
                        type="button"
                        className="mv-def"
                        onClick={() => setSelected({ kind: "metafield", ...d })}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          borderLeft: active ? "3px solid #6366F1" : "3px solid transparent",
                          background: active ? "#EEF0FF" : "transparent",
                          padding: "8px 15px",
                          cursor: "pointer",
                        }}
                      >
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" fontWeight={active ? "semibold" : "regular"}>
                            {d.name}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {OWNER_CONFIG[d.ownerType].label} · {d.namespace}.{d.key}
                          </Text>
                        </BlockStack>
                      </button>
                    );
                  })}
                </>
              )}

              {metaobjectDefs.length > 0 && (
                <>
                  <div style={{ padding: "16px 18px 8px" }}>
                    <Text as="h2" variant="headingSm" fontWeight="semibold">
                      Metaobjects
                    </Text>
                  </div>
                  {metaobjectDefs.map((d) => {
                    const active = selected?.kind === "metaobject" && selected.type === d.type;
                    return (
                      <button
                        key={d.type}
                        type="button"
                        className="mv-def"
                        onClick={() => setSelected({ kind: "metaobject", ...d })}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          borderLeft: active ? "3px solid #6366F1" : "3px solid transparent",
                          background: active ? "#EEF0FF" : "transparent",
                          padding: "8px 15px",
                          cursor: "pointer",
                        }}
                      >
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" fontWeight={active ? "semibold" : "regular"}>
                            {d.name}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {d.fields.length} fields · {d.type}
                          </Text>
                        </BlockStack>
                      </button>
                    );
                  })}
                </>
              )}
            </aside>

            {/* Snippet output */}
            <section style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
              {!selected ? (
                <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: "48px" }}>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text as="p" variant="headingMd" alignment="center">
                      Select a definition
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                      Choose a metafield or metaobject on the left to generate its Liquid.
                    </Text>
                  </BlockStack>
                </div>
              ) : (
                <>
                  <div style={{ padding: "16px 24px", borderBottom: "1px solid #ECECF1" }}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingMd" fontWeight="semibold">
                          {selected.name}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {snippetHint(selected)}
                        </Text>
                      </BlockStack>
                      <Button variant="primary" onClick={copy}>
                        Copy snippet
                      </Button>
                    </InlineStack>
                  </div>

                  <div style={{ flex: 1, padding: "20px 24px", overflow: "auto" }}>
                    <pre
                      style={{
                        margin: 0,
                        background: "#0A0F1E",
                        color: "#E5E7EB",
                        borderRadius: "10px",
                        padding: "18px 20px",
                        fontSize: "13px",
                        lineHeight: 1.6,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        overflowX: "auto",
                      }}
                    >
                      <code>{snippet}</code>
                    </pre>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </BlockStack>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        highlight="agency"
        reason="The Liquid snippet generator is available on the Agency plan."
      />
    </Page>
  );
}

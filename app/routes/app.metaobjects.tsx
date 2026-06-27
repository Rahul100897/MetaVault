import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Text, BlockStack, InlineStack, Badge, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { listDefinitions, listEntries } from "../lib/metaobjects.server";
import type {
  MetaobjectDefinitionSummary,
  MetaobjectEntry,
  MetaobjectPage,
} from "../lib/metaobjects";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const definitions = await listDefinitions(admin);
  const requested = url.searchParams.get("type");
  const selectedType =
    requested && definitions.some((d) => d.type === requested)
      ? requested
      : definitions[0]?.type ?? null;

  let entries: MetaobjectPage | null = null;
  if (selectedType) {
    entries = await listEntries(admin, { type: selectedType, first: 50 });
  }

  return { definitions, selectedType, entries };
};

// ---------------------------------------------------------------------------

function DefinitionsEmpty() {
  return (
    <div style={{ padding: "32px 20px", textAlign: "center" }}>
      <svg width="96" height="96" viewBox="0 0 96 96" fill="none" style={{ margin: "0 auto" }}>
        <rect width="96" height="96" rx="20" fill="#F3F4F6" />
        <rect x="26" y="30" width="44" height="10" rx="3" fill="#E5E7EB" />
        <rect x="26" y="46" width="44" height="10" rx="3" fill="#E5E7EB" />
        <rect x="26" y="62" width="28" height="10" rx="3" fill="#E5E7EB" />
      </svg>
      <div style={{ marginTop: "16px" }}>
        <BlockStack gap="100" inlineAlign="center">
          <Text as="p" variant="headingSm" alignment="center">
            No metaobject definitions found
          </Text>
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            Create one in Shopify admin under Settings → Custom data → Metaobjects,
            then refresh.
          </Text>
        </BlockStack>
      </div>
    </div>
  );
}

function RightPanelEmpty() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        gap: "16px",
        height: "100%",
      }}
    >
      <svg width="140" height="140" viewBox="0 0 140 140" fill="none">
        <rect width="140" height="140" rx="70" fill="#F3F4F6" />
        <rect x="40" y="46" width="60" height="48" rx="6" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
        <line x1="40" y1="62" x2="100" y2="62" stroke="#E5E7EB" strokeWidth="2" />
        <line x1="70" y1="46" x2="70" y2="94" stroke="#E5E7EB" strokeWidth="2" />
        <circle cx="100" cy="94" r="18" fill="#6366F1" opacity="0.15" />
        <path d="M94 94l4 4 8-8" stroke="#6366F1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          Select a definition
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          Choose a metaobject type on the left to view and edit its entries.
        </Text>
      </BlockStack>
    </div>
  );
}

function EntriesSkeleton() {
  return (
    <div style={{ padding: "8px 0" }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: "16px",
            padding: "14px 20px",
            borderBottom: "1px solid #F3F4F6",
            background: i % 2 === 0 ? "#FFFFFF" : "#F8F9FF",
          }}
        >
          {[120, 160, 80, 60].map((w, j) => (
            <div
              key={j}
              style={{
                height: "14px",
                width: w,
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

// ---------------------------------------------------------------------------

export default function MetaobjectsPage() {
  const { definitions, selectedType, entries } = useLoaderData<typeof loader>();
  const entriesFetcher = useFetcher<typeof loader>();

  const [activeType, setActiveType] = useState<string | null>(selectedType);
  const [rows, setRows] = useState<MetaobjectEntry[]>(entries?.entries ?? []);

  // When the entries fetcher returns, swap the right panel.
  useEffect(() => {
    if (entriesFetcher.state === "idle" && entriesFetcher.data) {
      setActiveType(entriesFetcher.data.selectedType);
      setRows(entriesFetcher.data.entries?.entries ?? []);
    }
  }, [entriesFetcher.state, entriesFetcher.data]);

  const definition: MetaobjectDefinitionSummary | undefined = definitions.find(
    (d) => d.type === activeType,
  );
  const isLoadingEntries = entriesFetcher.state !== "idle";

  const selectDefinition = (type: string) => {
    if (type === activeType) return;
    setActiveType(type);
    setRows([]);
    entriesFetcher.load(`/app/metaobjects?type=${encodeURIComponent(type)}`);
  };

  return (
    <Page fullWidth>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .mo-def:hover { background: #F1F1FF; }
        .mo-row:hover { background: #EEF2FF !important; }
      `}</style>

      <BlockStack gap="500">
        <div style={{ paddingTop: "8px" }}>
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl" fontWeight="bold">
              Metaobjects
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Browse, edit, import, and export your metaobject entries.
            </Text>
          </BlockStack>
        </div>

        <div
          style={{
            display: "flex",
            gap: "0",
            background: "#FFFFFF",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
            overflow: "hidden",
            minHeight: "560px",
          }}
        >
          {/* Left panel — definitions */}
          <aside
            style={{
              width: "280px",
              minWidth: "280px",
              borderRight: "1px solid #ECECF1",
              background: "#FBFBFD",
              overflowY: "auto",
            }}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #ECECF1" }}>
              <Text as="h2" variant="headingSm" fontWeight="semibold">
                Definitions
              </Text>
            </div>

            {definitions.length === 0 ? (
              <DefinitionsEmpty />
            ) : (
              <div style={{ padding: "8px" }}>
                {definitions.map((d) => {
                  const active = d.type === activeType;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      className="mo-def"
                      onClick={() => selectDefinition(d.type)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        border: "none",
                        borderLeft: active ? "3px solid #6366F1" : "3px solid transparent",
                        background: active ? "#EEF0FF" : "transparent",
                        borderRadius: "8px",
                        padding: "10px 12px",
                        marginBottom: "2px",
                        cursor: "pointer",
                      }}
                    >
                      <BlockStack gap="100">
                        <Text
                          as="span"
                          variant="bodyMd"
                          fontWeight={active ? "semibold" : "medium"}
                        >
                          {d.name}
                        </Text>
                        <InlineStack gap="150" blockAlign="center">
                          <Badge tone="info">{`${d.fieldDefinitions.length} fields`}</Badge>
                          <Badge>{`${d.entryCount} entries`}</Badge>
                        </InlineStack>
                      </BlockStack>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Right panel — entries */}
          <section style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {!definition ? (
              <RightPanelEmpty />
            ) : (
              <>
                <div style={{ padding: "16px 24px", borderBottom: "1px solid #ECECF1" }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingMd" fontWeight="semibold">
                          {definition.name}
                        </Text>
                        {definition.publishable && <Badge tone="success">Publishable</Badge>}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        type: {definition.type} · {definition.entryCount} entries
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </div>

                {isLoadingEntries ? (
                  <EntriesSkeleton />
                ) : (
                  <EntriesTable definition={definition} rows={rows} />
                )}
              </>
            )}
          </section>
        </div>
      </BlockStack>
    </Page>
  );
}

// Placeholder table (expanded with typed columns + actions in Task 2).
function EntriesTable({
  definition,
  rows,
}: {
  definition: MetaobjectDefinitionSummary;
  rows: MetaobjectEntry[];
}) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: "64px 24px", textAlign: "center" }}>
        <Text as="p" variant="bodyMd" tone="subdued">
          No entries for {definition.name} yet.
        </Text>
      </div>
    );
  }
  return (
    <div>
      {rows.map((row, idx) => (
        <div
          key={row.id}
          className="mo-row"
          style={{
            display: "flex",
            gap: "16px",
            padding: "12px 24px",
            background: idx % 2 === 0 ? "#FFFFFF" : "#F8F9FF",
            borderBottom: "1px solid #F3F4F6",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "12px",
              background: "#F1F1F4",
              color: "#4B5563",
              padding: "2px 8px",
              borderRadius: "6px",
            }}
          >
            {row.handle}
          </span>
          <Text as="span" variant="bodySm">
            {row.displayName}
          </Text>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Text, BlockStack, InlineStack, Badge, Button, Modal } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  listDefinitions,
  listEntries,
  getEntryById,
  createEntry,
  updateEntry,
  deleteEntry,
  type FieldInput,
} from "../lib/metaobjects.server";
import { chunk } from "../lib/metafields";
import MetaobjectDrawer, { type DrawerMode } from "../components/MetaobjectDrawer";
import {
  inputKindForType,
  truncate,
  type MetaobjectDefinitionSummary,
  type MetaobjectEntry,
  type MetaobjectFieldValue,
  type MetaobjectPage,
  type MoFieldDef,
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

type ActionData =
  | { ok: true; intent: "create" | "update"; entry: MetaobjectEntry }
  | { ok: true; intent: "delete"; deletedIds: string[]; failed: number }
  | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  function parseFields(): FieldInput[] {
    try {
      const arr = JSON.parse(String(form.get("fields") ?? "[]")) as FieldInput[];
      return arr.filter((f) => f && typeof f.key === "string");
    } catch {
      return [];
    }
  }

  const statusRaw = String(form.get("status") ?? "");
  const status = statusRaw === "ACTIVE" || statusRaw === "DRAFT" ? statusRaw : undefined;

  if (intent === "create") {
    const type = String(form.get("type") ?? "");
    const handle = String(form.get("handle") ?? "").trim() || undefined;
    const result = await createEntry(admin, { type, handle, fields: parseFields(), status });
    if (result.userErrors.length || !result.entry) {
      return { ok: false, intent, error: result.userErrors[0]?.message ?? "Create failed" };
    }
    const entry = await getEntryById(admin, result.entry.id);
    if (!entry) return { ok: false, intent, error: "Created but could not reload entry" };
    await prisma.activityLog.create({
      data: { shopId: session.shop, action: "metaobject_created", resourceType: type, rowCount: 1 },
    });
    return { ok: true, intent: "create", entry };
  }

  if (intent === "update") {
    const id = String(form.get("id") ?? "");
    const type = String(form.get("type") ?? "");
    const handle = String(form.get("handle") ?? "").trim();
    const result = await updateEntry(admin, { id, handle, fields: parseFields(), status });
    if (result.userErrors.length || !result.entry) {
      return { ok: false, intent, error: result.userErrors[0]?.message ?? "Update failed" };
    }
    const entry = await getEntryById(admin, id);
    if (!entry) return { ok: false, intent, error: "Updated but could not reload entry" };
    await prisma.activityLog.create({
      data: { shopId: session.shop, action: "metaobject_updated", resourceType: type, rowCount: 1 },
    });
    return { ok: true, intent: "update", entry };
  }

  if (intent === "delete") {
    const type = String(form.get("type") ?? "");
    let ids: string[] = [];
    try {
      ids = JSON.parse(String(form.get("ids") ?? "[]"));
    } catch {
      ids = [];
    }
    if (!ids.length) return { ok: false, intent, error: "Nothing to delete" };

    const deletedIds: string[] = [];
    let failed = 0;
    for (const batch of chunk(ids, 25)) {
      const results = await Promise.all(
        batch.map((id) =>
          deleteEntry(admin, id)
            .then((r) => ({ id, ok: !!r.deletedId && r.userErrors.length === 0 }))
            .catch(() => ({ id, ok: false })),
        ),
      );
      for (const r of results) {
        if (r.ok) deletedIds.push(r.id);
        else failed++;
      }
    }
    if (deletedIds.length) {
      await prisma.activityLog.create({
        data: {
          shopId: session.shop,
          action: "metaobject_deleted",
          resourceType: type,
          rowCount: deletedIds.length,
        },
      });
    }
    return { ok: true, intent: "delete", deletedIds, failed };
  }

  return { ok: false, intent, error: `Unknown action: ${intent}` };
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
  const deleteFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [activeType, setActiveType] = useState<string | null>(selectedType);
  const [rows, setRows] = useState<MetaobjectEntry[]>(entries?.entries ?? []);

  // Editor drawer (edit / create / duplicate)
  const [drawer, setDrawer] = useState<{ open: boolean; mode: DrawerMode; entry: MetaobjectEntry | null }>(
    { open: false, mode: "edit", entry: null },
  );

  // Selection + delete
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MetaobjectEntry | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState<"ACTIVE" | "DRAFT" | null>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const isDeleting = deleteFetcher.state !== "idle";

  const onEdit = (row: MetaobjectEntry) => setDrawer({ open: true, mode: "edit", entry: row });
  const onAdd = () => setDrawer({ open: true, mode: "create", entry: null });
  const onDuplicate = (row: MetaobjectEntry) =>
    setDrawer({ open: true, mode: "duplicate", entry: row });
  const onDelete = (row: MetaobjectEntry) => setDeleteTarget(row);

  const onSaved = (entry: MetaobjectEntry, mode: DrawerMode) => {
    setRows((prev) =>
      mode === "edit" ? prev.map((r) => (r.id === entry.id ? entry : r)) : [entry, ...prev],
    );
    setDrawer((d) => ({ ...d, open: false }));
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allSelected = rows.length > 0 && rows.every((r) => selectedSet.has(r.id));
  const someSelected = selected.length > 0;
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((r) => r.id));
  const selectedEntries = useMemo(() => rows.filter((r) => selectedSet.has(r.id)), [rows, selectedSet]);

  const submitDelete = (ids: string[]) =>
    deleteFetcher.submit(
      { intent: "delete", type: activeType ?? "", ids: JSON.stringify(ids) },
      { method: "post" },
    );

  // React to delete results.
  useEffect(() => {
    if (deleteFetcher.state !== "idle" || !deleteFetcher.data) return;
    const d = deleteFetcher.data;
    if (d.ok && d.intent === "delete") {
      const removed = new Set(d.deletedIds);
      setRows((prev) => prev.filter((r) => !removed.has(r.id)));
      setSelected((prev) => prev.filter((id) => !removed.has(id)));
      setDeleteTarget(null);
      setBulkDeleteOpen(false);
      if (d.failed) {
        shopify.toast.show(`Deleted ${d.deletedIds.length}, ${d.failed} failed`, { isError: true });
      } else {
        shopify.toast.show(
          `Deleted ${d.deletedIds.length} ${d.deletedIds.length === 1 ? "entry" : "entries"}`,
        );
      }
    } else if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state, deleteFetcher.data]);

  // When the entries fetcher returns, swap the right panel.
  useEffect(() => {
    if (entriesFetcher.state === "idle" && entriesFetcher.data) {
      setActiveType(entriesFetcher.data.selectedType);
      setRows(entriesFetcher.data.entries?.entries ?? []);
      setSelected([]);
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
    setSelected([]);
    entriesFetcher.load(`/app/metaobjects?type=${encodeURIComponent(type)}`);
  };

  return (
    <Page fullWidth>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .mo-def:hover { background: #F1F1FF; }
        .mo-row:hover { background: #EEF2FF !important; }
        .mo-check { width: 16px; height: 16px; cursor: pointer; accent-color: #6366F1; }
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
                    <InlineStack gap="200">
                      <Button variant="primary" onClick={onAdd}>
                        Add entry
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </div>

                {someSelected && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 24px",
                      background: "linear-gradient(135deg, #0A0F1E, #1E1B4B)",
                    }}
                  >
                    <InlineStack gap="300" blockAlign="center">
                      <span
                        style={{
                          background: "#6366F1",
                          color: "#FFFFFF",
                          borderRadius: "20px",
                          padding: "2px 10px",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        {selected.length} selected
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelected([])}
                        style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", fontSize: "13px", cursor: "pointer" }}
                      >
                        Clear
                      </button>
                    </InlineStack>
                    <InlineStack gap="200">
                      {definition.publishable && (
                        <>
                          <Button onClick={() => setPublishConfirm("ACTIVE")}>Publish</Button>
                          <Button onClick={() => setPublishConfirm("DRAFT")}>Unpublish</Button>
                        </>
                      )}
                      <Button variant="primary" tone="critical" loading={isDeleting} onClick={() => setBulkDeleteOpen(true)}>
                        Delete selected
                      </Button>
                    </InlineStack>
                  </div>
                )}

                {isLoadingEntries ? (
                  <EntriesSkeleton />
                ) : (
                  <EntriesTable
                    definition={definition}
                    rows={rows}
                    selectedSet={selectedSet}
                    allSelected={allSelected}
                    onToggleRow={toggleRow}
                    onToggleAll={toggleAll}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                  />
                )}
              </>
            )}
          </section>
        </div>
      </BlockStack>

      {definition && (
        <MetaobjectDrawer
          open={drawer.open}
          mode={drawer.mode}
          definition={definition}
          entry={drawer.entry}
          onClose={() => setDrawer((d) => ({ ...d, open: false }))}
          onSaved={onSaved}
        />
      )}

      {/* Single delete confirmation */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete this entry?"
        primaryAction={{
          content: "Delete entry",
          destructive: true,
          loading: isDeleting,
          onAction: () => {
            if (deleteTarget) submitDelete([deleteTarget.id]);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteTarget(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              You're about to permanently delete{" "}
              <Text as="span" fontWeight="semibold">
                {deleteTarget?.handle}
              </Text>
              .
            </Text>
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 14px" }}>
              <Text as="p" variant="bodySm" tone="critical">
                This cannot be undone. The metaobject entry will be removed from Shopify.
              </Text>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Bulk delete confirmation */}
      <Modal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selected.length} ${selected.length === 1 ? "entry" : "entries"}?`}
        primaryAction={{
          content: `Delete ${selected.length}`,
          destructive: true,
          loading: isDeleting,
          onAction: () => submitDelete(selectedEntries.map((e) => e.id)),
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setBulkDeleteOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              You're about to permanently delete{" "}
              <Text as="span" fontWeight="semibold">
                {selected.length} selected {selected.length === 1 ? "entry" : "entries"}
              </Text>
              .
            </Text>
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", padding: "12px 14px" }}>
              <Text as="p" variant="bodySm" tone="critical">
                This cannot be undone. Deletions run in batches of 25.
              </Text>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

const HANDLE_PILL: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "12px",
  background: "#F1F1F4",
  color: "#4B5563",
  padding: "2px 8px",
  borderRadius: "6px",
  whiteSpace: "nowrap",
};

function FieldCell({ field, def }: { field: MetaobjectFieldValue | undefined; def: MoFieldDef }) {
  const kind = inputKindForType(def.type);
  const value = field?.value ?? "";

  if (!field || value === "") {
    return (
      <Text as="span" variant="bodySm" tone="disabled">
        —
      </Text>
    );
  }

  switch (kind) {
    case "number":
      return (
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "13px",
            display: "block",
            textAlign: "right",
          }}
        >
          {value}
        </span>
      );
    case "boolean":
      return value === "true" ? (
        <Badge tone="success">Yes</Badge>
      ) : (
        <Badge>No</Badge>
      );
    case "date":
    case "datetime":
      return (
        <Text as="span" variant="bodySm">
          {formatDateValue(value, kind)}
        </Text>
      );
    case "url":
      return (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "#6366F1" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: "13px" }}>{truncate(value, 28)}</span>
        </a>
      );
    case "file":
      return (
        <InlineStack gap="150" blockAlign="center">
          {field.thumbnailUrl ? (
            <img
              src={field.thumbnailUrl}
              alt={field.fileName ?? ""}
              style={{ width: "24px", height: "24px", borderRadius: "4px", objectFit: "cover" }}
            />
          ) : (
            <span style={{ ...HANDLE_PILL, padding: "2px 6px" }}>file</span>
          )}
          <Text as="span" variant="bodySm" tone="subdued">
            {truncate(field.fileName ?? field.fileUrl ?? "file", 24)}
          </Text>
        </InlineStack>
      );
    case "metaobject":
      return (
        <Text as="span" variant="bodySm">
          {field.refDisplay ?? truncate(value, 40)}
        </Text>
      );
    default:
      return (
        <Text as="span" variant="bodySm" tone="subdued">
          {truncate(value, 40)}
        </Text>
      );
  }
}

function formatDateValue(value: string, kind: "date" | "datetime"): string {
  try {
    const d = parseISO(value);
    return format(d, kind === "datetime" ? "MMM d, yyyy HH:mm" : "MMM d, yyyy");
  } catch {
    return value;
  }
}

function RowActionButton({
  label,
  color,
  onClick,
  children,
}: {
  label: string;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: "28px",
        height: "28px",
        borderRadius: "6px",
        border: "none",
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color,
      }}
    >
      {children}
    </button>
  );
}

function EntriesTable({
  definition,
  rows,
  selectedSet,
  allSelected,
  onToggleRow,
  onToggleAll,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  definition: MetaobjectDefinitionSummary;
  rows: MetaobjectEntry[];
  selectedSet: Set<string>;
  allSelected: boolean;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (row: MetaobjectEntry) => void;
  onDuplicate: (row: MetaobjectEntry) => void;
  onDelete: (row: MetaobjectEntry) => void;
}) {
  const fields = definition.fieldDefinitions;
  const showStatus = definition.publishable;

  // grid: checkbox | handle | each field | [status] | actions
  const gridColumns = [
    "36px",
    "minmax(140px, 180px)",
    ...fields.map(() => "minmax(130px, 1fr)"),
    ...(showStatus ? ["110px"] : []),
    "118px",
  ].join(" ");

  if (rows.length === 0) {
    return (
      <div style={{ padding: "64px 24px", textAlign: "center" }}>
        <BlockStack gap="100" inlineAlign="center">
          <Text as="p" variant="headingSm">
            No entries yet
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {definition.name} has no entries. Add one to get started.
          </Text>
        </BlockStack>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: "fit-content" }}>
        {/* Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridColumns,
            gap: "16px",
            padding: "12px 24px",
            background: "#0A0F1E",
            position: "sticky",
            top: 0,
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <input
              type="checkbox"
              aria-label="Select all entries"
              className="mo-check"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allSelected && rows.some((r) => selectedSet.has(r.id));
              }}
              onChange={onToggleAll}
            />
          </div>
          <Text as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
            Handle
          </Text>
          {fields.map((f) => (
            <Text key={f.key} as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
              {f.name}
            </Text>
          ))}
          {showStatus && (
            <Text as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
              Status
            </Text>
          )}
          <Text as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
            Actions
          </Text>
        </div>

        {/* Rows */}
        {rows.map((row, idx) => (
          <div
            key={row.id}
            className="mo-row"
            style={{
              display: "grid",
              gridTemplateColumns: gridColumns,
              gap: "16px",
              padding: "12px 24px",
              background: selectedSet.has(row.id) ? "#EEF0FF" : idx % 2 === 0 ? "#FFFFFF" : "#F8F9FF",
              borderBottom: "1px solid #F3F4F6",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <input
                type="checkbox"
                aria-label={`Select ${row.handle}`}
                className="mo-check"
                checked={selectedSet.has(row.id)}
                onChange={() => onToggleRow(row.id)}
              />
            </div>
            <span style={HANDLE_PILL}>{row.handle}</span>
            {fields.map((f) => (
              <FieldCell key={f.key} field={row.fields[f.key]} def={f} />
            ))}
            {showStatus && (
              <div>
                {row.status === "ACTIVE" ? (
                  <Badge tone="success">Active</Badge>
                ) : (
                  <Badge>Draft</Badge>
                )}
              </div>
            )}
            <InlineStack gap="050">
              <RowActionButton label="Edit" color="#6366F1" onClick={() => onEdit(row)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </RowActionButton>
              <RowActionButton label="Duplicate" color="#6B7280" onClick={() => onDuplicate(row)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </RowActionButton>
              <RowActionButton label="Delete" color="#9CA3AF" onClick={() => onDelete(row)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </RowActionButton>
            </InlineStack>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { Page, Button, Text, BlockStack, InlineStack, Badge, Modal } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  listMetafields,
  setMetafields,
  deleteMetafields,
  chunk,
  OWNER_CONFIG,
  OWNER_TYPES,
  isOwnerType,
  type MetafieldRow,
  type OwnerType,
} from "../lib/metafields.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const ownerParam = url.searchParams.get("owner") ?? "PRODUCT";
  const ownerType: OwnerType = isOwnerType(ownerParam) ? ownerParam : "PRODUCT";
  const after = url.searchParams.get("after");

  const page = await listMetafields(admin, { ownerType, first: 25, after });

  return { ownerType, page };
};

type DeleteItem = { id: string; ownerId: string; namespace: string; key: string };

type ActionData =
  | { ok: true; intent: "set"; id: string; value: string }
  | { ok: true; intent: "delete"; deletedIds: string[]; partialError: string | null }
  | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "set") {
    const ownerType = String(formData.get("ownerType") ?? "");
    const input = {
      ownerId: String(formData.get("ownerId") ?? ""),
      namespace: String(formData.get("namespace") ?? ""),
      key: String(formData.get("key") ?? ""),
      type: String(formData.get("type") ?? ""),
      value: String(formData.get("value") ?? ""),
    };

    try {
      const result = await setMetafields(admin, [input]);
      if (result.userErrors.length) {
        return { ok: false, intent, error: result.userErrors[0].message };
      }
      const saved = result.metafields[0];
      await prisma.activityLog.create({
        data: {
          shopId: session.shop,
          action: "edit",
          resourceType: ownerType.toLowerCase() || "metafield",
          rowCount: 1,
        },
      });
      return { ok: true, intent: "set", id: saved.id, value: saved.value };
    } catch (err) {
      return { ok: false, intent, error: err instanceof Error ? err.message : "Save failed" };
    }
  }

  if (intent === "delete") {
    const ownerType = String(formData.get("ownerType") ?? "");
    let items: DeleteItem[] = [];
    try {
      items = JSON.parse(String(formData.get("items") ?? "[]"));
    } catch {
      items = [];
    }
    if (!items.length) {
      return { ok: false, intent, error: "Nothing to delete" };
    }

    const deletedIds: string[] = [];
    let partialError: string | null = null;
    try {
      for (const batch of chunk(items, 25)) {
        const result = await deleteMetafields(
          admin,
          batch.map(({ ownerId, namespace, key }) => ({ ownerId, namespace, key })),
        );
        if (result.userErrors.length && !partialError) {
          partialError = result.userErrors[0].message;
        }
        for (const d of result.deletedMetafields) {
          const match = batch.find(
            (b) => b.ownerId === d.ownerId && b.namespace === d.namespace && b.key === d.key,
          );
          if (match) deletedIds.push(match.id);
        }
      }
    } catch (err) {
      return { ok: false, intent, error: err instanceof Error ? err.message : "Delete failed" };
    }

    if (deletedIds.length) {
      await prisma.activityLog.create({
        data: {
          shopId: session.shop,
          action: "delete",
          resourceType: ownerType.toLowerCase() || "metafield",
          rowCount: deletedIds.length,
        },
      });
    }
    return { ok: true, intent: "delete", deletedIds, partialError };
  }

  return { ok: false, intent, error: `Unknown action: ${intent}` };
};

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const TYPE_TONE: Record<string, "info" | "success" | "warning" | "attention"> = {
  single_line_text_field: "info",
  multi_line_text_field: "info",
  number_integer: "success",
  number_decimal: "success",
  boolean: "warning",
  json: "attention",
};

function typeTone(type: string) {
  return TYPE_TONE[type] ?? "info";
}

function truncate(value: string, max = 80) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}

function isMultiline(type: string) {
  return type === "multi_line_text_field" || type === "json" || type.startsWith("list.");
}

function iconBtn(bg: string): React.CSSProperties {
  return {
    flexShrink: 0,
    width: "28px",
    height: "28px",
    borderRadius: "6px",
    border: "none",
    background: bg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };
}

const GRID_COLUMNS =
  "36px minmax(150px, 1.3fr) minmax(110px, 1fr) minmax(110px, 1fr) 170px minmax(200px, 2fr) 52px";

function TableSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLUMNS,
            gap: "16px",
            padding: "14px 20px",
            borderBottom: "1px solid #F3F4F6",
            background: i % 2 === 0 ? "#FFFFFF" : "#FAFAFB",
          }}
        >
          {[20, 60, 50, 70, 40, 90, 30].map((w, j) => (
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

function EmptyMetafields({ ownerLabel }: { ownerLabel: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "64px 24px",
        gap: "16px",
      }}
    >
      <svg width="140" height="140" viewBox="0 0 140 140" fill="none">
        <rect width="140" height="140" rx="70" fill="#F3F4F6" />
        <rect x="38" y="44" width="64" height="52" rx="6" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
        <line x1="38" y1="60" x2="102" y2="60" stroke="#E5E7EB" strokeWidth="2" />
        <line x1="70" y1="44" x2="70" y2="96" stroke="#E5E7EB" strokeWidth="2" />
        <line x1="38" y1="78" x2="102" y2="78" stroke="#E5E7EB" strokeWidth="2" />
        <circle cx="100" cy="96" r="20" fill="#6366F1" opacity="0.15" />
        <path d="M93 96l5 5 9-10" stroke="#6366F1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <BlockStack gap="100" inlineAlign="center">
        <Text as="p" variant="headingMd" alignment="center">
          No metafields found
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          None of your {ownerLabel.toLowerCase()} have metafields yet. Add one in
          Shopify admin, or switch to a different resource type above.
        </Text>
      </BlockStack>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MetafieldsPage() {
  const { ownerType, page } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const loadMore = useFetcher<typeof loader>();
  const editFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();

  // Accumulated rows: reset whenever the owner type (i.e. the loader) changes.
  const [rows, setRows] = useState<MetafieldRow[]>(page.rows);
  const [cursor, setCursor] = useState<string | null>(page.endCursor);
  const [hasNext, setHasNext] = useState<boolean>(page.hasNextPage);
  const [search, setSearch] = useState("");

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Previous values for optimistic rollback, keyed by metafield id.
  const rollbackRef = useRef<Record<string, string>>({});

  // Single-row delete target (Task 3). null = modal closed.
  const [deleteTarget, setDeleteTarget] = useState<MetafieldRow | null>(null);
  // Bulk selection (Task 4): selected metafield ids.
  const [selected, setSelected] = useState<string[]>([]);
  const isDeleting = deleteFetcher.state !== "idle";

  useEffect(() => {
    setRows(page.rows);
    setCursor(page.endCursor);
    setHasNext(page.hasNextPage);
    setEditingId(null);
    setSelected([]);
  }, [page]);

  // React to inline-edit save results.
  useEffect(() => {
    if (editFetcher.state !== "idle" || !editFetcher.data) return;
    const data = editFetcher.data;
    if (data.ok && data.intent === "set") {
      delete rollbackRef.current[data.id];
      setRows((prev) => prev.map((r) => (r.id === data.id ? { ...r, value: data.value } : r)));
      shopify.toast.show("Metafield updated");
    } else if (!data.ok) {
      // Roll back optimistic update.
      const entries = Object.entries(rollbackRef.current);
      if (entries.length) {
        setRows((prev) =>
          prev.map((r) => (r.id in rollbackRef.current ? { ...r, value: rollbackRef.current[r.id] } : r)),
        );
        rollbackRef.current = {};
      }
      shopify.toast.show(data.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFetcher.state, editFetcher.data]);

  // React to delete results.
  useEffect(() => {
    if (deleteFetcher.state !== "idle" || !deleteFetcher.data) return;
    const data = deleteFetcher.data;
    if (data.ok && data.intent === "delete") {
      const removed = new Set(data.deletedIds);
      setRows((prev) => prev.filter((r) => !removed.has(r.id)));
      setSelected((prev) => prev.filter((id) => !removed.has(id)));
      setDeleteTarget(null);
      if (data.partialError) {
        shopify.toast.show(
          `Deleted ${data.deletedIds.length}, some failed: ${data.partialError}`,
          { isError: true },
        );
      } else {
        shopify.toast.show(
          `Deleted ${data.deletedIds.length} metafield${data.deletedIds.length === 1 ? "" : "s"}`,
        );
      }
    } else if (!data.ok) {
      shopify.toast.show(data.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state, deleteFetcher.data]);

  const submitDelete = (items: MetafieldRow[]) => {
    deleteFetcher.submit(
      {
        intent: "delete",
        ownerType,
        items: JSON.stringify(
          items.map((r) => ({
            id: r.id,
            ownerId: r.ownerId,
            namespace: r.namespace,
            key: r.key,
          })),
        ),
      },
      { method: "post" },
    );
  };

  const startEdit = (row: MetafieldRow) => {
    setEditingId(row.id);
    setDraft(row.value);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const saveEdit = (row: MetafieldRow) => {
    if (draft === row.value) {
      cancelEdit();
      return;
    }
    rollbackRef.current[row.id] = row.value;
    // Optimistic update
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, value: draft } : r)));
    editFetcher.submit(
      {
        intent: "set",
        ownerType,
        ownerId: row.ownerId,
        namespace: row.namespace,
        key: row.key,
        type: row.type,
        value: draft,
      },
      { method: "post" },
    );
    cancelEdit();
  };

  // Append loaded rows when the load-more fetcher returns.
  useEffect(() => {
    if (loadMore.data && loadMore.state === "idle") {
      const next = loadMore.data.page;
      setRows((prev) => [...prev, ...next.rows]);
      setCursor(next.endCursor);
      setHasNext(next.hasNextPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMore.data, loadMore.state]);

  const isLoadingMore = loadMore.state !== "idle";

  const handleOwnerChange = (next: OwnerType) => {
    if (next === ownerType) return;
    navigate(`/app/metafields?owner=${next}`);
  };

  const handleLoadMore = () => {
    if (!cursor) return;
    loadMore.load(`/app/metafields?owner=${ownerType}&after=${encodeURIComponent(cursor)}`);
  };

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.namespace.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q) ||
        r.ownerLabel.toLowerCase().includes(q) ||
        r.value.toLowerCase().includes(q),
    );
  }, [rows, search]);

  // --- Bulk selection (Task 4) ---
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedSet.has(r.id));
  const someSelected = selected.length > 0;
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const toggleRow = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      const visible = new Set(filteredRows.map((r) => r.id));
      setSelected((prev) => prev.filter((id) => !visible.has(id)));
    } else {
      setSelected((prev) => Array.from(new Set([...prev, ...filteredRows.map((r) => r.id)])));
    }
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedSet.has(r.id)),
    [rows, selectedSet],
  );

  return (
    <Page>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .mv-row:hover { background: #F1F1FF !important; }
        .mv-owner-tab { transition: all 0.15s ease; cursor: pointer; }
        .mv-pencil { opacity: 0; transition: opacity 0.12s ease; flex-shrink: 0; }
        .mv-value:hover .mv-pencil { opacity: 1; }
        .mv-edit-input { width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #6366F1; font-size: 13px; outline: none; font-family: inherit; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
        .mv-trash:hover { background: #FEE2E2 !important; }
        .mv-trash:hover svg path { stroke: #DC2626; }
        .mv-check { width: 16px; height: 16px; cursor: pointer; accent-color: #6366F1; }
      `}</style>

      <BlockStack gap="500">
        {/* Header */}
        <div style={{ paddingTop: "8px" }}>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h1" variant="headingXl" fontWeight="bold">
                Metafields
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Browse and edit metafields across your store in a spreadsheet view.
              </Text>
            </BlockStack>
            <InlineStack gap="200">
              <Button url="/app/import-export">Import / Export</Button>
            </InlineStack>
          </InlineStack>
        </div>

        {/* Owner-type tabs + search */}
        <InlineStack align="space-between" blockAlign="center" gap="300">
          <div style={{ display: "flex", gap: "4px", background: "#FFFFFF", padding: "4px", borderRadius: "10px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            {OWNER_TYPES.map((t) => {
              const active = t === ownerType;
              return (
                <button
                  key={t}
                  type="button"
                  className="mv-owner-tab"
                  onClick={() => handleOwnerChange(t)}
                  style={{
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: active ? 600 : 500,
                    color: active ? "#FFFFFF" : "#4B5563",
                    background: active ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "transparent",
                  }}
                >
                  {OWNER_CONFIG[t].label}
                </button>
              );
            })}
          </div>

          <div style={{ position: "relative", width: "260px" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter loaded rows…"
              style={{
                width: "100%",
                padding: "8px 12px 8px 34px",
                borderRadius: "8px",
                border: "1px solid #E5E7EB",
                fontSize: "13px",
                outline: "none",
                background: "#FFFFFF",
              }}
            />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ position: "absolute", left: "10px", top: "9px" }}>
              <circle cx="11" cy="11" r="7" stroke="#9CA3AF" strokeWidth="2" />
              <path d="M21 21l-4-4" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </InlineStack>

        {/* Bulk action bar */}
        {someSelected && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 18px",
              background: "linear-gradient(135deg, #0A0F1E, #1E1B4B)",
              borderRadius: "10px",
              boxShadow: "0 4px 12px rgba(10,15,30,0.25)",
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
                style={{
                  background: "transparent",
                  border: "none",
                  color: "rgba(255,255,255,0.6)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Clear selection
              </button>
            </InlineStack>
            <Button
              variant="primary"
              tone="critical"
              loading={isDeleting}
              onClick={() => setBulkConfirmOpen(true)}
            >
              {`Delete ${selected.length} metafield${selected.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        )}

        {/* Spreadsheet */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
            overflow: "hidden",
          }}
        >
          {/* Sticky header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              gap: "16px",
              padding: "12px 20px",
              background: "#0A0F1E",
              position: "sticky",
              top: 0,
              zIndex: 2,
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <input
                type="checkbox"
                aria-label="Select all loaded rows"
                className="mv-check"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={toggleSelectAll}
              />
            </div>
            {["Owner", "Namespace", "Key", "Type", "Value", ""].map((h, i) => (
              <Text key={i} as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
                {h}
              </Text>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyMetafields ownerLabel={OWNER_CONFIG[ownerType].label} />
          ) : (
            <div>
              {filteredRows.map((row, idx) => (
                <div
                  key={row.id}
                  className="mv-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID_COLUMNS,
                    gap: "16px",
                    padding: "12px 20px",
                    background: selectedSet.has(row.id)
                      ? "#EEF0FF"
                      : idx % 2 === 0
                        ? "#FFFFFF"
                        : "#FAFAFB",
                    borderBottom: "1px solid #F3F4F6",
                    alignItems: "center",
                    transition: "background 0.1s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.namespace}.${row.key}`}
                      className="mv-check"
                      checked={selectedSet.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                    />
                  </div>
                  <Text as="span" variant="bodySm" fontWeight="medium">
                    {row.ownerLabel}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {row.namespace}
                  </Text>
                  <Text as="span" variant="bodySm">
                    {row.key}
                  </Text>
                  <div>
                    <Badge tone={typeTone(row.type)}>{row.type}</Badge>
                  </div>
                  {editingId === row.id ? (
                    <div style={{ display: "flex", gap: "6px", alignItems: "flex-start" }}>
                      {isMultiline(row.type) ? (
                        <textarea
                          className="mv-edit-input"
                          autoFocus
                          rows={3}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                      ) : (
                        <input
                          className="mv-edit-input"
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(row);
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                      )}
                      <button
                        type="button"
                        aria-label="Save"
                        onClick={() => saveEdit(row)}
                        style={iconBtn("#10B981")}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel"
                        onClick={cancelEdit}
                        style={iconBtn("#9CA3AF")}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div
                      className="mv-value"
                      onClick={() => startEdit(row)}
                      title="Click to edit"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "8px",
                        cursor: "pointer",
                        minHeight: "20px",
                      }}
                    >
                      <Text as="span" variant="bodySm" tone={row.value ? "subdued" : "disabled"}>
                        {row.value ? truncate(row.value) : "— empty —"}
                      </Text>
                      <svg className="mv-pencil" width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <button
                      type="button"
                      aria-label="Delete metafield"
                      className="mv-trash"
                      onClick={() => setDeleteTarget(row)}
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
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}

              {/* Loading-more skeleton */}
              {isLoadingMore && <TableSkeleton />}

              {/* Footer / pagination */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "14px 20px",
                  background: "#F9FAFB",
                  borderTop: "1px solid #E5E7EB",
                }}
              >
                <Text as="span" variant="bodySm" tone="subdued">
                  {search.trim()
                    ? `${filteredRows.length} of ${rows.length} rows`
                    : `${rows.length} row${rows.length === 1 ? "" : "s"} loaded`}
                </Text>
                {hasNext ? (
                  <Button onClick={handleLoadMore} loading={isLoadingMore} variant="secondary">
                    Load more
                  </Button>
                ) : (
                  <Text as="span" variant="bodySm" tone="subdued">
                    End of results
                  </Text>
                )}
              </div>
            </div>
          )}
        </div>
      </BlockStack>

      {/* Single delete confirmation */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete this metafield?"
        primaryAction={{
          content: "Delete metafield",
          destructive: true,
          loading: isDeleting,
          onAction: () => {
            if (deleteTarget) submitDelete([deleteTarget]);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteTarget(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              You're about to permanently delete{" "}
              <Text as="span" fontWeight="semibold">
                {deleteTarget?.namespace}.{deleteTarget?.key}
              </Text>{" "}
              from{" "}
              <Text as="span" fontWeight="semibold">
                {deleteTarget?.ownerLabel}
              </Text>
              .
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
                This action cannot be undone. The metafield value will be removed
                from this resource in Shopify.
              </Text>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Bulk delete confirmation */}
      <Modal
        open={bulkConfirmOpen}
        onClose={() => setBulkConfirmOpen(false)}
        title={`Delete ${selected.length} metafield${selected.length === 1 ? "" : "s"}?`}
        primaryAction={{
          content: `Delete ${selected.length} metafield${selected.length === 1 ? "" : "s"}`,
          destructive: true,
          loading: isDeleting,
          onAction: () => {
            submitDelete(selectedRows);
            setBulkConfirmOpen(false);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setBulkConfirmOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              You're about to permanently delete{" "}
              <Text as="span" fontWeight="semibold">
                {selected.length} metafield{selected.length === 1 ? "" : "s"}
              </Text>{" "}
              across your selected {OWNER_CONFIG[ownerType].label.toLowerCase()}.
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
                This action cannot be undone. Deletions run in batches of 25 and
                are applied directly in Shopify.
              </Text>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

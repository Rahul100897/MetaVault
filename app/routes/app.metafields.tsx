import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Modal,
  Filters,
  ChoiceList,
  TextField,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { exportQueue } from "../lib/queue.server";
import { getPlan, getDailyEditCount } from "../lib/plan.server";
import { isPro, isAgency, canBulkDelete, canBulkEdit, FREE_DAILY_LIMIT } from "../lib/plans";
import UpgradeModal from "../components/UpgradeModal";
import SnippetModal from "../components/SnippetModal";
import type { SnippetTarget } from "../lib/liquid";
import {
  listMetafields,
  listMetafieldDefinitions,
  setMetafields,
  deleteMetafields,
} from "../lib/metafields.server";
import {
  chunk,
  OWNER_CONFIG,
  OWNER_TYPES,
  isOwnerType,
  type MetafieldRow,
  type OwnerType,
} from "../lib/metafields";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const ownerParam = url.searchParams.get("owner") ?? "PRODUCT";
  const ownerType: OwnerType = isOwnerType(ownerParam) ? ownerParam : "PRODUCT";
  const after = url.searchParams.get("after");
  // Namespace and owner search are applied by Shopify (see listMetafields), so
  // they filter the whole catalog rather than the rows already on screen.
  const namespace = url.searchParams.get("namespace") || null;
  const search = url.searchParams.get("q") || null;

  const [page, plan, definitions] = await Promise.all([
    listMetafields(admin, { ownerType, first: 25, after, namespace, search }),
    getPlan(session.shop),
    // Cheap, complete source of namespaces that have a definition. Namespaces
    // left behind by removed apps have none, so the UI unions this with what it
    // has actually loaded.
    listMetafieldDefinitions(admin, ownerType).catch(() => []),
  ]);
  const dailyUsed = isPro(plan) ? 0 : await getDailyEditCount(session.shop);

  const definedNamespaces = Array.from(new Set(definitions.map((d) => d.namespace))).sort();

  return { ownerType, page, plan, dailyUsed, namespace, search, definedNamespaces };
};

type DeleteItem = { id: string; ownerId: string; namespace: string; key: string };

/**
 * A row targeted by bulk edit. `type` travels with each row rather than being
 * shared: a selection can span single_line_text_field, multi_line_text_field,
 * json and so on, and the action batches one type at a time because
 * metafieldsSet rejects an entire call if any single value is invalid.
 */
type BulkSetItem = DeleteItem & { type: string };

type ActionData =
  | { ok: true; intent: "set"; id: string; value: string }
  | { ok: true; intent: "delete"; deletedIds: string[]; partialError: string | null }
  | {
      ok: true;
      intent: "bulk-set";
      /** Metafield GIDs that actually took the new value. */
      updatedIds: string[];
      value: string;
      /** First userError when only some rows applied — e.g. a value invalid for that type. */
      partialError: string | null;
    }
  | { ok: true; intent: "export"; jobId: string }
  | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const plan = await getPlan(session.shop);

  // Free plan: enforce the 50-change/day cap for edits + deletes.
  if (!isPro(plan) && (intent === "set" || intent === "delete")) {
    const used = await getDailyEditCount(session.shop);
    if (used >= FREE_DAILY_LIMIT) {
      return {
        ok: false,
        intent,
        error: `Daily free limit reached (${FREE_DAILY_LIMIT} changes). Upgrade to Pro for unlimited edits.`,
      };
    }
  }

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

  if (intent === "bulk-set") {
    const ownerType = String(formData.get("ownerType") ?? "");
    const value = String(formData.get("value") ?? "");
    let items: BulkSetItem[] = [];
    try {
      items = JSON.parse(String(formData.get("items") ?? "[]"));
    } catch {
      items = [];
    }
    if (!items.length) {
      return { ok: false, intent, error: "Nothing to update" };
    }
    // Gated wholesale rather than by count: unlike delete, there is no
    // single-row version of this action to leave open to Free.
    if (!canBulkEdit(plan)) {
      return { ok: false, intent, error: "Bulk edit is a Pro feature." };
    }

    // metafieldsSet is ATOMIC per call: one invalid value rejects the whole
    // mutation, so a mixed-type batch loses the valid rows too. Verified against
    // the API — setting plain text over {single_line_text_field, json} updated 0
    // of 2, not 1 of 2. Grouping by type keeps a json failure from discarding
    // the text rows, and confines any rejection to the type that caused it.
    const byType = new Map<string, BulkSetItem[]>();
    for (const item of items) {
      const group = byType.get(item.type);
      if (group) group.push(item);
      else byType.set(item.type, [item]);
    }

    const updatedIds: string[] = [];
    let partialError: string | null = null;
    try {
      for (const group of byType.values()) {
        for (const batch of chunk(group, 25)) {
          const result = await setMetafields(
            admin,
            batch.map(({ ownerId, namespace, key, type }) => ({
              ownerId,
              namespace,
              key,
              type,
              value,
            })),
          );
          if (result.userErrors.length && !partialError) {
            partialError = result.userErrors[0].message;
          }
          // metafieldsSet echoes the metafield GID, which is exactly
          // MetafieldRow.id, so the response maps straight back to rows.
          for (const m of result.metafields) updatedIds.push(m.id);
        }
      }
    } catch (err) {
      return { ok: false, intent, error: err instanceof Error ? err.message : "Bulk edit failed" };
    }

    if (updatedIds.length) {
      await prisma.activityLog.create({
        data: {
          shopId: session.shop,
          action: "edit",
          resourceType: ownerType.toLowerCase() || "metafield",
          rowCount: updatedIds.length,
        },
      });
    }
    return { ok: true, intent: "bulk-set", updatedIds, value, partialError };
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
    if (items.length > 1 && !canBulkDelete(plan)) {
      return { ok: false, intent, error: "Bulk delete is a Pro feature." };
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

  if (intent === "export") {
    if (!isPro(plan)) {
      return { ok: false, intent, error: "CSV export is a Pro feature." };
    }
    const ownerType = String(formData.get("ownerType") ?? "PRODUCT");
    const job = await prisma.exportJob.create({
      data: { shopId: session.shop, type: "metafields", status: "queued" },
    });
    await exportQueue.add("export-metafields", {
      jobId: job.id,
      shopId: session.shop,
      shopDomain: session.shop,
      accessToken: String(session.accessToken ?? ""),
      type: "metafields",
      resourceType: ownerType,
    });
    return { ok: true, intent: "export", jobId: job.id };
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
  "36px minmax(150px, 1.3fr) minmax(110px, 1fr) minmax(110px, 1fr) 170px minmax(200px, 2fr) 92px";

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

/**
 * `filtered` matters: once namespace/search are applied by Shopify, an empty
 * page usually means "nothing matched", not "this store has no metafields".
 * Telling a merchant with a filter on that they have no metafields at all is
 * how a working filter looks like a broken app.
 */
function EmptyMetafields({
  ownerLabel,
  filtered = false,
  onClearFilters,
}: {
  ownerLabel: string;
  filtered?: boolean;
  onClearFilters?: () => void;
}) {
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
          {filtered ? "No matches" : "No metafields found"}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          {filtered
            ? `No ${ownerLabel.toLowerCase()} match the current namespace or search.`
            : `None of your ${ownerLabel.toLowerCase()} have metafields yet. Add one in
               Shopify admin, or switch to a different resource type above.`}
        </Text>
      </BlockStack>
      {filtered && onClearFilters && (
        <Button onClick={onClearFilters}>Clear filters</Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MetafieldsPage() {
  const {
    ownerType,
    page,
    plan,
    dailyUsed,
    namespace: activeNamespace,
    search: activeSearch,
    definedNamespaces,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const pro = isPro(plan);
  const agency = isAgency(plan);
  const [upgrade, setUpgrade] = useState<{
    open: boolean;
    reason: string;
    highlight: "pro" | "agency";
  }>({
    open: false,
    reason: "",
    highlight: "pro",
  });
  // "Get code" modal target (Agency). null = closed.
  const [snippetTarget, setSnippetTarget] = useState<SnippetTarget | null>(null);

  const openSnippet = (row: MetafieldRow) => {
    if (!agency) {
      setUpgrade({
        open: true,
        reason: "Liquid & GraphQL snippets are available on the Agency plan.",
        highlight: "agency",
      });
      return;
    }
    setSnippetTarget({
      kind: "metafield",
      ownerType,
      namespace: row.namespace,
      key: row.key,
      type: row.type,
      name: `${row.namespace}.${row.key}`,
    });
  };
  const loadMore = useFetcher<typeof loader>();
  const editFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const bulkEditFetcher = useFetcher<typeof action>();
  const exportFetcher = useFetcher<typeof action>();

  // Accumulated rows: reset whenever the owner type (i.e. the loader) changes.
  const [rows, setRows] = useState<MetafieldRow[]>(page.rows);
  const [cursor, setCursor] = useState<string | null>(page.endCursor);
  const [hasNext, setHasNext] = useState<boolean>(page.hasNextPage);
  // `search` is the text in the box; `activeSearch` is what the server actually
  // filtered on. They differ while the merchant is still typing.
  const [search, setSearch] = useState(activeSearch ?? "");
  // Type has no Admin API equivalent, so it stays a refinement of loaded rows
  // and is labelled as such in the UI.
  const [typeFilter, setTypeFilter] = useState<string[]>([]);

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

  // React to bulk-edit results.
  useEffect(() => {
    if (bulkEditFetcher.state !== "idle" || !bulkEditFetcher.data) return;
    const data = bulkEditFetcher.data;
    if (data.ok && data.intent === "bulk-set") {
      const updated = new Set(data.updatedIds);
      setRows((prev) => prev.map((r) => (updated.has(r.id) ? { ...r, value: data.value } : r)));
      setSelected([]);
      if (data.partialError) {
        shopify.toast.show(
          `Updated ${data.updatedIds.length}, some failed: ${data.partialError}`,
          { isError: true },
        );
      } else {
        shopify.toast.show(
          `Updated ${data.updatedIds.length} metafield${data.updatedIds.length === 1 ? "" : "s"}`,
        );
      }
    } else if (!data.ok) {
      shopify.toast.show(data.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkEditFetcher.state, bulkEditFetcher.data]);

  // React to export-trigger results.
  useEffect(() => {
    if (exportFetcher.state !== "idle" || !exportFetcher.data) return;
    const data = exportFetcher.data;
    if (data.ok && data.intent === "export") {
      shopify.toast.show("Export started — track progress in Jobs");
    } else if (!data.ok) {
      shopify.toast.show(data.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportFetcher.state, exportFetcher.data]);

  const startExport = () => {
    if (!pro) {
      setUpgrade({ open: true, reason: "CSV export is a Pro feature.", highlight: "pro" });
      return;
    }
    exportFetcher.submit({ intent: "export", ownerType }, { method: "post" });
  };

  const openBulkDelete = () => {
    if (!pro) {
      setUpgrade({ open: true, reason: "Bulk delete is a Pro feature.", highlight: "pro" });
      return;
    }
    setBulkConfirmOpen(true);
  };

  const openBulkEdit = () => {
    if (!pro) {
      setUpgrade({ open: true, reason: "Bulk edit is a Pro feature.", highlight: "pro" });
      return;
    }
    // Seed with the common value when every selected row already agrees, so the
    // merchant edits what they see rather than starting from an empty box.
    const values = new Set(selectedRows.map((r) => r.value));
    setBulkValue(values.size === 1 ? [...values][0] : "");
    setBulkEditOpen(true);
  };

  const submitBulkEdit = () => {
    bulkEditFetcher.submit(
      {
        intent: "bulk-set",
        ownerType,
        value: bulkValue,
        items: JSON.stringify(
          selectedRows.map((r) => ({
            id: r.id,
            ownerId: r.ownerId,
            namespace: r.namespace,
            key: r.key,
            type: r.type,
          })),
        ),
      },
      { method: "post" },
    );
    setBulkEditOpen(false);
  };

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

  /**
   * Server-filter state lives in the URL, so the loader is the single source of
   * truth: paging, revalidation and the back button all stay consistent with
   * what is on screen.
   */
  const buildUrl = (
    overrides: { owner?: OwnerType; namespace?: string | null; q?: string | null; after?: string } = {},
  ) => {
    const params = new URLSearchParams();
    params.set("owner", overrides.owner ?? ownerType);
    const ns = overrides.namespace !== undefined ? overrides.namespace : activeNamespace;
    const q = overrides.q !== undefined ? overrides.q : activeSearch;
    if (ns) params.set("namespace", ns);
    if (q) params.set("q", q);
    if (overrides.after) params.set("after", overrides.after);
    return `/app/metafields?${params.toString()}`;
  };

  const handleOwnerChange = (next: OwnerType) => {
    if (next === ownerType) return;
    // Namespace and search are owner-scoped, so switching owner clears them
    // rather than carrying over a filter that may match nothing here.
    navigate(`/app/metafields?owner=${next}`);
  };

  const handleLoadMore = () => {
    if (!cursor) return;
    loadMore.load(buildUrl({ after: cursor }));
  };

  const setNamespace = (next: string | null) => {
    if ((next ?? null) === (activeNamespace ?? null)) return;
    navigate(buildUrl({ namespace: next }));
  };

  // Debounce the search box: each change re-runs the loader, so firing on every
  // keystroke would be a request per character.
  useEffect(() => {
    const typed = search.trim();
    if (typed === (activeSearch ?? "")) return;
    const t = setTimeout(() => navigate(buildUrl({ q: typed || null })), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeSearch]);

  // Keep the box in step when the URL changes from elsewhere (clear-all, back).
  useEffect(() => {
    setSearch(activeSearch ?? "");
  }, [activeSearch]);

  /**
   * Namespaces with a definition, unioned with any seen in loaded rows —
   * namespaces left behind by a removed app have no definition, so definitions
   * alone would hide exactly the ones the orphan cleaner exists for.
   */
  const namespaceOptions = useMemo(
    () =>
      Array.from(new Set([...definedNamespaces, ...rows.map((r) => r.namespace)]))
        .sort()
        .map((n) => ({ label: n, value: n })),
    [definedNamespaces, rows],
  );
  const typeOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.type)))
        .sort()
        .map((t) => ({ label: t, value: t })),
    [rows],
  );

  const serverFiltered = Boolean(activeNamespace) || Boolean(activeSearch);

  // Only the type facet narrows here now — namespace and search were already
  // applied by Shopify, so re-checking them locally would be dead code.
  const filteredRows = useMemo(
    () => (typeFilter.length ? rows.filter((r) => typeFilter.includes(r.type)) : rows),
    [rows, typeFilter],
  );

  const appliedFilters = [
    ...(activeNamespace
      ? [
          {
            key: "namespace",
            label: `Namespace: ${activeNamespace}`,
            onRemove: () => setNamespace(null),
          },
        ]
      : []),
    ...(typeFilter.length
      ? [
          {
            key: "type",
            label: `Type (loaded rows): ${typeFilter.join(", ")}`,
            onRemove: () => setTypeFilter([]),
          },
        ]
      : []),
  ];

  // --- Bulk selection (Task 4) ---
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedSet.has(r.id));
  const someSelected = selected.length > 0;
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkValue, setBulkValue] = useState("");
  const isBulkEditing = bulkEditFetcher.state !== "idle";


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
  // Selections can span types, and a value valid for one may be rejected by
  // another (e.g. plain text into a json field). Warn rather than block —
  // Shopify decides, and the rows it rejects come back as a partial error.
  const selectedTypes = useMemo(
    () => Array.from(new Set(selectedRows.map((r) => r.type))),
    [selectedRows],
  );

  return (
    <Page fullWidth>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .mv-row:hover { background: #F1F1FF !important; }
        .mv-owner-tab { transition: all 0.15s ease; cursor: pointer; }
        .mv-pencil { opacity: 0; transition: opacity 0.12s ease; flex-shrink: 0; }
        .mv-value:hover .mv-pencil { opacity: 1; }
        .mv-edit-input { width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #6366F1; font-size: 13px; outline: none; font-family: inherit; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
        .mv-trash:hover { background: #FEE2E2 !important; }
        .mv-trash:hover svg path { stroke: #DC2626; }
        .mv-code:hover { background: #EEF0FF !important; }
        .mv-code:hover svg path { stroke: #6366F1; }
        .mv-check { width: 16px; height: 16px; cursor: pointer; accent-color: #6366F1; }
        /* Let grid cells shrink so long values truncate instead of pushing the
           fixed Actions column off the right edge. */
        .mv-row > *, .mv-mf-head > * { min-width: 0; }
        .mv-value { min-width: 0; overflow: hidden; }
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
            <InlineStack gap="200" blockAlign="center">
              {!pro && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: dailyUsed >= FREE_DAILY_LIMIT ? "#FEF2F2" : "#F3F4F6",
                    border: `1px solid ${dailyUsed >= FREE_DAILY_LIMIT ? "#FECACA" : "#E5E7EB"}`,
                    borderRadius: "20px",
                    padding: "5px 12px",
                  }}
                >
                  <Text
                    as="span"
                    variant="bodySm"
                    tone={dailyUsed >= FREE_DAILY_LIMIT ? "critical" : "subdued"}
                  >
                    {dailyUsed}/{FREE_DAILY_LIMIT} edits today
                  </Text>
                </div>
              )}
              <Button onClick={startExport} loading={exportFetcher.state !== "idle"}>
                {pro ? "Export CSV" : "Export CSV (Pro)"}
              </Button>
              <Button url="/app/import-export">Import</Button>
            </InlineStack>
          </InlineStack>
        </div>

        {/* Owner-type tabs */}
        <div style={{ display: "flex", gap: "4px", background: "#FFFFFF", padding: "4px", borderRadius: "10px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", width: "fit-content" }}>
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

        {/* Filter bar. Namespace + search run on Shopify's side and so cover the
            whole catalog; Type has no Admin API equivalent and is labelled as a
            refinement of what is loaded. */}
        <div style={{ background: "#FFFFFF", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }}>
          <Filters
            queryValue={search}
            queryPlaceholder={`Search ${OWNER_CONFIG[ownerType].label.toLowerCase()} by name…`}
            onQueryChange={setSearch}
            onQueryClear={() => setSearch("")}
            onClearAll={() => {
              setSearch("");
              setTypeFilter([]);
              navigate(buildUrl({ namespace: null, q: null }));
            }}
            appliedFilters={appliedFilters}
            filters={[
              {
                key: "namespace",
                label: "Namespace",
                shortcut: true,
                filter: (
                  <ChoiceList
                    title="Namespace"
                    titleHidden
                    choices={namespaceOptions}
                    selected={activeNamespace ? [activeNamespace] : []}
                    onChange={(next) => setNamespace(next[0] ?? null)}
                  />
                ),
              },
              {
                key: "type",
                label: "Type",
                shortcut: true,
                filter: (
                  <ChoiceList
                    title="Type"
                    titleHidden
                    allowMultiple
                    choices={typeOptions}
                    selected={typeFilter}
                    onChange={setTypeFilter}
                  />
                ),
              },
            ]}
          />
        </div>

        {typeFilter.length > 0 && (
          <Text as="p" variant="bodySm" tone="subdued">
            Type filters only the {rows.length} row{rows.length === 1 ? "" : "s"} loaded so
            far — Shopify can&apos;t filter metafields by type, so load more to widen it.
          </Text>
        )}

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
            <InlineStack gap="200">
              <Button loading={isBulkEditing} onClick={openBulkEdit}>
                {pro
                  ? `Edit ${selected.length} value${selected.length === 1 ? "" : "s"}`
                  : `Bulk edit ${selected.length} (Pro)`}
              </Button>
              <Button variant="primary" tone="critical" loading={isDeleting} onClick={openBulkDelete}>
                {pro
                  ? `Delete ${selected.length} metafield${selected.length === 1 ? "" : "s"}`
                  : `Bulk delete ${selected.length} (Pro)`}
              </Button>
            </InlineStack>
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
            className="mv-mf-head"
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
            {["Owner", "Namespace", "Key", "Type", "Value", "Actions"].map((h, i) => (
              <Text key={i} as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
                {h}
              </Text>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyMetafields
              ownerLabel={OWNER_CONFIG[ownerType].label}
              filtered={serverFiltered}
              onClearFilters={() => {
                setSearch("");
                setTypeFilter([]);
                navigate(buildUrl({ namespace: null, q: null }));
              }}
            />
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
                  <Text as="span" variant="bodySm" fontWeight="medium" truncate>
                    {row.ownerLabel}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued" truncate>
                    {row.namespace}
                  </Text>
                  <Text as="span" variant="bodySm" truncate>
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
                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <Text as="span" variant="bodySm" tone={row.value ? "subdued" : "disabled"} truncate>
                          {row.value ? truncate(row.value) : "— empty —"}
                        </Text>
                      </div>
                      <svg className="mv-pencil" width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "center", gap: "2px" }}>
                    <button
                      type="button"
                      aria-label="Get Liquid & GraphQL code"
                      title="Get Liquid & GraphQL code"
                      className="mv-code"
                      onClick={() => openSnippet(row)}
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
                        <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
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
                  {typeFilter.length
                    ? `${filteredRows.length} of ${rows.length} rows loaded`
                    : `${rows.length} row${rows.length === 1 ? "" : "s"} loaded`}
                  {serverFiltered ? " · filtered in Shopify" : ""}
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

      {/* Bulk edit — set one value across every selected row */}
      <Modal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        title={`Edit ${selected.length} metafield${selected.length === 1 ? "" : "s"}`}
        primaryAction={{
          content: `Update ${selected.length} value${selected.length === 1 ? "" : "s"}`,
          loading: isBulkEditing,
          onAction: submitBulkEdit,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setBulkEditOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Set the same value on{" "}
              <Text as="span" fontWeight="semibold">
                {selected.length} metafield{selected.length === 1 ? "" : "s"}
              </Text>{" "}
              across your selected {OWNER_CONFIG[ownerType].label.toLowerCase()}.
            </Text>

            <TextField
              label="New value"
              value={bulkValue}
              onChange={setBulkValue}
              multiline={4}
              autoComplete="off"
              helpText="Applied to every selected row. Leave empty to clear the values."
            />

            {selectedTypes.length > 1 && (
              <div
                style={{
                  background: "#FFFBEB",
                  border: "1px solid #FDE68A",
                  borderRadius: "8px",
                  padding: "12px 14px",
                }}
              >
                <Text as="p" variant="bodySm">
                  Your selection spans {selectedTypes.length} types (
                  {selectedTypes.join(", ")}). Each type is applied separately, so a value
                  Shopify rejects for one type leaves those rows unchanged without affecting
                  the others. A value valid for every type updates them all.
                </Text>
              </div>
            )}
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

      <SnippetModal target={snippetTarget} onClose={() => setSnippetTarget(null)} />

      <UpgradeModal
        open={upgrade.open}
        onClose={() => setUpgrade({ open: false, reason: "", highlight: "pro" })}
        reason={upgrade.reason}
        highlight={upgrade.highlight}
      />
    </Page>
  );
}

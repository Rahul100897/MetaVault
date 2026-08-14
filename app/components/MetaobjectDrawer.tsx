import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useFetcher } from "@remix-run/react";
import { Text, BlockStack, TextField, Checkbox, Select, DatePicker, Button, InlineStack } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  inputKindForType,
  slugify,
  type MetaobjectDefinitionSummary,
  type MetaobjectEntry,
} from "../lib/metaobjects";

export type DrawerMode = "edit" | "create" | "duplicate";

type SaveResult =
  | { ok: true; intent: "create" | "update"; entry: MetaobjectEntry }
  | { ok: false; intent: string; error: string };

type Props = {
  open: boolean;
  mode: DrawerMode;
  definition: MetaobjectDefinitionSummary;
  entry: MetaobjectEntry | null;
  onClose: () => void;
  onSaved: (entry: MetaobjectEntry, mode: DrawerMode) => void;
};

function isValidUrl(v: string): boolean {
  if (!v) return true;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const selected = value ? safeParse(value) : undefined;
  const base = selected ?? new Date();
  const [{ month, year }, setMY] = useState({ month: base.getMonth(), year: base.getFullYear() });
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" fontWeight="medium">
        {label}
      </Text>
      <DatePicker
        month={month}
        year={year}
        onMonthChange={(m, y) => setMY({ month: m, year: y })}
        selected={selected}
        onChange={({ start }) => onChange(format(start, "yyyy-MM-dd"))}
      />
    </BlockStack>
  );
}

function safeParse(v: string): Date | undefined {
  try {
    return parseISO(v);
  } catch {
    return undefined;
  }
}

// --- Resource reference fields (native "Select products" experience) ---------

type PickerResource = "product" | "variant" | "collection";

/** Which App Bridge resource picker (if any) backs a metaobject field type. */
function referencePicker(
  fieldType: string,
): { resource: PickerResource; multiple: boolean } | null {
  const multiple = fieldType.startsWith("list.");
  const base = fieldType.replace(/^list\./, "");
  if (base === "product_reference") return { resource: "product", multiple };
  if (base === "variant_reference") return { resource: "variant", multiple };
  if (base === "collection_reference") return { resource: "collection", multiple };
  return null;
}

/** Reference values are a single GID, or a JSON array of GIDs for list.* types. */
function parseRefs(value: string, multiple: boolean): string[] {
  if (!value) return [];
  if (multiple) {
    try {
      const arr = JSON.parse(value);
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [value];
    }
  }
  return [value];
}

function serializeRefs(ids: string[], multiple: boolean): string {
  return multiple ? JSON.stringify(ids) : (ids[0] ?? "");
}

const RESOURCE_PLURAL: Record<PickerResource, string> = {
  product: "products",
  variant: "variants",
  collection: "collections",
};

function ReferenceField({
  label,
  value,
  onChange,
  resource,
  multiple,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  resource: PickerResource;
  multiple: boolean;
}) {
  const shopify = useAppBridge();
  const ids = parseRefs(value, multiple);
  const plural = RESOURCE_PLURAL[resource];

  const openPicker = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selection = (await (shopify as any).resourcePicker({
      type: resource,
      multiple,
      selectionIds: ids.map((id) => ({ id })),
    })) as Array<{ id: string }> | undefined;
    if (!selection) return; // cancelled
    onChange(serializeRefs(selection.map((r) => r.id), multiple));
  };

  return (
    <BlockStack gap="150">
      <Text as="span" variant="bodySm" fontWeight="medium">
        {label}
      </Text>
      {ids.length > 0 ? (
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">
            {ids.length} {ids.length === 1 ? resource : plural} selected
          </Text>
          <Button size="slim" onClick={openPicker}>
            Change
          </Button>
          <Button
            size="slim"
            variant="plain"
            tone="critical"
            onClick={() => onChange(serializeRefs([], multiple))}
          >
            Clear
          </Button>
        </InlineStack>
      ) : (
        <Button onClick={openPicker}>Select {multiple ? plural : resource}</Button>
      )}
    </BlockStack>
  );
}

export default function MetaobjectDrawer({
  open,
  mode,
  definition,
  entry,
  onClose,
  onSaved,
}: Props) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<SaveResult>();

  const [values, setValues] = useState<Record<string, string>>({});
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "DRAFT">("ACTIVE");
  const [handleEdited, setHandleEdited] = useState(false);

  const firstTextKey = useMemo(() => {
    const f = definition.fieldDefinitions.find((d) => {
      const k = inputKindForType(d.type);
      return k === "text" || k === "multiline";
    });
    return f?.key ?? null;
  }, [definition]);

  // Initialize form whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    for (const f of definition.fieldDefinitions) init[f.key] = entry?.fields[f.key]?.value ?? "";
    setValues(init);
    setHandle(
      mode === "duplicate"
        ? `${entry?.handle ?? ""}-copy`
        : mode === "edit"
          ? entry?.handle ?? ""
          : "",
    );
    setStatus(entry?.status === "DRAFT" ? "DRAFT" : "ACTIVE");
    setHandleEdited(mode !== "create");
  }, [open, entry, mode, definition]);

  // React to save results.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data;
    if (data.ok) {
      shopify.toast.show(data.intent === "create" ? "Entry created" : "Entry updated");
      onSaved(data.entry, mode);
    } else {
      shopify.toast.show(data.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  if (!open) return null;

  const setFieldValue = (key: string, val: string) => {
    setValues((v) => ({ ...v, [key]: val }));
    if (mode === "create" && !handleEdited && key === firstTextKey) {
      setHandle(slugify(val));
    }
  };

  const save = () => {
    // URL field validation
    for (const f of definition.fieldDefinitions) {
      if (inputKindForType(f.type) === "url" && !isValidUrl(values[f.key] ?? "")) {
        shopify.toast.show(`"${f.name}" must be a valid URL`, { isError: true });
        return;
      }
    }
    const fields = definition.fieldDefinitions.map((f) => ({ key: f.key, value: values[f.key] ?? "" }));
    fetcher.submit(
      {
        intent: mode === "edit" ? "update" : "create",
        type: definition.type,
        id: entry?.id ?? "",
        handle,
        status: definition.publishable ? status : "",
        fields: JSON.stringify(fields),
      },
      { method: "post" },
    );
  };

  const saving = fetcher.state !== "idle";
  const title =
    mode === "edit"
      ? `Edit entry — ${entry?.handle ?? ""}`
      : mode === "duplicate"
        ? "Duplicate entry"
        : "Add entry";

  return (
    <>
      <style>{`@keyframes mo-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
      {/* Backdrop */}
      <div
        onClick={saving ? undefined : onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(10,15,30,0.35)",
          zIndex: 519,
        }}
      />
      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: "400px",
          maxWidth: "92vw",
          background: "#FFFFFF",
          boxShadow: "-8px 0 24px rgba(10,15,30,0.18)",
          zIndex: 520,
          display: "flex",
          flexDirection: "column",
          animation: "mo-slide-in 0.2s ease",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid #ECECF1",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text as="h2" variant="headingMd" fontWeight="semibold">
            {title}
          </Text>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          <BlockStack gap="400">
            <TextField
              label="Handle"
              value={handle}
              onChange={(v) => {
                setHandle(v);
                setHandleEdited(true);
              }}
              autoComplete="off"
              helpText="Unique identifier for this entry"
            />

            {definition.publishable && (
              <Select
                label="Status"
                options={[
                  { label: "Active", value: "ACTIVE" },
                  { label: "Draft", value: "DRAFT" },
                ]}
                value={status}
                onChange={(v) => setStatus(v as "ACTIVE" | "DRAFT")}
              />
            )}

            {definition.fieldDefinitions.map((f) => {
              const kind = inputKindForType(f.type);
              const val = values[f.key] ?? "";
              const label = f.required ? `${f.name} *` : f.name;

              if (kind === "boolean") {
                return (
                  <Checkbox
                    key={f.key}
                    label={label}
                    checked={val === "true"}
                    onChange={(c) => setFieldValue(f.key, c ? "true" : "false")}
                  />
                );
              }
              if (kind === "date") {
                return (
                  <DateField
                    key={f.key}
                    label={label}
                    value={val}
                    onChange={(v) => setFieldValue(f.key, v)}
                  />
                );
              }
              if (kind === "number") {
                return (
                  <TextField
                    key={f.key}
                    label={label}
                    type="number"
                    value={val}
                    onChange={(v) => setFieldValue(f.key, v)}
                    autoComplete="off"
                  />
                );
              }
              if (kind === "url") {
                const invalid = !isValidUrl(val);
                return (
                  <TextField
                    key={f.key}
                    label={label}
                    type="url"
                    value={val}
                    onChange={(v) => setFieldValue(f.key, v)}
                    error={invalid ? "Enter a valid URL" : undefined}
                    autoComplete="off"
                  />
                );
              }
              if (kind === "multiline" || kind === "json") {
                return (
                  <TextField
                    key={f.key}
                    label={label}
                    multiline={4}
                    value={val}
                    onChange={(v) => setFieldValue(f.key, v)}
                    autoComplete="off"
                    helpText={kind === "json" ? "JSON value" : undefined}
                  />
                );
              }
              // Product / variant / collection references → native resource picker.
              const ref = referencePicker(f.type);
              if (ref) {
                return (
                  <ReferenceField
                    key={f.key}
                    label={label}
                    value={val}
                    onChange={(v) => setFieldValue(f.key, v)}
                    resource={ref.resource}
                    multiple={ref.multiple}
                  />
                );
              }
              // text, file, metaobject, other → text input (references as raw value)
              return (
                <TextField
                  key={f.key}
                  label={label}
                  value={val}
                  onChange={(v) => setFieldValue(f.key, v)}
                  autoComplete="off"
                  helpText={
                    kind === "file"
                      ? "File reference (GID or URL)"
                      : kind === "metaobject"
                        ? "Referenced metaobject GID"
                        : undefined
                  }
                />
              );
            })}
          </BlockStack>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid #ECECF1",
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
          }}
        >
          <InlineStack gap="200">
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              {mode === "edit" ? "Save changes" : "Create entry"}
            </Button>
          </InlineStack>
        </div>
      </div>
    </>
  );
}

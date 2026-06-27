import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Modal, BlockStack, InlineStack, Text, Select, Banner, Badge } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { MetaobjectDefinitionSummary } from "../lib/metaobjects";

type Props = {
  open: boolean;
  definition: MetaobjectDefinitionSummary;
  onClose: () => void;
  onImported: () => void;
};

type FetchResult =
  | {
      ok: true;
      intent: "import-validate";
      total: number;
      willCreate: number;
      willUpdate: number;
      willSkip: number;
      errors: Array<{ line: number; handle: string; message: string }>;
    }
  | { ok: true; intent: "import-execute"; jobId: string }
  | { ok: false; intent: string; error: string };

const MAX_BYTES = 10 * 1024 * 1024;
const IGNORE = "";

function parseHeaders(text: string): string[] {
  const line = text.split(/\r?\n/)[0] ?? "";
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((h) => h.trim());
}

export default function MetaobjectImportModal({ open, definition, onClose, onImported }: Props) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<FetchResult>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "map" | "preview">("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);

  // Reset when (re)opened.
  useEffect(() => {
    if (open) {
      setStep("upload");
      setCsvText("");
      setFileName("");
      setHeaders([]);
      setMapping({});
    }
  }, [open]);

  // React to validate / execute results.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;
    if (d.ok && d.intent === "import-validate") {
      setStep("preview");
    } else if (d.ok && d.intent === "import-execute") {
      shopify.toast.show("Import started — track progress in Jobs");
      onImported();
      onClose();
    } else if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const fieldKeys = definition.fieldDefinitions.map((f) => f.key);

  const readFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      shopify.toast.show("Please select a .csv file", { isError: true });
      return;
    }
    if (file.size > MAX_BYTES) {
      shopify.toast.show("File exceeds 10MB limit", { isError: true });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const hdrs = parseHeaders(text);
      // Auto-map: exact match to a field key, or the literal "handle".
      const auto: Record<string, string> = {};
      for (const h of hdrs) {
        if (h === "handle") auto[h] = "handle";
        else if (fieldKeys.includes(h)) auto[h] = h;
        else auto[h] = IGNORE;
      }
      setCsvText(text);
      setFileName(file.name);
      setHeaders(hdrs);
      setMapping(auto);
      setStep("map");
    };
    reader.readAsText(file);
  };

  const handleMapped = Object.values(mapping).includes("handle");
  const isBusy = fetcher.state !== "idle";

  const runValidate = () => {
    fetcher.submit(
      { intent: "import-validate", type: definition.type, csvText, mapping: JSON.stringify(mapping) },
      { method: "post" },
    );
  };

  const runExecute = () => {
    fetcher.submit(
      { intent: "import-execute", type: definition.type, csvText, mapping: JSON.stringify(mapping) },
      { method: "post" },
    );
  };

  const preview =
    fetcher.data?.ok && fetcher.data.intent === "import-validate" ? fetcher.data : null;

  const targetOptions = [
    { label: "— Ignore —", value: IGNORE },
    { label: "handle (required)", value: "handle" },
    ...definition.fieldDefinitions.map((f) => ({ label: `${f.name} (${f.key})`, value: f.key })),
  ];

  const primaryAction =
    step === "map"
      ? {
          content: "Preview import",
          loading: isBusy,
          disabled: !handleMapped,
          onAction: runValidate,
        }
      : step === "preview"
        ? {
            content: `Run import`,
            loading: isBusy,
            disabled: !preview || preview.willCreate + preview.willUpdate === 0,
            onAction: runExecute,
          }
        : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Import entries — ${definition.name}`}
      size="large"
      primaryAction={primaryAction}
      secondaryActions={[
        step === "preview"
          ? { content: "Back", onAction: () => setStep("map") }
          : { content: "Cancel", onAction: onClose },
      ]}
    >
      <Modal.Section>
        {step === "upload" && (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) readFile(f);
            }}
            style={{
              border: `2px dashed ${dragging ? "#6366F1" : "#D1D5DB"}`,
              borderRadius: "12px",
              padding: "40px 24px",
              textAlign: "center",
              cursor: "pointer",
              background: dragging ? "#EEF0FF" : "#FAFAFB",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
              }}
            />
            <BlockStack gap="200" inlineAlign="center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5-5 5 5M12 5v12" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <Text as="p" variant="bodyMd" fontWeight="medium">
                Drop a CSV here, or click to browse
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                CSV only · max 10MB
              </Text>
            </BlockStack>
          </div>
        )}

        {step === "map" && (
          <BlockStack gap="400">
            <Text as="p" variant="bodySm" tone="subdued">
              Map columns from <b>{fileName}</b> to fields in {definition.name}. A
              column must map to <b>handle</b>.
            </Text>
            {!handleMapped && (
              <Banner tone="critical" title="A column must map to “handle”">
                <Text as="p" variant="bodySm">
                  The handle identifies each entry for create/update.
                </Text>
              </Banner>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                Your CSV columns
              </Text>
              <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                MetaVault fields
              </Text>
              {headers.map((h) => {
                const unmapped = (mapping[h] ?? IGNORE) === IGNORE;
                return (
                  <div key={h} style={{ display: "contents" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        background: unmapped ? "#FFFBEB" : "#F6F6F8",
                        border: unmapped ? "1px solid #FDE68A" : "1px solid #ECECF1",
                      }}
                    >
                      <Text as="span" variant="bodySm">
                        {h}
                      </Text>
                    </div>
                    <Select
                      label=""
                      labelHidden
                      options={targetOptions}
                      value={mapping[h] ?? IGNORE}
                      onChange={(v) => setMapping((m) => ({ ...m, [h]: v }))}
                    />
                  </div>
                );
              })}
            </div>
          </BlockStack>
        )}

        {step === "preview" && preview && (
          <BlockStack gap="400">
            <InlineStack gap="200">
              <Badge tone="success">{`${preview.willCreate} to create`}</Badge>
              <Badge tone="info">{`${preview.willUpdate} to update`}</Badge>
              <Badge tone="warning">{`${preview.willSkip} to skip`}</Badge>
              <Badge>{`${preview.total} total`}</Badge>
            </InlineStack>

            {preview.errors.length > 0 && (
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  Rows that will be skipped
                </Text>
                <div
                  style={{
                    maxHeight: "240px",
                    overflowY: "auto",
                    border: "1px solid #ECECF1",
                    borderRadius: "8px",
                  }}
                >
                  {preview.errors.map((e) => (
                    <div
                      key={e.line}
                      style={{
                        display: "flex",
                        gap: "12px",
                        padding: "8px 12px",
                        borderBottom: "1px solid #F3F4F6",
                      }}
                    >
                      <Text as="span" variant="bodySm" tone="subdued">
                        line {e.line}
                      </Text>
                      <Text as="span" variant="bodySm">
                        {e.handle || "(no handle)"}
                      </Text>
                      <Text as="span" variant="bodySm" tone="critical">
                        {e.message}
                      </Text>
                    </div>
                  ))}
                </div>
              </BlockStack>
            )}
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

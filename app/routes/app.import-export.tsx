import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Select,
  Banner,
  Badge,
  Spinner,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { exportQueue, importQueue } from "../lib/queue.server";
import { uploadFile, buildFileKey } from "../lib/r2.server";
import { validateImportCsv } from "../lib/metafield-import.server";
import { OWNER_CONFIG, OWNER_TYPES } from "../lib/metafields";
import { getPlan } from "../lib/plan.server";
import { canImportExport } from "../lib/plans";
import UpgradeModal from "../components/UpgradeModal";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const plan = await getPlan(session.shop);
  return { plan, allowed: canImportExport(plan) };
};

type PreviewRow = {
  line: number;
  owner_id: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
  valid: boolean;
  error: string;
};

type ActionData =
  | {
      ok: true;
      intent: "validate";
      total: number;
      valid: number;
      invalid: number;
      missingColumns: string[];
      preview: PreviewRow[];
    }
  | { ok: true; intent: "import"; jobId: string }
  | { ok: true; intent: "export"; jobId: string }
  | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  // Import + export are Pro features. Validation (dry-run) stays open so users
  // can see what they'd get.
  if ((intent === "import" || intent === "export") && !canImportExport(await getPlan(session.shop))) {
    return { ok: false, intent, error: "Import & export are Pro features." };
  }

  if (intent === "validate") {
    const csvText = String(formData.get("csvText") ?? "");
    if (!csvText.trim()) return { ok: false, intent, error: "The file is empty" };
    const summary = validateImportCsv(csvText);
    const preview: PreviewRow[] = summary.rows.slice(0, 50).map((r) => ({
      line: r.line,
      owner_id: String(r.raw.owner_id ?? ""),
      namespace: String(r.raw.namespace ?? ""),
      key: String(r.raw.key ?? ""),
      type: String(r.raw.type ?? ""),
      value: String(r.raw.value ?? ""),
      valid: r.input !== null,
      error: r.errors.join("; "),
    }));
    return {
      ok: true,
      intent: "validate",
      total: summary.total,
      valid: summary.valid,
      invalid: summary.invalid,
      missingColumns: summary.missingColumns,
      preview,
    };
  }

  if (intent === "import") {
    const csvText = String(formData.get("csvText") ?? "");
    if (!csvText.trim()) return { ok: false, intent, error: "The file is empty" };
    const summary = validateImportCsv(csvText);
    if (summary.valid === 0) {
      return { ok: false, intent, error: "No valid rows to import" };
    }

    const job = await prisma.importJob.create({
      data: { shopId: session.shop, type: "metafields", status: "queued", totalRows: summary.total },
    });
    const key = buildFileKey(session.shop, "import", job.id, "csv");
    await uploadFile(key, csvText, "text/csv");
    await prisma.importJob.update({ where: { id: job.id }, data: { fileUrl: key } });

    await importQueue.add("import-metafields", {
      jobId: job.id,
      shopId: session.shop,
      shopDomain: session.shop,
      accessToken: String(session.accessToken ?? ""),
      fileUrl: key,
      type: "metafields",
    });
    return { ok: true, intent: "import", jobId: job.id };
  }

  if (intent === "export") {
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

export default function ImportExportPage() {
  const { allowed } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const validateFetcher = useFetcher<ActionData>();
  const importFetcher = useFetcher<ActionData>();
  const exportFetcher = useFetcher<ActionData>();

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [ownerType, setOwnerType] = useState<string>("PRODUCT");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  /** Set once an import is queued, so the preview gives way to a result panel. */
  const [importResult, setImportResult] = useState<{ rows: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Row count captured at submit time — the preview is gone by the time we report it. */
  const queuedRows = useRef(0);

  const preview =
    validateFetcher.data?.ok && validateFetcher.data.intent === "validate"
      ? validateFetcher.data
      : null;

  const importing = importFetcher.state !== "idle";

  // Remix keeps a fetcher's data until its next submit, so the preview would
  // otherwise linger after Clear or after a queued import. Gate it on the
  // filename instead, which both of those reset.
  const showPreview = preview !== null && fileName !== "" && !importing && !importResult;

  // Toasts for import + export results.
  useEffect(() => {
    if (importFetcher.state !== "idle" || !importFetcher.data) return;
    const d = importFetcher.data;
    if (d.ok && d.intent === "import") {
      shopify.toast.show("Import started — track progress in Jobs");
      setImportResult({ rows: queuedRows.current });
      setCsvText("");
      setFileName("");
    } else if (!d.ok) {
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importFetcher.state, importFetcher.data]);

  useEffect(() => {
    if (exportFetcher.state !== "idle" || !exportFetcher.data) return;
    const d = exportFetcher.data;
    if (d.ok && d.intent === "export") shopify.toast.show("Export started — track progress in Jobs");
    else if (!d.ok) shopify.toast.show(d.error, { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportFetcher.state, exportFetcher.data]);

  const readFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      shopify.toast.show("Please select a .csv file", { isError: true });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ""));
      setFileName(file.name);
      validateFetcher.submit(
        { intent: "validate", csvText: String(reader.result ?? "") },
        { method: "post" },
      );
    };
    reader.readAsText(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const runImport = () => {
    queuedRows.current = preview?.valid ?? 0;
    importFetcher.submit({ intent: "import", csvText }, { method: "post" });
  };

  /** Back to the dropzone for another file. */
  const resetImport = () => {
    setImportResult(null);
    setCsvText("");
    setFileName("");
  };

  /**
   * A template so merchants can see the expected shape before they build a
   * file. Generated client-side — no round trip, and it always matches the
   * columns the validator actually requires.
   */
  const downloadSample = () => {
    const sample = [
      "owner_id,namespace,key,type,value",
      'gid://shopify/Product/1234567890,custom,subheading,single_line_text_field,Woven in a family mill since 1946',
      'gid://shopify/Product/1234567890,custom,care_guide,multi_line_text_field,"Machine wash at 30°C.\nDry flat, away from direct sun.\nWarm iron if needed."',
      'gid://shopify/Product/1234567890,custom,launch_date,date,2026-03-01',
      'gid://shopify/Collection/9876543210,custom,subheading,single_line_text_field,"Everything linen, in one place"',
      'gid://shopify/Customer/1122334455,custom,vip_tier,single_line_text_field,Gold',
    ].join("\n");

    const url = URL.createObjectURL(new Blob([sample], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "metavault-import-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const runExport = () => {
    exportFetcher.submit({ intent: "export", ownerType }, { method: "post" });
  };

  const isValidating = validateFetcher.state !== "idle";

  return (
    <Page>
      <style>{`
        .mv-drop { transition: all 0.15s ease; }
        .mv-prev-row:nth-child(even) { background: #FAFAFB; }
      `}</style>

      <BlockStack gap="500">
        <div style={{ paddingTop: "8px" }}>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h1" variant="headingXl" fontWeight="bold">
                  Import / Export
                </Text>
                <Badge tone="info">Pro</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Move metafields in and out as flat, one-row-per-entry CSV files.
              </Text>
            </BlockStack>
            <Button url="/app/jobs" variant="secondary">
              View jobs
            </Button>
          </InlineStack>
        </div>

        {!allowed && (
          <Card>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 24px", gap: "16px" }}>
              <div
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "18px",
                  background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="11" width="14" height="9" rx="2" stroke="#fff" strokeWidth="2" />
                  <path d="M8 11V8a4 4 0 018 0v3" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <BlockStack gap="100" inlineAlign="center">
                <Text as="p" variant="headingMd" alignment="center">
                  Import & Export is a Pro feature
                </Text>
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  Upgrade to Pro to move metafields in and out as CSV, with dry-run
                  validation and background jobs.
                </Text>
              </BlockStack>
              <Button variant="primary" onClick={() => setUpgradeOpen(true)}>
                See plans
              </Button>
            </div>
          </Card>
        )}

        {allowed && (
        <>
        {/* Export */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd" fontWeight="semibold">
                Export metafields
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Generate a CSV of all metafields for a resource type. Large stores
                run as a background job — download it from the Jobs page when ready.
              </Text>
            </BlockStack>
            <InlineStack gap="300" blockAlign="end">
              <div style={{ minWidth: "220px" }}>
                <Select
                  label="Resource type"
                  options={OWNER_TYPES.map((t) => ({ label: OWNER_CONFIG[t].label, value: t }))}
                  value={ownerType}
                  onChange={setOwnerType}
                />
              </div>
              <Button
                variant="primary"
                onClick={runExport}
                loading={exportFetcher.state !== "idle"}
              >
                Export CSV
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Import */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd" fontWeight="semibold">
                Import metafields
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Upload a CSV with columns: owner_id, namespace, key, type, value.
                We&apos;ll validate it before anything is written. A row whose
                namespace and key already exist on that owner is overwritten.
              </Text>
              <InlineStack>
                <Button variant="plain" onClick={downloadSample}>
                  Download a sample CSV
                </Button>
              </InlineStack>
            </BlockStack>

            {/* Dropzone */}
            <div
              className="mv-drop"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              style={{
                border: `2px dashed ${dragging ? "#6366F1" : "#D1D5DB"}`,
                borderRadius: "12px",
                padding: "32px 24px",
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
                  const file = e.target.files?.[0];
                  if (file) readFile(file);
                }}
              />
              <BlockStack gap="200" inlineAlign="center">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
                    stroke="#6366F1"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  {fileName || "Drop a CSV here, or click to browse"}
                </Text>
                {isValidating && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Validating…
                  </Text>
                )}
              </BlockStack>
            </div>

            {/* In-flight: the preview is dismissed so the table can't be
                mistaken for something still awaiting confirmation. */}
            {importing && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "20px",
                  border: "1px solid #E5E7EB",
                  borderRadius: "10px",
                  background: "#FAFAFB",
                }}
              >
                <Spinner size="small" />
                <BlockStack gap="050">
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    Queueing your import…
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Uploading the file and handing it to the worker.
                  </Text>
                </BlockStack>
              </div>
            )}

            {/* Queued: rows are written in the background, so point at Jobs
                rather than implying the work is already finished. */}
            {importResult && !importing && (
              <Banner
                tone="success"
                title={`Import queued — ${importResult.rows} row${importResult.rows === 1 ? "" : "s"}`}
                action={{ content: "View jobs", url: "/app/jobs" }}
                secondaryAction={{ content: "Import another file", onAction: resetImport }}
              >
                <Text as="p" variant="bodySm">
                  Rows are written in the background. Jobs shows progress, the
                  final count, and an error report if any row was rejected.
                </Text>
              </Banner>
            )}

            {/* Validation result */}
            {showPreview && (
              <BlockStack gap="300">
                {preview.missingColumns.length > 0 && (
                  <Banner tone="critical" title="Missing required columns">
                    <Text as="p" variant="bodySm">
                      Your file is missing: {preview.missingColumns.join(", ")}
                    </Text>
                  </Banner>
                )}

                <InlineStack gap="200">
                  <StatPill label="Total rows" value={preview.total} color="#6366F1" />
                  <StatPill label="Valid" value={preview.valid} color="#10B981" />
                  <StatPill label="Invalid" value={preview.invalid} color="#EF4444" />
                </InlineStack>

                {/* Preview table */}
                <div
                  style={{
                    border: "1px solid #E5E7EB",
                    borderRadius: "10px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "44px 1.4fr 1fr 1fr 1fr 1.4fr",
                      gap: "12px",
                      padding: "10px 14px",
                      background: "#0A0F1E",
                    }}
                  >
                    {["", "Owner ID", "Namespace", "Key", "Type", "Status"].map((h, i) => (
                      <Text key={i} as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
                        {h}
                      </Text>
                    ))}
                  </div>
                  {preview.preview.map((r) => (
                    <div
                      key={r.line}
                      className="mv-prev-row"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "44px 1.4fr 1fr 1fr 1fr 1.4fr",
                        gap: "12px",
                        padding: "10px 14px",
                        borderBottom: "1px solid #F3F4F6",
                        alignItems: "center",
                      }}
                    >
                      <Text as="span" variant="bodySm" tone="subdued">
                        {r.line}
                      </Text>
                      <Text as="span" variant="bodySm">
                        {truncate(r.owner_id, 24)}
                      </Text>
                      <Text as="span" variant="bodySm">
                        {r.namespace}
                      </Text>
                      <Text as="span" variant="bodySm">
                        {r.key}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {r.type}
                      </Text>
                      {r.valid ? (
                        <Badge tone="success">Valid</Badge>
                      ) : (
                        <span title={r.error}>
                          <Badge tone="critical">Invalid</Badge>
                        </span>
                      )}
                    </div>
                  ))}
                  {preview.total > preview.preview.length && (
                    <div style={{ padding: "10px 14px", background: "#F9FAFB" }}>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Showing first {preview.preview.length} of {preview.total} rows
                      </Text>
                    </div>
                  )}
                </div>

                <InlineStack align="end" gap="200">
                  <Button onClick={resetImport}>Clear</Button>
                  <Button
                    variant="primary"
                    disabled={preview.valid === 0}
                    loading={importing}
                    onClick={runImport}
                  >
                    {`Import ${preview.valid} valid row${preview.valid === 1 ? "" : "s"}`}
                  </Button>
                </InlineStack>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
        </>
        )}
      </BlockStack>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        reason="Import & export are available on Pro and Agency plans."
        highlight="pro"
      />
    </Page>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        background: color + "12",
        border: `1px solid ${color}33`,
        borderRadius: "10px",
        padding: "8px 16px",
      }}
    >
      <Text as="span" variant="bodySm" tone="subdued">
        {label}:{" "}
      </Text>
      <Text as="span" variant="bodyMd" fontWeight="bold">
        {value}
      </Text>
    </div>
  );
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : value.slice(0, max) + "…";
}

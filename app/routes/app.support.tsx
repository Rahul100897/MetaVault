import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Banner,
  Select,
  TextField,
  Checkbox,
  Collapsible,
  Divider,
  Link as PolarisLink,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getPlan } from "../lib/plan.server";
import {
  AREAS,
  MESSAGE_MAX,
  REQUEST_TYPES,
  SUBJECT_MAX,
  URGENCIES,
  hasErrors,
  isRequestType,
  isUrgency,
  requestTypeLabel,
  validateSupportForm,
  type RequestType,
  type SupportFormErrors,
} from "../lib/support";
import {
  checkRateLimit,
  collectDiagnostics,
  createSupportRequest,
  listShopRequests,
  resolveShopEmail,
  sanitiseClientDiagnostics,
  type SupportRequestSummary,
} from "../lib/support.server";

/**
 * Help & feedback.
 *
 * Deliberately available on every plan, including Free: a merchant who can't
 * reach us is a merchant whose bug we never hear about, and the App Store
 * expects support to be reachable regardless of what someone pays.
 *
 * The submission is written to Postgres and *then* emailed to us. See
 * support.server.ts for why that order matters.
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [plan, shopEmail, history] = await Promise.all([
    getPlan(shopId),
    resolveShopEmail(shopId),
    listShopRequests(shopId),
  ]);

  // Deep links from elsewhere in the app can preselect the form, e.g.
  // /app/support?type=bug&area=Backups%20%26%20restore.
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type") ?? "";
  const areaParam = url.searchParams.get("area") ?? "";

  return {
    shopId,
    plan,
    prefill: {
      email: shopEmail ?? "",
      type: isRequestType(typeParam) ? typeParam : "",
      area: (AREAS as readonly string[]).includes(areaParam) ? areaParam : "",
    },
    history,
    // The PUBLIC contact address, shown to merchants — the same one on the
    // legal pages. Deliberately NOT SUPPORT_TO_EMAIL: that is the private
    // inbox we route requests to and is very likely a personal address, which
    // must never be rendered into a merchant-facing page.
    publicContactEmail: process.env.APP_CONTACT_EMAIL ?? "support@metavault.app",
  };
};

type ActionData =
  | { ok: true; id: string }
  | { ok: false; error?: string; fieldErrors?: SupportFormErrors };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const form = await request.formData();

  const values = {
    type: String(form.get("type") ?? ""),
    area: String(form.get("area") ?? ""),
    subject: String(form.get("subject") ?? "").trim(),
    message: String(form.get("message") ?? "").trim(),
    replyEmail: String(form.get("replyEmail") ?? "").trim(),
    urgency: String(form.get("urgency") ?? ""),
  };

  // Re-validate server-side: the client check is a courtesy, not a guarantee.
  const fieldErrors = validateSupportForm(values);
  if (hasErrors(fieldErrors)) return { ok: false, fieldErrors };
  if (!isRequestType(values.type)) return { ok: false, fieldErrors: { type: "Choose what this is about." } };

  const rate = await checkRateLimit(shopId, values.message);
  if (!rate.ok) return { ok: false, error: rate.error };

  const plan = await getPlan(shopId);

  // Diagnostics are opt-in. When off, nothing technical is attached at all.
  let diagnostics = null;
  if (form.get("includeDiagnostics") === "true") {
    diagnostics = await collectDiagnostics(shopId, plan);
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(form.get("clientDiagnostics") ?? "null"));
    } catch {
      parsed = null;
    }
    diagnostics.client = sanitiseClientDiagnostics(parsed);
  }

  const created = await createSupportRequest({
    shopId,
    type: values.type,
    area: values.area || null,
    subject: values.subject,
    message: values.message,
    replyEmail: values.replyEmail,
    // Urgency is only meaningful for a bug report; don't store noise otherwise.
    urgency: values.type === "bug" && isUrgency(values.urgency) ? values.urgency : null,
    staffEmail: await resolveShopEmail(shopId),
    plan,
    diagnostics,
  });

  return { ok: true, id: created.id };
};

// ---------------------------------------------------------------------------

const INDIGO = "#6366F1";
const NAVY = "#0A0F1E";

/**
 * Selectable tile for the request type.
 *
 * Built on a real `<input type="radio">` inside a `<label>` so arrow-key
 * navigation, screen readers and form semantics all work for free. The input is
 * visually hidden, which means the tile has to render the focus ring itself —
 * otherwise keyboard users get no indication of where they are.
 */
function TypeTile({
  option,
  selected,
  onSelect,
}: {
  option: (typeof REQUEST_TYPES)[number];
  selected: boolean;
  onSelect: (id: RequestType) => void;
}) {
  const [focused, setFocused] = useState(false);

  const ring = focused
    ? "0 0 0 3px rgba(99,102,241,0.35)"
    : selected
      ? "0 0 0 3px rgba(99,102,241,0.12)"
      : "none";

  return (
    <label
      style={{
        display: "block",
        // Contains the absolutely-positioned input so it can't affect layout.
        position: "relative",
        cursor: "pointer",
        padding: "14px 16px",
        borderRadius: "10px",
        border: `1.5px solid ${selected || focused ? INDIGO : "#E3E3E8"}`,
        background: selected ? "rgba(99,102,241,0.06)" : "#FFFFFF",
        boxShadow: ring,
        transition: "all 0.15s ease",
      }}
    >
      <input
        type="radio"
        name="support-type"
        value={option.id}
        checked={selected}
        onChange={() => onSelect(option.id)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          position: "absolute",
          opacity: 0,
          width: "1px",
          height: "1px",
          pointerEvents: "none",
        }}
      />
      <BlockStack gap="050">
        <InlineStack gap="150" blockAlign="center" wrap={false}>
          <span
            aria-hidden="true"
            style={{
              width: "16px",
              height: "16px",
              minWidth: "16px",
              borderRadius: "50%",
              border: `1.5px solid ${selected ? INDIGO : "#C9C9CF"}`,
              background: selected ? INDIGO : "#FFFFFF",
              boxShadow: selected ? "inset 0 0 0 3px #FFFFFF" : "none",
            }}
          />
          <Text as="span" variant="bodyMd" fontWeight={selected ? "semibold" : "medium"}>
            {option.label}
          </Text>
        </InlineStack>
        <div style={{ paddingLeft: "28px" }}>
          <Text as="span" variant="bodySm" tone="subdued">
            {option.helpText}
          </Text>
        </div>
      </BlockStack>
    </label>
  );
}

/** Client-side half of the diagnostics, gathered after mount (SSR-safe). */
function useClientDiagnostics(): Record<string, string> {
  const [info, setInfo] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      language: navigator.language,
    };
    if (window.screen) next.screen = `${window.screen.width}×${window.screen.height}`;
    try {
      next.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      // Not worth failing the form over.
    }
    setInfo(next);
  }, []);

  return info;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "closed") return <Badge tone="success">Answered</Badge>;
  if (status === "open") return <Badge tone="info">In progress</Badge>;
  return <Badge tone="attention">Received</Badge>;
}

function HistoryCard({ history }: { history: SupportRequestSummary[] }) {
  const COLUMNS = "1fr 150px 130px 120px";

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd" fontWeight="semibold">
            Your recent requests
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Everything this store has sent us. Replies arrive by email.
          </Text>
        </BlockStack>

        <div style={{ border: "1px solid #ECECF1", borderRadius: "10px", overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLUMNS,
              gap: "16px",
              padding: "10px 20px",
              background: NAVY,
            }}
          >
            {["Subject", "Type", "Sent", "Status"].map((h) => (
              <Text key={h} as="span" variant="bodySm" fontWeight="semibold" tone="text-inverse">
                {h}
              </Text>
            ))}
          </div>
          {history.map((r, idx) => (
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: COLUMNS,
                gap: "16px",
                padding: "12px 20px",
                alignItems: "center",
                background: idx % 2 === 0 ? "#FFFFFF" : "#FAFAFB",
                borderBottom: idx === history.length - 1 ? "none" : "1px solid #F3F4F6",
              }}
            >
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" fontWeight="medium">
                  {r.subject}
                </Text>
                {r.area && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {r.area}
                  </Text>
                )}
              </BlockStack>
              <Text as="span" variant="bodySm" tone="subdued">
                {requestTypeLabel(r.type)}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {new Date(r.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </Text>
              <div>
                <StatusBadge status={r.status} />
              </div>
            </div>
          ))}
        </div>
      </BlockStack>
    </Card>
  );
}

export default function SupportPage() {
  const { shopId, plan, prefill, history, publicContactEmail } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  const [type, setType] = useState<string>(prefill.type);
  const [area, setArea] = useState(prefill.area);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState(prefill.email);
  const [urgency, setUrgency] = useState("normal");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [errors, setErrors] = useState<SupportFormErrors>({});
  const [sentId, setSentId] = useState<string | null>(null);

  const clientInfo = useClientDiagnostics();
  const submitting = fetcher.state !== "idle";

  const selectedType = useMemo(
    () => REQUEST_TYPES.find((t) => t.id === type),
    [type],
  );

  // Server-side validation and rate-limit rejections come back here.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;
    if (d.ok) {
      setSentId(d.id);
      setSubject("");
      setMessage("");
      setErrors({});
      shopify.toast.show("Thanks — we've got it");
      return;
    }
    if (d.fieldErrors) setErrors(d.fieldErrors);
    if (d.error) shopify.toast.show(d.error, { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const submit = () => {
    const values = { type, area, subject, message, replyEmail, urgency };
    const found = validateSupportForm(values);
    setErrors(found);
    if (hasErrors(found)) {
      shopify.toast.show("Check the highlighted fields", { isError: true });
      return;
    }
    fetcher.submit(
      {
        ...values,
        includeDiagnostics: String(includeDiagnostics),
        clientDiagnostics: JSON.stringify(clientInfo),
      },
      { method: "post" },
    );
  };

  // Clear a field's error as soon as the merchant starts fixing it.
  const clearError = (field: keyof SupportFormErrors) =>
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const diagnosticsPreview = [
    ["Store", shopId],
    ["Plan", plan],
    ...Object.entries(clientInfo),
  ] as Array<[string, string]>;

  return (
    <Page>
      <BlockStack gap="500">
        <div style={{ paddingTop: "8px" }}>
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl" fontWeight="bold">
              Help &amp; feedback
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Questions, bug reports, and ideas all reach us here — we read every one.
            </Text>
          </BlockStack>
        </div>

        {sentId && (
          <Banner
            tone="success"
            title="Your message is with us"
            onDismiss={() => setSentId(null)}
          >
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                We usually reply within 1–2 business days, to{" "}
                <Text as="span" fontWeight="semibold">
                  {replyEmail}
                </Text>
                . Your reference is{" "}
                <Text as="span" fontWeight="semibold">
                  {sentId.slice(-8)}
                </Text>
                .
              </Text>
              <div>
                <Button size="slim" onClick={() => setSentId(null)}>
                  Send another
                </Button>
              </div>
            </BlockStack>
          </Banner>
        )}

        <Card>
          <BlockStack gap="500">
            {/* 1 — What kind of request */}
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd" fontWeight="semibold">
                  What can we help with?
                </Text>
                {errors.type && (
                  <Text as="p" variant="bodySm" tone="critical">
                    {errors.type}
                  </Text>
                )}
              </BlockStack>
              <div
                role="radiogroup"
                aria-label="What can we help with?"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "10px",
                }}
              >
                {REQUEST_TYPES.map((option) => (
                  <TypeTile
                    key={option.id}
                    option={option}
                    selected={type === option.id}
                    onSelect={(id) => {
                      setType(id);
                      clearError("type");
                    }}
                  />
                ))}
              </div>
            </BlockStack>

            <Divider />

            {/* 2 — The request itself */}
            <BlockStack gap="400">
              <InlineStack gap="400" wrap={false} align="start" blockAlign="start">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Select
                    label="Which part of MetaVault?"
                    helpText="Optional — helps us route it faster."
                    options={[
                      { label: "Not sure / not specific", value: "" },
                      ...AREAS.map((a) => ({ label: a, value: a })),
                    ]}
                    value={area}
                    onChange={setArea}
                  />
                </div>
                {type === "bug" && (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Select
                      label="How urgent is it?"
                      options={URGENCIES.map((u) => ({ label: u.label, value: u.id }))}
                      value={urgency}
                      onChange={setUrgency}
                      error={errors.urgency}
                    />
                  </div>
                )}
              </InlineStack>

              <TextField
                label="Subject"
                value={subject}
                onChange={(v) => {
                  setSubject(v);
                  clearError("subject");
                }}
                maxLength={SUBJECT_MAX}
                placeholder="One line — what is this about?"
                error={errors.subject}
                autoComplete="off"
              />

              <TextField
                label="Details"
                value={message}
                onChange={(v) => {
                  setMessage(v);
                  clearError("message");
                }}
                multiline={6}
                maxLength={MESSAGE_MAX}
                showCharacterCount
                placeholder={
                  selectedType?.messagePlaceholder ??
                  "Tell us what's going on — the more specific, the better."
                }
                helpText={
                  type === "bug"
                    ? "Exact steps, the store page you were on, and what you expected are the three most useful things."
                    : undefined
                }
                error={errors.message}
                autoComplete="off"
              />

              <div style={{ maxWidth: "380px" }}>
                <TextField
                  label="Reply to"
                  type="email"
                  value={replyEmail}
                  onChange={(v) => {
                    setReplyEmail(v);
                    clearError("replyEmail");
                  }}
                  helpText="Where we send our answer."
                  error={errors.replyEmail}
                  autoComplete="email"
                />
              </div>
            </BlockStack>

            <Divider />

            {/* 3 — Diagnostics, opt-out, fully disclosed */}
            <BlockStack gap="200">
              <Checkbox
                label="Include technical details"
                helpText="Your store address, plan, app version, browser, and the status of your last few jobs. No customer, order, or product data."
                checked={includeDiagnostics}
                onChange={setIncludeDiagnostics}
              />
              {includeDiagnostics && (
                <BlockStack gap="200">
                  <div>
                    <Button
                      variant="plain"
                      onClick={() => setDiagnosticsOpen((o) => !o)}
                      ariaExpanded={diagnosticsOpen}
                      ariaControls="support-diagnostics"
                    >
                      {diagnosticsOpen ? "Hide what's included" : "See exactly what's included"}
                    </Button>
                  </div>
                  <Collapsible
                    open={diagnosticsOpen}
                    id="support-diagnostics"
                    transition={{ duration: "150ms" }}
                  >
                    <div
                      style={{
                        background: "#F8F9FF",
                        border: "1px solid #E7E7F3",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: "12px",
                        lineHeight: 1.8,
                        color: "#4A5060",
                        wordBreak: "break-word",
                      }}
                    >
                      {diagnosticsPreview.map(([k, v]) => (
                        <div key={k}>
                          <span style={{ color: "#8A8FA0" }}>{k}: </span>
                          {v}
                        </div>
                      ))}
                      <div>
                        <span style={{ color: "#8A8FA0" }}>recent jobs: </span>
                        status and timing of your last 5 imports, exports, and backups
                      </div>
                    </div>
                  </Collapsible>
                </BlockStack>
              )}
            </BlockStack>

            <Divider />

            <InlineStack align="space-between" blockAlign="center" gap="400">
              <Text as="p" variant="bodySm" tone="subdued">
                We usually reply within 1–2 business days.
              </Text>
              <Button variant="primary" onClick={submit} loading={submitting}>
                Send message
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {history.length > 0 && <HistoryCard history={history} />}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd" fontWeight="semibold">
              Other ways to reach us
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Prefer your own inbox? Email{" "}
              <PolarisLink
                url={`mailto:${publicContactEmail}?subject=MetaVault%20—%20${encodeURIComponent(shopId)}`}
              >
                {publicContactEmail}
              </PolarisLink>{" "}
              and mention your store address ({shopId}) so we can find your account.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

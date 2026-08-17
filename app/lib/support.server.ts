/**
 * Support requests: persistence, abuse guard, and the notification to the app
 * owner.
 *
 * The ordering here is the whole design. The row is committed FIRST and the
 * email is attempted second, because mail is the unreliable half: Resend's
 * sandbox sender only delivers to the Resend account owner, and any provider
 * can 500. A merchant who writes up a bug must never lose it to that. The
 * delivery outcome is written back onto the row (`emailedAt` / `emailError`) so
 * a failure is discoverable instead of silent — the mistake job notifications
 * make deliberately and support requests cannot afford.
 */

import prisma from "../db.server";
import { sendEmail } from "./notify.server";
import {
  BORDER,
  CANVAS,
  FONT,
  INDIGO,
  INK,
  MONO,
  MUTED,
  emailShell,
  escapeHtml,
} from "./email-template.server";
import {
  DUPLICATE_WINDOW_MINUTES,
  RATE_LIMIT_PER_HOUR,
  requestTypeLabel,
  urgencyLabel,
  type RequestType,
  type Urgency,
} from "./support";
import { APP_VERSION } from "./version";
import type { Plan } from "./plans";
import { publicContactEmail } from "./contact.server";

/**
 * Where support mail is routed. PRIVATE — this is very likely a personal
 * address, so it must never be rendered into a merchant-facing page or returned
 * from a loader. The public contact address merchants see is APP_CONTACT_EMAIL.
 *
 * With Resend's sandbox sender this MUST be the Resend account owner's address,
 * or every send is rejected 403 and only lands in `emailError`.
 */
function supportInbox(): string {
  return process.env.SUPPORT_TO_EMAIL ?? publicContactEmail();
}

// ---------------------------------------------------------------------------
// Diagnostics

/** A recent job, summarised. Metadata only — never row contents. */
export type JobSummary = {
  kind: "import" | "export" | "backup";
  id: string;
  type?: string | null;
  status: string;
  createdAt: string;
};

export type Diagnostics = {
  shop: string;
  plan: string;
  appVersion: string;
  submittedAt: string;
  recentJobs: JobSummary[];
  /** Gathered in the browser: user agent, screen size, timezone. Untrusted. */
  client?: Record<string, string>;
};

/** How many recent jobs to attach — enough for context, short enough to read. */
const RECENT_JOB_LIMIT = 5;

/**
 * Technical context for a bug report, assembled server-side.
 *
 * Deliberately contains no customer, order, or metafield *values* — only job
 * metadata. The app holds protected customer data, and a support inbox is not
 * the place for it.
 */
export async function collectDiagnostics(
  shopId: string,
  plan: Plan,
): Promise<Diagnostics> {
  const [imports, exports, backups] = await Promise.all([
    prisma.importJob.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOB_LIMIT,
      select: { id: true, type: true, status: true, createdAt: true },
    }),
    prisma.exportJob.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOB_LIMIT,
      select: { id: true, type: true, status: true, createdAt: true },
    }),
    prisma.backupJob.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOB_LIMIT,
      select: { id: true, status: true, createdAt: true },
    }),
  ]);

  const recentJobs: JobSummary[] = [
    ...imports.map((j) => ({
      kind: "import" as const,
      id: j.id,
      type: j.type,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
    })),
    ...exports.map((j) => ({
      kind: "export" as const,
      id: j.id,
      type: j.type,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
    })),
    ...backups.map((j) => ({
      kind: "backup" as const,
      id: j.id,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_JOB_LIMIT);

  return {
    shop: shopId,
    plan,
    appVersion: APP_VERSION,
    submittedAt: new Date().toISOString(),
    recentJobs,
  };
}

/** Longest client-reported value we keep, so a crafted form can't bloat a row. */
const CLIENT_VALUE_MAX = 200;
const CLIENT_KEYS = ["userAgent", "screen", "viewport", "timezone", "language"] as const;

/**
 * Sanitise the browser-side half of the diagnostics. It arrives in the form
 * body, so it is merchant-controlled input: keep only known keys, as strings,
 * truncated.
 */
export function sanitiseClientDiagnostics(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of CLIENT_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim().slice(0, CLIENT_VALUE_MAX);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** The store owner's email, used to prefill the reply-to field. */
export async function resolveShopEmail(shopId: string): Promise<string | null> {
  const session = await prisma.session.findFirst({
    where: { shop: shopId, email: { not: null } },
    orderBy: { expires: "desc" },
    select: { email: true },
  });
  return session?.email ?? null;
}

// ---------------------------------------------------------------------------
// Abuse guard

export type RateLimitVerdict =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Keep one shop from flooding the inbox. The route is already authenticated per
 * shop, so this is about accidents and impatience (a merchant hitting Send
 * repeatedly because nothing looked like it happened) more than attack.
 */
export async function checkRateLimit(
  shopId: string,
  message: string,
): Promise<RateLimitVerdict> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.supportRequest.count({
    where: { shopId, createdAt: { gte: hourAgo } },
  });
  if (recent >= RATE_LIMIT_PER_HOUR) {
    return {
      ok: false,
      error:
        `You've sent ${RATE_LIMIT_PER_HOUR} requests in the past hour, which is the limit. ` +
        `Everything already sent is with us — try again a little later, or email us directly.`,
    };
  }

  const dupeWindow = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000);
  const duplicate = await prisma.supportRequest.findFirst({
    where: { shopId, message: message.trim(), createdAt: { gte: dupeWindow } },
    select: { id: true },
  });
  if (duplicate) {
    return {
      ok: false,
      error: "We already have this one — it was received a moment ago.",
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Email to the app owner

export type SupportEmailInput = {
  id: string;
  shopId: string;
  type: RequestType;
  area?: string | null;
  subject: string;
  message: string;
  replyEmail: string;
  urgency?: Urgency | null;
  staffEmail?: string | null;
  plan: string;
  diagnostics?: Diagnostics | null;
};

function metaRows(input: SupportEmailInput): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Type", requestTypeLabel(input.type)],
    ["Store", input.shopId],
    ["Plan", input.plan],
  ];
  if (input.area) rows.push(["Area", input.area]);
  if (input.urgency) rows.push(["Urgency", urgencyLabel(input.urgency)]);
  rows.push(["Reply to", input.replyEmail]);
  if (input.staffEmail && input.staffEmail !== input.replyEmail) {
    rows.push(["Store owner", input.staffEmail]);
  }
  rows.push(["Request", input.id]);
  return rows;
}

export function buildSupportSubject(input: SupportEmailInput): string {
  const urgent = input.urgency === "blocking" ? "[BLOCKING] " : "";
  return `${urgent}[MetaVault ${requestTypeLabel(input.type)}] ${input.subject}`;
}

export function buildSupportText(input: SupportEmailInput): string {
  const lines = [`${requestTypeLabel(input.type)}: ${input.subject}`, ""];
  for (const [label, value] of metaRows(input)) lines.push(`${label}: ${value}`);
  lines.push("", "---", input.message, "---", "");

  const jobs = input.diagnostics?.recentJobs ?? [];
  if (input.diagnostics) {
    lines.push(
      `App version: ${input.diagnostics.appVersion}`,
      ...Object.entries(input.diagnostics.client ?? {}).map(([k, v]) => `${k}: ${v}`),
    );
    if (jobs.length) {
      lines.push("", "Recent jobs:");
      for (const j of jobs) {
        lines.push(
          `  ${j.createdAt} ${j.kind}${j.type ? `/${j.type}` : ""} ${j.status} (${j.id})`,
        );
      }
    }
  } else {
    lines.push("(The merchant chose not to include diagnostic details.)");
  }

  lines.push("", `Reply to this email to answer ${input.replyEmail} directly.`);
  return lines.join("\n");
}

export function buildSupportHtml(input: SupportEmailInput): string {
  const accent = input.urgency === "blocking" ? "#EF4444" : INDIGO;

  const meta = metaRows(input)
    .map(
      ([label, value]) => `
              <tr>
                <td style="padding:7px 0;border-bottom:1px solid ${BORDER};font:13px ${FONT};color:${MUTED};white-space:nowrap;">${escapeHtml(
                  label,
                )}</td>
                <td align="right" style="padding:7px 0;border-bottom:1px solid ${BORDER};font:600 13px ${FONT};color:${INK};word-break:break-word;">${escapeHtml(
                  value,
                )}</td>
              </tr>`,
    )
    .join("");

  // The merchant's own words, escaped, with newlines preserved.
  const body = escapeHtml(input.message).replace(/\r?\n/g, "<br>");

  const jobs = input.diagnostics?.recentJobs ?? [];
  // Escape each line, then join with real <br> tags — never escape the markup.
  const jobLines = jobs
    .map((j) =>
      escapeHtml(
        `${j.createdAt.replace("T", " ").slice(0, 19)} · ${j.kind}${
          j.type ? `/${j.type}` : ""
        } · ${j.status} · ${j.id}`,
      ),
    )
    .join("<br>");

  const clientLines = Object.entries(input.diagnostics?.client ?? {})
    .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`)
    .join("<br>");

  const diagnosticsBlock = input.diagnostics
    ? `<p style="margin:0 0 8px;font:600 13px ${FONT};color:${INK};">Diagnostics</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
              <tr>
                <td style="padding:12px 14px;background:${CANVAS};border:1px solid ${BORDER};border-radius:8px;font:12px/1.7 ${MONO};color:${MUTED};word-break:break-word;">
                  app ${escapeHtml(input.diagnostics.appVersion)}${
                    clientLines ? `<br>${clientLines}` : ""
                  }${jobLines ? `<br><br>recent jobs<br>${jobLines}` : ""}
                </td>
              </tr>
            </table>`
    : `<p style="margin:0;font:13px ${FONT};color:${MUTED};">The merchant chose not to include diagnostic details.</p>`;

  return emailShell({
    subject: buildSupportSubject(input),
    preheader: `${input.shopId} — ${input.subject}`,
    accent,
    content: `<p style="margin:0 0 6px;font:600 12px ${FONT};color:${accent};letter-spacing:0.6px;text-transform:uppercase;">${escapeHtml(
      requestTypeLabel(input.type),
    )}</p>
            <h1 style="margin:0 0 20px;font:600 21px ${FONT};color:${INK};letter-spacing:-0.3px;">${escapeHtml(
              input.subject,
            )}</h1>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${meta}</table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="padding:16px 18px;background:#FFFFFF;border-left:3px solid ${accent};border-radius:6px;font:15px/1.7 ${FONT};color:${INK};word-break:break-word;">${body}</td>
              </tr>
            </table>
            ${diagnosticsBlock}`,
    footer: `<p style="margin:0;font:13px/1.5 ${FONT};color:${MUTED};">
              Sent from MetaVault → Help &amp; feedback. Reply to this email to answer
              ${escapeHtml(input.replyEmail)} directly.
            </p>`,
  });
}

/**
 * Notify the app owner. Throws on a provider rejection, and reports
 * `{ sent: false }` when no provider is configured — the caller records both,
 * because "logged to stdout" is not "delivered".
 */
async function sendSupportEmail(input: SupportEmailInput): Promise<{ sent: boolean }> {
  return sendEmail({
    to: supportInbox(),
    subject: buildSupportSubject(input),
    body: buildSupportText(input),
    html: buildSupportHtml(input),
    // Replying in a mail client answers the merchant, not ourselves.
    replyTo: input.replyEmail,
  });
}

// ---------------------------------------------------------------------------
// Create

export type CreateSupportRequestInput = {
  shopId: string;
  type: RequestType;
  area?: string | null;
  subject: string;
  message: string;
  replyEmail: string;
  urgency?: Urgency | null;
  staffEmail?: string | null;
  plan: Plan;
  diagnostics?: Diagnostics | null;
};

export type CreatedSupportRequest = {
  id: string;
  createdAt: Date;
  /** False when the row was saved but the owner's email didn't go out. */
  emailed: boolean;
};

export async function createSupportRequest(
  input: CreateSupportRequestInput,
): Promise<CreatedSupportRequest> {
  // 1. Persist. From here on the submission exists no matter what mail does.
  const row = await prisma.supportRequest.create({
    data: {
      shopId: input.shopId,
      type: input.type,
      area: input.area || null,
      subject: input.subject,
      message: input.message,
      replyEmail: input.replyEmail,
      urgency: input.urgency ?? null,
      staffEmail: input.staffEmail ?? null,
      plan: input.plan,
      diagnostics: input.diagnostics ?? undefined,
    },
    select: { id: true, createdAt: true },
  });

  // 2. Notify, and record whether that worked.
  let emailed = false;
  let emailError: string | null = null;
  try {
    const { sent } = await sendSupportEmail({ ...input, id: row.id });
    emailed = sent;
    if (!sent) {
      emailError = "No email provider configured — payload logged only.";
      // eslint-disable-next-line no-console
      console.warn(`[metavault] support request ${row.id} stored but not emailed`);
    }
  } catch (err) {
    emailError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    // eslint-disable-next-line no-console
    console.warn(`[metavault] support email failed for ${row.id}: ${emailError}`);
  }

  await prisma.supportRequest
    .update({
      where: { id: row.id },
      data: { emailedAt: emailed ? new Date() : null, emailError },
    })
    // The row and the notification both already happened; failing to stamp the
    // outcome must not turn a received request into an error for the merchant.
    .catch(() => undefined);

  return { id: row.id, createdAt: row.createdAt, emailed };
}

// ---------------------------------------------------------------------------
// Read (merchant's own history)

export type SupportRequestSummary = {
  id: string;
  type: string;
  area: string | null;
  subject: string;
  status: string;
  createdAt: string;
};

/** How many past requests the merchant sees on the page. */
const HISTORY_LIMIT = 10;

export async function listShopRequests(shopId: string): Promise<SupportRequestSummary[]> {
  const rows = await prisma.supportRequest.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      type: true,
      area: true,
      subject: true,
      status: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/**
 * Job completion notifications.
 *
 * No email provider is wired yet — this builds the exact payload that will be
 * handed to one and logs it, so the trigger points, opt-out and copy are all in
 * place. Swapping in a provider means implementing `deliver` only.
 *
 * Recipients: the shop's notifyEmail override, else the shop owner's email from
 * the most recent session. Delivery is best-effort — a notification failure
 * must never fail the job that produced it.
 */

import prisma from "../db.server";
import { getDownloadUrl } from "./r2.server";
import { buildHtml, buildSubject, buildText, type Stat } from "./email-template.server";

export type NotifiableJob = "import" | "export" | "backup" | "restore";

/** How long a signed download link in an email stays valid. */
const LINK_VALID_DAYS = 7;

export type JobNotification = {
  shopId: string;
  type: NotifiableJob;
  status: "completed" | "failed";
  /** Storage key of the produced file; turned into a signed download link. */
  fileKey?: string | null;
  /**
   * What `fileKey` points at. An import's file is a report of REJECTED rows,
   * not the import result — labelling it "Download" told merchants the wrong
   * thing entirely.
   */
  fileRole?: "result" | "errorReport";
  /** Figures worth stating outright, e.g. rows written vs rejected. */
  stats?: Stat[];
  error?: string;
};

export type EmailPayload = {
  to: string;
  subject: string;
  /** Plain-text part — some clients prefer it and filters expect it. */
  body: string;
  html: string;
  /** Where a reply should go, when that differs from the sending address. */
  replyTo?: string;
};

async function resolveRecipient(shopId: string): Promise<string | null> {
  const settings = await prisma.shopSettings.findUnique({ where: { shopId } });
  if (settings && settings.emailNotifications === false) return null;
  if (settings?.notifyEmail) return settings.notifyEmail;

  const session = await prisma.session.findFirst({
    where: { shop: shopId, email: { not: null } },
    orderBy: { expires: "desc" },
    select: { email: true },
  });
  return session?.email ?? null;
}

export function buildEmail(
  to: string,
  {
    type,
    status,
    error,
    stats,
    fileRole,
  }: Pick<JobNotification, "type" | "status" | "error" | "stats" | "fileRole">,
  downloadUrl: string | null,
): EmailPayload {
  const input = {
    type,
    status,
    error,
    stats,
    fileRole,
    downloadUrl,
    linkValidForDays: downloadUrl ? LINK_VALID_DAYS : undefined,
  };

  return {
    to,
    subject: buildSubject(input),
    body: buildText(input),
    html: buildHtml(input),
  };
}

/**
 * Send the email through Resend when configured, else log it.
 *
 * Real delivery turns on the moment RESEND_API_KEY + RESEND_FROM are set (a
 * verified sender domain in Resend), with no code change. Without them, we log
 * the payload so nothing breaks in dev or before the provider is set up.
 *
 * Throws on a provider rejection. Job notifications swallow that (a
 * notification must never fail the job); support requests record it instead —
 * see `sendSupportEmail` in support.server.ts.
 *
 * Resolves `{ sent: false }` when there is no provider configured and the
 * payload was only logged. Callers that record delivery must not treat that as
 * a send, or the record claims a message went out when it never did.
 */
export async function sendEmail(payload: EmailPayload): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  // e.g. "MetaVault <notifications@yourdomain.com>" — must be a verified domain.
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    // eslint-disable-next-line no-console
    console.log("[metavault][email] (not sent — Resend unconfigured)", JSON.stringify(payload));
    return { sent: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
      html: payload.html,
      ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }

  return { sent: true };
}

export async function notifyJobFinished(notification: JobNotification): Promise<void> {
  try {
    const to = await resolveRecipient(notification.shopId);
    if (!to) return;

    const downloadUrl = notification.fileKey
      ? await getDownloadUrl(notification.fileKey, LINK_VALID_DAYS * 24 * 3600)
      : null;

    await sendEmail(buildEmail(to, notification, downloadUrl));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[metavault] notification failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

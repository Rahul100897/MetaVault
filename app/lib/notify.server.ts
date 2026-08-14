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

export type NotifiableJob = "import" | "export" | "backup" | "restore";

export type JobNotification = {
  shopId: string;
  type: NotifiableJob;
  status: "completed" | "failed";
  /** Storage key of the produced file; turned into a signed download link. */
  fileKey?: string | null;
  error?: string;
};

export type EmailPayload = {
  to: string;
  subject: string;
  body: string;
};

const LABEL: Record<NotifiableJob, string> = {
  import: "import",
  export: "export",
  backup: "backup",
  restore: "restore",
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
  { type, status, error }: Pick<JobNotification, "type" | "status" | "error">,
  downloadUrl: string | null,
): EmailPayload {
  const label = LABEL[type];
  if (status === "failed") {
    return {
      to,
      subject: `Your MetaVault ${label} failed`,
      body: `Your ${label} failed. Error: ${error ?? "unknown error"}.`,
    };
  }
  return {
    to,
    subject: `Your MetaVault ${label} is ready`,
    body: downloadUrl
      ? `Your ${label} is ready. ${downloadUrl}`
      : `Your ${label} is ready.`,
  };
}

/**
 * Send the email through Resend when configured, else log it.
 *
 * Real delivery turns on the moment RESEND_API_KEY + RESEND_FROM are set (a
 * verified sender domain in Resend), with no code change. Without them, we log
 * the payload so nothing breaks in dev or before the provider is set up.
 */
async function deliver(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  // e.g. "MetaVault <notifications@yourdomain.com>" — must be a verified domain.
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    // eslint-disable-next-line no-console
    console.log("[metavault][email] (not sent — Resend unconfigured)", JSON.stringify(payload));
    return;
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
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}

export async function notifyJobFinished(notification: JobNotification): Promise<void> {
  try {
    const to = await resolveRecipient(notification.shopId);
    if (!to) return;

    const downloadUrl = notification.fileKey
      ? await getDownloadUrl(notification.fileKey, 7 * 24 * 3600)
      : null;

    await deliver(buildEmail(to, notification, downloadUrl));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[metavault] notification failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

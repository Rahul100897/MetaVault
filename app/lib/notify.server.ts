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

/** Hand the payload to the email provider. Console-only until one is wired. */
async function deliver(payload: EmailPayload): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[metavault][email]", JSON.stringify(payload));
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

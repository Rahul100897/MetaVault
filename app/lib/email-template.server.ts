/**
 * HTML email templates for job notifications.
 *
 * Email clients are not browsers: no external stylesheets, no flexbox/grid, no
 * web fonts, and images are blocked by default. So this is table-based layout
 * with inline styles only, and the MetaVault mark is drawn with text rather
 * than an image so it always renders.
 *
 * Every template ships a plain-text twin. Some clients prefer text, spam
 * filters penalise HTML-only mail, and the text version is what shows in
 * notification previews.
 */

import type { NotifiableJob } from "./notify.server";

const NAVY = "#0A0F1E";
const INDIGO = "#6366F1";
const INK = "#1F2430";
const MUTED = "#6B7280";
const BORDER = "#E5E7EB";
const CANVAS = "#F6F6F8";

export type Stat = { label: string; value: string };

export type TemplateInput = {
  type: NotifiableJob;
  status: "completed" | "failed";
  /** Rendered as a small figures table under the intro. */
  stats?: Stat[];
  /** Signed link; omitted when the job produced nothing to download. */
  downloadUrl?: string | null;
  /** What the link actually points at — an import's file is an error report. */
  fileRole?: "result" | "errorReport";
  error?: string;
  /** How long the signed link stays valid, for the caption under the button. */
  linkValidForDays?: number;
};

const NOUN: Record<NotifiableJob, string> = {
  import: "import",
  export: "export",
  backup: "backup",
  restore: "restore",
};

/** Headline, intro line, and button label per job type and outcome. */
function copyFor(input: TemplateInput): {
  heading: string;
  intro: string;
  cta: string | null;
} {
  const noun = NOUN[input.type];

  if (input.status === "failed") {
    return {
      heading: `Your ${noun} didn't finish`,
      intro:
        `Something went wrong partway through and no further changes were made. ` +
        `The details below should say why; if it's not clear, reply to this email.`,
      cta: null,
    };
  }

  if (input.type === "import") {
    const isErrorReport = input.fileRole === "errorReport" && input.downloadUrl;
    return {
      heading: isErrorReport ? "Your import finished with some errors" : "Your import finished",
      intro: isErrorReport
        ? "The valid rows were written to your store. Some rows were rejected — the report lists each one with the reason."
        : "Every row was written to your store.",
      cta: isErrorReport ? "Download error report" : null,
    };
  }

  if (input.type === "export") {
    return {
      heading: "Your export is ready",
      intro: "Your metafields have been collected into a CSV, ready to open in a spreadsheet.",
      cta: "Download CSV",
    };
  }

  if (input.type === "backup") {
    return {
      heading: "Your backup is ready",
      intro:
        "A snapshot of every metafield and metaobject in your store has been saved. " +
        "You can restore from it at any point while it's retained.",
      cta: "Download snapshot",
    };
  }

  return {
    heading: "Your restore finished",
    intro: "The snapshot has been applied to your store.",
    cta: null,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSubject(input: TemplateInput): string {
  const noun = NOUN[input.type];
  if (input.status === "failed") return `Your MetaVault ${noun} didn't finish`;
  if (input.type === "import" && input.fileRole === "errorReport" && input.downloadUrl) {
    return "Your MetaVault import finished with some errors";
  }
  if (input.type === "import") return "Your MetaVault import finished";
  if (input.type === "restore") return "Your MetaVault restore finished";
  return `Your MetaVault ${noun} is ready`;
}

export function buildText(input: TemplateInput): string {
  const { heading, intro } = copyFor(input);
  const lines = [heading, "", intro, ""];

  for (const s of input.stats ?? []) lines.push(`${s.label}: ${s.value}`);
  if (input.stats?.length) lines.push("");

  if (input.status === "failed" && input.error) {
    lines.push(`Error: ${input.error}`, "");
  }

  if (input.downloadUrl) {
    const label = input.fileRole === "errorReport" ? "Error report" : "Download";
    lines.push(`${label}: ${input.downloadUrl}`);
    if (input.linkValidForDays) {
      lines.push(`This link works for ${input.linkValidForDays} days.`);
    }
    lines.push("");
  }

  lines.push(
    "— MetaVault",
    "You're getting this because job notifications are on for your store.",
    "Turn them off in MetaVault → Settings → Email notifications.",
  );

  return lines.join("\n");
}

export function buildHtml(input: TemplateInput): string {
  const { heading, intro, cta } = copyFor(input);
  const accent = input.status === "failed" ? "#EF4444" : INDIGO;

  const statsRows = (input.stats ?? [])
    .map(
      (s) => `
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid ${BORDER};font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(s.label)}</td>
                <td align="right" style="padding:8px 0;border-bottom:1px solid ${BORDER};font:600 14px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(s.value)}</td>
              </tr>`,
    )
    .join("");

  const statsTable = statsRows
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${statsRows}</table>`
    : "";

  const errorBlock =
    input.status === "failed" && input.error
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="padding:14px 16px;background:#FEF2F2;border-left:3px solid #EF4444;border-radius:6px;font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#991B1B;word-break:break-word;">${escapeHtml(
                  input.error,
                )}</td>
              </tr>
            </table>`
      : "";

  const button =
    cta && input.downloadUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
              <tr>
                <td style="border-radius:8px;background:${INDIGO};">
                  <a href="${escapeHtml(input.downloadUrl)}" style="display:inline-block;padding:12px 24px;font:600 15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtml(
                    cta,
                  )}</a>
                </td>
              </tr>
            </table>
            ${
              input.linkValidForDays
                ? `<p style="margin:0 0 8px;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">This link works for ${input.linkValidForDays} days.</p>`
                : ""
            }`
      : "";

  // Preheader: the grey line clients show next to the subject.
  const preheader = escapeHtml(intro.slice(0, 110));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(buildSubject(input))}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;font-size:1px;color:${CANVAS};max-height:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,46,0.08);">
        <tr>
          <td style="padding:20px 32px;background:${NAVY};">
            <span style="font:600 17px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#FFFFFF;letter-spacing:-0.2px;">
              <span style="color:${INDIGO};">◆</span>&nbsp;MetaVault
            </span>
          </td>
        </tr>
        <tr>
          <td style="height:3px;background:${accent};font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 12px;font:600 21px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};letter-spacing:-0.3px;">${escapeHtml(
              heading,
            )}</h1>
            <p style="margin:0 0 24px;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(
              intro,
            )}</p>
            ${statsTable}
            ${errorBlock}
            ${button}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#FAFAFB;border-top:1px solid ${BORDER};">
            <p style="margin:0 0 6px;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
              You're getting this because job notifications are on for your store.
            </p>
            <p style="margin:0;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
              Turn them off in MetaVault → Settings → Email notifications.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

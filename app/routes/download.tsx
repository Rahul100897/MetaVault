import type { LoaderFunctionArgs } from "@remix-run/node";
import { getFileContent, verifyDownloadToken } from "../lib/r2.server";

/**
 * Public resource route that serves locally-stored files via an HMAC-signed,
 * time-limited token (the local-storage stand-in for R2 presigned URLs).
 * No Shopify auth — authorization is the signature itself — so the link works
 * when opened in a new browser tab outside the embedded admin.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const exp = url.searchParams.get("exp") ?? "";
  const sig = url.searchParams.get("sig") ?? "";

  if (!verifyDownloadToken(key, exp, sig)) {
    return new Response("Invalid or expired download link", { status: 403 });
  }

  const content = await getFileContent(key);
  if (!content) {
    return new Response("File not found", { status: 404 });
  }

  const filename = key.split("/").pop() || "download.csv";
  const contentType = filename.endsWith(".json")
    ? "application/json; charset=utf-8"
    : filename.endsWith(".jsonl")
      ? "application/x-ndjson; charset=utf-8"
      : "text/csv; charset=utf-8";

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};

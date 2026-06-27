/**
 * File storage — LOCAL FILESYSTEM backend (development).
 *
 * Public interface is intentionally identical to the eventual Cloudflare R2
 * implementation (uploadFile / getFileContent / deleteFile / getDownloadUrl /
 * buildFileKey), so swapping back to R2 before production only changes the
 * bodies of these functions — callers and the job pipeline stay the same.
 *
 * Files live under BASE_DIR (default /tmp/metavault-exports), mirroring the
 * object key as a directory path. Downloads are served by the public
 * `/download` route, authorized with an HMAC-signed, time-limited token
 * (see verifyDownloadToken) instead of an R2 presigned URL.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

const BASE_DIR = process.env.LOCAL_STORAGE_DIR ?? "/tmp/metavault-exports";
const SIGNING_SECRET = process.env.SHOPIFY_API_SECRET ?? "metavault-dev-secret";
const APP_URL = process.env.SHOPIFY_APP_URL ?? "";

function pathForKey(key: string): string {
  // Keys never contain ".." (they're built from shop/type/jobId), but normalize
  // defensively so a key can't escape BASE_DIR.
  const safe = key.replace(/\.\.(\/|\\|$)/g, "");
  return join(BASE_DIR, safe);
}

export async function uploadFile(
  key: string,
  body: Buffer | string,
  _contentType: string,
): Promise<string> {
  const filePath = pathForKey(key);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
  return key;
}

export async function getFileContent(key: string): Promise<string> {
  try {
    return await readFile(pathForKey(key), "utf8");
  } catch {
    return "";
  }
}

export async function deleteFile(key: string): Promise<void> {
  try {
    await unlink(pathForKey(key));
  } catch {
    // Missing file is a no-op, matching idempotent object deletes.
  }
}

// --- Signed download tokens (replacement for R2 presigned URLs) -------------

function sign(key: string, exp: number): string {
  return createHmac("sha256", SIGNING_SECRET).update(`${key}:${exp}`).digest("hex");
}

/**
 * Build a time-limited, signed download URL pointing at the public `/download`
 * route. Async to match the R2 presigner's signature.
 */
export async function getDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const exp = Date.now() + expiresInSeconds * 1000;
  const params = new URLSearchParams({ key, exp: String(exp), sig: sign(key, exp) });
  // Relative when APP_URL is unset; absolute (tunnel/prod URL) otherwise so the
  // link works when opened in a new tab outside the embedded admin.
  return `${APP_URL}/download?${params.toString()}`;
}

/** Verify a download token: signature matches and not expired. */
export function verifyDownloadToken(key: string, exp: string, sig: string): boolean {
  if (!key || !exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false;
  const expected = sign(key, expNum);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildFileKey(
  shopId: string,
  type: string,
  jobId: string,
  ext: "csv" | "jsonl" | "json" = "csv",
): string {
  return `${shopId}/${type}/${jobId}.${ext}`;
}

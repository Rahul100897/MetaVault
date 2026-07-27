/**
 * File storage.
 *
 * Two interchangeable backends behind one interface (uploadFile /
 * getFileContent / deleteFile / getDownloadUrl / verifyDownloadToken /
 * buildFileKey):
 *
 *  - **Cloudflare R2** (production) — used automatically when the R2 credentials
 *    are present in the environment. Objects are stored in the bucket and
 *    downloads are served with time-limited presigned URLs (or, if
 *    R2_PUBLIC_URL is set for a public bucket, a direct public URL).
 *  - **Local filesystem** (development) — used automatically when the R2
 *    credentials are absent. Files live under BASE_DIR and downloads go through
 *    the public `/download` route, authorized by an HMAC-signed token.
 *
 * Callers (routes + BullMQ workers) never care which backend is active.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BASE_DIR = process.env.LOCAL_STORAGE_DIR ?? "/tmp/metavault-exports";
const SIGNING_SECRET =
  process.env.SESSION_SECRET ?? process.env.SHOPIFY_API_SECRET ?? "metavault-dev-secret";
const APP_URL = process.env.SHOPIFY_APP_URL ?? process.env.HOST ?? "";

// --- R2 configuration --------------------------------------------------------

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME;
// Optional: base URL of a public bucket (e.g. https://files.example.com). When
// set, downloads are served straight from it instead of a presigned URL.
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
// Endpoint can be given directly or derived from the account id.
const R2_ENDPOINT =
  process.env.R2_ENDPOINT ??
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);

/** R2 is used only when fully configured; otherwise we fall back to local FS. */
export const usingR2 = Boolean(
  R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET,
);

let _client: S3Client | null = null;
function r2(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID as string,
        secretAccessKey: R2_SECRET_ACCESS_KEY as string,
      },
    });
  }
  return _client;
}

/** Keys are built from shop/type/jobId, but normalize defensively regardless. */
function safeKey(key: string): string {
  return key.replace(/\.\.(\/|\\|$)/g, "");
}

function pathForKey(key: string): string {
  return join(BASE_DIR, safeKey(key));
}

// --- Public interface --------------------------------------------------------

export async function uploadFile(
  key: string,
  body: Buffer | string,
  contentType: string,
): Promise<string> {
  if (usingR2) {
    await r2().send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: safeKey(key),
        Body: body,
        ContentType: contentType,
      }),
    );
    return key;
  }

  const filePath = pathForKey(key);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
  return key;
}

export async function getFileContent(key: string): Promise<string> {
  if (usingR2) {
    try {
      const res = await r2().send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: safeKey(key) }),
      );
      // SDK v3 augments the Node stream with transformToString().
      return res.Body ? await res.Body.transformToString() : "";
    } catch {
      // Missing object → empty string, matching the local backend.
      return "";
    }
  }

  try {
    return await readFile(pathForKey(key), "utf8");
  } catch {
    return "";
  }
}

export async function deleteFile(key: string): Promise<void> {
  if (usingR2) {
    try {
      await r2().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: safeKey(key) }));
    } catch {
      // Missing object is a no-op, matching idempotent deletes.
    }
    return;
  }

  try {
    await unlink(pathForKey(key));
  } catch {
    // Missing file is a no-op.
  }
}

// --- Signed download tokens (local backend) ----------------------------------

function sign(key: string, exp: number): string {
  return createHmac("sha256", SIGNING_SECRET).update(`${key}:${exp}`).digest("hex");
}

/**
 * Build a time-limited download URL.
 *  - R2 + public bucket → direct public URL.
 *  - R2 (private)       → presigned GetObject URL (expires in expiresInSeconds).
 *  - local              → signed `/download` route URL.
 * Async in all cases to match the R2 presigner's signature.
 */
export async function getDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  if (usingR2) {
    if (R2_PUBLIC_URL) {
      return `${R2_PUBLIC_URL.replace(/\/$/, "")}/${safeKey(key)}`;
    }
    return getSignedUrl(
      r2(),
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: safeKey(key) }),
      { expiresIn: expiresInSeconds },
    );
  }

  const exp = Date.now() + expiresInSeconds * 1000;
  const params = new URLSearchParams({ key, exp: String(exp), sig: sign(key, exp) });
  // Relative when APP_URL is unset; absolute otherwise so the link works when
  // opened in a new tab outside the embedded admin.
  return `${APP_URL}/download?${params.toString()}`;
}

/** Verify a download token: signature matches and not expired (local backend). */
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

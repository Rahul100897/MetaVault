import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT ?? "",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

const BUCKET = process.env.R2_BUCKET_NAME ?? "metavault";

export async function uploadFile(
  key: string,
  body: Buffer | string,
  contentType: string,
): Promise<string> {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

export async function getFileContent(key: string): Promise<string> {
  const res = await r2Client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  // Body is a stream in Node; transformToString is provided by the SDK.
  const body = res.Body as { transformToString: () => Promise<string> } | undefined;
  if (!body?.transformToString) return "";
  return body.transformToString();
}

export async function getDownloadUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  return getSignedUrl(
    r2Client,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

export async function deleteFile(key: string): Promise<void> {
  await r2Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key }),
  );
}

export function buildFileKey(
  shopId: string,
  type: string,
  jobId: string,
  ext: "csv" | "jsonl" = "csv",
): string {
  return `${shopId}/${type}/${jobId}.${ext}`;
}

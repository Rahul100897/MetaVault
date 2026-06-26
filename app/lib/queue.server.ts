import { Queue, Worker, type ConnectionOptions } from "bullmq";

const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD,
};

export const QUEUE_NAMES = {
  IMPORT: "metavault-import",
  EXPORT: "metavault-export",
  BACKUP: "metavault-backup",
} as const;

export const importQueue = new Queue(QUEUE_NAMES.IMPORT, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const exportQueue = new Queue(QUEUE_NAMES.EXPORT, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const backupQueue = new Queue(QUEUE_NAMES.BACKUP, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
  },
});

export type ImportJobData = {
  jobId: string;
  shopId: string;
  shopDomain: string;
  accessToken: string;
  fileUrl: string;
  type: "metafields" | "metaobjects";
};

export type ExportJobData = {
  jobId: string;
  shopId: string;
  shopDomain: string;
  accessToken: string;
  type: "metafields" | "metaobjects";
  resourceType?: string;
};

export type BackupJobData = {
  jobId: string;
  shopId: string;
  shopDomain: string;
  accessToken: string;
};

export { connection as redisConnection };

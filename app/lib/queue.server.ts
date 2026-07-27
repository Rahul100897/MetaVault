import { Queue, type ConnectionOptions } from "bullmq";

// Tuning shared by both connection styles. maxRetriesPerRequest must be null for
// BullMQ's blocking commands; the keepAlive/retry settings stop Railway's Redis
// proxy dropping idle sockets from flooding the logs with ECONNRESET.
const TUNING = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 10000,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
  reconnectOnError: () => true,
} satisfies Partial<ConnectionOptions>;

/**
 * Prefer a single REDIS_URL (what Railway and most hosts provide), falling back
 * to discrete REDIS_HOST/PORT/PASSWORD for local setups. `rediss://` enables TLS.
 */
function buildConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      username: u.username || undefined,
      password: u.password || undefined,
      tls: u.protocol === "rediss:" ? {} : undefined,
      ...TUNING,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
    ...TUNING,
  };
}

const connection: ConnectionOptions = buildConnection();

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
  /** Metaobject definition type (metaobject imports only). */
  resourceType?: string;
  /** CSV column → field key mapping (metaobject imports only). */
  mapping?: Record<string, string>;
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
  /** BackupJob id (mode "backup") or the BackupJob being restored (mode "restore"). */
  jobId: string;
  shopId: string;
  shopDomain: string;
  accessToken: string;
  /** Defaults to "backup". */
  mode?: "backup" | "restore" | "preview";
  /** Storage key of the snapshot to read (modes "restore" and "preview"). */
  backupKey?: string;
  /** ImportJob id used to track restore progress (mode "restore"). */
  restoreJobId?: string;
  /** ImportJob id used to track the diff computation (mode "preview"). */
  previewJobId?: string;
};

export { connection as redisConnection };

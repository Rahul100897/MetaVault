/**
 * Shared Admin GraphQL request helper: runs a query through an AdminClient,
 * retries on THROTTLED with exponential backoff, and throws on top-level errors.
 */

export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function isThrottled(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return /throttl/i.test(message);
}

async function withBackoff<T>(
  fn: () => Promise<T>,
  { maxRetries = 5, baseDelayMs = 500 }: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isThrottled(err) || attempt >= maxRetries) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

export async function graphqlRequest<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return withBackoff(async () => {
    const res = await admin.graphql(query, { variables });
    const body = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };
    if (body.errors?.length) {
      const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
      const message = body.errors.map((e) => e.message).join("; ");
      throw new Error(throttled ? `THROTTLED: ${message}` : message);
    }
    if (!body.data) throw new Error("Empty GraphQL response");
    return body.data;
  });
}

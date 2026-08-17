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

/**
 * A rejected Admin API call, carrying the bits callers actually branch on.
 *
 * `auth` is the one worth handling: it means the access token is dead or lacks
 * the scope, which no amount of retrying fixes — the caller has to get a new
 * token (see `offlineAdminFor`) rather than report a data-shaped failure.
 */
export class AdminApiError extends Error {
  readonly status: number;
  readonly throttled: boolean;
  readonly auth: boolean;

  constructor(
    message: string,
    { status, throttled = false, auth = false }: { status: number; throttled?: boolean; auth?: boolean },
  ) {
    // Keep the THROTTLED prefix: isThrottled() matches on the message, and so
    // do the job runners' log lines.
    super(throttled ? `THROTTLED: ${message}` : message);
    this.name = "AdminApiError";
    this.status = status;
    this.throttled = throttled;
    this.auth = auth;
  }
}

export function isThrottled(err: unknown): boolean {
  if (err instanceof AdminApiError) return err.throttled;
  if (!err || typeof err !== "object") return false;
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return /throttl/i.test(message);
}

export function isAuthError(err: unknown): boolean {
  return err instanceof AdminApiError && err.auth;
}

/**
 * Flatten Shopify's two different top-level error shapes into one message.
 *
 * GraphQL-level failures come back as an array of `{message, extensions}`, but
 * transport-level rejections — 401 invalid token, 402 shop frozen, 403 missing
 * scope, 423 shop locked — return `errors` as a bare **string**. Treating that
 * string as an array is what turned every dead-token response in this app into
 * `body.errors.some is not a function`, hiding the real cause.
 */
function messageFrom(errors: unknown): string {
  if (typeof errors === "string") return errors;
  if (Array.isArray(errors)) {
    return errors
      .map((e) => (e && typeof e === "object" && "message" in e ? String(e.message) : String(e)))
      .join("; ");
  }
  return JSON.stringify(errors);
}

function hasThrottleCode(errors: unknown): boolean {
  return (
    Array.isArray(errors) &&
    errors.some(
      (e) =>
        e &&
        typeof e === "object" &&
        (e as { extensions?: { code?: string } }).extensions?.code === "THROTTLED",
    )
  );
}

/**
 * Turn an Admin API HTTP response into data, or throw an `AdminApiError`.
 *
 * The HTTP status is consulted as well as the body: a 5xx or an edge-served
 * error page is not JSON at all, and silently failing to parse it produced a
 * `SyntaxError` that said nothing about what went wrong.
 */
export async function parseGraphqlResponse<T>(res: Response): Promise<T> {
  const auth = res.status === 401 || res.status === 403;
  let body: { data?: T; errors?: unknown } | null = null;
  try {
    body = (await res.json()) as { data?: T; errors?: unknown };
  } catch {
    throw new AdminApiError(
      `Shopify returned HTTP ${res.status} ${res.statusText} with a non-JSON body`,
      { status: res.status, throttled: res.status === 429, auth },
    );
  }

  if (body?.errors !== undefined && messageFrom(body.errors).length > 0) {
    throw new AdminApiError(messageFrom(body.errors), {
      status: res.status,
      throttled: res.status === 429 || hasThrottleCode(body.errors),
      auth,
    });
  }

  if (!res.ok) {
    throw new AdminApiError(`Shopify returned HTTP ${res.status} ${res.statusText}`, {
      status: res.status,
      throttled: res.status === 429,
      auth,
    });
  }

  if (!body?.data) throw new AdminApiError("Empty GraphQL response", { status: res.status });
  return body.data;
}

export async function withBackoff<T>(
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
    return parseGraphqlResponse<T>(res);
  });
}

import { json } from "@remix-run/node";

/**
 * Unauthenticated health check for Railway's healthcheckPath (/health) and any
 * uptime monitor. A resource route (no default export) — the loader is the
 * whole thing.
 */
export const loader = () => json({ status: "ok", timestamp: Date.now() });

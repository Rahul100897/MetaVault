/**
 * Gate for developer-only routes that ship inside the merchant app.
 *
 * MetaVault is a public App Store app, so anything reachable at /app/* is
 * reachable by every merchant who installs it — and by whoever reviews it. The
 * pre-submission checklist is internal tooling that reports our own compliance
 * state; a merchant seeing it is confusing, and a reviewer seeing it is worse.
 *
 * Fails CLOSED in production: with INTERNAL_TOOLS_SHOPS unset, no shop passes,
 * so a guessed URL 404s rather than exposing internal state. Local development
 * is always allowed so the tooling stays usable without extra setup.
 */
export function canSeeInternalTools(shop: string): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const allowed = (process.env.INTERNAL_TOOLS_SHOPS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(shop.trim().toLowerCase());
}

/**
 * Throw from a loader/action to make an internal route indistinguishable from a
 * route that does not exist. A 403 would confirm the page is there.
 */
export function assertInternalTools(shop: string): void {
  if (!canSeeInternalTools(shop)) {
    throw new Response("Not Found", { status: 404 });
  }
}

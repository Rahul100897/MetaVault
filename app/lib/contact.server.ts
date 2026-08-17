/**
 * The public contact address — what merchants and App Store reviewers see on
 * `/privacy`, `/terms` and the in-app support page.
 *
 * Server-only, and read through a function rather than a module-scope constant
 * on purpose. `process.env.APP_CONTACT_EMAIL` used to be evaluated at module
 * scope inside `components/Legal.tsx`, which Vite ships to the browser too — so
 * the client bundle had the fallback **inlined at build time** while the server
 * read the real value at runtime. Setting the variable on Railway would then
 * render one address server-side and a different one after hydration.
 *
 * Resolving it in a loader keeps it a runtime value, sends it to the client as
 * loader data, and means changing the variable takes effect on restart with no
 * rebuild.
 *
 * Distinct from SUPPORT_TO_EMAIL, which routes support mail to a private inbox
 * and must never reach a page (see ./support.server).
 */

/** Fallback only — the real value comes from APP_CONTACT_EMAIL in production. */
export const FALLBACK_CONTACT_EMAIL = "support@storelivo.com";

export function publicContactEmail(): string {
  return process.env.APP_CONTACT_EMAIL ?? FALLBACK_CONTACT_EMAIL;
}

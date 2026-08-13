# MetaVault — Production / Deployment Notes

A running checklist of everything that needs attention **before or during
production deployment**. Updated as features land. Don't ship without walking
this list.

> Legend: 🔴 blocker · 🟡 important · 🟢 verify

---

## 1. Environment & infrastructure

- 🔴 **Local dev currently overrides production config.** During local testing
  the `.env` was pointed at local Docker Postgres/Redis and R2 was disabled.
  Before deploy, production env vars must be set on **both** the `web` and
  `worker` Railway services. `.env.bak.railway` holds the original values.
- 🔴 **Railway paid plan.** The trial is expired; a **Hobby plan (~$5/mo)** is
  required to keep services online. (Merchant/owner action — a purchase.)
- 🔴 **Two Railway services**, same repo: `web` (start `npm run docker-start`,
  healthcheck `/health`) and `worker` (start `npm run worker`). Worker has no
  HTTP port / healthcheck.
- 🔴 **`DATABASE_URL`** → production Postgres (`${{Postgres.DATABASE_URL}}`).
- 🔴 **`REDIS_URL`** → production Redis (`${{Redis.REDIS_URL}}`). Code prefers
  `REDIS_URL`; falls back to `REDIS_HOST/PORT/PASSWORD`.
- 🔴 **`SHOPIFY_APP_URL` and `HOST`** → the production Railway URL.
- 🔴 **`SESSION_SECRET`** → set a real secret (`openssl rand -hex 32`). Signs
  local download tokens.
- 🟡 **`NODE_ENV=production`** — makes billing use live charges and disables the
  `SHOP_PLAN_OVERRIDE` dev escape hatch.
- 🟢 Remove/unset **`SHOP_PLAN_OVERRIDE`** (was `agency` during testing; ignored
  in prod, but clean it up).

## 2. Database migrations

- 🔴 Run **`prisma migrate deploy`** against the production DB. Migrations to
  apply (beyond the Phase-1..4 baseline):
  - `shop_settings` — billing/plan mirror + notification prefs
  - `backup_size` — backup size/itemCount columns
  - `store_connections` — cross-store pairing
- 🟢 `npm run docker-start` already runs `prisma migrate deploy` on web boot, so
  this is automatic **if** the web service uses that start command.

## 3. Cloudflare R2 storage

- 🔴 **R2 is currently DISABLED** (creds commented out in `.env` for local
  testing → app falls back to local filesystem). In production, set:
  `R2_ACCOUNT_ID` (or `R2_ENDPOINT`), `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. Optional `R2_PUBLIC_URL`.
- 🔴 **Verify the R2 bucket exists and the keys have write access.** The
  placeholder endpoint in `.env` previously failed with "Invalid URL". Exports
  and backups upload to R2 — they fail if it's misconfigured.
- 🟢 Downloads use time-limited presigned R2 URLs (private) unless
  `R2_PUBLIC_URL` is set for a public bucket.

## 4. Shopify app configuration

- 🔴 Update **`shopify.app.toml`** `application_url` + `redirect_urls` to the
  production URL, then **`npm run deploy`** (or set them in the Partner
  Dashboard). During dev these are the transient tunnel URL — never commit that.
- 🔴 **Reinstall / re-auth** the app against the production URL so a fresh
  offline token is written to the production DB.
- 🟡 **Protected Customer Data access.** The app can't read customer (and some
  order) metafields until approved in the Partner Dashboard → App setup →
  *Protected customer data access*. Until then, backups/exports/scans **skip**
  customer & order metafields (handled gracefully, not an error). Request access
  before relying on customer-metafield features.
- 🟢 Confirm access scopes in `shopify.app.toml` still match what's used (a
  `shopify app dev --reset` has previously wiped scopes to `""`).

## 5. Billing

- 🟡 In production (`NODE_ENV=production`), charges are **live** (Pro $15,
  Agency $29, 7-day trials). `SHOPIFY_BILLING_TEST` can force test mode — make
  sure it's not accidentally left on.
- 🟢 `SHOP_PLAN_OVERRIDE` is ignored in production, so plan gating uses the real
  Shopify subscription mirrored into `ShopSettings`.

## 6. Email notifications

- 🟡 **Notifications are console-only.** `app/lib/notify.server.ts` builds the
  email payload and `console.log`s it — no real emails are sent. Wire a provider
  (Resend / SendGrid / Postmark) in `deliver()` before promising email delivery
  to merchants. Recipient resolution + opt-out toggle are already implemented.

## 7. App Store submission

- 🟢 In-app checklist at `/app/checklist` (GDPR webhooks, GraphQL-only, billing,
  privacy/terms, minimal scopes, etc.).
- 🟡 Add **Protected Customer Data** as a submission item (see §4).
- 🟢 Hosted `/privacy` and `/terms` — add their public URLs to the listing.
- 🟢 GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
  verified returning 200; `shop/redact` clears jobs, activity, `ShopSettings`,
  `StoreConnection`, and sessions.

## 8. Open items / TODO before launch

- [ ] Wire a real email provider (§6).
- [ ] Request Protected Customer Data access (§4).
- [ ] (Optional/among asks) Native-style metafields search/filter — client-side
      facets over loaded rows, with a "Load all" for full filtering.

---

_Last updated: 2026-08-14. Keep this in sync as features land._

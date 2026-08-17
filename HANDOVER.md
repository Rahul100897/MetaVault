# MetaVault — session handover

Written 2026-08-15, substantially updated 2026-08-17. Covers the Railway
deployment, App Store submission progress, the Help & feedback page, the
storelivo.com email stack (§11), and what is left. Read this before touching
anything.

**Where things stand in one paragraph:** the app is live on Railway and healthy,
running `main` at `deed5d0` on Node 22. The **offline-token bug is fixed** and so
is a hydration bug that would have broken the public legal pages the moment
`APP_CONTACT_EMAIL` was set. The **agency domain `storelivo.com` is fully wired**
— Cloudflare DNS + Email Routing for receiving, Resend verified for sending — so
**merchant email notifications are live for the first time**. The App Store
listing is filled in and saved with **one blocker left: a screencast video**. The
AI self review is done (30 pass, 0 fail, 1 needs review). Paid plans have no free
trial, deliberately. Nothing is blocked on engineering; what remains is a video,
a Gmail SMTP setting, and end-to-end testing on the dev store (§12).

---

## 1. Where the app runs

**Railway project `desirable-achievement`** — id `907d3414-2879-4f96-8d71-978237829e49`,
environment `production` (`2a07ab38-4ab2-49a4-a6cc-525b1ac77dbe`). Four services,
all Online:

| Service | Role | Notes |
| --- | --- | --- |
| **MetaVault** | web | `https://metavault-production.up.railway.app`, `/health` returns 200. Builds from `railway.json` |
| **precious-peace** | worker | Runs 4 BullMQ workers: export, import, backup, cleanup. Builds from `railway.worker.json` |
| **Postgres** | database | 4 migrations applied |
| **Redis** | queue | In-project, referenced as `${{Redis.REDIS_URL}}` |

**Cloudflare R2**: bucket `metavault-production`, WNAM, Standard class, public
access disabled. Account id `8875f979d04ff6ce87fb591100e7ff68`.

Secrets live on the **web** service as raw values; the **worker** references them
as `${{MetaVault.VAR}}`. That keeps one copy of every secret.

### Rules learned the hard way — do not relearn these

1. **Never set `HOST` to a URL.** `remix-serve` reads `HOST` as the interface to
   bind to. Setting it to the public URL made the container try to bind a public
   IP and crash-loop with `EADDRNOTAVAIL`. Use `SHOPIFY_APP_URL` for the app URL.
2. **No `&&` in a Railway `startCommand`.** It is not shell-interpreted; the
   second half is passed as junk args. Put the chain in a package.json script
   (this is why `worker-start` exists).
3. **`${{Service.VAR}}` references resolve at deploy time and are baked in.**
   Rotating a secret on the web service does *not* update the worker — you must
   redeploy the worker explicitly, or it keeps using the old value while looking
   perfectly healthy.
4. **`package-lock.json` must stay committed.** The Shopify template gitignores
   it; `npm ci` in the Dockerfile fails without it.
5. **Adding a variable in the Railway dashboard only *stages* it.** After you
   click Add, the list says "15 Service Variables" and the variable looks
   present — but an **"Apply 1 change"** banner and an **"Edited · 1 Change"**
   badge on the service card mean it is in no container at all. This cost a
   round trip on 2026-08-15: `SUPPORT_TO_EMAIL` appeared set while the app kept
   resolving its fallback. **Click Deploy, confirm the banner clears**, then
   verify from *inside* the container (service → Console → `printenv NAME`),
   never from the variables list.
6. **Don't use the Raw Editor to read variables.** It renders every value in
   plaintext — `SHOPIFY_API_SECRET`, `RESEND_API_KEY`, the R2 keys — so it leaks
   secrets into any screenshot or shared session. Single-variable entry keeps
   values masked.
7. **`npm run dev` is no longer consequence-free now that production exists.**
   `scripts/dev.sh` rewrites `application_url` + `redirect_urls` in
   `shopify.app.toml` to a quick tunnel, and its exit trap restores them to the
   **`https://example.com` placeholder — not the Railway URL**. A `npm run
   deploy` from that state would point the live app at `example.com`. It also
   activates a dev store preview, which makes the production embedded app show
   "refused to connect" until Dev Console → **Clean dev preview**. Do not start
   the dev server just to eyeball a UI change; verify against the Railway deploy
   instead, or `git checkout shopify.app.toml` and clear the preview afterwards.

---

## 2. Shopify app state

Partners org `1991389`, app id `390008537089`. Dev Dashboard org `129777563`.

- **Distribution: Public (App Store)** — chosen 2026-08-14. **Permanent.**
- Live app version `metavault-3`. URLs point at Railway; `automatically_update_urls_on_dev = false`
  so `shopify app dev` cannot clobber the production URL.
- Scopes: `read_customers, read_metaobject_definitions, read_metaobjects,
  read_orders, read_products, write_customers, write_metaobjects, write_orders,
  write_products`. No `write_metaobject_definitions` (removed in the compliance audit).
- Installed on dev store **rahul-developer-store** at `/apps/metavault-1/app`
  (the `-1` is a store-level handle collision; cosmetic).
- **Agency test subscription is active** on that store, so gated features work.
- **Partner payouts configured** via Hyperwallet, depositing in INR. Revenue
  share is 0% on the first $1M/year, then 15%.

### App Store submission — preliminary steps

| Step | Status |
| --- | --- |
| Queries supported API versions | ✅ |
| Fixed requirement issues (incl. app icon) | ✅ |
| Emergency contact | ✅ |
| Selected app capabilities: embedded | ✅ |
| Protected customer data request | ✅ 16/16 |
| Automated checks for common errors | ✅ passed |
| Embedded app checks | ✅ passed |
| **Create listing content** | 🟡 filled and saved — **1 issue left: Screencast URL** |
| **Run AI self review** | ✅ run, and marked done in the dashboard |
| **Submit for review** | ❌ blocked only by the screencast |

**The listing is otherwise complete.** Name, category (Store design › Content ›
Metafields), category details, language, introduction, details, 5 features,
subtitle, 5 search terms, privacy policy URL, support/review/submission emails,
install requirements, test-account answer, testing instructions, 3 desktop
screenshots + feature media, and 3 public pricing plans are all entered and
saved. Everything entered is mirrored in `APP_STORE_LISTING.md` so it never has
to be retyped.

**The only remaining blocker is a screencast**: a 3–8 minute video showing
onboarding and core functionality, hosted anywhere public (unlisted YouTube is
fine). It is for reviewers, not the public listing. A suggested shot list is in
`APP_STORE_LISTING.md`.

Two traps found while filling it in, both already cleaned up — but they recur if
you re-edit the form: repeated **Save** attempts **duplicate the Features list**
(it reached 30 entries against a max of 5), and clicking **Add** under
Screenshots creates an empty slot that then fails validation with "An image is
required" (15 had accumulated).

PCD request: data use = *Protected customer data* + the *Name* field, both with
reason **Store management**. The 16 data-protection answers are backed by
`SECURITY.md` in this repo — read it before standing behind the "yes" on data
loss prevention and incident response.

---

## 3. What has been verified working in production

- Web `/health` 200; worker logs `[metavault] started 4 worker(s)`.
- **R2 proven.** An export job completed and the worker log shows the AWS SDK v3
  warning firing at that exact second. `@aws-sdk/client-s3` is only constructed
  by `r2.server.ts`, so the file went to R2 and not the local-FS fallback.
- **Import proven** — 24/24 rows, then a 3-row file including a multi-line value.
- **Backup proven** — 35 items, 22 KB, expiry stamped exactly +30 days.
- **Billing proven** — Agency subscription created as a Shopify *test* charge and
  the plan mirror synced on redirect.
- **Email proven for the app owner only** — a real "Your MetaVault export is
  ready" arrived. See the limitation in §5.
- **Help & feedback page live** (§8). `/app/support` returns 410 unauthenticated,
  identical to `/app/settings`, while a nonexistent route returns 404 — so the
  route is registered, and since `docker-start` is `setup && start`, the server
  could not be serving unless `prisma migrate deploy` created `SupportRequest`.
  A submission was stored and rendered in the merchant's history.
- **Support email proven.** `SUPPORT_TO_EMAIL` verified present in the running
  web container via `printenv`, and a POST to Resend from that container returned
  **HTTP 200** (id `fc7e3f05-e4aa-40fe-9c5b-71ba01ff0bfb`). Still unexercised:
  the route's own action end to end, which needs a submission from the admin —
  the app is in a cross-origin iframe, so it can't be driven from here.

Added 2026-08-17:

- **Node 22 in production** — `node -v` in the running web container reports
  `v22.23.2`. The Dockerfile bump was also proven with a full local `docker build`
  before pushing.
- **The hydration fix is real in production, not just locally.** `/privacy` and
  `/terms` both serve `mailto:support@storelivo.com`, the value appears in the
  hydration payload as loader data, and **every JS asset was fetched and none
  contains any contact address**. That last check is the actual proof: before the
  fix the client bundle had `support@metavault.app` baked in at build time.
- **Both new env vars verified from inside the container**, not from the
  variables list — `printenv APP_CONTACT_EMAIL RESEND_FROM` returns
  `support@storelivo.com` and `metavault@storelivo.com`.
- **Resend domain `storelivo.com` Verified**; all 7 email DNS records confirmed
  live at the authoritative nameserver (`dig @dane.ns.cloudflare.com`), not just
  in the dashboard.
- **The server-side metafields filter verified against the dev store** — 43 rows
  unfiltered → 24 for `custom`, 18 for `judgeme`, 7 for search `towel`, 4 for
  both; page two of a filtered walk leaked 0 rows from other namespaces.

**NOT yet verified in production** (see §12): cross-store copy with the new token
path, a merchant notification actually arriving at a merchant address, and the
metafields filter through the real UI.

---

## 4. Work done (all pushed to `main`)

### 2026-08-17

| Commit | What |
| --- | --- |
| `0f212eb` | **Offline-token fix.** `targetAdminFor()` read the `Session` row raw, so cross-store copy 401'd ~24h after the *target* merchant last opened the app. Now goes through `unauthenticated.admin()` (refresh), re-checks expiry, and proves the token before writing. Also fixed the string-vs-array `errors` bug that made every auth failure read `body.errors.some is not a function` |
| `84c900f` | **Metafields filter server-side.** Namespace + owner search now run in the Admin API, so they cover the catalog rather than the loaded page. Key/value/type cannot be — no top-level `metafields` query exists |
| `f15b857` | **Contact address via loader.** `process.env` at module scope in a client-bundled file meant Vite baked the fallback in at build time; setting the var would have caused a hydration flip on `/privacy` and `/terms` |
| `22b6c46` | Notifications opt-out card self-enables via `canNotifyMerchants()` instead of a manual code edit |
| `375d292` | `node:22-alpine` (AWS SDK v3 drops Node 20 in Jan 2027) |
| `deed5d0` | Doc corrections — §5's token diagnosis was wrong |

### Earlier

| Commit | What |
| --- | --- |
| `a977d93` | Commit `package-lock.json` — `npm ci` failed with EUSAGE because the template gitignored it |
| `7e5ae37` | Worker start command moved into a script; documented that `HOST` is a bind address |
| `ca2e86d` | Shopify app URLs → Railway domain |
| `acc62e2` | Dashboard metafield/metaobject tiles show real counts (were hardcoded `"—"`) |
| `244c720` | **Enforce 30-day backup retention.** `deleteFile()` had zero callers, so snapshots lived forever while the UI displayed an expiry date. Added a daily sweep in `app/jobs/cleanup.server.ts` |
| `7e60b91` | `SECURITY.md` — data loss prevention + incident response, written against the real stack |
| `9ed5a5a` | `APP_STORE_LISTING.md` — draft listing copy, **awaiting review** |
| `d8350ef` | **`app_subscriptions/update` webhook.** Plan state only re-synced when a merchant opened Plans & Billing, so a cancelled or declined subscription kept paid features |
| `ce27a0c` | **CSV parser rewrite.** `parseCsv` split on newlines before parsing quotes, so exported multi-line metafield values came back as broken rows — export→edit→import silently corrupted data |
| `8e639e6` | Import UX: preview dismissed on submit, spinner, success banner; sample CSV download; documented that import upserts |
| `3e4b1b5` | Designed HTML email templates + real job figures; fixed import emails that called the error report "your import" |
| `e73e232` | Hid the Email notifications setting (see §5) |
| `6c7ee84` | **Help & feedback page** — `/app/support`, `SupportRequest` model + migration, opt-in diagnostics, rate limit, merchant history. Extracted a shared `emailShell()`; job-template output verified byte-identical across 6 cases. Moved the hardcoded sidebar version into `APP_VERSION` |
| `baa0db1` | **Stopped the support page publishing the private inbox.** The "Other ways to reach us" card rendered the same env chain the mailer routes with, so setting `SUPPORT_TO_EMAIL` — which must be a personal address for Resend's sandbox to deliver — would have shown it to every merchant. Public contact is now `APP_CONTACT_EMAIL` only |
| `4628990` | **Kept developer-only surfaces out of the merchant app.** "App Store Checklist" was in the sidebar with no gate — every merchant and any reviewer could read our own compliance posture. Now gated by `assertInternalTools()`, which **fails closed** and 404s rather than 403s. Also deleted `app.additional.tsx`, untouched Shopify template boilerplate that was still reachable |
| `f228ea6` | **Replaced the bare "Application Error" screen.** `root.tsx` had no ErrorBoundary, so anything a route boundary didn't handle fell through to Remix's default: two words over an empty box. Added a branded `Layout` + `ErrorBoundary`, and `handleError` in `entry.server.tsx` — without it such failures left **no trace in the logs**, which is exactly why an incident showed an error screen while the logs held nothing but 200s |
| `b9af335` | **Reset the plan mirror on uninstall.** Found by the AI self review against requirement 1.2.2. Uninstall deleted only the session; `ShopSettings` kept `plan: "agency"`, `app_subscriptions/update` bails out on uninstall, and `shop/redact` lags up to 48h — so reinstalling inside that window restored **Agency features with no subscription and no charge approval** |
| `6332d29` | **Removed the free trial from Pro and Agency.** Every paid capability is burst-shaped (one backup, one migration, one bulk CSV), so a trial was a giveaway. Removing it doesn't lose the one-off merchant, it charges them — Shopify never prorates on cancellation. Also fixed the button that would have rendered "Start 0-day free trial", and corrected `terms.tsx`, a **public legal page** still promising a 7-day trial |
| `d8a2a7e` | `scripts/listing-screenshots.py` + `docs/LISTING_SCREENSHOT_PROMPTS.md` — deterministic screenshot pipeline, and why a generative image model must never be used on them |

---

## 5. Known gaps and decisions

**✅ Email is LIVE as of 2026-08-17.** Previously the sandbox sender
`onboarding@resend.dev` only delivered to the Resend account owner, so every
merchant address was rejected 403 — silently, because notification failures are
deliberately swallowed so they cannot fail a job. That is over:
`storelivo.com` is **Verified in Resend** and `RESEND_FROM=metavault@storelivo.com`
is applied on the web service. Merchant job notifications now actually deliver.

The Settings opt-out card was hidden in `e73e232`. **It is no longer a manual
step** — `app.settings.tsx` renders it whenever `canNotifyMerchants()` (in
`notify.server.ts`) is true, i.e. `RESEND_API_KEY` and `RESEND_FROM` are set
*and* `RESEND_FROM` is not a `resend.dev` address. It therefore appeared by
itself when the variable was applied. Nothing to remember, nothing to re-enable.

**Resend free tier limits to watch:** 1 domain, 3,000/month, **100/day** — shared
between merchant notifications and support mail. Every completed
export/import/backup is one email, so that ceiling is real once merchants arrive.

**Reputation note:** the *root* domain is verified in Resend, not a `mail.`
subdomain. A subdomain would isolate app-mail reputation from company mail, but
the free tier allows only one domain and `support@storelivo.com` also needs to
send. Revisit if you move to Resend Pro.

**Support mail never needed the domain.** The sandbox limitation was about the
*recipient*, and a support request's recipient is the Resend account owner.
`SUPPORT_TO_EMAIL` stays distinct from `APP_CONTACT_EMAIL`: the former is private
routing (a personal Gmail), the latter is what merchants are shown. Never render
`SUPPORT_TO_EMAIL` in a loader or page.

**✅ FIXED 2026-08-17 — the "dead offline access token".** Two corrections to
what was written here on 2026-08-15, both worth reading before trusting older
notes:

1. **The token was not mysteriously dead — it is designed to expire.**
   `shopify.server.ts` sets `future.expiringOfflineAccessTokens: true`, which
   makes offline tokens live **24 hours**. An `expires` in the past is correct
   behaviour for that flag, not the anomaly it was taken for.
2. **The evidence was read from the local dev database, not production.** The row
   is `shpua_…` (an expiring offline token), not `shpat_…`.

The real defect: `targetAdminFor()` in `app.cross-store.tsx` read the `Session`
row directly and used `accessToken` with no expiry check and no refresh. So
cross-store copy worked for ~24h after the *target* store's merchant last opened
MetaVault, and 401'd the rest of the time. The Shopify library already has the
repair path — `unauthenticated.admin(shop)` → `ensureValidOfflineSession` →
refresh grant → writes the new token back — and nothing was calling it.

Now handled by [`app/lib/offline-session.server.ts`](app/lib/offline-session.server.ts):
refresh, re-check expiry, then prove the token with one `{ shop { name } }`
before writing to another store. Failures return a typed reason instead of a
mid-copy 401.

**Dead end, recorded so nobody repeats it:** the client credentials grant would
be ideal here and *does* work against `rahul-developer-store` (verified — HTTP
200, full scopes). But Shopify restricts it to apps installed in stores in your
own organization; public App Store apps get `shop_not_permitted`. It would pass
every dev-store test and fail for every real merchant. **Do not use it.**

When the refresh token is also dead there is no server-side recovery for a public
app — a token exchange needs a session token from that store's admin, so the
merchant must open MetaVault there once. The UI now says exactly that.

**Also fixed in the same pass:** on auth failures Shopify returns `errors` as a
bare **string**, not an array. Both `graphql.server.ts` and a duplicated copy in
`metafields.server.ts` called `body.errors.some(...)`, so every dead-token
response anywhere in the app surfaced as `TypeError: body.errors.some is not a
function`. That is why this class of failure was so hard to read. The duplicate
is gone; `metafields.server.ts` now imports the shared helper.

**Background jobs remain unaffected** — export/import/backup take `accessToken`
from the job payload, captured from a live request at enqueue time.

**Other open items**

- **✅ Agency domain DONE 2026-08-17: `storelivo.com`.** See §11 for the full DNS
  inventory and the traps found while wiring it.
- **`INTERNAL_TOOLS_SHOPS` is unset**, so `/app/checklist` 404s for us too. Set it
  to `rahul-developer-store.myshopify.com` on the web service to get it back.
  Everything it reports is duplicated in §2 anyway.

- **`/app/checklist` is internal tooling and is now gated** (commit `4628990`).
  It was in the merchant sidebar with no gate, so every merchant — and any App
  Store reviewer — could read our own compliance posture. It is out of
  `NAV_ITEMS` and behind `assertInternalTools()` (`app/lib/internal.server.ts`),
  which **fails closed**: with `INTERNAL_TOOLS_SHOPS` unset, nobody in production
  reaches it, and it 404s rather than 403s so the route looks nonexistent.
  **Currently unset, so the page 404s for us too.** To use it again, set
  `INTERNAL_TOOLS_SHOPS=rahul-developer-store.myshopify.com` on the web service.
  Everything it reports is duplicated in §2, so leaving it dead is fine.
  Do not re-add it to the sidebar.
- `app/routes/app.additional.tsx` (Shopify template boilerplate, reachable and
  talking about "the app template") was deleted in `4628990`. `/app/additional`
  now returns 404 in production.
- **✅ `APP_CONTACT_EMAIL` is set to `support@storelivo.com`** (2026-08-17), applied
  and verified with `printenv` inside the running container. It was previously
  `metavaultsapp@gmail.com` — **not** unset, as an earlier version of this doc
  claimed. Do **not** set it to the personal Gmail in `SUPPORT_TO_EMAIL`; that
  address is deliberately never rendered.

  **Fixed 2026-08-17 — it would not have worked before.** `CONTACT_EMAIL` was a
  module-scope `process.env` read inside `components/Legal.tsx`, which ships to the
  browser, so Vite **inlined the fallback at build time** while the server read the
  variable at runtime. Setting it would have rendered the new address server-side
  and reverted to the placeholder on hydration — on public legal pages. It is now
  resolved in a loader via `app/lib/contact.server.ts`, which is also the single
  place the fallback lives (it was duplicated in three files).

- **Listing screenshots** — minimum 1600×900. Capture with `Cmd+Shift+4` on a
  Retina display (2× pixels). Best screens: Backups (real snapshot with size and
  expiry), Dashboard, Metafields filtered to namespace `custom`, Import/Export,
  Metaobjects.
- **Export/import CSVs in R2 are never deleted.** Backups expire at 30 days and
  the sweep enforces it; exports have no `expiresAt` and no UI promise, so
  choosing a lifetime is a product decision.
- **Delete the redundant Railway project `charismatic-learning`**
  (`f0653d47-9071-41d3-9dd5-1195b151d967`) — an old standalone Redis. Permanent
  delete, so it needs the owner's click.
- **File/image metaobject fields** are GID text inputs; a native picker needs
  `read_files`/`write_files` and a `stagedUploadsCreate` pipeline.
- **Metafields filter** — namespace and owner search are now applied by Shopify
  (`metafields(namespace:)` and the owner connection's `query:`), so they filter
  the whole catalog. **Key, value and type cannot be** — there is no top-level
  `metafields` query on `QueryRoot`, so metafields are only reachable through
  their owner. Type stayed a refinement of loaded rows and is labelled as one.
  The old single search box matched namespace/key/value/owner locally; it now
  searches the owner in Shopify, so key/value substring search is gone.
- **`metafields(first: 50)` per owner ignores its own `hasNextPage`**, so an owner
  with more than 50 metafields silently loses the rest. A namespace filter makes
  this far less likely but does not remove it. Needs nested cursor pagination.
- **AWS SDK v3 will require Node ≥ 22 from January 2027**; the Dockerfile now
  pins `node:22-alpine` (bumped 2026-08-17, verified with a local `docker build`).

---

## 6. Dev store notes

Store **rahul-developer-store**. Six products, renamed from SKU-style junk to
realistic names (Woven Rattan Cat Cave Bed, Organic Cotton Bath Towel, Merino
Wool Throw Blanket, Stoneware Dinner Plate Set, Linen Blend Cushion Cover,
Ceramic Pour-Over Coffee Set) so screenshots don't look like a test store.

Metafield definitions in the `custom` namespace: `product_key_features` and
`product_description` (multi-line), `product_sell_badge` and `subheading`
(single line). The `Servv*` definitions belong to another app — leave them.

**The store also carries `judgeme` metafields on every product** — HTML and JSON
blobs from Judge.me. That is another app's real data: do not delete it. Filter by
namespace `custom` for anything you intend to screenshot.

Test files in `~/Downloads`: `metavault-seed.csv` (24 rows) and
`metavault-minimal-test.csv` (3 rows, includes a multi-line value and an
overwrite case).

---

## 7. Browser automation limits

If you are driving this with browser tools, these cost real time to rediscover:

- **The app renders in a cross-origin iframe.** `read_page`, `find` and
  `file_upload` cannot see inside it — only coordinate clicks work. CSV import
  therefore **cannot be automated**; the dropzone opens a native file picker.
- **Shopify admin has global single-key shortcuts.** A click that misses an input
  sends typing to the document and opens "Add product"/"Add blog" modals. Use
  find → click the field's edit button → type, or `form_input` with a ref.
- **Railway's canvas spawns a `function-bun` service from stray clicks.** It
  happened twice. It stages rather than deploys, so discard it from the
  staged-changes panel. Work inside the service panel rather than on the canvas.
  (Earlier advice here was to prefer the Raw Editor — **don't**; see §1 rule 6,
  it shows every secret in plaintext. Use single-variable entry, then Deploy.)
- **Screenshots cap at ~1568×742** (physical window) — below Shopify's listing
  minimum, and the tooling cannot write image files to disk.
- Product metafields are far easier to edit at
  `/products/<id>/metafields` than on the product page.

---

## 8. Help & feedback page — shipped

Live at `/app/support`, nav item at the bottom of the sidebar. Commits `6c7ee84`
and `baa0db1`.

### How a submission reaches the owner

The §5 tension resolved once the *direction* of the mail was noticed. Resend's
sandbox sender fails for merchant notifications because the recipient is a
merchant; a support request's recipient is the Resend account owner. So it works
today with no domain purchase.

**Postgres is the source of truth. Email is best-effort on top.** The
`SupportRequest` row is committed *before* any send is attempted, so a submission
can never be lost to a mail failure, and the outcome is written back
(`emailedAt` / `emailError`) so a silent failure is discoverable. `sendEmail`
returns `{ sent }` — without that, an unconfigured provider logged the payload
and returned normally, which would have stamped `emailedAt` on mail that never
went out.

Owner reads submissions from the email or straight from Postgres; there is
deliberately **no owner console** inside the merchant app.

### Decisions worth not relitigating

- **No plan gating.** Support is reachable on Free — gating bug reports means not
  hearing about bugs from the plan most likely to hit them. Abuse is handled by a
  rate limit instead: 5 per shop per hour, plus identical-message dedupe within
  5 minutes.
- **Diagnostics are opt-in**, disclosed verbatim before sending, and carry shop /
  plan / app version / browser / last 5 job outcomes — **never** customer, order
  or product data, which matters given the Protected Customer Data commitments.
- **Attachments are out of scope.** They need an R2 upload pipeline plus a
  retention decision; that is its own task.
- Merchants see their own submission history, so they don't resend out of doubt.

### Files

`app/routes/app.support.tsx` (route), `app/lib/support.ts` (client-safe
vocabulary + the one validation function both sides run), `app/lib/support.server.ts`
(persist → notify, diagnostics, rate limit, history, owner template),
`app/lib/version.ts` (`APP_VERSION`), `prisma/migrations/20260814194945_support_requests`.

`email-template.server.ts` now exports a shared `emailShell()` plus palette and
`escapeHtml`; the job templates were verified byte-identical after that refactor,
so don't assume they changed.

### What's left

- Consider contextual "Report a problem" links from other pages — the route
  already accepts `?type=bug&area=Backups%20%26%20restore` to preselect the form.
- The first submission ("Add specific metafield export") is stored with an
  `emailError`, from before `SUPPORT_TO_EMAIL` was applied. Nothing was lost.

---

## 9. Environment variables that are set in production

On the **MetaVault** (web) service. The worker holds `${{MetaVault.*}}` references.

| Var | Value / note |
| --- | --- |
| `SUPPORT_TO_EMAIL` | `thakorrahul285@gmail.com` — **private routing inbox**, a personal Gmail. Never render it in a loader or a page. |
| `APP_CONTACT_EMAIL` | ✅ `support@storelivo.com` — **public** contact, shown on `/privacy`, `/terms`, support page. |
| `RESEND_FROM` | ✅ `metavault@storelivo.com` — verified domain, real delivery to merchants. |
| `RESEND_API_KEY` | set (secret). |
| `INTERNAL_TOOLS_SHOPS` | **unset** → `/app/checklist` 404s for everyone. |

The web container runs **Node v22.23.2** (confirmed via `node -v` in the Railway
Console), so the `node:22-alpine` bump is real in production.

**How to verify a variable without leaking secrets:** service → Console →
`printenv NAME1 NAME2` with explicit names. Never bare `printenv` and never the
**Raw Editor** — both dump `SHOPIFY_API_SECRET`, `RESEND_API_KEY` and the R2 keys
in plaintext into whatever transcript or screenshot you are in.

---

## 10. Screenshot pipeline

`python3 scripts/listing-screenshots.py <folder-of-raw-captures>` turns raw,
uncropped window captures named `NN-slug-raw.png` into exact 2560×1440 and
1600×900 images. Crop + uniform scale + pad only — no model, so text stays the
app's own pixels.

Current set lives in `~/Downloads/new-screenshot/listing/1600x900/`. **Use the
1600×900 set** — it is a pure downscale; the 2560 set upscales the centred pages
~1.14×.

Three things it encodes that are invisible in the output and expensive to
rediscover: find the sidebar by per-column darkness density (the active nav
item's indigo tint splits a naive "longest navy run" scan and silently slices
138px off), splice out the ~590px dead gutter on Polaris-centred pages, and snap
the crop height to a gap *between* nav items using a strict brightness threshold
(a loose one counts antialiased glyph tails as empty navy and bisects the last
label).

**Never run listing screenshots through a generative image model.** A ChatGPT
attempt rewrote "one-row-per-entry" as "app-row-per-entry" and changed the
cross-store copy header to claim it copies metafields — the opposite of what the
feature does. See `docs/LISTING_SCREENSHOT_PROMPTS.md`.

---

## 11. storelivo.com — domain and email infrastructure

Set up 2026-08-17. Registrar **Namecheap**, DNS + receiving **Cloudflare** (free
plan, account `8875f979d04ff6ce87fb591100e7ff68` — the same account as the R2
bucket), sending **Resend** (free tier, region Tokyo `ap-northeast-1`).

Nameservers: `dane.ns.cloudflare.com`, `eva.ns.cloudflare.com`. DNSSEC off.

### The DNS records and why each one is where it is

| Name | Type | Value | Owner |
| --- | --- | --- | --- |
| `storelivo.com` | MX 32/55/60 | `route1/2/3.mx.cloudflare.net` | Cloudflare — **receiving** |
| `storelivo.com` | TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all` | Cloudflare |
| `cf2024-1._domainkey` | TXT | `v=DKIM1; …` | Cloudflare |
| `send` | MX 10 | `feedback-smtp.ap-northeast-1.amazonses.com` | Resend — **sending** |
| `send` | TXT | `v=spf1 include:amazonses.com ~all` | Resend |
| `resend._domainkey` | TXT | `p=MIGfMA0G…` | Resend |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:support@storelivo.com` | us |
| `storelivo.com` | A (proxied) | `162.255.119.12` | Namecheap parking — replace with Pages |
| `www` | CNAME (proxied) | `parkingpage.namecheap.com` | ditto |

**The whole design rests on one fact:** Cloudflare owns the **root** MX/SPF and
Resend owns the **`send`** subdomain MX/SPF. Two SPF records on the *same* name
would break SPF entirely; on different names they coexist. So the root domain can
be verified in Resend (needed, because the free tier allows one domain and
`support@` must send too) without touching receiving.

Email Routing: `support@storelivo.com` → forwards to `thakorrahul285@gmail.com`.
The destination address auto-verified with no email click because it is the
Cloudflare account's own address. DNS records show **Locked** (Cloudflare-managed).

### Traps hit — do not repeat these

1. **Namecheap pre-populates 5 `eforward*.registrar-servers.com` MX records plus
   its own SPF**, and Cloudflare's zone scan imports them. Their priorities are
   **10/15/20** against Cloudflare's **32/55/60** — lower wins, so inbound mail
   would have gone to Namecheap's dead forwarders. Cloudflare refuses to configure
   while they exist (*"Existing non-Cloudflare MX records conflict with Email
   Routing"*) and will **not** remove them for you. Delete all 6, then click
   **Add missing records**.
2. **Resend also offers an "Enable Receiving" MX** — `inbound-smtp.<region>.amazonaws.com`
   on the **root** at priority **9**. That would outrank Cloudflare's and hijack
   all inbound mail. Leave Enable Receiving **off**; Cloudflare owns receiving.
3. **Resend truncates long DNS values in the UI with a middle ellipsis (`[…]`)**,
   including the 216-char DKIM key. Do not retype from the screen. Use the copy
   button, or verify: the key must be 216 base64 chars decoding to 162 bytes,
   starting `MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ` and ending `IDAQAB`.
4. **Paste only `send`, not `send.storelivo.com`** — Cloudflare appends the zone,
   giving `send.storelivo.com.storelivo.com`. DKIM must be **DNS only** (grey
   cloud), not proxied.
5. **Once nameservers point at Cloudflare, Namecheap's Advanced DNS tab is inert.**
   Its host records and email forwarding stop being authoritative — nothing there
   needs cleaning up. Only the copies Cloudflare imported matter. Nameservers are
   on Namecheap's **Domain** tab, not Advanced DNS, and need the green ✓ to save.

### Still to do on the domain

- **Gmail "Send mail as"** for `support@storelivo.com`: SMTP `smtp.resend.com`
  port 465, username `resend`, password = the Resend API key. Without this you can
  *receive* at `support@` but replies come from your personal Gmail.
- **Agency site** on Cloudflare Pages, then repoint the root A / `www` CNAME off
  the Namecheap parking page.
- Partner Directory slug is `vidhan` and the business name was `IT`; the name is
  editable under Partner settings → Business details, the **slug is not** — it
  needs a Shopify support ticket and there is no redirect from the old URL.

---

## 12. What is pending, and what needs testing

Current as of 2026-08-17, `main` at `deed5d0`.

### Blocking App Store submission

1. **Screencast video** — 3–8 min, onboarding + core flows, hosted anywhere public
   (unlisted YouTube is fine). Shot list in `APP_STORE_LISTING.md`. This is the
   only thing standing between the listing and Submit.
2. **Re-run the automated checks** just before submitting — they expire after 30
   days and were last run around 2026-08-14.
3. **Update the listing's three email fields** to `support@storelivo.com`
   (support, merchant review, app submission) and the Partner **business name** to
   `Storelivo`. The listing currently shows Developer "IT".

### Needs a decision, not engineering

4. **Export/import CSV retention.** Backups expire at 30 days and the sweep in
   `app/jobs/cleanup.server.ts` enforces it. Export/import CSVs have no `expiresAt`
   and are **never deleted**. Needs a retention number, then `expiresAt` on
   `ExportJob`/`ImportJob` + a migration + extending the sweep. Options considered:
   14 days for everything (balanced), 7 days (tighter data minimisation), 30 days
   (one promise across the app), or 7 up / 30 down (shortest life for the file the
   merchant uploaded).

### Small, non-blocking

5. **Gmail "Send mail as"** for `support@storelivo.com` — SMTP `smtp.resend.com:465`,
   user `resend`, password = the Resend API key. Receiving already works; this is
   only so replies come *from* the right address.
6. **Delete Railway project `charismatic-learning`** (`f0653d47-9071-41d3-9dd5-1195b151d967`),
   an old standalone Redis. Permanent delete, needs the owner's click.
7. `INTERNAL_TOOLS_SHOPS` unset → `/app/checklist` 404s for us too. Set it to
   `rahul-developer-store.myshopify.com` to get it back. Everything it reports is
   duplicated in §2, so leaving it dead is fine.
8. **Agency site** on Cloudflare Pages; then repoint the root A and `www` CNAME off
   Namecheap's parking page.
9. **Partner Directory slug** `vidhan` → needs a Shopify support ticket (§11).

### Known limitations, deliberately not fixed

- **`metafields(first: 50)` per owner ignores its own `hasNextPage`**, so an owner
  with >50 metafields silently loses the rest. A namespace filter makes this far
  less likely but does not remove it. Fixing it needs nested cursor pagination.
- **Key / value / type metafield filtering cannot be server-side.** There is no
  top-level `metafields` query on `QueryRoot` — metafields are only reachable
  through their owner. Type stays a refinement of loaded rows and is labelled as
  such. The old single search box matched namespace/key/value/owner locally; it now
  searches the owner in Shopify, so key/value substring search is gone.
- **File/image metaobject fields** are raw GID text inputs. A native picker needs
  `read_files`/`write_files` and a `stagedUploadsCreate` pipeline.
- **Resend free tier: 100 emails/day**, shared between notifications and support.

### Testing needed — none of this can be driven from a headless session

The app renders in a **cross-origin iframe**, so browser tooling cannot see inside
it (§7). Everything below needs a human in the Shopify admin.

| # | Test | Why it matters | Expected |
| --- | --- | --- | --- |
| 1 | **Cross-store copy** on the dev store | The headline fix of 2026-08-17. Only ever verified via unit-level probes, never through the real UI | Copies succeed. If the target store hasn't been opened in >24h it should say *"MetaVault's access to … has expired. Open MetaVault on that store once"* — **not** a 401 or "0 copied, N failed" |
| 2 | **Metafields filter** — pick namespace `custom`, then search a product name | Server-side filter is new; the UI contract changed | Row count drops to `custom` only, and the footer reads "· filtered in Shopify". Searching a **metafield key** now returns nothing — that is expected, not a bug |
| 3 | **Type filter** with few rows loaded | It is deliberately client-side | Chip reads "Type (loaded rows)" and a line explains Shopify can't filter by type |
| 4 | **Empty state** — filter to a namespace that matches nothing | Used to say "None of your products have metafields yet", which looked like a broken app | Should say **"No matches"** with a Clear filters button |
| 5 | **Run an export** and watch for the email | First real test of merchant notifications since the domain was verified | A "Your MetaVault export is ready" email arrives **from `metavault@storelivo.com`**, not `onboarding@resend.dev` |
| 6 | **Settings page** | The opt-out card is now gated on `canNotifyMerchants()` | The **Email notifications card is visible**. If it isn't, `RESEND_FROM` didn't apply |
| 7 | **Email `support@storelivo.com`** from an outside account | Cloudflare Email Routing was "Syncing" when set up | Lands in `thakorrahul285@gmail.com` |
| 8 | **Submit the in-app support form** | Never exercised end to end — §3 only proved the Resend POST | Row in `SupportRequest` with `emailedAt` set (not `emailError`), and the mail arrives |
| 9 | **Orphan cleaner** on a junk namespace | `collectNamespaceMetafields` changed to filter in the query | Finds and deletes the same set as before, faster |
| 10 | **`/privacy` and `/terms` in a browser** | Hydration fix | Shows `support@storelivo.com` and **stays** on it after load — no flicker back to a placeholder, no React hydration error in the console |

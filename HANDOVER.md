# MetaVault — session handover

Written 2026-08-15. Covers the Railway deployment, App Store submission
progress, the Help & feedback page, and what is left. Read this before touching
anything.

**Where things stand in one paragraph:** the app is live on Railway and healthy.
The App Store listing is filled in and saved with **one blocker left — a
screencast video**. The AI self review has been run (30 pass, 0 fail, 1 needs
review) and marked done. Paid plans now have **no free trial**, deliberately.
The next real engineering task is the **dead offline access token in §5**, which
silently breaks cross-store copy. The next commercial task is **buying the
agency domain**, which unblocks the public contact address and merchant email.

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

---

## 4. Work done this session (all pushed to `main`)

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

**Email is built but effectively off.** The whole notify + template layer works.
`RESEND_API_KEY` and `RESEND_FROM=onboarding@resend.dev` are set on both services.
But that sandbox sender **only delivers to the Resend account owner's address**,
so every merchant's own store email is rejected 403 — and notification failures
are deliberately swallowed so they cannot fail the job, making it silent.

The Settings card was therefore hidden in `e73e232`. `NotificationsCard`, the
loader and the action are all intact; re-rendering it is one line in
`app/routes/app.settings.tsx`. **Restore that card before enabling real sending**,
so merchants have a way to opt out.

To finish email: buy a domain, verify a *subdomain* in Resend
(`mail.youragency.com` — keeps app-mail reputation away from company mail), then
set `RESEND_FROM=metavault@mail.youragency.com`. No code change.

**Support mail is the exception and already works.** The sandbox limitation is
about the *recipient*, and a support request's recipient is the Resend account
owner — so it needs no domain. `SUPPORT_TO_EMAIL` is set on the web service and
proven (§3). Keep it distinct from `APP_CONTACT_EMAIL`: the former is private
routing, the latter is what merchants are shown.

**⚠️ LIVE BUG — the stored offline access token is dead.** Verified 2026-08-15:
the single row in `Session` for `rahul-developer-store` holds a well-formed
`shpat_…` token that Shopify rejects with **401 on API versions 2026-04, 2025-10
and 2025-01**. The row also carries an `expires` in the past, which an offline
session should never have.

The app itself works fine, because token exchange (`unstable_newEmbeddedAuthStrategy`)
mints a token per request and never reads that row. Blast radius, checked rather
than assumed:

- **Background jobs are unaffected** — export/import/backup take `accessToken`
  from the job payload, captured from a live request at enqueue time.
- **Cross-store copy is broken** — [`app.cross-store.tsx:34`](app/routes/app.cross-store.tsx:34)
  reads the stored offline session and uses its token to write to the *target*
  store. With a stale token that 401s, and there is no refresh or repair path.
  That is a paid Agency feature failing.

Not yet diagnosed further. Start here if picking up a bug: does the offline
session ever get refreshed, and should cross-store copy re-exchange instead of
trusting the stored row?

**Other open items**

- **Buy the agency domain.** One purchase closes three things: a real
  `APP_CONTACT_EMAIL` (today it is `metavaultsapp@gmail.com`, a Gmail on a domain
  we don't own, shown on `/privacy`, `/terms` and the support page), the verified
  Resend sending subdomain that merchant email notifications need, and the agency
  site itself. Recommended stack: Cloudflare Pages (free, and the R2 bucket is
  already in that account) + Cloudflare Email Routing for `support@` forwarding.
  `fathomcommerce.com` was available and recommended at the time of writing.
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
- **`APP_CONTACT_EMAIL` is unset in production**, so the support page, `/privacy`
  and `/terms` all display the `support@metavault.app` placeholder — a domain
  that isn't ours, on pages App Store reviewers read. Set it to a real address on
  a domain you control before submitting. Do **not** set it to the personal Gmail
  in `SUPPORT_TO_EMAIL`; that address is deliberately never rendered.

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
- **Metafields filter is client-side** over loaded rows only.
- **AWS SDK v3 will require Node ≥ 22 from January 2027**; the Dockerfile pins
  `node:20-alpine`.

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
| `SUPPORT_TO_EMAIL` | `thakorrahul285@gmail.com` — **private routing inbox.** Must be the Resend account owner's address or the sandbox sender 403s. Never render it in a loader or a page. |
| `APP_CONTACT_EMAIL` | `metavaultsapp@gmail.com` — **public** contact, shown on `/privacy`, `/terms`, support page. Replace with `support@<domain>` once the domain is bought. |
| `RESEND_API_KEY`, `RESEND_FROM` | `onboarding@resend.dev` — sandbox sender, delivers **only** to the Resend account owner. |
| `INTERNAL_TOOLS_SHOPS` | **unset** → `/app/checklist` 404s for everyone. |

Verify a variable from **inside the container** (service → Console →
`printenv NAME`), never from the variables list — see §1 rule 5.

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

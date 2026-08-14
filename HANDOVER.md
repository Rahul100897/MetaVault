# MetaVault — session handover

Written 2026-08-15. Covers the Railway deployment, App Store submission
progress, the Help & feedback page, and what is left. Read this before touching
anything.

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
| **Create listing content** | ❌ needs screenshots |
| **Run AI self review** | ❌ optional |
| **Submit for review** | ❌ |

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

**Other open items**

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

- **Submit one request from the admin.** Everything else is proven (§3); the
  route's own action end to end is not, because the app runs in a cross-origin
  iframe and can't be driven from a tooling session.
- Consider contextual "Report a problem" links from other pages — the route
  already accepts `?type=bug&area=Backups%20%26%20restore` to preselect the form.
- The first submission ("Add specific metafield export") is stored with an
  `emailError`, from before `SUPPORT_TO_EMAIL` was applied. Nothing was lost.

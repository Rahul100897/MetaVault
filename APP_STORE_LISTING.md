# MetaVault — App Store listing draft

Draft for review. Nothing here has been submitted to Shopify.
Character limits are Shopify's; counts in brackets are the draft's length.

---

## App name

```
MetaVault
```
[9 / 30]

**Keep it exactly this — do not list it as "MetaVault app".** Two reasons:
`shopify.app.toml` sets `name = "MetaVault"`, and Shopify's requirements say the
TOML name must align with the listing name; and the naming guidance is to lead
with a distinctive brand rather than append a generic descriptor. "app" adds no
information — every listing on the App Store is an app.

## App tagline

Shown under the name in search results.

```
Bulk edit metafields, metaobjects, backups
```
[42 / 62]

## App introduction

The one-liner at the top of the listing page.

```
Edit metafields in bulk, manage metaobjects, and back up your custom data — without code.
```
[88 / 100]

## App details

```
Shopify's admin makes you edit metafields one resource at a time. MetaVault
gives you a real workspace for custom data.

Browse and bulk edit metafields across products, collections, customers and
orders. Manage metaobject definitions and entries in one place. Import and
export as CSV to make sweeping changes in a spreadsheet, then push them back.

Agencies get more: full snapshots of every metafield and metaobject in a store,
a preview-then-confirm restore, copying custom data between stores you manage,
and ready-made Liquid snippets for rendering metafields in a theme.

An orphan cleaner finds metafield values left behind with no definition, so you
can tidy data other apps left behind.
```
[~640 — trim to 500 if the form rejects it; cut the orphan-cleaner paragraph first]

## Feature list (max 5, 80 chars each)

```
1. Bulk edit metafields — select rows and set values at once, or sweep changes via CSV
2. Import and export metafields and metaobjects as CSV
3. Full backups of your custom data, with preview-then-confirm restore
4. Copy metafields and metaobjects between stores you manage
5. Find and clean up orphaned metafield values left by other apps
```

## Search terms

```
metafields, metafield editor, bulk edit metafields, metaobjects, custom data,
csv import export, metafield backup, bulk metafield update
```

---

## Pricing

Must match `app/lib/plans.ts` exactly — reviewers check this.

| Plan | Price | Trial | Includes |
| --- | --- | --- | --- |
| **Free** | $0 | — | View & edit up to 50 metafields/day · Metaobjects viewer · Single delete |
| **Pro** | $15/month | **none** | Everything in Free · Unlimited edits · CSV import & export · Bulk delete |
| **Agency** | $29/month | **none** | Everything in Pro · Backups & restore · Cross-store copy · Liquid snippets |

**No free trial, deliberately.** Every paid capability is burst-shaped — one
backup, one migration, one bulk CSV, copy the Liquid snippet once — so a trial
lets a merchant take the entire value and cancel before day 8 having paid
nothing. Removing it does not lose that merchant: Shopify never prorates a
recurring charge on cancellation, so a one-off user now pays the full month.
The Free plan is the evaluation path.

---

## URLs

| Field | Value |
| --- | --- |
| App URL | https://metavault-production.up.railway.app |
| Privacy policy | https://metavault-production.up.railway.app/privacy |
| Terms | https://metavault-production.up.railway.app/terms |
| Support email | metavaultsapp@gmail.com |

The support email is public — it is the same address as `APP_CONTACT_EMAIL` and
appears on `/privacy`, `/terms` and the in-app support page. It is deliberately
**not** `SUPPORT_TO_EMAIL`, which routes in-app support requests to a personal
inbox and must stay unpublished. Both are set on the Railway web service.

---

## Screenshots — required, must be captured from the real app

Shopify wants **at least 3** (6 max), **1600 × 900 minimum**, PNG or JPG.
They must be genuine screenshots of the working app — placeholder or mocked
images get the listing rejected.

Suggested set, in order:

1. **Dashboard** — stat tiles, recent activity, plan card. Sets the scene.
2. **Metafields browser** — a populated list across an owner type. This is the
   core value; make sure real definitions and values are visible.
3. **Bulk edit / edit drawer** — mid-edit, showing the editing experience.
4. **Import / Export** — the CSV screen.
5. **Backups** — snapshot history with a restore preview. (Agency proof.)
6. **Metaobjects** — the two-panel definition/entry view.

Capture on a development store with realistic data — an empty store makes the
app look unfinished. Seed a handful of products with real metafield definitions
first.

### Production pipeline

All ten pages have been captured and cropped to exact **2560×1440** and
**1600×900**. Regenerate with:

```bash
python3 scripts/listing-screenshots.py <folder-of-raw-captures>
```

Feed it raw, uncropped window captures named `NN-slug-raw.png`. It crops the
Shopify chrome, removes the dead gutter, and pads with the app canvas colour —
crop and scale only, so the text stays the app's own pixels. **Never run listing
screenshots through a generative image model**; see
`docs/LISTING_SCREENSHOT_PROMPTS.md` for what that does to UI text.

Capture in a window ~1590 CSS px wide to avoid the letterbox on the three
full-width pages (Metafields, Metaobjects, Liquid snippets).

---

## Known gaps to resolve before submitting

- ~~`app_subscriptions/update` webhook is not implemented.~~ **Resolved** in
  commit `d8350ef`, released as app version `metavault-3`
  (`app/routes/webhooks.app.subscriptions_update.tsx`). Plan state now re-syncs
  on the webhook, so a lapsed subscription stops serving paid features.
- Export/import CSVs in object storage have no retention policy (backups do,
  enforced by the daily sweep in `app/jobs/cleanup.server.ts`).
- File/image metaobject fields are GID text inputs, not a native picker. This is
  why the Metaobjects screenshot shows raw `gid://shopify/...` values — shoot the
  **New Arrivals Section** definition rather than Color.

### Blocking the screenshots specifically

Two test values are still in the store and appear in the Metafields capture.
Neither can be fixed by cropping — they must be edited in the store, then the
page re-captured:

- `MINIMAL TEST — overwrote the previous value` (Woven Rattan Cat Cave Bed →
  `custom.subheading`)
- `Test badge` (Woven Rattan Cat Cave Bed → `custom.product_sell_badge`)
- `First line of a multi-line value Second line proves the parser fix Third line`
  (Organic Cotton Bath Towel → `custom.product_key_features`)

---

## Partner Dashboard listing form — values entered

Recorded here because the submission form does not save until *every* required
field is complete, so a half-filled form is lost on navigation.

| Field | Value |
| --- | --- |
| App name | `MetaVault` |
| Primary category | Store design › Content › **Metafields** |
| Metafield types | Collections, Products, Customers, Orders |
| Management tools | Bulk import and export |
| Languages | English |
| App card subtitle | `Bulk edit metafields, manage metaobjects, back up custom data` [61/62] |
| Merchant review email | metavaultsapp@gmail.com |
| App submission email | metavaultsapp@gmail.com |
| Test account | "My app doesn't require an account to use it" |
| Sales channel requirements | "My app doesn't require the Shopify Online Store or Shopify POS" |

**App details** had to be trimmed — the form caps it at 500 characters and the
original draft was 699. The orphan-cleaner paragraph was cut first, as planned:

```
Shopify's admin makes you edit metafields one resource at a time. MetaVault gives you a real workspace for custom data.

Browse and bulk edit metafields across products, collections, customers and orders. Manage metaobject definitions and entries in one place. Import and export as CSV to make sweeping changes in a spreadsheet, then push back.

Agencies get more: full snapshots of every metafield and metaobject, preview-then-confirm restore, cross-store copying, and ready-made Liquid snippets.
```
[497 / 500]

### Reviewer testing instructions

```
No account or credentials are needed — MetaVault authenticates through Shopify session tokens on install.

To test this app:
1. Install MetaVault on a development store that has at least one metafield definition in the "custom" namespace, with values on a few products.
2. Open the app from Apps in the Shopify admin. You land on the Dashboard, which shows metafield/metaobject definition counts and recent activity.
3. Click Metafields. Use the owner-type tabs (Products, Collections, Customers, Orders) and the "Add filter" control to filter by namespace. Edit a value inline and save — the change is written straight to Shopify via the GraphQL Admin API.
4. Click Metaobjects to browse definitions and entries, and to add or edit an entry.
5. Click Import / Export. Choose a resource type and click Export CSV; the file is generated as a background job and appears on the Jobs page when ready. "Download a sample CSV" shows the expected import format (owner_id, namespace, key, type, value). Imports upsert: a row whose namespace and key already exist on that owner is overwritten.
6. Free plan limits editing to 50 metafields/day. CSV import/export requires Pro; Backups, Cross-store copy, Liquid snippets and Orphan cleaner require Agency. Plans can be started, changed and cancelled from Plans & Billing, which uses the Shopify Billing API (appSubscriptionCreate). Test charges are used on development stores, so nothing is billed.
7. Help & Feedback is the in-app support form; submissions are stored and emailed to us.

Backups and restore (Agency) create a full snapshot of every metafield and metaobject; restore shows a preview and requires confirmation before writing. Snapshots are stored privately and expire after 30 days.
```

### Still blocking Save

- **Screenshots** — must be attached by hand. Browser automation cannot upload
  them: the file input only accepts folders shared with the browser session, and
  `~/Downloads` is not one. Files are in
  `~/Downloads/new-screenshot/listing/1600x900/`.
- **Public pricing plans** — the form shows *0 public plans*. These define what
  merchants are actually charged and are published, so they were deliberately
  left for the owner to create via **Manage**. They must match `app/lib/plans.ts`:
  Free $0, Pro $15/month, Agency $29/month — no free trial on either paid plan.

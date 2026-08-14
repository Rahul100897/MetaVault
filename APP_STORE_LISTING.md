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
1. Bulk edit metafields across products, collections, customers and orders
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
| **Pro** | $15/month | 7 days | Everything in Free · Unlimited edits · CSV import & export · Bulk delete |
| **Agency** | $29/month | 7 days | Everything in Pro · Backups & restore · Cross-store copy · Liquid snippets |

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

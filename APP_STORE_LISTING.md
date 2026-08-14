# MetaVault — App Store listing draft

Draft for review. Nothing here has been submitted to Shopify.
Character limits are Shopify's; counts in brackets are the draft's length.

---

## App name

```
MetaVault
```
[9 / 30]

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
| Support email | thakorrahul285@gmail.com |

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

---

## Known gaps to resolve before submitting

- **`app_subscriptions/update` webhook is not implemented.** Plan state is only
  re-synced from Shopify when a merchant opens Plans & Billing, so a lapsed or
  cancelled subscription can keep serving paid features until then.
- Export/import CSVs in object storage have no retention policy (backups do).
- File/image metaobject fields are GID text inputs, not a native picker.

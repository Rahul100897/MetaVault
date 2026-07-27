# MetaVault

**The metafield & metaobject manager for Shopify.** MetaVault gives merchants and
agencies a fast spreadsheet-style editor for metafields and metaobjects, plus
bulk CSV import/export, full-store backup & restore, cross-store copy, Liquid &
GraphQL snippet generation, and orphaned-namespace cleanup.

Built with [Remix](https://remix.run), [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix),
[Polaris](https://polaris.shopify.com), Prisma/PostgreSQL, and a BullMQ/Redis
worker for long-running jobs. All Shopify access goes through the **GraphQL Admin
API** only.

---

## Features

| Area | Free | Pro ($15/mo) | Agency ($29/mo) |
| --- | --- | --- | --- |
| Metafields viewer & inline editor | ✅ (50 edits/day) | ✅ unlimited | ✅ |
| Metaobjects viewer & editor | ✅ | ✅ | ✅ |
| Single delete | ✅ | ✅ | ✅ |
| CSV import & export | — | ✅ | ✅ |
| Bulk delete | — | ✅ | ✅ |
| Job history | — | ✅ | ✅ |
| Backup & restore (with diff preview) | — | — | ✅ |
| Cross-store copy | — | — | ✅ |
| Liquid & GraphQL snippets | — | — | ✅ |
| Namespace inspector / orphan cleaner | — | — | ✅ |

Every paid plan includes a 7-day free trial. Billing runs through Shopify's
`appSubscriptionCreate`; charges are test charges outside production.

---

## Architecture

```
app/
  routes/            Remix routes (embedded admin under /app, public /privacy /terms)
  components/        Shared UI (AppLayout, modals, Legal)
  lib/               Server + client-safe helpers
    billing.server   appSubscriptionCreate / cancel / plan sync
    plan.server      getPlan / isPro / isAgency (reads mirrored ShopSettings)
    bulk.server      bulkOperationRunQuery wrapper
    graphql.server   shared Admin GraphQL request helper (backoff on THROTTLED)
    notify.server    job-completion email payloads (console until a provider is wired)
    namespaces.server namespace scan + delete
  jobs/              BullMQ workers (import, export, backup/restore, snapshot, diff)
prisma/              schema + migrations
```

- **Web server** serves the embedded admin and enqueues jobs.
- **Worker** (`npm run worker`) drains the import/export/backup queues. On
  Railway this is a separate service sharing the same Postgres and Redis.
- **Plan resolution** reads `ShopSettings.plan`, which `syncPlanFromShopify`
  keeps in step with Shopify's active subscription, so page loads stay a single
  indexed DB read.

---

## Local development

### Prerequisites

- Node.js ≥ 20.19 (or ≥ 22.12)
- A [Shopify Partner account](https://partners.shopify.com/signup) and a development store
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started): `npm install -g @shopify/cli@latest`
- PostgreSQL and Redis (local installs, or hosted e.g. Railway)

### Setup

```bash
npm install
```

Create a `.env` from the example and fill it in:

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | App credentials from the Partner Dashboard |
| `SHOPIFY_APP_URL` | Public app URL (tunnel in dev, host in prod) |
| `SCOPES` | Comma-separated access scopes (see `shopify.app.toml`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis for the BullMQ queues |
| `LOCAL_STORAGE_DIR` | Where generated files are stored in dev (default `/tmp/metavault-exports`) |
| `SHOP_PLAN_OVERRIDE` | **Dev only** — force `free`/`pro`/`agency` without a charge (ignored in production) |
| `SHOPIFY_BILLING_TEST` | Force test charges on/off; defaults to on outside production |
| `APP_CONTACT_EMAIL` | Contact address shown on the privacy/terms pages |

Apply migrations and generate the Prisma client:

```bash
npm run setup
```

### Run

In two terminals:

```bash
npm run dev
```

```bash
npm run worker
```

`npm run dev` starts the Shopify CLI + Remix web server (and opens a tunnel);
`npm run worker` starts the BullMQ worker. The worker must be running for CSV
import/export and backup/restore to complete.

---

## Deployment

MetaVault deploys as **two services** sharing one Postgres and one Redis:

1. **Web** — `npm run docker-start` (runs `prisma migrate deploy` then `remix-serve`).
2. **Worker** — `npm run worker`.

A `Dockerfile` is included. On Railway (or similar), create both services from
the same repo, set the environment variables above on each, and point them at
the shared Postgres/Redis. Set `NODE_ENV=production` so billing uses live charges
and `SHOP_PLAN_OVERRIDE` is ignored.

Deploy app config (scopes, webhooks, billing metadata) with:

```bash
npm run deploy
```

---

## App Store submission

An in-app checklist lives at **/app/checklist** (green/amber/red per item). It
verifies the automated items and lists the manual ones:

- ✅ GDPR compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- ✅ GraphQL Admin API only
- ✅ Billing configured (Pro/Agency subscriptions with trials)
- ✅ Privacy policy (`/privacy`) and terms (`/terms`) hosted
- ⬜ Minimal scopes reviewed, fresh-install tested, demo video, screenshots, app icon

Add the hosted `/privacy` and `/terms` URLs to the Partner Dashboard listing.

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Shopify CLI + Remix dev server |
| `npm run worker` | BullMQ worker process |
| `npm run build` | Production build |
| `npm run setup` | `prisma generate && prisma migrate deploy` |
| `npm run lint` | ESLint |
| `npm run deploy` | Push app config to Shopify |

---

## License

Proprietary — © MetaVault. All rights reserved.

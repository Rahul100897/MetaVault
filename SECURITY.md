# MetaVault — Security Policy

Owner: Rahul Thakor · Contact: metavaultsapp@gmail.com
Last reviewed: 2026-08-14 · Review cadence: every 6 months

MetaVault is a Shopify app that manages merchant-defined metafields and
metaobjects. It processes protected customer data only in so far as metafields
and metaobjects are attached to Customer and Order records, and it displays a
customer's name so merchants can identify which record they are editing.

---

## 1. Data loss prevention strategy

### What data exists, and where

| Data | Location | Protection |
| --- | --- | --- |
| Sessions, job records, shop settings, activity log | Railway Postgres (US West) | Managed daily backups; encrypted at rest; private network only |
| Job queue state | Railway Redis | Encrypted at rest; private network only; transient |
| Exports, import error reports, backup snapshots | Cloudflare R2 (`metavault-production`, WNAM) | Private bucket; encrypted at rest; access via time-limited presigned URLs only |
| Secrets (API keys, tokens) | Railway environment variables | Never committed to git; `.env` is gitignored |

### Controls

- **No public object storage.** The R2 bucket has public access disabled.
  Downloads are issued as presigned URLs with a 1-hour expiry, never as
  permanent public links.
- **Least-privilege credentials.** The R2 API token is scoped to a single
  bucket with Object Read & Write only — it cannot create or delete buckets.
  Shopify access scopes are reviewed against actual usage; scopes the app does
  not use are removed (`write_metaobject_definitions` was removed for this
  reason).
- **Secrets never enter version control.** `.env` is gitignored;
  `.env.example` contains empty placeholders only. Credentials are rotated if
  they are ever exposed, and rotation includes redeploying every service that
  consumes them.
- **Backups are bounded, not unbounded.** Snapshots carry a 30-day expiry that
  is enforced by a daily sweep (`app/jobs/cleanup.server.ts`), so customer data
  is not retained indefinitely.
- **Schema changes are versioned.** All database changes ship as Prisma
  migrations in git and are applied on deploy, so state is reproducible and
  reversible.
- **Destructive operations are confirmed.** Restore from a snapshot runs a
  diff/preview step first; the merchant confirms the plan before it is applied.
- **Separate environments.** Development runs against a local database and
  local filesystem storage. Production data is never used for development or
  testing.

### Recovery

- Postgres: restore from Railway's managed backup.
- Merchant metafield/metaobject data: restore from the most recent MetaVault
  snapshot via the in-app Backups → Restore flow.
- Application code: redeploy any previous commit from GitHub.

---

## 2. Security incident response policy

An **incident** is any suspected or confirmed unauthorised access to, loss of,
or disclosure of merchant or customer data, or any compromise of a credential
that could permit it.

### Severity

| Level | Definition | Example |
| --- | --- | --- |
| **P1** | Confirmed exposure of customer or merchant data | Object storage made public; database accessed by a third party |
| **P2** | Credential compromise with no confirmed data access | An API token leaked into a screenshot or log |
| **P3** | Vulnerability with no evidence of exploitation | Dependency CVE affecting a used code path |

### Response

1. **Detect and record.** Log the time of discovery, what was observed, and who
   found it. Start a written timeline immediately.
2. **Contain (target: within 1 hour of discovery).** Revoke the affected
   credential, disable the affected feature, or take the service offline —
   whichever is smallest and sufficient. Rotating a credential includes
   redeploying every service that references it.
3. **Assess.** Determine which shops and what data were affected, and over what
   window. Use the `ActivityLog` table and Railway deploy/access logs.
4. **Notify.**
   - **Shopify: within 24 hours of discovery** for any incident involving
     protected customer data, via the Partner Dashboard emergency contact.
   - **Affected merchants: within 72 hours**, describing what happened, what
     data was involved, and what they should do.
   - Any additional notification required by applicable law (e.g. GDPR
     Article 33).
5. **Remediate.** Fix the root cause, not just the symptom. Ship the fix and
   confirm it in production.
6. **Post-incident review (within 7 days).** Write up the timeline, root cause,
   and the specific control that failed. Record follow-up actions in
   `PRODUCTION_NOTES.md` and update this policy if a gap was found.

### Emergency contact

The Partner Dashboard emergency contact is kept current so Shopify can reach
the app owner directly.

---

## 3. Access control

- Production infrastructure (Railway, Cloudflare, Shopify Partners) is
  administered by the app owner only. There are no additional staff accounts.
- All administrative accounts use unique, randomly generated passwords stored
  in a password manager, with two-factor authentication enabled.
- Access to merchant data is logged: the `ActivityLog` table records the
  action, resource type, affected row count, acting staff account, and
  timestamp for every mutating operation.
- If staff are added in future, access will be granted on a least-privilege
  basis and reviewed when roles change.

---

## 4. Data handling commitments

- The app processes the minimum data needed to provide its functionality, and
  uses it solely for that purpose. It does not sell customer data, use it for
  advertising, or use it for automated decision-making.
- Data is encrypted in transit (TLS on every connection — Shopify Admin API,
  Postgres, Redis, R2) and at rest (Railway managed storage and Cloudflare R2).
- GDPR/CCPA compliance webhooks (`customers/data_request`, `customers/redact`,
  `shop/redact`) are implemented and respond to merchant and customer requests.
- On app uninstall, shop data is removed in line with the `shop/redact`
  webhook.
- What the app processes and why is disclosed to merchants in the in-app
  privacy policy at `/privacy`.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

/**
 * Decode the shop domain from Shopify's base64 `host` param, which is either
 *   admin.shopify.com/store/<handle>   (current)  or
 *   <shop>.myshopify.com/admin         (legacy).
 */
function shopFromHost(host: string): string | null {
  try {
    const decoded = Buffer.from(host, "base64").toString("utf8");
    const store = decoded.match(/\/store\/([^/?#]+)/);
    if (store) return `${store[1]}.myshopify.com`;
    const legacy = decoded.match(/([a-z0-9][a-z0-9-]*\.myshopify\.com)/i);
    if (legacy) return legacy[1];
    return null;
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const params = url.searchParams;

  if (params.get("shop")) {
    throw redirect(`/app?${params.toString()}`);
  }

  // Embedded-bounce recovery: an expired session token can reload the app at
  // `/` with only `host` (no shop). Rather than dead-end on the login form,
  // derive the shop and re-enter /app so it re-authenticates. `_r` caps this at
  // one attempt so a genuinely broken auth can't loop.
  const host = params.get("host");
  if (host && !params.get("_r")) {
    const shop = shopFromHost(host);
    if (shop) {
      params.set("shop", shop);
      params.set("_r", "1");
      throw redirect(`/app?${params.toString()}`);
    }
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>MetaVault</h1>
        <p className={styles.text}>
          The metafield &amp; metaobject manager for Shopify. Open MetaVault from your
          store&apos;s Apps menu, or enter your store domain to sign in.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Edit metafields fast</strong>. A spreadsheet-style editor with bulk
            actions and CSV import/export.
          </li>
          <li>
            <strong>Back up &amp; restore</strong>. Snapshot every metafield and metaobject,
            with a diff preview before you restore.
          </li>
          <li>
            <strong>Agency tools</strong>. Cross-store copy, Liquid &amp; GraphQL snippets,
            and orphaned-namespace cleanup.
          </li>
        </ul>
      </div>
    </div>
  );
}

import type { MetaFunction } from "@remix-run/node";
import { LegalPage, Section, CONTACT_EMAIL } from "../components/Legal";

export const meta: MetaFunction = () => [
  { title: "MetaVault — Privacy Policy" },
  { name: "robots", content: "index" },
];

const P: React.CSSProperties = { margin: "0 0 12px" };
const UL: React.CSSProperties = { margin: "0 0 12px", paddingLeft: "20px" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="July 27, 2026">
      <Section heading="Overview">
        <p style={P}>
          MetaVault (&ldquo;the app&rdquo;, &ldquo;we&rdquo;) is a Shopify app that helps merchants
          view, edit, import, export, back up, and clean up the metafields and metaobjects
          on their store. This policy explains what data the app accesses, why, and how it
          is handled.
        </p>
      </Section>

      <Section heading="Information we access">
        <p style={P}>
          When you install MetaVault on a store, the app requests only the scopes needed to
          do its job:
        </p>
        <ul style={UL}>
          <li>Store metafields and metaobjects (read and write).</li>
          <li>Products, collections, customers, and orders — solely to read and write
            their metafields.</li>
          <li>Your store domain and the installing user&rsquo;s email, used to identify your
            store and send job notifications.</li>
        </ul>
        <p style={P}>
          MetaVault accesses this data only while performing an action you initiate (such as
          an edit, import, export, or backup). It does not read storefront customer browsing
          data and requests no scopes beyond those listed above.
        </p>
      </Section>

      <Section heading="How we use and store data">
        <ul style={UL}>
          <li><b>Metafield &amp; metaobject values</b> are processed to fulfil the action you
            requested. Backups are stored as a snapshot file so you can download or restore
            them, and are automatically deleted after 30 days.</li>
          <li><b>Export and error-report files</b> are generated on demand and served through
            a time-limited, signed download link.</li>
          <li><b>Job records and an activity log</b> (action type, resource, row counts, and
            timestamps) are retained so you can review what the app has done.</li>
          <li>We do <b>not</b> sell your data, and we do not use it for advertising.</li>
        </ul>
      </Section>

      <Section heading="Data retention & deletion">
        <p style={P}>
          Backups expire after 30 days. When you uninstall the app, Shopify notifies us and
          we delete the store&rsquo;s access token, settings, job history, and any stored files.
          MetaVault also honours Shopify&rsquo;s mandatory GDPR webhooks:
        </p>
        <ul style={UL}>
          <li><code>customers/data_request</code> — we report any data held for a customer.</li>
          <li><code>customers/redact</code> — we delete data associated with a customer.</li>
          <li><code>shop/redact</code> — we delete all data for a store 48 hours after
            uninstall.</li>
        </ul>
      </Section>

      <Section heading="Subprocessors">
        <p style={P}>
          MetaVault runs on standard cloud infrastructure (application hosting, a PostgreSQL
          database, a Redis queue, and object storage for generated files). These providers
          process data only to operate the service on our behalf.
        </p>
      </Section>

      <Section heading="Your rights">
        <p style={P}>
          You may request access to, correction of, or deletion of your data at any time by
          contacting us. Uninstalling the app triggers deletion automatically.
        </p>
      </Section>

      <Section heading="Contact">
        <p style={P}>
          Questions about this policy? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "#6366F1" }}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}

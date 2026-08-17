import type { MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { LegalPage, Section, ContactLine } from "../components/Legal";
import { publicContactEmail } from "../lib/contact.server";

export const meta: MetaFunction = () => [
  { title: "MetaVault — Terms of Service" },
  { name: "robots", content: "index" },
];

export const loader = () => ({ contactEmail: publicContactEmail() });

const P: React.CSSProperties = { margin: "0 0 12px" };
const UL: React.CSSProperties = { margin: "0 0 12px", paddingLeft: "20px" };

export default function Terms() {
  const { contactEmail } = useLoaderData<typeof loader>();
  return (
    <LegalPage title="Terms of Service" updated="July 27, 2026">
      <Section heading="Acceptance">
        <p style={P}>
          By installing or using MetaVault (&ldquo;the app&rdquo;) on your Shopify store, you agree to
          these Terms of Service. If you do not agree, please do not install or use the app.
        </p>
      </Section>

      <Section heading="The service">
        <p style={P}>
          MetaVault provides tools to manage Shopify metafields and metaobjects — including
          viewing, editing, bulk import/export, backup and restore, cross-store copy, Liquid
          and GraphQL snippet generation, and namespace cleanup. Features vary by plan.
        </p>
      </Section>

      <Section heading="Plans & billing">
        <ul style={UL}>
          <li>The <b>Free</b> plan is available at no charge with limited usage.</li>
          <li><b>Pro</b> ($15/month) and <b>Agency</b> ($29/month) are recurring subscriptions
            billed through Shopify. They do not include a free trial &mdash; use the Free plan
            to try the app before subscribing.</li>
          <li>Charges appear on your regular Shopify invoice. You may cancel at any time from
            the app&rsquo;s billing page; access to paid features ends when the subscription is
            cancelled. Cancelling does not refund the current billing period.</li>
          <li>Except where required by law, charges already billed are non-refundable.</li>
        </ul>
      </Section>

      <Section heading="Acceptable use">
        <p style={P}>You agree not to:</p>
        <ul style={UL}>
          <li>Use the app to violate Shopify&rsquo;s terms, applicable law, or third-party rights.</li>
          <li>Attempt to disrupt, reverse-engineer, or gain unauthorized access to the service.</li>
          <li>Use the app to store or transmit unlawful content.</li>
        </ul>
      </Section>

      <Section heading="Your data & responsibility">
        <p style={P}>
          You are responsible for the changes you make with the app. Bulk edits, deletes,
          restores, and namespace cleanup can overwrite or remove store data — we recommend
          taking a backup first. You retain ownership of your store&rsquo;s data; our handling of
          it is described in our{" "}
          <a href="/privacy" style={{ color: "#6366F1" }}>
            Privacy Policy
          </a>
          .
        </p>
      </Section>

      <Section heading="Warranty disclaimer">
        <p style={P}>
          The app is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind,
          whether express or implied, including fitness for a particular purpose and
          non-infringement. We do not warrant that the app will be uninterrupted or
          error-free.
        </p>
      </Section>

      <Section heading="Limitation of liability">
        <p style={P}>
          To the maximum extent permitted by law, MetaVault and its operators are not liable
          for any indirect, incidental, or consequential damages, or for any loss of data or
          profits, arising from your use of the app. Our total liability is limited to the
          amount you paid for the app in the three months preceding the claim.
        </p>
      </Section>

      <Section heading="Changes & termination">
        <p style={P}>
          We may update these terms or modify the service over time; continued use after a
          change constitutes acceptance. Either party may terminate by uninstalling the app,
          which ends your right to use it.
        </p>
      </Section>

      <ContactLine lead="Questions about these terms? Email" email={contactEmail} />
    </LegalPage>
  );
}

/**
 * Shared layout for the public legal pages (privacy, terms). These render
 * outside the embedded admin, so they don't use Polaris/AppProvider — just
 * self-contained, readable HTML.
 */

const CONTAINER: React.CSSProperties = {
  maxWidth: "760px",
  margin: "0 auto",
  padding: "56px 24px 96px",
  fontFamily:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  color: "#1F2430",
  lineHeight: 1.65,
};

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main style={CONTAINER}>
      <a
        href="/"
        style={{ color: "#6366F1", textDecoration: "none", fontSize: "14px", fontWeight: 600 }}
      >
        MetaVault
      </a>
      <h1 style={{ fontSize: "32px", fontWeight: 800, margin: "20px 0 6px", letterSpacing: "-0.5px" }}>
        {title}
      </h1>
      <p style={{ color: "#6B7280", fontSize: "14px", margin: "0 0 32px" }}>
        Last updated {updated}
      </p>
      <div style={{ fontSize: "15px" }}>{children}</div>
    </main>
  );
}

export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "28px" }}>
      <h2 style={{ fontSize: "19px", fontWeight: 700, margin: "0 0 8px" }}>{heading}</h2>
      {children}
    </section>
  );
}

/** Contact address surfaced on both legal pages; override via APP_CONTACT_EMAIL. */
export const CONTACT_EMAIL = process.env.APP_CONTACT_EMAIL ?? "support@metavault.app";

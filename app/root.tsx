import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";

/**
 * `Layout` wraps BOTH the app and the ErrorBoundary, so the document shell is
 * defined once. Without it a root error boundary has to re-declare <html>, and
 * any mistake there produces an unstyled browser-default page.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * Last-resort error screen.
 *
 * Anything a route boundary doesn't handle ends up here — including errors that
 * `boundary.error()` in app.tsx re-throws because they aren't Shopify auth
 * errors. Without this, Remix renders its built-in page: the words "Application
 * Error" over an empty box, with no explanation and no way forward. A merchant
 * reads that as a broken app, and an App Store reviewer reads it the same way.
 *
 * Deliberately shows no stack trace or raw message — those leak internals to
 * merchants and mean nothing to them. The status code is enough to correlate
 * with server logs.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;

  const heading =
    status === 404 ? "We couldn't find that page" : "Something went wrong";
  const detail =
    status === 404
      ? "The page you're looking for doesn't exist, or has moved."
      : "This is on our side, not yours — nothing in your store was changed. Reloading usually fixes it.";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#F6F6F7",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "460px",
          width: "100%",
          background: "#FFFFFF",
          borderRadius: "12px",
          boxShadow: "0 1px 3px rgba(16,24,46,0.08)",
          padding: "32px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            margin: "0 auto 20px",
            borderRadius: "12px",
            background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 8v5M12 16.5v.5"
              stroke="#FFFFFF"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="12" cy="12" r="9" stroke="#FFFFFF" strokeWidth="2" />
          </svg>
        </div>

        <h1
          style={{
            margin: "0 0 8px",
            fontSize: "20px",
            fontWeight: 600,
            color: "#1F2430",
            letterSpacing: "-0.3px",
          }}
        >
          {heading}
        </h1>
        <p
          style={{
            margin: "0 0 24px",
            fontSize: "14px",
            lineHeight: 1.6,
            color: "#6B7280",
          }}
        >
          {detail}
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: "#0A0F1E",
            color: "#FFFFFF",
            border: "none",
            borderRadius: "8px",
            padding: "10px 20px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload
        </button>

        <p style={{ margin: "20px 0 0", fontSize: "12px", color: "#9CA3AF" }}>
          If it keeps happening, tell us from Help &amp; feedback
          {status ? ` (reference ${status})` : ""}.
        </p>
      </div>
    </div>
  );
}

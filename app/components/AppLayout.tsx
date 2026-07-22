import { Link, useLocation } from "@remix-run/react";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    to: "/app",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path
          d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points="9 22 9 12 15 12 15 22"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: "Metafields",
    to: "/app/metafields",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="2"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M3 9h18M3 15h18M9 3v18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: "Metaobjects",
    to: "/app/metaobjects",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: "Import / Export",
    to: "/app/import-export",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path
          d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: "Jobs",
    to: "/app/jobs",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "Backups",
    to: "/app/backups",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    label: "Cross-store Copy",
    to: "/app/cross-store",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M4 7h10M4 7l3-3M4 7l3 3M20 17H10M20 17l-3-3M20 17l-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "Liquid Snippets",
    to: "/app/snippets",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "Orphan Cleaner",
    to: "/app/orphans",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
        <path d="M21 21l-4-4M8 11h6M11 8v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Activity Log",
    to: "/app/activity",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path
          d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points="14 2 14 8 20 8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="16"
          y1="13"
          x2="8"
          y2="13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="16"
          y1="17"
          x2="8"
          y2="17"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <polyline
          points="10 9 9 9 8 9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: "Plans & Billing",
    to: "/app/billing",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M2 10h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M6 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Settings",
    to: "/app/settings",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
        <path
          d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
] as const;

type Props = {
  children: React.ReactNode;
  plan?: "free" | "pro" | "agency";
};

const PLAN_COLORS: Record<string, string> = {
  free: "#6B7280",
  pro: "#6366F1",
  agency: "#8B5CF6",
};

export default function AppLayout({ children, plan = "free" }: Props) {
  const location = useLocation();

  const isActive = (to: string) => {
    if (to === "/app") return location.pathname === "/app";
    return location.pathname.startsWith(to);
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: "240px",
          minWidth: "240px",
          background: "#0A0F1E",
          display: "flex",
          flexDirection: "column",
          boxShadow: "2px 0 8px rgba(0,0,0,0.3)",
          zIndex: 10,
        }}
      >
        {/* Logo / Brand */}
        <div
          style={{
            padding: "24px 20px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <div
                style={{
                  color: "#FFFFFF",
                  fontSize: "16px",
                  fontWeight: 700,
                  letterSpacing: "-0.3px",
                  lineHeight: 1,
                }}
              >
                MetaVault
              </div>
              <div
                style={{
                  color: "rgba(255,255,255,0.4)",
                  fontSize: "11px",
                  marginTop: "3px",
                }}
              >
                Metafield Manager
              </div>
            </div>
          </div>

          {/* Plan badge */}
          <div style={{ marginTop: "14px" }}>
            <span
              style={{
                background: PLAN_COLORS[plan] + "22",
                color: PLAN_COLORS[plan],
                border: `1px solid ${PLAN_COLORS[plan]}44`,
                borderRadius: "20px",
                padding: "3px 10px",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.3px",
                textTransform: "uppercase",
              }}
            >
              {plan} Plan
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  marginBottom: "2px",
                  textDecoration: "none",
                  color: active ? "#FFFFFF" : "rgba(255,255,255,0.55)",
                  background: active
                    ? "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(99,102,241,0.15))"
                    : "transparent",
                  borderLeft: active
                    ? "2px solid #6366F1"
                    : "2px solid transparent",
                  transition: "all 0.15s ease",
                  fontSize: "14px",
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span
                  style={{
                    color: active ? "#6366F1" : "rgba(255,255,255,0.4)",
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: "11px" }}>
            MetaVault v1.0.0
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          overflow: "auto",
          background: "#F6F6F7",
        }}
      >
        {children}
      </main>
    </div>
  );
}

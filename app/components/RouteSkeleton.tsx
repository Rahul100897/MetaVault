/**
 * Destination-aware loading skeletons.
 *
 * AppLayout renders <RouteSkeleton pathname={destination}/> while a navigation
 * is in flight, so clicking a nav item shows a skeleton shaped like the page
 * you're going TO — not the one you're leaving. This is what fixes the "wrong
 * skeleton" bug and gives every screen an instant loading state.
 */

import { Shimmer, MetaVaultLoader } from "./Loader";

const CARD: React.CSSProperties = {
  background: "#FFFFFF",
  borderRadius: "12px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

function PageHeader({ withActions = true }: { withActions?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        paddingTop: "8px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <Shimmer width={220} height={26} />
        <Shimmer width={320} height={13} />
      </div>
      {withActions && (
        <div style={{ display: "flex", gap: "10px" }}>
          <Shimmer width={110} height={34} radius={8} />
          <Shimmer width={130} height={34} radius={8} />
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <PageHeader />
      {/* Stat cards */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ ...CARD, padding: "20px 24px", flex: 1, minWidth: "180px" }}>
            <Shimmer width="55%" height={12} />
            <div style={{ height: "14px" }} />
            <Shimmer width="40%" height={28} />
          </div>
        ))}
      </div>
      {/* Two-column: activity + side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "16px" }}>
        <div style={{ ...CARD, padding: "20px 24px" }}>
          <Shimmer width={160} height={16} />
          <div style={{ height: "20px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {[0, 1, 2, 3].map((i) => (
              <Shimmer key={i} width="100%" height={16} />
            ))}
          </div>
        </div>
        <div style={{ ...CARD, padding: "20px 24px" }}>
          <Shimmer width={120} height={16} />
          <div style={{ height: "20px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[0, 1, 2, 3].map((i) => (
              <Shimmer key={i} width="100%" height={38} radius={8} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ ...CARD, overflow: "hidden" }}>
      {/* Dark header bar, matching the real tables */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: "16px",
          padding: "14px 20px",
          background: "#0A0F1E",
        }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={i}
            style={{
              height: "12px",
              width: "60%",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.18)",
            }}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: "16px",
            padding: "14px 20px",
            borderBottom: "1px solid #F3F4F6",
            background: r % 2 === 0 ? "#FFFFFF" : "#FAFAFB",
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Shimmer key={c} width={c === 0 ? "80%" : "55%"} height={13} />
          ))}
        </div>
      ))}
    </div>
  );
}

function MetafieldsSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader />
      {/* Owner-type tab pills */}
      <div style={{ display: "flex", gap: "8px" }}>
        {[0, 1, 2, 3].map((i) => (
          <Shimmer key={i} width={110} height={36} radius={10} />
        ))}
      </div>
      <TableSkeleton rows={9} cols={6} />
    </div>
  );
}

function TwoPanelSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader withActions={false} />
      <div
        style={{
          ...CARD,
          display: "flex",
          overflow: "hidden",
          minHeight: "520px",
        }}
      >
        {/* Left list */}
        <div
          style={{
            width: "280px",
            minWidth: "280px",
            borderRight: "1px solid #ECECF1",
            background: "#FBFBFD",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <Shimmer width={120} height={14} style={{ marginBottom: "6px" }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Shimmer key={i} width="100%" height={52} radius={10} />
          ))}
        </div>
        {/* Right detail */}
        <div style={{ flex: 1, padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
          <Shimmer width={200} height={20} />
          <Shimmer width={140} height={13} />
          <div style={{ height: "8px" }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Shimmer key={i} width="100%" height={40} radius={8} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Generic page: header + a card that hosts the animated mark. */
function GenericSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader />
      <div
        style={{
          ...CARD,
          minHeight: "360px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MetaVaultLoader />
      </div>
    </div>
  );
}

const FULL_WIDTH = new Set(["/app/metafields", "/app/metaobjects", "/app/snippets"]);

export default function RouteSkeleton({ pathname }: { pathname: string }) {
  let body: React.ReactNode;
  if (pathname === "/app" || pathname === "/app/") {
    body = <DashboardSkeleton />;
  } else if (pathname.startsWith("/app/metafields")) {
    body = <MetafieldsSkeleton />;
  } else if (
    pathname.startsWith("/app/metaobjects") ||
    pathname.startsWith("/app/snippets")
  ) {
    body = <TwoPanelSkeleton />;
  } else if (pathname.startsWith("/app/activity") || pathname.startsWith("/app/jobs")) {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <PageHeader />
        <TableSkeleton rows={8} cols={5} />
      </div>
    );
  } else {
    body = <GenericSkeleton />;
  }

  const fullWidth = [...FULL_WIDTH].some((p) => pathname.startsWith(p));

  return (
    <div
      className="mv-skeleton-root"
      style={{
        padding: fullWidth ? "20px 16px" : "20px",
        maxWidth: fullWidth ? "none" : "1000px",
        margin: "0 auto",
        width: "100%",
      }}
    >
      {body}
    </div>
  );
}

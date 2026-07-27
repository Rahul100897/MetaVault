/**
 * Loading primitives shared across the app: the animated MetaVault mark, a
 * shimmer block for skeletons, and the keyframes both rely on.
 *
 * The keyframes live in <SkeletonStyles/>, which AppLayout renders once so the
 * animations are available everywhere without each skeleton re-injecting them.
 */

/** Injected once by AppLayout. Defines every animation the skeletons use. */
export function SkeletonStyles() {
  return (
    <style>{`
      @keyframes mv-shimmer {
        0% { background-position: -450px 0; }
        100% { background-position: 450px 0; }
      }
      @keyframes mv-float {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-7px) scale(1.06); }
      }
      @keyframes mv-glow {
        0%, 100% { box-shadow: 0 8px 22px rgba(99,102,241,0.32); }
        50% { box-shadow: 0 16px 38px rgba(139,92,246,0.55); }
      }
      @keyframes mv-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .mv-shimmer {
        background: linear-gradient(90deg, #E9EBEF 25%, #F5F6F8 50%, #E9EBEF 75%);
        background-size: 900px 100%;
        animation: mv-shimmer 1.4s infinite linear;
      }
      .mv-loader-mark {
        animation: mv-float 1.8s ease-in-out infinite, mv-glow 1.8s ease-in-out infinite;
      }
      .mv-skeleton-root { animation: mv-fade-in 0.15s ease-in; }
    `}</style>
  );
}

/** A single shimmering placeholder block. */
export function Shimmer({
  width = "100%",
  height = 14,
  radius = 8,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="mv-shimmer"
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

/** The animated MetaVault mark — a floating, glowing gradient tile. */
export function MetaVaultLoader({ label = "Loading…" }: { label?: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "16px",
      }}
    >
      <div
        className="mv-loader-mark"
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "16px",
          background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="white">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>
      {label && (
        <span style={{ color: "#6B7280", fontSize: "13px", fontWeight: 500 }}>{label}</span>
      )}
    </div>
  );
}

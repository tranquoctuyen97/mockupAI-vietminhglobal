/**
 * Authed area loading skeleton.
 * Matches dashboard layout dimensions to prevent CLS (content-jumping §3).
 * Uses skeleton shimmer animation (progressive-loading §3).
 */
export default function Loading() {
  return (
    <div>
      {/* Header skeleton */}
      <div className="skeleton" style={{ width: 180, height: 28, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: 300, height: 16, marginBottom: 32 }} />

      {/* Stat cards (4 columns) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        {[...Array(4)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 96, borderRadius: 16 }} />
        ))}
      </div>

      {/* Chart area */}
      <div className="skeleton" style={{ height: 320, borderRadius: 20, marginBottom: 24 }} />

      {/* List rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10 }} />
        ))}
      </div>
    </div>
  );
}

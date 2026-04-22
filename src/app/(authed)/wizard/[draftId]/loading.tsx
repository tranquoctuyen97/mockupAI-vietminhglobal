/**
 * Wizard step loading skeleton.
 * Reserves space for step content to prevent CLS.
 */
export default function Loading() {
  return (
    <div>
      {/* Step title */}
      <div className="skeleton" style={{ width: 160, height: 24, marginBottom: 6 }} />
      <div className="skeleton" style={{ width: 260, height: 14, marginBottom: 24 }} />

      {/* Content area */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 180, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}

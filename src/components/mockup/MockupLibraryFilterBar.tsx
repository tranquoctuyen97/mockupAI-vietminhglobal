"use client";

export type MockupLibraryFilter = "all" | "has" | "missing";

interface MockupLibraryFilterBarProps {
  activeFilter: MockupLibraryFilter;
  counts: Record<MockupLibraryFilter, number>;
  onChange: (filter: MockupLibraryFilter) => void;
}

const FILTERS: Array<{ key: MockupLibraryFilter; label: string }> = [
  { key: "all", label: "Tất cả" },
  { key: "has", label: "Đã có" },
  { key: "missing", label: "Thiếu" },
];

export function MockupLibraryFilterBar({
  activeFilter,
  counts,
  onChange,
}: MockupLibraryFilterBarProps) {
  return (
    <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
      {FILTERS.map((filter) => {
        const active = activeFilter === filter.key;
        return (
          <button
            key={filter.key}
            type="button"
            onClick={() => onChange(filter.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              minHeight: 36,
              padding: "7px 12px",
              borderRadius: 999,
              border: active ? "1px solid #9fe870" : "1px solid var(--border-default)",
              background: active ? "#9fe870" : "var(--bg-inset, #f6f6f4)",
              color: active ? "#163300" : "var(--text-primary)",
              fontSize: "0.78rem",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {filter.label}
            <span
              style={{
                minWidth: 22,
                height: 22,
                borderRadius: 999,
                display: "inline-grid",
                placeItems: "center",
                padding: "0 7px",
                background: active ? "rgba(22,51,0,0.12)" : "var(--bg-primary)",
                border: active ? "1px solid rgba(22,51,0,0.16)" : "1px solid var(--border-default)",
                fontSize: "0.68rem",
              }}
            >
              {counts[filter.key] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

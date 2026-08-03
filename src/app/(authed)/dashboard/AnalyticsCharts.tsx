import type { AnalyticsMetricKey, TripleWhaleAnalyticsResult } from "@/lib/triple-whale/analytics";

const CHARTS: Array<{ key: AnalyticsMetricKey; label: string; currency: boolean }> = [
  { key: "orderRevenue", label: "Order revenue", currency: true },
  { key: "orders", label: "Orders", currency: false },
  { key: "blendedAdSpend", label: "Ads", currency: true },
  { key: "totalCost", label: "Cost", currency: true },
  { key: "netProfit", label: "Net profit", currency: true },
];
const COLORS = ["#54a9ed", "#6fcf97", "#f2b84b", "#f57835", "#818ce4", "#9fe870"];

function formatValue(value: number, currency: boolean): string {
  if (!currency) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const absolute = Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value < 0 ? `-$${absolute}` : `$${absolute}`;
}

function linePoints(values: Array<number | null>, min: number, max: number): string {
  return values
    .map((value, index) => {
      if (value == null) return null;
      const x = values.length === 1 ? 50 : 4 + (index / (values.length - 1)) * 92;
      const y = max === min ? 27 : 48 - ((value - min) / (max - min)) * 42;
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(" ");
}

function Trend({
  label,
  points,
}: {
  label: string;
  points: Array<{ date: string; current: number; previous: number | null }>;
}) {
  if (!points.length) return <EmptyChart />;
  const values = points.flatMap((point) =>
    point.previous == null ? [point.current] : [point.current, point.previous],
  );
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  return (
    <div>
      <div style={{ display: "flex", fontSize: 10, gap: 14, margin: "10px 0 2px" }}>
        <span>
          <i
            style={{
              background: "#6b5cff",
              borderRadius: 99,
              display: "inline-block",
              height: 7,
              marginRight: 5,
              width: 7,
            }}
          />
          Current
        </span>
        <span>
          <i
            style={{
              background: "var(--text-muted)",
              borderRadius: 99,
              display: "inline-block",
              height: 7,
              marginRight: 5,
              width: 7,
            }}
          />
          Previous
        </span>
      </div>
      <svg
        aria-label={`${label} daily current and previous trend`}
        role="img"
        viewBox="0 0 100 56"
        style={{ height: 170, overflow: "visible", width: "100%" }}
      >
        <title>{`${label} daily trend. Solid line is current period; dashed line is previous period.`}</title>
        <line x1="4" x2="96" y1="48" y2="48" stroke="var(--border-default)" strokeWidth="0.6" />
        <polyline
          fill="none"
          points={linePoints(
            points.map((point) => point.previous),
            min,
            max,
          )}
          stroke="var(--text-muted)"
          strokeDasharray="3 2"
          strokeWidth="1.6"
        />
        <polyline
          fill="none"
          points={linePoints(
            points.map((point) => point.current),
            min,
            max,
          )}
          stroke="#6b5cff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        {points.map((point, index) => {
          const x = points.length === 1 ? 50 : 4 + (index / (points.length - 1)) * 92;
          const y = max === min ? 27 : 48 - ((point.current - min) / (max - min)) * 42;
          return (
            <circle cx={x} cy={y} fill="#6b5cff" key={point.date} r="1.8">
              <title>{`${point.date}: ${point.current}`}</title>
            </circle>
          );
        })}
      </svg>
      <div
        style={{
          color: "var(--text-muted)",
          display: "flex",
          fontSize: 10,
          justifyContent: "space-between",
        }}
      >
        <span>{points[0]?.date}</span>
        <span>{points.at(-1)?.date}</span>
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div
      style={{
        alignItems: "center",
        color: "var(--text-muted)",
        display: "flex",
        fontSize: 12,
        justifyContent: "center",
        minHeight: 190,
      }}
    >
      No data for this period
    </div>
  );
}

function Distribution({
  currency,
  items,
}: {
  currency: boolean;
  items: Array<{ shopId: string; label: string; value: number }>;
}) {
  if (!items.length) return <EmptyChart />;
  const sorted = [...items].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const max = Math.max(...sorted.map((item) => Math.abs(item.value)), 1);
  return (
    <div
      aria-label="Shop value comparison chart"
      role="img"
      style={{ display: "grid", gap: 11, minHeight: 190, paddingTop: 18 }}
    >
      {sorted.map((item, index) => (
        <div key={item.shopId}>
          <div
            style={{
              display: "flex",
              fontSize: 11,
              gap: 12,
              justifyContent: "space-between",
              marginBottom: 5,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.label}
            </span>
            <strong
              style={{ color: item.value < 0 ? "var(--color-danger)" : "var(--text-primary)" }}
            >
              {formatValue(item.value, currency)}
            </strong>
          </div>
          <div
            style={{
              background: "var(--bg-secondary)",
              borderRadius: 99,
              height: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: item.value < 0 ? "var(--color-danger)" : COLORS[index % COLORS.length],
                borderRadius: 99,
                height: "100%",
                width: `${(Math.abs(item.value) / max) * 100}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsCharts({
  distribution,
  daily,
  selectedShopId,
}: {
  distribution: TripleWhaleAnalyticsResult["analytics"]["distribution"];
  daily: TripleWhaleAnalyticsResult["analytics"]["daily"];
  selectedShopId: string;
}) {
  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
        {selectedShopId ? "Daily trends" : "Distribution by shop"}
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {CHARTS.map(({ key, label, currency }) => (
          <article className="card" key={key} style={{ padding: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 750 }}>{label}</h3>
            {selectedShopId ? (
              <Trend label={label} points={daily[key]} />
            ) : (
              <Distribution currency={currency} items={distribution[key]} />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

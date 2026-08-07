import type { AnalyticsMetricKey, TripleWhaleAnalyticsResult } from "@/lib/triple-whale/analytics";

import AnalyticsDistributionPie from "./AnalyticsDistributionPie";
import { buildShopColorMap } from "./analytics-chart-model";

const CHARTS: Array<{ key: AnalyticsMetricKey; label: string; currency: boolean }> = [
  { key: "orderRevenue", label: "Order revenue %", currency: true },
  { key: "orders", label: "Order %", currency: false },
  { key: "blendedAdSpend", label: "Ads", currency: true },
  { key: "totalCost", label: "Cost %", currency: true },
  { key: "netProfit", label: "Net profit %", currency: true },
];

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

export default function AnalyticsCharts({
  distribution,
  daily,
  selectedShopId,
}: {
  distribution: TripleWhaleAnalyticsResult["analytics"]["distribution"];
  daily: TripleWhaleAnalyticsResult["analytics"]["daily"];
  selectedShopId: string;
}) {
  const colorByShop = buildShopColorMap(distribution);

  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
        {selectedShopId ? "Daily trends" : "Distribution by shop"}
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {CHARTS.map(({ key, label, currency }) => (
          <article className="card" key={key} style={{ padding: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 750 }}>
              {selectedShopId ? label.replace(/ %$/, "") : label}
            </h3>
            {selectedShopId ? (
              <Trend label={label.replace(/ %$/, "")} points={daily[key]} />
            ) : (
              <AnalyticsDistributionPie
                colorByShop={colorByShop}
                currency={currency}
                items={distribution[key]}
                label={label}
              />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

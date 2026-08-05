import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import type { AnalyticsMetricKey, MetricSummary } from "@/lib/triple-whale/analytics";

interface Point {
  date: string;
  current: number;
  previous: number | null;
}

function sparklinePoints(values: Array<number | null>, min: number, max: number): string {
  return values
    .map((value, index) => {
      if (value == null) return null;
      const x = values.length === 1 ? 48 : (index / (values.length - 1)) * 96;
      const y = max === min ? 18 : 32 - ((value - min) / (max - min)) * 28;
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(" ");
}

function isFavorable(
  metricKey: AnalyticsMetricKey,
  direction: MetricSummary["direction"],
): boolean {
  if (direction === "flat" || direction === "none") return false;
  const lowerIsBetter = metricKey === "blendedAdSpend" || metricKey === "totalCost";
  return lowerIsBetter ? direction === "down" : direction === "up";
}

function formatMetric(value: number | null, currency: boolean): string {
  if (value == null) return "—";
  if (!currency) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  });
}

function deltaText(metric: MetricSummary): string {
  if (metric.previous === 0 && metric.current !== 0) return "New activity";
  if (metric.percentChange == null) return "No prior data";
  const change =
    metric.direction === "up" ? "increase" : metric.direction === "down" ? "decrease" : "change";
  return `${Math.abs(metric.percentChange).toFixed(1)}% ${change}`;
}

function deltaIcon(direction: MetricSummary["direction"]) {
  if (direction === "up") return ArrowUpRight;
  if (direction === "down") return ArrowDownRight;
  return ArrowRight;
}

function trendData(points: Point[]) {
  const allValues = points.flatMap((point) =>
    point.previous == null ? [point.current] : [point.current, point.previous],
  );
  const min = Math.min(...allValues, 0);
  const max = Math.max(...allValues, 0);
  return {
    current: sparklinePoints(
      points.map((point) => point.current),
      min,
      max,
    ),
    currentDotY: sparklinePoints([points[0]?.current ?? 0], min, max).split(",")[1],
    previous: sparklinePoints(
      points.map((point) => point.previous),
      min,
      max,
    ),
    previousDotY:
      points[0]?.previous == null
        ? undefined
        : sparklinePoints([points[0].previous], min, max).split(",")[1],
  };
}

export default function AnalyticsStatCard({
  label,
  metricKey,
  metric,
  points,
  comparisonLabel,
  currency = false,
  statusText,
  showTrend = true,
}: {
  label: string;
  metricKey: AnalyticsMetricKey;
  metric: MetricSummary;
  points: Point[];
  comparisonLabel?: string;
  currency?: boolean;
  statusText?: string;
  showTrend?: boolean;
}) {
  const formatted = formatMetric(metric.current, currency);
  const favorable = isFavorable(metricKey, metric.direction);
  const color =
    metric.direction === "flat" || metric.direction === "none"
      ? "var(--text-muted)"
      : favorable
        ? "#16803c"
        : "var(--color-danger)";
  const DeltaIcon = deltaIcon(metric.direction);
  const deltaLabel = deltaText(metric);
  const trend = showTrend && points.length >= 2 ? trendData(points) : null;
  const visibleStatus = showTrend
    ? (statusText ??
      (!metric.complete
        ? metric.current == null
          ? "Syncing requested data"
          : "Syncing comparison data"
        : undefined))
    : statusText;

  return (
    <article className="card card-sm analytics-stat-card">
      <div
        className="analytics-stat-card__body"
        style={{
          color: "var(--text-muted)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          alignItems: "end",
          display: "flex",
          gap: 10,
          justifyContent: "space-between",
          marginTop: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 850, letterSpacing: "-0.04em" }}>{formatted}</div>
          {visibleStatus ? (
            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 8 }}>
              {visibleStatus}
            </div>
          ) : (
            showTrend && (
              <div
                className="analytics-stat-card__delta"
                style={{
                  alignItems: "center",
                  color,
                  display: "flex",
                  fontSize: 11,
                  fontWeight: 700,
                  gap: 3,
                  marginTop: 8,
                }}
              >
                <DeltaIcon size={14} /> {deltaLabel}
                {metric.direction !== "flat" && metric.direction !== "none" && (
                  <span className="sr-only">{favorable ? "Favorable" : "Unfavorable"}</span>
                )}
              </div>
            )
          )}
          {comparisonLabel && metric.complete && showTrend && (
            <div
              className="analytics-stat-card__comparison"
              style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 4 }}
            >
              {comparisonLabel}
            </div>
          )}
        </div>
        {showTrend && trend && (
          <svg
            aria-label={`${label} current and previous period trend`}
            className="analytics-stat-card__sparkline"
            height="44"
            role="img"
            viewBox="0 0 96 36"
            width="96"
          >
            <title>{`${label}: Current period compared with Previous period`}</title>
            {trend.previous && (
              <polyline
                fill="none"
                points={trend.previous}
                stroke="var(--text-muted)"
                strokeDasharray="3 3"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            )}
            <polyline
              fill="none"
              points={trend.current}
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            />
            {points.length === 1 && (
              <>
                {points[0]?.previous != null && (
                  <circle cx="48" cy={trend.previousDotY} fill="var(--text-muted)" r="3" />
                )}
                <circle cx="48" cy={trend.currentDotY} fill={color} r="3.5" />
              </>
            )}
          </svg>
        )}
      </div>
    </article>
  );
}

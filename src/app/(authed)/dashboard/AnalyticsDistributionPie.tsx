"use client";

import type { ReactNode } from "react";
import type { PieLabelRenderProps } from "recharts";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { buildPieSlices, type PieSlice, type ShopColorMap } from "./analytics-chart-model";

function formatValue(value: number, currency: boolean): string {
  const absolute = Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: currency ? 2 : 0,
  });
  if (!currency) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value < 0 ? `-$${absolute}` : `$${absolute}`;
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function renderPieLabel(currency: boolean, props: PieLabelRenderProps): ReactNode {
  const slice = props.payload as PieSlice | undefined;
  if (!slice || props.x == null || props.y == null) return null;
  return (
    <text
      dominantBaseline="central"
      fill="var(--text-secondary)"
      fontSize={10}
      textAnchor={props.textAnchor as "start" | "middle" | "end"}
      x={props.x}
      y={props.y}
    >
      {`${slice.label}: ${formatValue(slice.value, currency)} (${formatPercent(slice.percent)})`}
    </text>
  );
}

export default function AnalyticsDistributionPie({
  colorByShop,
  currency,
  items,
  label,
}: {
  colorByShop: ShopColorMap;
  currency: boolean;
  items: Array<{ shopId: string; label: string; value: number }>;
  label: string;
}) {
  const slices = buildPieSlices(items, colorByShop);
  const visibleSlices = slices.filter((slice) => slice.magnitude > 0);
  const hasNegativeValues = slices.some((slice) => slice.value < 0);
  const hasNonZeroData = visibleSlices.length > 0;

  return (
    <figure
      aria-label={`${label} shop distribution pie chart`}
      data-chart-type="pie"
      data-has-negative-values={hasNegativeValues ? "true" : "false"}
      style={{ margin: 0, minHeight: 230, paddingTop: 8 }}
    >
      <figcaption className="sr-only">{label} shop distribution</figcaption>
      {hasNonZeroData ? (
        <div style={{ height: 205, width: "100%" }}>
          <ResponsiveContainer height="100%" width="100%">
            <PieChart>
              <Pie
                data={visibleSlices}
                dataKey="magnitude"
                endAngle={360}
                isAnimationActive={false}
                label={(props) => renderPieLabel(currency, props)}
                labelLine={{ stroke: "var(--border-default)", strokeWidth: 1 }}
                nameKey="label"
                outerRadius="62%"
                startAngle={90}
                stroke="var(--bg-card)"
                strokeWidth={1}
              >
                {visibleSlices.map((slice) => (
                  <Cell fill={slice.color} key={slice.shopId} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: unknown, _name: unknown, item: { payload?: unknown }) => {
                  const slice = item.payload as PieSlice | undefined;
                  if (!slice) return [String(value), "Value"];
                  return [
                    `${formatValue(slice.value, currency)} (${formatPercent(slice.percent)})`,
                    slice.label,
                  ];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div
          style={{
            alignItems: "center",
            color: "var(--text-muted)",
            display: "flex",
            justifyContent: "center",
            minHeight: 190,
          }}
        >
          No non-zero data for this period
        </div>
      )}

      {hasNegativeValues ? (
        <p style={{ color: "var(--text-muted)", fontSize: 10, margin: "0 0 8px" }}>
          Percentages use absolute profit/loss magnitude; signed values are shown.
        </p>
      ) : null}

      <ul
        aria-label={`${label} shop legend`}
        style={{
          display: "flex",
          gap: 10,
          listStyle: "none",
          margin: 0,
          overflowX: "auto",
          padding: 0,
          whiteSpace: "nowrap",
        }}
      >
        {slices.map((slice) => (
          <li
            key={slice.shopId}
            style={{ alignItems: "center", display: "inline-flex", gap: 4, fontSize: 10 }}
          >
            <span
              aria-hidden="true"
              style={{
                background: slice.color,
                borderRadius: 99,
                display: "inline-block",
                height: 7,
                width: 7,
              }}
            />
            <span>{slice.label}</span>
            <strong>{formatValue(slice.value, currency)}</strong>
            <span>({formatPercent(slice.percent)})</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

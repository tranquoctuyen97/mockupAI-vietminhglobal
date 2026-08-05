"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ListingOrderChartPoint {
  date: string;
  count: number;
}

export function ListingOrdersSparkline({ data }: { data: ListingOrderChartPoint[] }) {
  if (data.length < 2) {
    return <span style={{ width: 88, textAlign: "right", opacity: 0.25 }}>—</span>;
  }

  const width = 88;
  const height = 26;
  const max = Math.max(...data.map((point) => point.count), 1);
  const points = data
    .map((point, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - (point.count / max) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      aria-label="Orders trong 30 ngày gần nhất"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ display: "block" }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="#8fdc63"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function ListingOrdersChart({ data }: { data: ListingOrderChartPoint[] }) {
  const gradientId = `listing-orders-${useId().replace(/:/g, "")}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#9fe870" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#9fe870" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          stroke="rgba(255,255,255,0.3)"
          fontSize={11}
          tickFormatter={(value: string) => {
            const date = new Date(`${value}T00:00:00Z`);
            return `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
          }}
        />
        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1b1c1e",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#f9f9f9" }}
          itemStyle={{ color: "#9fe870" }}
          formatter={(value: unknown) => [String(value), "Orders"]}
          labelFormatter={(value: unknown) =>
            new Date(`${String(value)}T00:00:00Z`).toLocaleDateString("vi-VN", {
              timeZone: "UTC",
            })
          }
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#9fe870"
          strokeWidth={2}
          fillOpacity={1}
          fill={`url(#${gradientId})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

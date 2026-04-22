"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface OrderDay {
  date: string;
  count: number;
  revenue: number;
}

/**
 * Isolated recharts component — dynamically imported.
 * Only loads ~100KB recharts bundle when this component mounts.
 */
export default function DashboardChart({ data }: { data: OrderDay[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#9fe870" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#9fe870" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(255,255,255,0.06)"
        />
        <XAxis
          dataKey="date"
          stroke="rgba(255,255,255,0.3)"
          fontSize={11}
          tickFormatter={(val: string) => {
            const d = new Date(val);
            return `${d.getDate()}/${d.getMonth() + 1}`;
          }}
        />
        <YAxis
          stroke="rgba(255,255,255,0.3)"
          fontSize={11}
          allowDecimals={false}
        />
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
          labelFormatter={(label: unknown) => {
            const d = new Date(String(label));
            return d.toLocaleDateString("vi-VN");
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#9fe870"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorOrders)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

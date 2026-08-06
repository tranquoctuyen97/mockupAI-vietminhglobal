"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  DashboardOrderAnalytics as DashboardOrderAnalyticsData,
  DashboardOrderDailyPoint,
} from "@/lib/analytics/dashboard-orders";

import ListingOrdersChart, { type ListingOrderChartPoint } from "../listings/ListingOrdersChart";

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatRange(from: string, to: string): string {
  if (from === to) return formatDate(from);
  return `${formatDate(from)} – ${formatDate(to)}`;
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  });
}

function buildChartData(daily: DashboardOrderDailyPoint[]): ListingOrderChartPoint[] {
  return daily.map((point) => ({ date: point.date, count: point.count }));
}

const EMPTY_STATS: DashboardOrderAnalyticsData = {
  orderCount: 0,
  actualTotalCost: null,
  actualCostOrderCount: 0,
  pendingCostOrderCount: 0,
  daily: [],
};

export function DashboardOrderAnalyticsPanel({
  data,
  from,
  shopMapped,
  to,
}: {
  data: DashboardOrderAnalyticsData;
  from: string;
  shopMapped: boolean;
  to: string;
}) {
  const chartData = buildChartData(data.daily);

  return (
    <section aria-label="Orders by listing" className="card" style={{ marginTop: 16, padding: 20 }}>
      <div
        className="flex items-start justify-between gap-4"
        style={{ flexWrap: "wrap", marginBottom: 12 }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Orders by listing</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "5px 0 0" }}>
            Internal orders from Inkhub · {formatRange(from, to)}
          </p>
        </div>
        <Link
          className="btn btn-sm"
          href="/listings"
          style={{ alignItems: "center", display: "inline-flex", gap: 6 }}
        >
          View listings <ExternalLink aria-hidden="true" size={13} />
        </Link>
      </div>

      {!shopMapped ? (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: 13,
            padding: "48px 12px",
            textAlign: "center",
          }}
        >
          Shop chưa được liên kết với Store nội bộ
        </div>
      ) : (
        <>
          <div style={{ height: 220 }}>
            {chartData.length > 1 ? (
              <ListingOrdersChart data={chartData} />
            ) : (
              <div
                style={{
                  alignItems: "center",
                  color: "var(--text-muted)",
                  display: "flex",
                  height: "100%",
                  justifyContent: "center",
                }}
              >
                No order data for this period
              </div>
            )}
          </div>

          <div
            className="flex items-center gap-4"
            style={{ color: "var(--text-muted)", flexWrap: "wrap", fontSize: 12, marginTop: 8 }}
          >
            <strong style={{ color: "var(--text-primary)", fontSize: 14 }}>
              {data.orderCount.toLocaleString("en-US")} orders
            </strong>
            <span>
              Actual total cost: {formatCurrency(data.actualTotalCost)}
              {data.actualCostOrderCount > 0 && (
                <span> · {data.actualCostOrderCount.toLocaleString("en-US")} costs ready</span>
              )}
            </span>
            {data.pendingCostOrderCount > 0 && (
              <span style={{ color: "#a16207" }}>
                {data.pendingCostOrderCount.toLocaleString("en-US")} cost pending
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default function DashboardOrderAnalytics({
  from,
  selectedShopId,
  to,
}: {
  from: string;
  selectedShopId: string;
  to: string;
}) {
  const [data, setData] = useState<DashboardOrderAnalyticsData | null>(null);
  const [shopMapped, setShopMapped] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from, to });
    if (selectedShopId) params.set("shopId", selectedShopId);

    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/order-analytics?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          error?: string;
          shopMapped?: boolean;
          stats?: DashboardOrderAnalyticsData;
        };
        if (!response.ok) throw new Error(body.error ?? "Unable to load internal order analytics");
        return body;
      })
      .then((body) => {
        setData(body.stats ?? EMPTY_STATS);
        setShopMapped(body.shopMapped ?? true);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(
          caught instanceof Error ? caught.message : "Unable to load internal order analytics",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [from, selectedShopId, to]);

  if (loading) {
    return (
      <section
        aria-label="Orders by listing"
        className="card"
        style={{ marginTop: 16, padding: 20 }}
      >
        <div
          className="flex items-center gap-2"
          style={{ color: "var(--text-muted)", fontSize: 13 }}
        >
          <Loader2 className="animate-spin" size={16} /> Loading internal order analytics…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        aria-label="Orders by listing"
        className="card"
        style={{ marginTop: 16, padding: 20 }}
      >
        <div role="alert" style={{ color: "var(--color-danger)", fontSize: 13 }}>
          {error}
        </div>
      </section>
    );
  }

  return (
    <DashboardOrderAnalyticsPanel
      data={data ?? EMPTY_STATS}
      from={from}
      shopMapped={shopMapped}
      to={to}
    />
  );
}

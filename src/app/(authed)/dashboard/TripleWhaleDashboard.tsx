"use client";

import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import type { TripleWhaleAnalyticsResult } from "@/lib/triple-whale/analytics";
import type { TripleWhaleSyncJobSummary } from "@/lib/triple-whale/backfill";
import { comparisonRange, presetRange } from "@/lib/triple-whale/date-ranges";

import AnalyticsCharts from "./AnalyticsCharts";
import AnalyticsStatCard from "./AnalyticsStatCard";
import DashboardFilters, { type DashboardFilterValue } from "./DashboardFilters";
import DashboardOrderAnalytics from "./DashboardOrderAnalytics";
import SyncStatusBanner from "./SyncStatusBanner";

type AnalyticsApiResponse = Omit<TripleWhaleAnalyticsResult, "dataStatus"> & {
  dataStatus: "complete" | "partial" | "syncing" | "failed";
  syncJobs: TripleWhaleSyncJobSummary[];
};

const AnalyticsDashboardDataContext = createContext<AnalyticsApiResponse | null>(null);

export function AnalyticsDashboardDataProvider({
  children,
  data,
}: {
  children: ReactNode;
  data: AnalyticsApiResponse;
}) {
  return (
    <AnalyticsDashboardDataContext.Provider value={data}>
      {children}
    </AnalyticsDashboardDataContext.Provider>
  );
}

const METRIC_CARDS = [
  { key: "orderRevenue", label: "Order Revenue", currency: true },
  { key: "blendedAdSpend", label: "Ads", currency: true },
  { key: "totalCost", label: "Expected Cost", currency: true },
  { key: "netProfit", label: "Net Profit", currency: true },
  { key: "orders", label: "Orders", currency: false },
] as const;

const WORKSPACE_CARDS = [
  { key: "designs", label: "Designs" },
  { key: "activeListings", label: "Active Listings" },
] as const;

const SKELETON_CARDS = [...METRIC_CARDS, ...WORKSPACE_CARDS];

const ACTIVE_JOB_STATES = new Set(["queued", "syncing", "rate_limited"]);

function comparisonLabel(range: { from: string; to: string } | null): string | undefined {
  if (!range) return undefined;
  const format = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    });
  return range.from === range.to
    ? `vs ${format(range.from)}`
    : `vs ${format(range.from)} – ${format(range.to)}`;
}

function formatDashboardDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

function DashboardSkeleton() {
  return (
    <output
      aria-label="Loading analytics"
      aria-live="polite"
      style={{ display: "block", marginTop: 16 }}
    >
      <span className="sr-only">Loading analytics</span>
      <div className="dashboard-kpi-grid">
        {SKELETON_CARDS.map((card) => (
          <div className="card animate-pulse analytics-stat-card" key={card.key}>
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 6,
                height: 10,
                width: "42%",
              }}
            />
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 8,
                height: 30,
                marginTop: 18,
                width: "65%",
              }}
            />
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 6,
                height: 9,
                marginTop: 14,
                width: "52%",
              }}
            />
          </div>
        ))}
      </div>
    </output>
  );
}

type AnalyticsMetricCardsData = Pick<AnalyticsApiResponse, "analytics" | "workspace">;

export function AnalyticsMetricCards({
  data,
  comparisonLabel: metricComparisonLabel,
}: {
  data: AnalyticsMetricCardsData;
  comparisonLabel?: string;
}) {
  const workspaceMetric = (value: number | null) => ({
    current: data.workspace.storeLinked ? value : null,
    previous: null,
    absoluteChange: null,
    percentChange: null,
    direction: "none" as const,
    complete: true,
  });
  const workspaceStatus = data.workspace.storeLinked ? undefined : "Store not linked";

  return (
    <section
      aria-label="Primary analytics metrics"
      className="dashboard-kpi-grid"
      style={{ marginTop: 16 }}
    >
      {METRIC_CARDS.map((card) => (
        <AnalyticsStatCard
          comparisonLabel={metricComparisonLabel}
          currency={card.currency}
          key={card.key}
          label={card.label}
          metric={data.analytics.metrics[card.key]}
          metricKey={card.key}
          points={data.analytics.daily[card.key]}
        />
      ))}
      {WORKSPACE_CARDS.map((card) => (
        <AnalyticsStatCard
          currency={false}
          key={card.key}
          label={card.label}
          metric={workspaceMetric(data.workspace[card.key])}
          metricKey="orders"
          points={[]}
          showTrend={false}
          statusText={workspaceStatus}
        />
      ))}
    </section>
  );
}

function queryForFilters(filters: DashboardFilterValue): string {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    comparison: filters.comparison,
  });
  if (filters.selectedShopId) params.append("shopId", filters.selectedShopId);
  return params.toString();
}

export default function TripleWhaleDashboard({ timezone }: { timezone: string }) {
  const initialData = useContext(AnalyticsDashboardDataContext);
  const [filters, setFilters] = useState<DashboardFilterValue>(() => ({
    preset: "today",
    ...presetRange("today", timezone),
    comparison: "previous_period",
    selectedShopId: "",
  }));
  const [data, setData] = useState<AnalyticsApiResponse | null>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const completedSyncToastKey = useRef<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal, retryFailed = false) => {
      setLoading(true);
      setError(null);
      try {
        const query = queryForFilters(filters);
        const response = await fetch(
          `/api/triple-whale/analytics?${query}${retryFailed ? "&retry=1" : ""}`,
          {
            signal,
          },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load analytics");
        setData(body as AnalyticsApiResponse);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Unable to load analytics");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const activeJobs = data?.syncJobs.filter((job) => ACTIVE_JOB_STATES.has(job.status)) ?? [];
    if (!activeJobs.length) return;
    const activeJobKey = activeJobs
      .map((job) => `${job.shopId}:${job.from}:${job.to}`)
      .sort()
      .join("|");
    let stopped = false;
    const timer = window.setInterval(async () => {
      const params = new URLSearchParams();
      activeJobs.forEach((job) => {
        params.append("jobId", job.id);
      });
      try {
        const response = await fetch(`/api/triple-whale/sync-status?${params}`);
        if (!response.ok || stopped) return;
        const body = (await response.json()) as { jobs: TripleWhaleSyncJobSummary[] };
        const stillActive = body.jobs.some((job) => ACTIVE_JOB_STATES.has(job.status));
        if (!stillActive) {
          window.clearInterval(timer);
          if (body.jobs.some((job) => job.status === "failed")) {
            setData(
              (current) => current && { ...current, dataStatus: "failed", syncJobs: body.jobs },
            );
          } else {
            await load();
            if (!stopped && completedSyncToastKey.current !== activeJobKey) {
              completedSyncToastKey.current = activeJobKey;
              toast.success("Triple Whale historical data updated");
            }
          }
        } else {
          setData((current) => current && { ...current, syncJobs: body.jobs });
        }
      } catch {
        // A transient polling error must not hide the last successful analytics response.
      }
    }, 2_500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [data?.syncJobs, load]);

  const onFiltersChange = useCallback(
    (next: DashboardFilterValue) => {
      if (next.preset !== "custom" && next.preset !== filters.preset) {
        setFilters({ ...next, ...presetRange(next.preset, timezone) });
      } else {
        setFilters(next);
      }
    },
    [filters.preset, timezone],
  );

  const perShop = useMemo(() => {
    if (!data) return [];
    return data.analytics.distribution.orderRevenue.map((revenue) => ({
      shopId: revenue.shopId,
      label: revenue.label,
      revenue: revenue.value,
      ads:
        data.analytics.distribution.blendedAdSpend.find((item) => item.shopId === revenue.shopId)
          ?.value ?? 0,
      cost:
        data.analytics.distribution.totalCost.find((item) => item.shopId === revenue.shopId)
          ?.value ?? 0,
      profit:
        data.analytics.distribution.netProfit.find((item) => item.shopId === revenue.shopId)
          ?.value ?? 0,
      orders:
        data.analytics.distribution.orders.find((item) => item.shopId === revenue.shopId)?.value ??
        0,
    }));
  }, [data]);
  const effectiveComparisonRange = useMemo(
    () => data?.comparisonRange ?? comparisonRange(filters, filters.comparison),
    [data?.comparisonRange, filters],
  );

  async function syncAll() {
    setSyncingAll(true);
    try {
      const response = await fetch("/api/integrations/triple-whale/sync-all", { method: "POST" });
      if (!response.ok) throw new Error("Unable to queue sync");
      toast.success("Sync queued for all shops");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Unable to queue sync");
    } finally {
      setSyncingAll(false);
    }
  }

  return (
    <section aria-label="Triple Whale analytics" style={{ paddingBottom: 32 }}>
      <DashboardFilters
        {...filters}
        comparisonRange={effectiveComparisonRange}
        onChange={onFiltersChange}
        shops={data?.shops ?? []}
        syncAction={
          <button
            aria-label="Sync all Triple Whale shops"
            className="btn btn-primary btn-sm"
            disabled={syncingAll}
            onClick={syncAll}
            type="button"
          >
            {syncingAll ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
            Sync All
          </button>
        }
      />

      {data && (
        <SyncStatusBanner
          jobs={data.syncJobs}
          onRetry={() => void load(undefined, true)}
          status={data.dataStatus}
        />
      )}
      {error && (
        <div
          className="card"
          role="alert"
          style={{
            alignItems: "center",
            color: "var(--color-danger)",
            display: "flex",
            gap: 10,
            justifyContent: "space-between",
            marginTop: 12,
            padding: 14,
          }}
        >
          <span style={{ alignItems: "center", display: "flex", gap: 8 }}>
            <AlertCircle aria-hidden="true" size={17} /> {error}
          </span>
          <button className="btn btn-sm" onClick={() => void load()} type="button">
            Retry
          </button>
        </div>
      )}
      {loading && !data && <DashboardSkeleton />}

      {data && (
        <>
          <AnalyticsMetricCards
            comparisonLabel={comparisonLabel(data.comparisonRange)}
            data={data}
          />

          <DashboardOrderAnalytics
            from={filters.from}
            selectedShopId={filters.selectedShopId}
            to={filters.to}
          />

          <AnalyticsCharts
            daily={data.analytics.daily}
            distribution={data.analytics.distribution}
            selectedShopId={filters.selectedShopId}
          />

          {perShop.length > 0 && (
            <div className="card" style={{ marginTop: 16, overflowX: "auto", padding: 0 }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, padding: "14px 18px" }}>
                Per-shop summary
              </h2>
              <table
                style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 720, width: "100%" }}
              >
                <thead>
                  <tr>
                    {["Shop", "Revenue", "Ads", "Cost", "Profit", "Orders"].map((heading) => (
                      <th
                        key={heading}
                        style={{
                          background: "var(--bg-secondary)",
                          padding: 10,
                          textAlign: heading === "Shop" ? "left" : "right",
                        }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {perShop.map((shop) => (
                    <tr key={shop.shopId}>
                      <td style={{ fontWeight: 700, padding: 10 }}>{shop.label}</td>
                      {[shop.revenue, shop.ads, shop.cost, shop.profit].map((value, index) => (
                        <td
                          key={`${shop.shopId}-${index}`}
                          style={{ padding: 10, textAlign: "right" }}
                        >
                          ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        </td>
                      ))}
                      <td style={{ padding: 10, textAlign: "right" }}>
                        {shop.orders.toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details className="card" style={{ marginTop: 16, padding: 16 }}>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>
              Daily breakdown · {data.analytics.daily.orderRevenue.length} rows
            </summary>
            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={{ fontSize: 12, minWidth: 640, width: "100%" }}>
                <thead>
                  <tr>
                    {["Date", "Revenue", "Ads", "Cost", "Profit", "Orders"].map((heading) => (
                      <th
                        key={heading}
                        style={{ padding: 8, textAlign: heading === "Date" ? "left" : "right" }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.analytics.daily.orderRevenue.map((point, index) => (
                    <tr key={point.date}>
                      <td style={{ padding: 8 }}>{formatDashboardDate(point.date)}</td>
                      {(["orderRevenue", "blendedAdSpend", "totalCost", "netProfit"] as const).map(
                        (key) => (
                          <td key={key} style={{ padding: 8, textAlign: "right" }}>
                            $
                            {data.analytics.daily[key][index]?.current.toLocaleString("en-US", {
                              maximumFractionDigits: 0,
                            })}
                          </td>
                        ),
                      )}
                      <td style={{ padding: 8, textAlign: "right" }}>
                        {data.analytics.daily.orders[index]?.current.toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

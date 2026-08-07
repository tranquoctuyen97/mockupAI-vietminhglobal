import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AnalyticsCharts from "./AnalyticsCharts";
import AnalyticsStatCard from "./AnalyticsStatCard";
import DashboardClient from "./DashboardClient";
import DashboardFilters, { filterChangeForPreset } from "./DashboardFilters";
import SyncStatusBanner from "./SyncStatusBanner";
import { AnalyticsDashboardDataProvider, AnalyticsMetricCards } from "./TripleWhaleDashboard";

describe("dashboard analytics components", () => {
  it("renders analytics KPI cards before Quick start in dashboard order", () => {
    const metric = {
      current: 1,
      previous: 0,
      absoluteChange: 1,
      percentChange: 100,
      direction: "up" as const,
      complete: true,
    };
    const analyticsData = {
      dataStatus: "complete" as const,
      syncJobs: [],
      timezone: "UTC",
      currentRange: { from: "2026-08-01", to: "2026-08-01" },
      comparisonRange: { from: "2026-07-31", to: "2026-07-31" },
      shops: [],
      missingRanges: [],
      workspace: { designs: 12, activeListings: 9, storeLinked: true },
      analytics: {
        metrics: {
          orderRevenue: metric,
          blendedAdSpend: metric,
          totalCost: metric,
          netProfit: metric,
          orders: metric,
        },
        daily: {
          orderRevenue: [],
          blendedAdSpend: [],
          totalCost: [],
          netProfit: [],
          orders: [],
        },
        distribution: {
          orderRevenue: [],
          blendedAdSpend: [],
          totalCost: [],
          netProfit: [],
          orders: [],
        },
      },
    };
    const markup = renderToStaticMarkup(
      <AnalyticsDashboardDataProvider data={analyticsData}>
        <DashboardClient twTimezone="UTC" />
      </AnalyticsDashboardDataProvider>,
    );

    expect(markup.indexOf(">Orders<")).toBeLessThan(markup.indexOf(">Designs<"));
    expect(markup).toContain("Expected Cost");
    expect(markup.indexOf(">Designs<")).toBeLessThan(markup.indexOf(">Active Listings<"));
    expect(markup.indexOf(">Active Listings<")).toBeLessThan(markup.indexOf("Quick start"));
  });

  it("keeps Quick start below analytics without the legacy Workspace Overview", () => {
    const markup = renderToStaticMarkup(<DashboardClient twTimezone="UTC" />);
    expect(markup).toContain('class="text-section-heading dashboard-heading"');
    expect(markup).not.toContain("🐋 Triple Whale");
    expect(markup).not.toContain('aria-pressed="true">Overview');
    expect(markup).not.toContain("Workspace Overview");
    expect(markup.indexOf("Loading analytics")).toBeLessThan(markup.indexOf("Quick start"));
    expect(markup.match(/class="card animate-pulse analytics-stat-card"/g)).toHaveLength(7);
    expect(markup).toContain('href="/stores"');
    expect(markup).toContain('href="/designs"');
    expect(markup).toContain('href="/wizard"');
    expect(markup).toContain('aria-label="Analytics filters"');
    expect(markup).toContain('aria-label="Sync all Triple Whale shops"');
    expect(markup).not.toContain("flex:1 1 760px");
  });

  it("renders compact dropdown triggers instead of a wide preset row", () => {
    const markup = renderToStaticMarkup(
      <DashboardFilters
        comparison="previous_period"
        comparisonRange={{ from: "2026-07-31", to: "2026-07-31" }}
        from="2026-08-01"
        onChange={() => undefined}
        preset="today"
        selectedShopId=""
        shops={[{ id: "shop-a", customName: "Shop A", shopDomain: "a.myshopify.com" }]}
        syncAction={<button type="button">Sync</button>}
        to="2026-08-01"
      />,
    );
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain("Today");
    expect(markup).toContain("Previous period");
    expect(markup).toContain("All shops");
    expect(markup).toContain('class="dashboard-filter-toolbar"');
    expect(markup).toContain('class="dashboard-filter-sync"');
    expect(markup).not.toContain('aria-pressed="false"');
  });

  it("uses a flexible KPI grid and compact analytics cards", () => {
    const metric = {
      current: 12,
      previous: 10,
      absoluteChange: 2,
      percentChange: 20,
      direction: "up" as const,
      complete: true,
    };
    const markup = renderToStaticMarkup(
      <AnalyticsMetricCards
        comparisonLabel="vs Jul 31, 2026"
        data={{
          analytics: {
            metrics: {
              orderRevenue: metric,
              blendedAdSpend: metric,
              totalCost: metric,
              netProfit: metric,
              orders: metric,
            },
            daily: {
              orderRevenue: [],
              blendedAdSpend: [],
              totalCost: [],
              netProfit: [],
              orders: [],
            },
          },
          workspace: { designs: 125, activeListings: 3, storeLinked: true },
        }}
      />,
    );

    expect(markup).toContain('class="dashboard-kpi-grid"');
    expect(markup.match(/class="card card-sm analytics-stat-card"/g)).toHaveLength(7);
    expect(markup).not.toContain("2xl:grid-cols-7");
  });

  it("does not issue a filter change until a custom range is applied", () => {
    expect(filterChangeForPreset("custom")).toBeNull();
    expect(filterChangeForPreset("7d")).toEqual({ preset: "7d" });
  });

  it("shows an absolute comparison without Infinity when previous is zero", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsStatCard
        currency
        label="Ads"
        metricKey="blendedAdSpend"
        metric={{
          current: 31,
          previous: 0,
          absoluteChange: 31,
          percentChange: null,
          direction: "up",
          complete: true,
        }}
        points={[{ date: "2026-08-01", current: 31, previous: 0 }]}
      />,
    );
    expect(markup).toContain("$31");
    expect(markup).toContain("New activity");
    expect(markup).not.toContain("Infinity");
  });

  it("treats increased costs as unfavorable without drawing a meaningless one-point chart", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsStatCard
        comparisonLabel="vs Jul 31, 2026"
        currency
        label="Total Cost"
        metricKey="totalCost"
        metric={{
          current: 31,
          previous: 20,
          absoluteChange: 11,
          percentChange: 55,
          direction: "up",
          complete: true,
        }}
        points={[{ date: "2026-08-01", current: 31, previous: 20 }]}
      />,
    );
    expect(markup).toContain("55.0% increase");
    expect(markup).toContain("Unfavorable");
    expect(markup).toContain("vs Jul 31, 2026");
    expect(markup).not.toContain("current and previous period trend");
  });

  it("draws current-period sparklines when at least two dates exist", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsStatCard
        currency
        label="Order Revenue"
        metricKey="orderRevenue"
        metric={{
          current: 31,
          previous: 20,
          absoluteChange: 11,
          percentChange: 55,
          direction: "up",
          complete: true,
        }}
        points={[
          { date: "2026-07-31", current: 20, previous: 18 },
          { date: "2026-08-01", current: 31, previous: 20 },
        ]}
      />,
    );

    expect(markup).toContain("current period trend");
    expect(markup).toContain("Current period trend");
    expect(markup).not.toContain("Current period compared with Previous period");
  });

  it("marks incomplete metrics as syncing", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsStatCard
        currency
        label="Revenue"
        metricKey="orderRevenue"
        metric={{
          current: 31,
          previous: null,
          absoluteChange: null,
          percentChange: null,
          direction: "none",
          complete: false,
        }}
        points={[]}
      />,
    );
    expect(markup).toContain("Syncing comparison data");
  });

  it("does not render missing current data as zero", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsStatCard
        currency
        label="Revenue"
        metricKey="orderRevenue"
        metric={{
          current: null,
          previous: 31,
          absoluteChange: null,
          percentChange: null,
          direction: "none",
          complete: false,
        }}
        points={[]}
      />,
    );
    expect(markup).toContain("—");
    expect(markup).not.toContain("$0");
  });

  it("shows an unlinked workspace card as unavailable instead of zero", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsStatCard
        currency
        label="Designs"
        metricKey="orders"
        metric={{
          current: null,
          previous: null,
          absoluteChange: null,
          percentChange: null,
          direction: "none",
          complete: true,
        }}
        points={[]}
        showTrend={false}
        statusText="Store not linked"
      />,
    );

    expect(markup).toContain("—");
    expect(markup).toContain("Store not linked");
    expect(markup).not.toContain("$0");
  });

  it("omits fallback comparison content for a linked zero workspace card", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsStatCard
        label="Designs"
        metricKey="orders"
        metric={{
          current: 0,
          previous: null,
          absoluteChange: null,
          percentChange: null,
          direction: "none",
          complete: true,
        }}
        points={[]}
        showTrend={false}
      />,
    );

    expect(markup).toContain(">0<");
    expect(markup).not.toContain("No prior data");
    expect(markup).not.toContain("current and previous period trend");
  });

  it("places workspace metrics in the primary analytics card region", () => {
    const metric = {
      current: 1,
      previous: 0,
      absoluteChange: 1,
      percentChange: 100,
      direction: "up" as const,
      complete: true,
    };
    const markup = renderToStaticMarkup(
      <AnalyticsMetricCards
        comparisonLabel="vs Jul 31, 2026"
        data={{
          analytics: {
            metrics: {
              orderRevenue: metric,
              blendedAdSpend: metric,
              totalCost: metric,
              netProfit: metric,
              orders: metric,
            },
            daily: {
              orderRevenue: [],
              blendedAdSpend: [],
              totalCost: [],
              netProfit: [],
              orders: [],
            },
          },
          workspace: { designs: 12, activeListings: 9, storeLinked: true },
        }}
      />,
    );

    expect(markup).toContain('aria-label="Primary analytics metrics"');
    expect(markup).toContain("Designs");
    expect(markup).toContain("Active Listings");
    expect(markup.indexOf(">Orders<")).toBeLessThan(markup.indexOf(">Designs<"));
    expect(markup.indexOf(">Designs<")).toBeLessThan(markup.indexOf(">Active Listings<"));
  });

  it("switches from shop distribution to daily trends for one selected shop", () => {
    const common = {
      daily: {
        orderRevenue: [{ date: "2026-08-01", current: 10, previous: 8 }],
        blendedAdSpend: [{ date: "2026-08-01", current: 2, previous: 3 }],
        totalCost: [{ date: "2026-08-01", current: 5, previous: 6 }],
        netProfit: [{ date: "2026-08-01", current: 5, previous: 2 }],
        orders: [{ date: "2026-08-01", current: 1, previous: 1 }],
      },
      distribution: {
        orderRevenue: [{ shopId: "shop-a", label: "Shop A", value: 10 }],
        blendedAdSpend: [{ shopId: "shop-a", label: "Shop A", value: 2 }],
        totalCost: [{ shopId: "shop-a", label: "Shop A", value: 5 }],
        netProfit: [{ shopId: "shop-a", label: "Shop A", value: 5 }],
        orders: [{ shopId: "shop-a", label: "Shop A", value: 1 }],
      },
    };
    expect(renderToStaticMarkup(<AnalyticsCharts {...common} selectedShopId="" />)).toContain(
      "Distribution by shop",
    );
    expect(renderToStaticMarkup(<AnalyticsCharts {...common} selectedShopId="shop-a" />)).toContain(
      "Daily trends",
    );
  });

  it("keeps loss-making shops visible in profit comparison charts", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsCharts
        daily={{
          orderRevenue: [],
          blendedAdSpend: [],
          totalCost: [],
          netProfit: [],
          orders: [],
        }}
        distribution={{
          orderRevenue: [],
          blendedAdSpend: [],
          totalCost: [],
          netProfit: [
            { shopId: "shop-a", label: "Profitable", value: 40 },
            { shopId: "shop-b", label: "Loss making", value: -18 },
          ],
          orders: [],
        }}
        selectedShopId=""
      />,
    );
    expect(markup).toContain("Loss making");
    expect(markup).toContain("-$18");
  });

  it("shows an Apply action and the effective comparison periods", () => {
    const markup = renderToStaticMarkup(
      <DashboardFilters
        comparison="previous_period"
        comparisonRange={{ from: "2026-07-25", to: "2026-07-31" }}
        from="2026-08-01"
        onChange={() => undefined}
        preset="custom"
        selectedShopId=""
        shops={[]}
        to="2026-08-07"
      />,
    );
    expect(markup).toContain(">Apply<");
    expect(markup).toContain("Aug 1–7, 2026");
    expect(markup).toContain("Jul 25–31, 2026");
    expect(markup).toContain("width:288px");
    expect(markup).toContain("grid-template-columns:1fr 18px");
    expect(markup).toContain("background:#f2faec");
    expect(markup).toContain("min-height:40px");
  });

  it("announces rate-limit waiting without blocking the page", () => {
    const markup = renderToStaticMarkup(
      <SyncStatusBanner
        jobs={[
          {
            id: "job",
            shopId: "shop-a",
            from: "2026-01-01",
            to: "2026-01-31",
            status: "rate_limited",
          },
        ]}
        status="syncing"
      />,
    );
    expect(markup).toContain("Waiting for Triple Whale quota");
    expect(markup).toContain("Jan 1–31, 2026");
    expect(markup).toContain('aria-live="polite"');
  });
});

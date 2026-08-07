"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  ShopifyProductSalesResponse,
  ShopifyProductSalesRow,
  ShopifyProductSalesStoreStatus,
} from "@/lib/analytics/shopify-product-sales";

const MAX_LOADING_MS = 30_000;

export function ShopifyProductSalesLoading() {
  return (
    <section
      aria-label="Loading Shopify product sales"
      className="card"
      style={{ marginTop: 16, padding: 20 }}
    >
      <div
        aria-live="polite"
        className="flex items-center gap-2"
        style={{ color: "var(--text-muted)", fontSize: 13 }}
      >
        <Loader2 className="animate-spin" size={16} /> Loading Shopify product sales…
      </div>
    </section>
  );
}

export function ShopifyProductSalesPanel({
  data,
  onRetry,
}: {
  data: ShopifyProductSalesResponse;
  onRetry: () => void;
}) {
  const showStore = data.selectedShopId === null;
  const successfulStores = data.stores.filter((store) => store.status === "ok");
  const unavailableStores = data.stores.filter((store) => store.status !== "ok");
  const allStoresFailed = data.stores.length > 0 && successfulStores.length === 0;

  return (
    <section aria-label="Total sales by product" className="card" style={{ marginTop: 16, padding: 20 }}>
      <div
        className="flex items-start justify-between gap-4"
        style={{ flexWrap: "wrap", marginBottom: 12 }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Total sales by product</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "5px 0 0" }}>
            Shopify Analytics · {formatRange(data.from, data.to)}
          </p>
        </div>
        {(data.partial || allStoresFailed) && (
          <button className="btn btn-sm" onClick={onRetry} type="button">
            <RefreshCw size={14} /> Retry
          </button>
        )}
      </div>

      {data.partial && data.stores.length > 0 && (
        <div
          role="alert"
          style={{
            background: "var(--bg-secondary)",
            borderRadius: 8,
            color: "var(--text-muted)",
            fontSize: 12,
            marginBottom: 12,
            padding: "9px 11px",
          }}
        >
          {successfulStores.length}/{data.stores.length} stores loaded
          {unavailableStores.length > 0 && (
            <ul style={{ margin: "5px 0 0 18px", padding: 0 }}>
              {unavailableStores.map((store) => (
                <li key={`${store.shopId}:${store.status}`}>
                  {store.storeName}: {store.message ?? statusLabel(store.status)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {allStoresFailed ? (
        <div role="alert" style={emptyStateStyle}>
          Unable to load Shopify product sales.
          <div style={{ marginTop: 6 }}>
            {unavailableStores.map((store) => (
              <div key={`${store.shopId}:${store.status}`}>
                {store.storeName}: {store.message ?? statusLabel(store.status)}
              </div>
            ))}
          </div>
        </div>
      ) : data.rows.length === 0 ? (
        <div style={emptyStateStyle}>No Shopify product sales for this period</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 720, width: "100%" }}>
            <thead>
              <tr>
                {showStore && <th style={headerCellStyle}>Store</th>}
                <th style={headerCellStyle}>Product title</th>
                <th style={{ ...headerCellStyle, textAlign: "right" }}>Net items sold</th>
                <th style={{ ...headerCellStyle, textAlign: "right" }}>Total sales</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: "var(--bg-secondary)" }}>
                {showStore && <td style={bodyCellStyle}>Summary</td>}
                <td style={{ ...bodyCellStyle, fontWeight: 800 }}>Summary</td>
                <td style={{ ...numericCellStyle, fontWeight: 800 }}>
                  {data.summary.netItemsSold.toLocaleString("en-US")}
                </td>
                <td style={{ ...numericCellStyle, fontWeight: 800 }}>
                  {formatSummary(data.summary.totalSalesByCurrency)}
                </td>
              </tr>
              {data.rows.map((row) => (
                <ProductSalesRow key={`${row.storeId}:${row.productTitle ?? "__none__"}`} row={row} showStore={showStore} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function ShopifyProductSalesTable({
  from,
  selectedShopId,
  to,
}: {
  from: string;
  selectedShopId: string;
  to: string;
}) {
  const requestKey = `${from}:${to}:${selectedShopId}`;
  const [data, setData] = useState<ShopifyProductSalesResponse | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    setLoading(true);
    setError(null);
    setErrorKey(null);

    const load = async (): Promise<void> => {
      if (stopped) return;
      const params = new URLSearchParams({ from, to });
      if (selectedShopId) params.set("shopId", selectedShopId);

      try {
        const response = await fetch(`/api/dashboard/shopify-product-sales?${params.toString()}`, {
          signal: controller.signal,
        });
        const body = (await response.json()) as ShopifyProductSalesResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Unable to load Shopify product sales");
        if (stopped) return;

        if (body.stores.some((store) => store.status === "loading")) {
          if (Date.now() - startedAt >= MAX_LOADING_MS) {
            const timedOutData = {
              ...body,
              partial: true,
              stores: body.stores.map((store) =>
                store.status === "loading"
                  ? {
                      ...store,
                      status: "failed" as const,
                      message: "Timed out while loading Shopify report",
                    }
                  : store,
              ),
            } satisfies ShopifyProductSalesResponse;
            setData(timedOutData);
            setDataKey(requestKey);
            setLoading(false);
          } else {
            setData(body);
            timer = setTimeout(() => void load(), 1_000);
          }
          return;
        }

        setData(body);
        setDataKey(requestKey);
        setLoading(false);
      } catch (caught) {
        if (stopped || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError(caught instanceof Error ? caught.message : "Unable to load Shopify product sales");
        setErrorKey(requestKey);
        setLoading(false);
      }
    };

    void load();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [from, requestKey, retryCount, selectedShopId, to]);

  if (error && errorKey === requestKey) {
    return (
      <section aria-label="Total sales by product" className="card" style={{ marginTop: 16, padding: 20 }}>
        <div className="flex items-center justify-between gap-3" style={{ fontSize: 13 }}>
          <span role="alert" style={{ color: "var(--color-danger)" }}>{error}</span>
          <button className="btn btn-sm" onClick={() => setRetryCount((count) => count + 1)} type="button">
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (loading || dataKey !== requestKey || !data) return <ShopifyProductSalesLoading />;
  return <ShopifyProductSalesPanel data={data} onRetry={() => setRetryCount((count) => count + 1)} />;
}

function ProductSalesRow({ row, showStore }: { row: ShopifyProductSalesRow; showStore: boolean }) {
  return (
    <tr>
      {showStore && <td style={bodyCellStyle}>{row.storeName}</td>}
      <td style={bodyCellStyle}>{row.productTitle || "None"}</td>
      <td style={numericCellStyle}>{row.netItemsSold.toLocaleString("en-US")}</td>
      <td style={numericCellStyle}>{formatCurrency(row.totalSales, row.currencyCode)}</td>
    </tr>
  );
}

function formatCurrency(value: string, currencyCode: string): string {
  const numericValue = Number(value);
  try {
    return new Intl.NumberFormat("en-US", {
      currency: currencyCode,
      maximumFractionDigits: 2,
      style: "currency",
    }).format(numericValue);
  } catch {
    return `${currencyCode} ${numericValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
}

function formatSummary(totals: Record<string, string>): string {
  const entries = Object.entries(totals);
  if (entries.length === 0) return "—";
  return entries.map(([currency, value]) => formatCurrency(value, currency)).join(" · ");
}

function formatRange(from: string, to: string): string {
  const format = (date: string) =>
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(`${date}T00:00:00Z`));
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}

function statusLabel(status: ShopifyProductSalesStoreStatus["status"]): string {
  return status.replaceAll("_", " ");
}

const headerCellStyle = {
  background: "var(--bg-secondary)",
  padding: 10,
  textAlign: "left" as const,
  whiteSpace: "nowrap" as const,
};

const bodyCellStyle = {
  borderTop: "1px solid var(--border-default)",
  padding: 10,
};

const numericCellStyle = {
  ...bodyCellStyle,
  textAlign: "right" as const,
  whiteSpace: "nowrap" as const,
};

const emptyStateStyle = {
  color: "var(--text-muted)",
  fontSize: 13,
  padding: "48px 12px",
  textAlign: "center" as const,
};

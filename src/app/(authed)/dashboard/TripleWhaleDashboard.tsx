"use client";

import { ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface StoreStats {
  storeId: string;
  shopifyDomain: string;
  customName: string;
  orderRevenue: number;
  netProfit: number;
  netMargin: number;
  orders: number;
  paymentGateways: number;
  shipping: number;
  blendedAdSpend: number;
  cogs: number;
  totalCost: number;
}

interface Totals {
  orderRevenue: number;
  netProfit: number;
  orders: number;
  paymentGateways: number;
  shipping: number;
  blendedAdSpend: number;
  cogs: number;
  totalCost: number;
}

interface DailyRow {
  id: string;
  date: string;
  shopDomain: string;
  customName: string;
  orderRevenue: number;
  netProfit: number;
  netMargin: number;
  orders: number;
  blendedAdSpend: number;
  cogs: number;
  totalCost: number;
}

const STORE_COLORS = ["#9fe870", "#6b5cff", "#3b82f6", "#ec4899", "#f59e0b", "#14b8a6", "#38c8ff"];

function fmtUSD(value: number) {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function fmtPct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function getDateRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);
  const today = formatDate(now);
  if (preset === "Today") return { from: today, to: today };
  if (preset === "7D") {
    const date = new Date(now);
    date.setDate(date.getDate() - 6);
    return { from: formatDate(date), to: today };
  }
  if (preset === "30D") {
    const date = new Date(now);
    date.setDate(date.getDate() - 29);
    return { from: formatDate(date), to: today };
  }
  if (preset === "This Month") {
    return { from: formatDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  return { from: today, to: today };
}

function DonutChart({
  data,
  label,
  total,
  fmtVal = fmtUSD,
  size = 120,
}: {
  data: { label: string; value: number; color: string }[];
  label: string;
  total: number;
  fmtVal?: (value: number) => string;
  size?: number;
}) {
  const r = size / 2;
  const inner = r - 24;
  const sum = data.reduce((acc, item) => acc + Math.max(item.value, 0), 0) || 1;
  let cumulative = 0;

  const slices = data.map((item) => {
    const value = Math.max(item.value, 0);
    const start = (cumulative / sum) * Math.PI * 2 - Math.PI / 2;
    cumulative += value;
    const end = (cumulative / sum) * Math.PI * 2 - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = r + r * Math.cos(start);
    const y1 = r + r * Math.sin(start);
    const x2 = r + r * Math.cos(end);
    const y2 = r + r * Math.sin(end);
    const xi1 = r + inner * Math.cos(end);
    const yi1 = r + inner * Math.sin(end);
    const xi2 = r + inner * Math.cos(start);
    const yi2 = r + inner * Math.sin(start);

    return (
      <path
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${inner} ${inner} 0 ${large} 0 ${xi2} ${yi2} Z`}
        fill={item.color}
        key={item.label}
      />
    );
  });

  return (
    <div style={{ flexShrink: 0, height: size, position: "relative", width: size }}>
      <svg aria-label={`${label} distribution`} height={size} role="img" width={size}>
        {slices}
      </svg>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          inset: 0,
          justifyContent: "center",
          pointerEvents: "none",
          position: "absolute",
        }}
      >
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 800, marginTop: 1 }}>
          {fmtVal(total)}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: string;
}) {
  return (
    <div className="card card-sm" style={{ padding: 18 }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <div
          style={{
            background: `${color}22`,
            borderRadius: 9999,
            color,
            display: "grid",
            fontSize: 14,
            height: 30,
            placeItems: "center",
            width: 30,
          }}
        >
          {icon}
        </div>
      </div>
      <div
        style={{
          color: "var(--text-primary)",
          fontSize: 26,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 800,
          letterSpacing: "-0.5px",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function TripleWhaleDashboard() {
  const [preset, setPreset] = useState("7D");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [perStore, setPerStore] = useState<StoreStats[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [showDaily, setShowDaily] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const { from, to } =
    preset === "Custom" ? { from: customFrom, to: customTo } : getDateRange(preset);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const [statsRes, dailyRes] = await Promise.all([
        fetch(`/api/triple-whale/stats?from=${from}&to=${to}`),
        fetch(`/api/triple-whale/daily?from=${from}&to=${to}`),
      ]);
      if (statsRes.ok) {
        const data = await statsRes.json();
        setPerStore(data.perStore);
        setTotals(data.totals);
      }
      if (dailyRes.ok) {
        const data = await dailyRes.json();
        setDailyRows(data.rows);
      }
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  async function syncAll() {
    setSyncing(true);
    try {
      await fetch("/api/integrations/triple-whale/sync-all", { method: "POST" });
      toast.success("Sync queued for all stores");
    } finally {
      setSyncing(false);
    }
  }

  const storeColors = Object.fromEntries(
    perStore.map((store, index) => [store.storeId, STORE_COLORS[index % STORE_COLORS.length]]),
  );
  const pieMetrics = totals
    ? [
        { key: "orderRevenue" as keyof StoreStats, label: "Revenue", total: totals.orderRevenue },
        {
          fmtVal: (value: number) => String(Math.round(value)),
          key: "orders" as keyof StoreStats,
          label: "Orders",
          total: totals.orders,
        },
        { key: "blendedAdSpend" as keyof StoreStats, label: "Ads", total: totals.blendedAdSpend },
        { key: "totalCost" as keyof StoreStats, label: "Cost", total: totals.totalCost },
        { key: "netProfit" as keyof StoreStats, label: "Profit", total: totals.netProfit },
      ]
    : [];

  if (loading && !totals) {
    return (
      <div style={{ color: "var(--text-muted)", padding: 40, textAlign: "center" }}>
        Loading analytics...
      </div>
    );
  }

  if (!totals && !loading) {
    return (
      <div style={{ padding: "60px 40px", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🐋</div>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: 8 }}>
          Connect Triple Whale to get started
        </h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>
          Configure API keys at{" "}
          <a href="/integrations/triple-whale" style={{ color: "var(--color-wise-green)" }}>
            Integrations → Triple Whale
          </a>
        </p>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 16,
          justifyContent: "space-between",
          padding: "16px 0 20px",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <div
            style={{
              alignItems: "center",
              background: "var(--bg-secondary)",
              borderRadius: 9999,
              display: "inline-flex",
              gap: 3,
              padding: 3,
            }}
          >
            {["Today", "7D", "30D", "This Month"].map((item) => (
              <button
                key={item}
                onClick={() => {
                  setPreset(item);
                  setShowCustom(false);
                }}
                type="button"
                style={{
                  background: preset === item ? "var(--color-wise-green)" : "transparent",
                  border: "none",
                  borderRadius: 9999,
                  color: preset === item ? "var(--color-wise-dark-green)" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "6px 14px",
                }}
              >
                {item}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setPreset("Custom");
              setShowCustom(!showCustom);
            }}
            type="button"
            style={{
              alignItems: "center",
              background: "transparent",
              border: "1px solid var(--border-default)",
              borderRadius: 9999,
              color: preset === "Custom" ? "var(--color-wise-green)" : "var(--text-secondary)",
              cursor: "pointer",
              display: "inline-flex",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 600,
              gap: 6,
              padding: "7px 14px",
            }}
          >
            📅 {from && to && preset === "Custom" ? `${from} → ${to}` : "Custom"}
          </button>
          {showCustom && (
            <div
              style={{
                alignItems: "center",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                borderRadius: 12,
                display: "flex",
                gap: 6,
                padding: "6px 12px",
              }}
            >
              <input
                className="input"
                onChange={(event) => setCustomFrom(event.target.value)}
                style={{ padding: "4px 8px", width: 140 }}
                type="date"
                value={customFrom}
              />
              <span style={{ color: "var(--text-muted)" }}>→</span>
              <input
                className="input"
                onChange={(event) => setCustomTo(event.target.value)}
                style={{ padding: "4px 8px", width: 140 }}
                type="date"
                value={customTo}
              />
            </div>
          )}
        </div>
        <button
          className="btn btn-primary btn-sm"
          disabled={syncing}
          onClick={syncAll}
          type="button"
        >
          {syncing ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
          Sync All
        </button>
      </div>

      {totals && (
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(5, 1fr)",
            marginBottom: 20,
          }}
        >
          <StatCard
            color="#9fe870"
            icon="💰"
            label="Order Revenue"
            value={`$${totals.orderRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          />
          <StatCard
            color="#ec4899"
            icon="📣"
            label="Blended Ads"
            value={`$${totals.blendedAdSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          />
          <StatCard
            color="#f59e0b"
            icon="💸"
            label="Total Cost"
            value={`$${totals.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          />
          <StatCard
            color="#6b5cff"
            icon="📈"
            label="Net Profit"
            value={`$${totals.netProfit.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          />
          <StatCard
            color="#38c8ff"
            icon="🛒"
            label="Orders"
            value={totals.orders.toLocaleString("en-US")}
          />
        </div>
      )}

      {perStore.length > 0 && totals && (
        <div className="card" style={{ marginBottom: 16, padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
            Distribution by shop
          </div>
          <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(5, 1fr)" }}>
            {pieMetrics.map((metric) => (
              <div
                key={metric.key}
                style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 10 }}
              >
                <DonutChart
                  data={perStore.map((store) => ({
                    color: storeColors[store.storeId],
                    label: store.customName,
                    value: store[metric.key] as number,
                  }))}
                  fmtVal={metric.fmtVal ?? fmtUSD}
                  label={metric.label}
                  size={120}
                  total={metric.total}
                />
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    fontSize: 11,
                    gap: 4,
                    width: "100%",
                  }}
                >
                  {perStore.map((store) => {
                    const value = store[metric.key] as number;
                    const pct =
                      metric.total > 0 ? ((value / metric.total) * 100).toFixed(1) : "0.0";
                    return (
                      <div
                        key={store.storeId}
                        style={{ alignItems: "center", display: "flex", gap: 6 }}
                      >
                        <span
                          style={{
                            background: storeColors[store.storeId],
                            borderRadius: 2,
                            flexShrink: 0,
                            height: 7,
                            width: 7,
                          }}
                        />
                        <span style={{ flex: 1, fontWeight: 600 }}>{store.customName}</span>
                        <span
                          style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
                        >
                          {pct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {perStore.length > 0 && (
        <div className="card" style={{ marginBottom: 16, overflow: "hidden", padding: 0 }}>
          <div
            style={{
              borderBottom: "1px solid var(--border-default)",
              fontSize: 15,
              fontWeight: 700,
              padding: "14px 20px",
            }}
          >
            Per-shop summary
          </div>
          <table
            style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 13, width: "100%" }}
          >
            <thead>
              <tr>
                {["Shop", "Revenue", "Profit", "Margin", "Ads", "Orders"].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      background: "var(--bg-secondary)",
                      borderBottom: "1px solid var(--border-default)",
                      color: "var(--text-muted)",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      padding: "10px 16px",
                      textAlign: heading === "Shop" ? "left" : "right",
                      textTransform: "uppercase",
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perStore.map((store, index) => (
                <tr
                  key={store.storeId}
                  style={{
                    borderBottom:
                      index < perStore.length - 1 ? "1px solid var(--border-default)" : "none",
                  }}
                >
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                      <span
                        style={{
                          background: storeColors[store.storeId],
                          borderRadius: 2,
                          height: 8,
                          width: 8,
                        }}
                      />
                      <span style={{ fontWeight: 700 }}>{store.customName}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                        {store.shopifyDomain}
                      </span>
                    </div>
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    ${store.orderRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    ${store.netProfit.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                  <td
                    style={{
                      color:
                        store.netMargin > 0.15
                          ? "#054d28"
                          : store.netMargin > 0.05
                            ? "var(--text-primary)"
                            : "var(--color-danger)",
                      fontVariantNumeric: "tabular-nums",
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    {fmtPct(store.netMargin)}
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    ${store.blendedAdSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    {store.orders.toLocaleString()}
                  </td>
                </tr>
              ))}
              {totals && (
                <tr style={{ background: "var(--bg-secondary)" }}>
                  <td style={{ fontWeight: 800, padding: "12px 16px" }}>Total</td>
                  <td
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 800,
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    ${totals.orderRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 800,
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    ${totals.netProfit.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 800,
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    {totals.orderRevenue > 0 ? fmtPct(totals.netProfit / totals.orderRevenue) : "—"}
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 800,
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    ${totals.blendedAdSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 800,
                      padding: "12px 16px",
                      textAlign: "right",
                    }}
                  >
                    {totals.orders.toLocaleString()}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        <div
          style={{
            alignItems: "center",
            borderBottom: showDaily ? "1px solid var(--border-default)" : "none",
            display: "flex",
            justifyContent: "space-between",
            padding: "14px 20px",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            Daily breakdown · {dailyRows.length} rows
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowDaily(!showDaily)}
            type="button"
          >
            {showDaily ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showDaily ? "Collapse" : "Expand"}
          </button>
        </div>
        {showDaily && (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12, width: "100%" }}
            >
              <thead>
                <tr>
                  {[
                    "Date",
                    "Shop",
                    "Revenue",
                    "Net Profit",
                    "Margin",
                    "Orders",
                    "Ads",
                    "COGS",
                    "Total Cost",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        background: "var(--bg-secondary)",
                        borderBottom: "1px solid var(--border-default)",
                        color: "var(--text-muted)",
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        padding: "10px 12px",
                        textAlign: heading === "Date" || heading === "Shop" ? "left" : "right",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((row, index) => (
                  <tr
                    key={row.id}
                    style={{
                      borderBottom:
                        index < dailyRows.length - 1 ? "1px solid var(--border-default)" : "none",
                    }}
                  >
                    <td
                      style={{
                        color: "var(--text-secondary)",
                        fontWeight: 600,
                        padding: "10px 12px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.date}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ alignItems: "center", display: "inline-flex", gap: 5 }}>
                        <span
                          style={{
                            background: "#9fe870",
                            borderRadius: 2,
                            height: 7,
                            width: 7,
                          }}
                        />
                        <span style={{ fontWeight: 700 }}>{row.customName}</span>
                      </span>
                    </td>
                    <td
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        padding: "10px 12px",
                        textAlign: "right",
                      }}
                    >
                      ${row.orderRevenue.toFixed(2)}
                    </td>
                    <td
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        padding: "10px 12px",
                        textAlign: "right",
                      }}
                    >
                      ${row.netProfit.toFixed(2)}
                    </td>
                    <td
                      style={{
                        color: row.netMargin > 0.15 ? "#054d28" : "var(--text-muted)",
                        fontVariantNumeric: "tabular-nums",
                        padding: "10px 12px",
                        textAlign: "right",
                      }}
                    >
                      {fmtPct(row.netMargin)}
                    </td>
                    <td
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        padding: "10px 12px",
                        textAlign: "right",
                      }}
                    >
                      {row.orders}
                    </td>
                    <td
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        padding: "10px 12px",
                        textAlign: "right",
                      }}
                    >
                      ${row.blendedAdSpend.toFixed(2)}
                    </td>
                    <td
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        padding: "10px 12px",
                        textAlign: "right",
                      }}
                    >
                      ${row.cogs.toFixed(2)}
                    </td>
                    <td
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        padding: "10px 12px",
                        textAlign: "right",
                      }}
                    >
                      ${row.totalCost.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

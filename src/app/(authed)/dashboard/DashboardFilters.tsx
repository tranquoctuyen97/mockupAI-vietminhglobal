"use client";

import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import type { AnalyticsShop } from "@/lib/triple-whale/analytics";
import type { ComparisonMode, DatePreset, DateRange } from "@/lib/triple-whale/date-ranges";

export type DashboardPreset = DatePreset | "custom";

export interface DashboardFilterValue {
  preset: DashboardPreset;
  from: string;
  to: string;
  comparison: ComparisonMode;
  selectedShopId: string;
}

const DATE_OPTIONS: Array<{ value: DashboardPreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom range" },
];

const COMPARISON_OPTIONS: Array<{ value: ComparisonMode; label: string }> = [
  { value: "none", label: "None" },
  { value: "previous_period", label: "Previous period" },
  { value: "previous_week", label: "Previous week" },
  { value: "previous_month", label: "Previous month" },
  { value: "previous_quarter", label: "Previous quarter" },
  { value: "previous_year", label: "Previous year" },
];

type OpenPanel = "date" | "comparison" | null;

export function filterChangeForPreset(
  preset: DashboardPreset,
): Pick<DashboardFilterValue, "preset"> | null {
  return preset === "custom" ? null : { preset };
}

function formatRange(range: DateRange): string {
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const sameMonth = sameYear && from.getUTCMonth() === to.getUTCMonth();
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
  if (range.from === range.to) {
    return `${month.format(from)} ${from.getUTCDate()}, ${from.getUTCFullYear()}`;
  }
  if (sameMonth) {
    return `${month.format(from)} ${from.getUTCDate()}–${to.getUTCDate()}, ${from.getUTCFullYear()}`;
  }
  const fromYear = sameYear ? "" : `, ${from.getUTCFullYear()}`;
  return `${month.format(from)} ${from.getUTCDate()}${fromYear}–${month.format(to)} ${to.getUTCDate()}, ${to.getUTCFullYear()}`;
}

const triggerStyle = {
  alignItems: "center",
  background: "var(--bg-primary)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  display: "inline-flex",
  fontSize: 13,
  fontWeight: 700,
  gap: 8,
  minHeight: 38,
  padding: "8px 11px",
} as const;

const panelStyle = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: 12,
  boxShadow: "0 14px 32px rgba(15, 23, 42, 0.12)",
  left: 0,
  maxWidth: "calc(100vw - 32px)",
  padding: 8,
  position: "absolute",
  top: "calc(100% + 34px)",
  width: "288px",
  zIndex: 30,
} as const;

function optionStyle(active: boolean) {
  return {
    background: active ? "#f2faec" : "transparent",
    color: active ? "var(--color-wise-dark-green)" : "var(--text-primary)",
    display: "grid",
    fontSize: 14,
    fontWeight: active ? 700 : 600,
    gridTemplateColumns: "1fr 18px",
    justifyContent: "initial",
    minHeight: 40,
    padding: "0 12px",
    textAlign: "left" as const,
    width: "100%",
  };
}

export default function DashboardFilters(
  props: DashboardFilterValue & {
    shops: AnalyticsShop[];
    comparisonRange?: DateRange | null;
    onChange: (value: DashboardFilterValue) => void;
    syncAction?: ReactNode;
  },
) {
  const fromId = useId();
  const toId = useId();
  const datePanelId = useId();
  const comparisonPanelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [draftRange, setDraftRange] = useState({ from: props.from, to: props.to });
  const [openPanel, setOpenPanel] = useState<OpenPanel>(props.preset === "custom" ? "date" : null);
  const [customVisible, setCustomVisible] = useState(props.preset === "custom");

  useEffect(() => setDraftRange({ from: props.from, to: props.to }), [props.from, props.to]);
  useEffect(() => {
    function closePanels() {
      setOpenPanel(null);
      setCustomVisible(props.preset === "custom");
    }
    function dismissOnPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closePanels();
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closePanels();
    }
    document.addEventListener("pointerdown", dismissOnPointerDown);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointerDown);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [props.preset]);

  const currentFilters: DashboardFilterValue = {
    comparison: props.comparison,
    from: props.from,
    preset: props.preset,
    selectedShopId: props.selectedShopId,
    to: props.to,
  };
  const update = (next: Partial<DashboardFilterValue>) =>
    props.onChange({ ...currentFilters, ...next });
  const customRangeValid = Boolean(
    draftRange.from && draftRange.to && draftRange.from <= draftRange.to,
  );
  const activeDateLabel =
    DATE_OPTIONS.find((option) => option.value === (customVisible ? "custom" : props.preset))
      ?.label ?? "Select dates";
  const activeComparisonLabel =
    COMPARISON_OPTIONS.find((option) => option.value === props.comparison)?.label ?? "Compare";

  function selectPreset(preset: DashboardPreset) {
    const change = filterChangeForPreset(preset);
    if (!change) {
      setCustomVisible(true);
      return;
    }
    setCustomVisible(false);
    update(change);
    setOpenPanel(null);
  }

  return (
    <div
      aria-label="Analytics filters"
      className="dashboard-filter-toolbar"
      ref={rootRef}
      role="toolbar"
      style={{
        alignItems: "center",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        position: "relative",
        width: "100%",
      }}
    >
      <div style={{ position: "relative" }}>
        <button
          aria-controls={datePanelId}
          aria-expanded={openPanel === "date"}
          aria-haspopup="dialog"
          className="btn"
          onClick={() => {
            if (openPanel === "date") setCustomVisible(props.preset === "custom");
            setOpenPanel((current) => (current === "date" ? null : "date"));
          }}
          style={triggerStyle}
          type="button"
        >
          <CalendarDays aria-hidden="true" size={16} />
          {activeDateLabel}
          <ChevronDown aria-hidden="true" size={15} />
        </button>

        {openPanel === "date" && (
          <div aria-label="Select date range" id={datePanelId} role="dialog" style={panelStyle}>
            <div style={{ display: "grid", gap: 2 }}>
              {DATE_OPTIONS.map((option) =>
                (() => {
                  const active =
                    option.value === "custom" ? customVisible : props.preset === option.value;
                  return (
                    <button
                      className="btn btn-ghost"
                      key={option.value}
                      onClick={() => selectPreset(option.value)}
                      style={optionStyle(active)}
                      type="button"
                    >
                      <span>{option.label}</span>
                      {active && <Check aria-hidden="true" size={16} />}
                    </button>
                  );
                })(),
              )}
            </div>

            {customVisible && (
              <div
                style={{
                  borderTop: "1px solid var(--border-default)",
                  display: "grid",
                  gap: 9,
                  marginTop: 8,
                  padding: "12px 4px 4px",
                }}
              >
                <label htmlFor={fromId} style={{ display: "grid", fontSize: 11, gap: 4 }}>
                  From
                  <input
                    className="input"
                    id={fromId}
                    onChange={(event) =>
                      setDraftRange((current) => ({ ...current, from: event.target.value }))
                    }
                    type="date"
                    value={draftRange.from}
                  />
                </label>
                <label htmlFor={toId} style={{ display: "grid", fontSize: 11, gap: 4 }}>
                  To
                  <input
                    className="input"
                    id={toId}
                    onChange={(event) =>
                      setDraftRange((current) => ({ ...current, to: event.target.value }))
                    }
                    type="date"
                    value={draftRange.to}
                  />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={!customRangeValid}
                  onClick={() => {
                    update({ ...draftRange, preset: "custom" });
                    setOpenPanel(null);
                  }}
                  type="button"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <button
          aria-controls={comparisonPanelId}
          aria-expanded={openPanel === "comparison"}
          aria-haspopup="menu"
          className="btn"
          onClick={() =>
            setOpenPanel((current) => {
              setCustomVisible(props.preset === "custom");
              return current === "comparison" ? null : "comparison";
            })
          }
          style={triggerStyle}
          type="button"
        >
          {activeComparisonLabel}
          <ChevronDown aria-hidden="true" size={15} />
        </button>

        {openPanel === "comparison" && (
          <div aria-label="Comparison period" id={comparisonPanelId} role="menu" style={panelStyle}>
            {COMPARISON_OPTIONS.map((option) => (
              <button
                aria-checked={props.comparison === option.value}
                className="btn btn-ghost"
                key={option.value}
                onClick={() => {
                  update({ comparison: option.value });
                  setOpenPanel(null);
                }}
                role="menuitemradio"
                style={optionStyle(props.comparison === option.value)}
                type="button"
              >
                <span>{option.label}</span>
                {props.comparison === option.value && <Check aria-hidden="true" size={16} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <label style={{ position: "relative" }}>
        <span className="sr-only">Shop</span>
        <select
          aria-label="Shop"
          className="input"
          onChange={(event) => update({ selectedShopId: event.target.value })}
          style={{ ...triggerStyle, minWidth: 150 }}
          value={props.selectedShopId}
        >
          <option value="">All shops</option>
          {props.shops.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.customName}
            </option>
          ))}
        </select>
      </label>

      {props.syncAction && <div className="dashboard-filter-sync">{props.syncAction}</div>}

      <div
        aria-live="polite"
        style={{
          alignItems: "center",
          color: "var(--text-muted)",
          display: "flex",
          flexBasis: "100%",
          flexWrap: "wrap",
          fontSize: 11,
          gap: 5,
        }}
      >
        <strong style={{ color: "var(--text-primary)" }}>{formatRange(props)}</strong>
        {props.comparison !== "none" && props.comparisonRange && (
          <>
            <span>compared with</span>
            <strong style={{ color: "var(--text-primary)" }}>
              {formatRange(props.comparisonRange)}
            </strong>
          </>
        )}
      </div>
    </div>
  );
}

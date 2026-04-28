"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  EyeOff,
  Loader2,
  Plus,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { PLACEMENT_PRESETS } from "@/lib/placement/presets";
import { DEFAULT_PRINT_AREA, VIEW_KEYS, type Placement, type PlacementData, type ViewKey } from "@/lib/placement/types";
import { validatePlacement } from "@/lib/placement/validate";
import {
  VIEW_LABELS,
  createDefaultPlacementForView,
  disablePlacementView,
  enablePlacementView,
  getEnabledViews,
  getPlacementForView,
  normalizePlacementData,
  patchPlacementForView,
  setPlacementForView,
  summarizePlacementViews,
} from "@/lib/placement/views";

const LazyPlacementEditor = dynamic(
  () => import("@/components/placement/PlacementEditor").then((m) => ({ default: m.PlacementEditor })),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: 520, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 size={20} className="animate-spin" />
      </div>
    ),
  },
);

interface MultiViewPlacementEditorProps {
  value: PlacementData | null | undefined;
  onChange: (next: PlacementData) => void;
  bgColor?: string;
  designUrl?: string | null;
  title?: string;
  description?: string;
  compact?: boolean;
}

export function MultiViewPlacementEditor({
  value,
  onChange,
  bgColor = "#EEEEEE",
  designUrl,
  title = "Placement",
  description = "Cấu hình vị trí in cho từng mặt sản phẩm.",
  compact = false,
}: MultiViewPlacementEditorProps) {
  const placementData = useMemo(() => normalizePlacementData(value, true), [value]);
  const enabledViews = getEnabledViews(placementData);
  const [activeView, setActiveView] = useState<ViewKey>(enabledViews[0] ?? "front");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!VIEW_KEYS.includes(activeView)) {
      setActiveView(enabledViews[0] ?? "front");
    }
  }, [activeView, enabledViews]);

  useEffect(() => {
    setShowAdvanced(false);
  }, [activeView]);

  const activePlacement = getPlacementForView(placementData, activeView);
  const activePresets = PLACEMENT_PRESETS.filter((preset) => preset.view === activeView);
  const validation = activePlacement ? validatePlacement(activePlacement, DEFAULT_PRINT_AREA) : null;

  function commit(next: PlacementData) {
    onChange(normalizePlacementData(next, false));
  }

  function enableView(view: ViewKey, placement?: Partial<Placement>) {
    commit(enablePlacementView(placementData, view, placement));
    setActiveView(view);
  }

  function disableView(view: ViewKey) {
    const next = disablePlacementView(placementData, view);
    commit(next);
    setActiveView(view);
  }

  function updateActivePlacement(nextPlacement: Placement) {
    commit(setPlacementForView(placementData, activeView, nextPlacement));
  }

  function patchActivePlacement(patch: Partial<Placement>) {
    commit(patchPlacementForView(placementData, activeView, patch));
  }

  function applyPreset(key: string) {
    const preset = PLACEMENT_PRESETS.find((item) => item.key === key);
    if (!preset) return;
    enableView(preset.view, {
      ...preset.placement,
      lockAspect: true,
      mirrored: false,
      presetKey: preset.key,
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4" style={{ marginBottom: 16 }}>
        <div>
          <h3 style={{ fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <SlidersHorizontal size={18} /> {title}
          </h3>
          <p style={{ margin: "4px 0 0", opacity: 0.55, fontSize: "0.85rem" }}>{description}</p>
        </div>
        <span className="badge badge-success" style={{ whiteSpace: "nowrap" }}>
          {summarizePlacementViews(placementData)}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact ? "200px minmax(360px,1fr) 270px" : "220px minmax(460px,1fr) 300px",
          gap: compact ? 12 : 18,
          alignItems: "stretch",
        }}
      >
        <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {VIEW_KEYS.map((view) => {
            const enabled = Boolean(getPlacementForView(placementData, view));
            const active = activeView === view;
            return (
              <div
                key={view}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  border: active ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                  background: active ? "rgba(159,232,112,0.12)" : "transparent",
                  borderRadius: 8,
                  padding: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveView(view)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 44,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    padding: 0,
                  }}
                >
                  {enabled ? (
                    <CheckCircle2 size={15} style={{ color: "var(--color-wise-green)", flexShrink: 0 }} />
                  ) : (
                    <EyeOff size={15} style={{ opacity: 0.35, flexShrink: 0 }} />
                  )}
                  <span>
                    <span style={{ display: "block", fontWeight: 700, fontSize: "0.84rem", whiteSpace: "nowrap" }}>{VIEW_LABELS[view]}</span>
                    <span style={{ display: "block", opacity: 0.5, fontSize: "0.72rem" }}>
                      {enabled ? "Đang bật" : "Tắt"}
                    </span>
                  </span>
                </button>
                {enabled ? (
                  <button
                    type="button"
                    onClick={() => disableView(view)}
                    className="btn btn-secondary"
                    style={{ minHeight: 36, padding: "5px 9px", fontSize: "0.72rem", color: "#dc2626" }}
                  >
                    Tắt
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => enableView(view)}
                    className="btn btn-secondary"
                    style={{ minHeight: 36, padding: "5px 9px", fontSize: "0.72rem" }}
                  >
                    <Plus size={13} /> Bật
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="card" style={{ padding: 14, minHeight: compact ? 500 : 560 }}>
          {activePlacement ? (
            <LazyPlacementEditor
              printArea={DEFAULT_PRINT_AREA}
              placement={activePlacement}
              onChange={updateActivePlacement}
              bgColor={bgColor}
              designUrl={designUrl ?? undefined}
              canvasWidth={compact ? 460 : 560}
              canvasHeight={compact ? 500 : 560}
            />
          ) : (
            <div
              style={{
                minHeight: compact ? 500 : 560,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                opacity: 0.65,
              }}
            >
              <div>
                <EyeOff size={32} style={{ margin: "0 auto 12px" }} />
                <p style={{ margin: 0, fontWeight: 700 }}>{VIEW_LABELS[activeView]} đang tắt</p>
                <p style={{ margin: "4px 0 16px", fontSize: "0.85rem" }}>Bật vị trí này nếu store/listing cần tạo mockup tại đây.</p>
                <button type="button" className="btn btn-primary" onClick={() => enableView(activeView)}>
                  <Plus size={14} /> Bật {VIEW_LABELS[activeView]}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontWeight: 700, fontSize: "0.78rem", marginBottom: 6 }}>
              Preset cho {VIEW_LABELS[activeView]}
            </label>
            <div style={{ display: "grid", gap: 8 }}>
              {activePresets.map((preset) => {
                const selected = activePlacement?.presetKey === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => applyPreset(preset.key)}
                    style={{
                      minHeight: 44,
                      border: selected ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                      background: selected ? "rgba(159,232,112,0.12)" : "var(--bg-secondary)",
                      borderRadius: 8,
                      padding: "9px 10px",
                      cursor: "pointer",
                      textAlign: "left",
                      fontWeight: 700,
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
              {activePresets.length === 0 && (
                <p style={{ margin: 0, opacity: 0.55, fontSize: "0.8rem" }}>
                  Chưa có preset nhanh cho vị trí này.
                </p>
              )}
            </div>
          </div>

          {activePlacement ? (
            <>
              <button
                type="button"
                onClick={() => setShowAdvanced((next) => !next)}
                style={{
                  minHeight: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  border: "1px solid var(--border-default)",
                  borderRadius: 8,
                  background: "var(--bg-secondary)",
                  padding: "9px 10px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                <span>Nâng cao</span>
                {showAdvanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>

              {showAdvanced && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { key: "xMm", label: "X" },
                      { key: "yMm", label: "Y" },
                      { key: "widthMm", label: "Rộng" },
                      { key: "heightMm", label: "Cao" },
                      { key: "rotationDeg", label: "Xoay" },
                    ].map((field) => (
                      <div key={field.key}>
                        <label style={{ fontSize: "0.72rem", fontWeight: 700, opacity: 0.6 }}>{field.label}</label>
                        <input
                          className="input"
                          type="number"
                          step="0.1"
                          value={(activePlacement as unknown as Record<string, number>)[field.key] ?? 0}
                          onChange={(event) => patchActivePlacement({ [field.key]: Number(event.target.value) } as Partial<Placement>)}
                          style={{ width: "100%", padding: "7px 8px" }}
                        />
                      </div>
                    ))}
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, opacity: 0.6, marginBottom: 4 }}>
                      Placement mode
                    </label>
                    <select
                      className="input"
                      value={activePlacement.placementMode}
                      onChange={(event) => patchActivePlacement({ placementMode: event.target.value as Placement["placementMode"] })}
                      style={{ width: "100%" }}
                    >
                      <option value="preserve">Preserve</option>
                      <option value="stretch">Stretch</option>
                      <option value="exact">Exact</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-2" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={activePlacement.lockAspect}
                      onChange={(event) => patchActivePlacement({ lockAspect: event.target.checked })}
                    />
                    Khóa tỉ lệ
                  </label>

                  <label className="flex items-center gap-2" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={activePlacement.mirrored}
                      onChange={(event) => patchActivePlacement({ mirrored: event.target.checked })}
                    />
                    Lật ngang
                  </label>

                  {validation && validation.errors.length > 0 && (
                    <div className="alert" style={{ padding: 10, fontSize: "0.78rem" }}>
                      <div>
                        {validation.errors.map((item) => (
                          <p key={item.code} style={{ margin: "0 0 4px", color: item.severity === "error" ? "#dc2626" : "#b45309" }}>
                            {item.message}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => updateActivePlacement(createDefaultPlacementForView(activeView))}
                  >
                    <RotateCcw size={14} /> Reset view
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => disableView(activeView)}
                    style={{ color: "#dc2626" }}
                  >
                    <EyeOff size={14} /> Tắt vị trí này
                  </button>
                </>
              )}
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => enableView(activeView)}>
              <Plus size={14} /> Bật {VIEW_LABELS[activeView]}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

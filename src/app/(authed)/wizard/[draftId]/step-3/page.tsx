"use client";

import { use, useEffect, useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import { Copy, RotateCcw, Lock, Unlock } from "lucide-react";
import { DEFAULT_PLACEMENT, DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { Placement, PrintArea, ViewKey, PlacementData } from "@/lib/placement/types";
import { migratePlacementOnRead, stampV2_1 } from "@/lib/placement/migrate";
import { DpiBadge } from "@/components/placement/DpiBadge";
import { RotationControl } from "@/components/placement/RotationControl";
import { PlacementModeSelect } from "@/components/placement/PlacementModeSelect";
import { MirrorButton } from "@/components/placement/MirrorButton";
import { ValidationBanner } from "@/components/placement/ValidationBanner";
import { NumericInput } from "@/components/placement/NumericInput";
import { calculateDpi, type DpiResult } from "@/lib/placement/dpi";
import { validatePlacementSet } from "@/lib/placement/validate";
import { usePlacementHistory } from "@/stores/usePlacementHistory";
import type { BoundaryViolation } from "@/lib/placement/validate";
import type { PlacementPreset } from "@prisma/client";

const CanvasWorkspace = dynamic(() => import("@/components/placement/CanvasWorkspace"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[500px] animate-pulse bg-slate-100 rounded-lg flex items-center justify-center text-sm text-text-secondary">
      Đang tải Editor...
    </div>
  ),
});

const VIEWS: { id: ViewKey; label: string }[] = [
  { id: "front", label: "Mặt trước" },
  { id: "back", label: "Mặt sau" },
  { id: "sleeve_left", label: "Tay trái" },
  { id: "sleeve_right", label: "Tay phải" },
];

export default function Step3PlacementPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = use(params);
  const { draft, updateDraft } = useWizardStore();
  const { pushDebounced, undo, redo, clear } = usePlacementHistory();

  const colors = (draft?.selectedColors as Array<{ title: string; hex: string }>) || [];
  const [selectedColor, setSelectedColor] = useState(colors[0] || null);
  const [activeView, setActiveView] = useState<ViewKey>("front");

  const [printArea, setPrintArea] = useState<PrintArea>(DEFAULT_PRINT_AREA);
  const [presets, setPresets] = useState<PlacementPreset[]>([]);
  const [designPreview, setDesignPreview] = useState<{
    url: string;
    width: number;
    height: number;
    dpi: number | null;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Migrate-on-read for v2 → v2.1
  const placementData: PlacementData = useMemo(
    () => migratePlacementOnRead(draft?.placement),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft?.placement],
  );

  const currentPlacement: Placement =
    placementData?.variants?.[selectedColor?.title ?? ""]?.[activeView] ??
    DEFAULT_PLACEMENT;

  // DPI
  const currentDpi: DpiResult = useMemo(() => {
    if (!designPreview) return { dpi: 0, severity: "warn", label: "No design" };
    return calculateDpi(
      { widthPx: designPreview.width, heightPx: designPreview.height, dpi: designPreview.dpi },
      currentPlacement,
    );
  }, [designPreview, currentPlacement]);

  // ── Client-side live violations (6.8b) ───────────────────────────────
  const violations: BoundaryViolation[] = useMemo(() => {
    if (!designPreview || !placementData?.variants) return [];
    return validatePlacementSet(
      placementData,
      printArea,
      { widthPx: designPreview.width, heightPx: designPreview.height, dpi: designPreview.dpi },
    );
  }, [placementData, printArea, designPreview]);

  // Load design preview
  useEffect(() => {
    if (!draft?.designId) return;
    (async () => {
      const res = await fetch(`/api/designs/${draft.designId}`);
      if (res.ok) {
        const data = await res.json();
        setDesignPreview({ url: data.previewUrl, width: data.width, height: data.height, dpi: data.dpi });
      }
    })();
  }, [draft?.designId]);

  // Load print area on view change
  useEffect(() => {
    if (!draft?.blueprintId) return;
    (async () => {
      const res = await fetch(
        `/api/blueprint/${draft.blueprintId}/print-area?position=${activeView}`,
      );
      if (res.ok) setPrintArea((await res.json()).printArea);
    })();
  }, [draft?.blueprintId, activeView]);

  // Load presets
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/placement/presets?productType=tshirt");
      if (res.ok) setPresets((await res.json()).presets);
    })();
  }, []);

  // Clear undo/redo history when switching color/view
  useEffect(() => { clear(); }, [selectedColor, activeView, clear]);

  // ── Placement change handler ──────────────────────────────────────────
  const handlePlacementChange = useCallback(
    async (patch: Partial<Placement>) => {
      const newPlacement: Placement = { ...currentPlacement, ...patch };
      const colorKey = selectedColor?.title ?? "";

      // Deep clone + apply
      const newVariants = JSON.parse(JSON.stringify(placementData.variants ?? {}));
      if (!newVariants[colorKey]) newVariants[colorKey] = {};
      newVariants[colorKey][activeView] = newPlacement;

      const newData: PlacementData = stampV2_1({ ...placementData, variants: newVariants });

      // Optimistic update
      updateDraft({ placement: newData as any });

      // Undo/redo history push (debounced 300ms)
      pushDebounced(newData);

      // API save (fire-and-forget; errors are non-blocking)
      fetch(`/api/wizard/drafts/${draftId}/placement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantKey: colorKey, view: activeView, placement: newPlacement }),
      }).catch(console.error);
    },
    [currentPlacement, selectedColor, activeView, placementData, draftId, updateDraft, pushDebounced],
  );

  // ── Undo/Redo ──────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    const prev = undo();
    if (prev) updateDraft({ placement: prev as any });
  }, [undo, updateDraft]);

  const handleRedo = useCallback(() => {
    const next = redo();
    if (next) updateDraft({ placement: next as any });
  }, [redo, updateDraft]);

  // Global keyboard handler — Cmd+Z / Ctrl+Z for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta || e.key !== "z") return;
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  // ── Copy to all colors ─────────────────────────────────────────────────
  const applyToAllColors = async () => {
    if (!selectedColor) return;
    const res = await fetch(`/api/wizard/drafts/${draftId}/placement/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromVariantKey: selectedColor.title,
        view: activeView,
        targetVariantKeys: colors.map((c) => c.title),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      updateDraft({ placement: data.placementData });
      alert("Đã áp dụng cho toàn bộ màu!");
    }
  };

  // ── Jump-to handler for ValidationBanner ──────────────────────────────
  const jumpToVariantView = (variantId: string, view: string) => {
    const color = colors.find((c) => c.title === variantId);
    if (color) setSelectedColor(color);
    setActiveView(view as ViewKey);
  };

  // ── Finalize (validate all + move to Step 4) ──────────────────────────
  const hasErrors = violations.some((v) => v.severity === "error");
  const hasWarnings = violations.some((v) => v.severity === "warn");

  const handleNext = async () => {
    if (hasErrors) return; // Button should be disabled, but guard anyway
    setIsSubmitting(true);

    // If only warnings, confirm first before calling API
    if (hasWarnings) {
      const confirmed = window.confirm(
        `Có ${violations.filter((v) => v.severity === "warn").length} cảnh báo vị trí in (ngoài safe zone). Tiếp tục không?`,
      );
      if (!confirmed) { setIsSubmitting(false); return; }
    }

    const res = await fetch(`/api/wizard/drafts/${draftId}/step-3/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledge_warnings: hasWarnings }),
    });

    if (!res.ok) {
      // Unexpected server error — show generic message
      setIsSubmitting(false);
      alert("Có lỗi xảy ra khi kiểm tra placement. Vui lòng thử lại.");
      return;
    }

    // Proceed to step 4
    window.location.href = `/wizard/${draftId}/step-4`;
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">Placement Editor Pro</h2>
          <p className="text-sm text-text-secondary">Chỉnh sửa vị trí in chính xác tới từng mm.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUndo}
            className="btn btn-secondary btn-sm flex items-center gap-1"
            title="Hoàn tác (Cmd+Z)"
          >
            <RotateCcw size={13} />
            Undo
          </button>
          <button
            onClick={handleNext}
            disabled={hasErrors || isSubmitting}
            className="btn btn-primary btn-sm"
          >
            {isSubmitting ? "Đang kiểm tra..." : "Tiếp theo →"}
          </button>
        </div>
      </div>

      {/* Validation banner above canvas */}
      <ValidationBanner violations={violations} onJumpTo={jumpToVariantView} />

      <div className="grid grid-cols-[200px_1fr_300px] gap-5 flex-1 min-h-[560px]">
        {/* ── Left Pane ── */}
        <div className="flex flex-col gap-5">
          {/* View Selector */}
          <div>
            <label className="text-xs font-semibold text-text-secondary mb-2 block uppercase tracking-wide">Mặt in</label>
            <div className="flex flex-col gap-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setActiveView(v.id)}
                  className={`px-3 py-2 text-left rounded-md text-sm transition-colors border ${
                    activeView === v.id
                      ? "bg-wise-green/8 border-wise-green font-medium text-wise-green"
                      : "border-transparent hover:border-border-default"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color Selector */}
          <div>
            <label className="text-xs font-semibold text-text-secondary mb-2 block uppercase tracking-wide">Màu sắc</label>
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <button
                  key={c.title}
                  onClick={() => setSelectedColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    selectedColor?.title === c.title
                      ? "border-wise-green ring-2 ring-wise-green/20 scale-110"
                      : "border-white/50 hover:scale-110"
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.title}
                />
              ))}
            </div>
            {selectedColor && (
              <p className="text-[10px] text-text-secondary mt-1 opacity-70">{selectedColor.title}</p>
            )}
          </div>
        </div>

        {/* ── Center Canvas ── */}
        <div className="flex flex-col">
          <CanvasWorkspace
            placement={currentPlacement}
            printArea={printArea}
            designPreviewUrl={designPreview?.url ?? null}
            productBgColor={selectedColor?.hex ?? "#FFFFFF"}
            onChange={handlePlacementChange}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-text-secondary">
            <span>Vùng đứt nét xanh = vùng an toàn</span>
            <DpiBadge result={currentDpi} />
          </div>
        </div>

        {/* ── Right Pane ── */}
        <div className="flex flex-col gap-4 overflow-y-auto pr-0.5">
          {/* Position inputs */}
          <div className="card p-4 space-y-3">
            <h3 className="font-semibold text-xs uppercase tracking-wide text-text-secondary">Vị trí (mm)</h3>

            <div className="grid grid-cols-2 gap-4">
              {/* X — horizontal offset, relative to print area center */}
              <div className="pb-4">
                <label className="text-[10px] text-text-secondary mb-0.5 block">X</label>
                <NumericInput
                  label="Trục X"
                  value={currentPlacement.xMm}
                  onChange={(v) => handlePlacementChange({ xMm: v })}
                  softMin={-(printArea.widthMm / 2 - printArea.safeMarginMm)}
                  softMax={printArea.widthMm / 2 - printArea.safeMarginMm}
                  hardMin={-1000}
                  hardMax={1000}
                  unit="mm"
                />
              </div>
              {/* Y — vertical offset from top of print area */}
              <div className="pb-4">
                <label className="text-[10px] text-text-secondary mb-0.5 block">Y</label>
                <NumericInput
                  label="Trục Y"
                  value={currentPlacement.yMm}
                  onChange={(v) => handlePlacementChange({ yMm: v })}
                  softMin={printArea.safeMarginMm}
                  softMax={printArea.heightMm - printArea.safeMarginMm}
                  hardMin={-500}
                  hardMax={1000}
                  unit="mm"
                />
              </div>
              <div className="pb-4">
                <label className="text-[10px] text-text-secondary mb-0.5 block">Rộng</label>
                <NumericInput
                  label="Chiều rộng"
                  value={currentPlacement.widthMm}
                  onChange={(v) => handlePlacementChange({ widthMm: v })}
                  softMin={10}
                  softMax={printArea.widthMm}
                  hardMin={5}
                  hardMax={1000}
                  unit="mm"
                />
              </div>
              <div className="pb-4">
                <label className="text-[10px] text-text-secondary mb-0.5 block">Cao</label>
                <NumericInput
                  label="Chiều cao"
                  value={currentPlacement.heightMm}
                  onChange={(v) => handlePlacementChange({ heightMm: v })}
                  softMin={10}
                  softMax={printArea.heightMm}
                  hardMin={5}
                  hardMax={1000}
                  unit="mm"
                />
              </div>
            </div>

            {/* Lock aspect */}
            <button
              onClick={() => handlePlacementChange({ lockAspect: !currentPlacement.lockAspect })}
              className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border w-full transition-colors ${
                currentPlacement.lockAspect
                  ? "border-wise-green/40 bg-wise-green/5 text-wise-green"
                  : "border-border-default text-text-secondary"
              }`}
            >
              {currentPlacement.lockAspect ? <Lock size={12} /> : <Unlock size={12} />}
              {currentPlacement.lockAspect ? "Giữ tỉ lệ W/H" : "Tự do W/H"}
            </button>

            {/* Center buttons */}
            <div className="flex gap-2">
              <button
                className="btn btn-secondary flex-1 text-xs h-7"
                onClick={() => handlePlacementChange({ xMm: 0 })}
              >
                Center H
              </button>
              <button
                className="btn btn-secondary flex-1 text-xs h-7"
                onClick={() => handlePlacementChange({ yMm: printArea.heightMm / 2 })}
              >
                Center V
              </button>
            </div>
          </div>

          {/* Rotation */}
          <div className="card p-4">
            <RotationControl
              value={currentPlacement.rotationDeg}
              onChange={(deg) => handlePlacementChange({ rotationDeg: deg })}
            />
          </div>

          {/* Mirror & placement mode */}
          <div className="card p-4 space-y-3">
            <MirrorButton
              mirrored={currentPlacement.mirrored}
              onToggle={() => handlePlacementChange({ mirrored: !currentPlacement.mirrored })}
            />
            <PlacementModeSelect
              value={currentPlacement.placementMode}
              onChange={(mode) => handlePlacementChange({ placementMode: mode })}
            />
          </div>

          {/* Presets */}
          <div className="card p-4">
            <h3 className="font-semibold text-xs uppercase tracking-wide text-text-secondary mb-3">Presets</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {presets
                .filter(
                  (p) =>
                    (activeView === "front" && p.position === "FRONT") ||
                    (activeView === "back" && p.position === "BACK") ||
                    (activeView === "sleeve_left" && p.position === "SLEEVE_LEFT") ||
                    (activeView === "sleeve_right" && p.position === "SLEEVE_RIGHT"),
                )
                .map((p) => (
                  <button
                    key={p.key}
                    onClick={() =>
                      handlePlacementChange({
                        xMm: p.defaultXMm,
                        yMm: p.defaultYMm + printArea.heightMm / 2,
                        widthMm: p.defaultWidthMm,
                        heightMm: p.defaultHeightMm,
                        rotationDeg: 0,
                        presetKey: p.key,
                      })
                    }
                    className={`p-2 text-[11px] border rounded hover:border-wise-green bg-bg-primary text-left transition-colors ${
                      currentPlacement.presetKey === p.key ? "border-wise-green" : ""
                    }`}
                  >
                    <span className="block font-medium">{p.nameVi}</span>
                    <span className="block text-[10px] text-text-secondary opacity-60 mt-0.5">
                      {p.defaultWidthMm}×{p.defaultHeightMm}mm
                    </span>
                  </button>
                ))}
            </div>
          </div>

          {/* Copy to all colors */}
          <div className="card p-4 bg-wise-green/5 border-wise-green/20">
            <h3 className="font-semibold text-xs mb-1.5 flex items-center gap-1.5 text-wise-green">
              <Copy size={13} /> Copy vị trí
            </h3>
            <p className="text-[11px] text-text-secondary mb-3">
              Copy từ <strong>{selectedColor?.title ?? "—"}</strong> sang toàn bộ {colors.length} màu.
            </p>
            <button
              onClick={applyToAllColors}
              className="btn w-full bg-wise-green text-white hover:bg-wise-green/90 border-0 h-8 text-xs"
            >
              Áp dụng cho tất cả màu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

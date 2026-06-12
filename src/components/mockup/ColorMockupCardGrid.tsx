"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ColorMockupCard, type CardSource } from "./ColorMockupCard";
import { UploadMockupModal, type UploadMockupModalValue, type UploadMockupTemplate } from "./UploadMockupModal";
import {
  computeCustomPrintAreaPx,
  materializeSmartFitPlacement,
  shouldAutoApplySmartFit,
} from "@/lib/mockup/placement-region";

// --- Types ---

interface ColorInfo { id: string; name: string; hex: string }

interface SourcesResponse {
  template: {
    id: string; name: string; blueprintTitle: string; printProviderTitle: string;
    defaultMockupSource: string;
    selectedColors: ColorInfo[];
  } | null;
  draftSources: SourceWithColor[];
  eligibleTemplateSources: SourceWithColor[];
  selectedSourceIds: string[];
  primarySourceId: string | null;
}

type SourceWithColor = CardSource & {
  colorId?: string | null;
  colorName?: string | null;
  color?: { id: string; name: string; hex: string } | null;
};

// --- Pure logic (exported for tests) ---

export function findSourceForColor(
  colorId: string,
  sources: SourceWithColor[],
  colors?: ColorInfo[],
): SourceWithColor | null {
  // Try id match first
  const byId = sources.find((s) => s.colorId === colorId);
  if (byId) return byId;
  // Fall back to name match (check both flat colorName and nested color.name)
  if (!colors) return null;
  const colorName = colors.find((c) => c.id === colorId)?.name;
  if (!colorName) return null;
  return sources.find((s) => s.colorName === colorName || s.color?.name === colorName) ?? null;
}

export interface ReadinessResult {
  readyCount: number;
  totalCount: number;
  allReady: boolean;
}

export function computeReadiness(
  colors: ColorInfo[],
  sourceByColorId: Map<string, CardSource | null>,
  generatedByColorId: Map<string, string | null>,
): ReadinessResult {
  let readyCount = 0;
  for (const color of colors) {
    const src = sourceByColorId.get(color.id) ?? null;
    const gen = generatedByColorId.get(color.id) ?? null;
    const isReady = Boolean(gen || (src && src.compositeRegionPx));
    if (isReady) readyCount++;
  }
  return { readyCount, totalCount: colors.length, allReady: readyCount === colors.length };
}

// --- Component ---

interface ColorMockupCardGridProps {
  draftId: string;
  templateId: string;
  selectedColors: ColorInfo[];
  designImageUrl?: string | null;
  mockupImages: Array<{ colorName: string; compositeUrl?: string | null; colorId?: string | null }>;
  onGenerate: () => void;
  isGenerating: boolean;
  generateButtonLabel: string;
  hasRenderedMockups: boolean;
  onNextStep: () => Promise<void>;
  onDeselectColor?: (colorId: string) => void;
  /** Dynamic print area in millimeter dimensions (from template/blueprint) */
  printAreaMm?: { widthMm: number; heightMm: number } | null;
}

export function ColorMockupCardGrid({
  draftId,
  templateId,
  selectedColors,
  designImageUrl,
  mockupImages,
  onGenerate,
  isGenerating,
  generateButtonLabel,
  hasRenderedMockups,
  onNextStep,
  onDeselectColor,
  printAreaMm,
}: ColorMockupCardGridProps) {
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<SourcesResponse | null>(null);
  const [uploadColorId, setUploadColorId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources`);
      if (!res.ok) throw new Error();
      setSources(await res.json());
    } catch {
      toast.error("Không tải được mockup sources");
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => { void loadSources(); }, [loadSources]);

  // Re-fetch sources when selected colors change (handles re-selection after deselect)
  const selectedColorKey = selectedColors.map((c) => c.id).sort().join(",");
  useEffect(() => {
    // Skip initial render (loadSources already called above)
    const timer = setTimeout(() => { void loadSources(); }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedColorKey]);

  // ── Backfill: Smart Fit cho TEMPLATE sources thiếu placement ──
  const backfillAppliedRef = useRef(false);

  useEffect(() => {
    if (backfillAppliedRef.current) return;
    if (loading || !sources) return;
    if (!printAreaMm?.widthMm || !printAreaMm?.heightMm) return;

    // Collect TEMPLATE sources that need backfill (only those mapped to selected colors)
    const needsBackfill: Array<{ sourceId: string; imageW: number; imageH: number }> = [];

    for (const source of sources.eligibleTemplateSources ?? []) {
      // Only backfill if this source maps to a selected color
      const colorMatch = selectedColors.some((c) => c.id === source.colorId);
      if (!colorMatch) continue;

      const imageW = source.imageWidth ?? 0;
      const imageH = source.imageHeight ?? 0;
      if (!imageW || !imageH) continue;

      const printAreaPx = computeCustomPrintAreaPx(printAreaMm, imageW, imageH);
      const existingRegion = source.compositeRegionPx
        ? {
            x: source.compositeRegionPx.x,
            y: source.compositeRegionPx.y,
            width: source.compositeRegionPx.width,
            height: source.compositeRegionPx.height,
          }
        : null;

      if (
        shouldAutoApplySmartFit({
          existingRegion,
          printAreaPx,
          imageWidth: imageW,
          imageHeight: imageH,
        })
      ) {
        needsBackfill.push({ sourceId: source.id, imageW, imageH });
      }
    }

    if (needsBackfill.length === 0) {
      backfillAppliedRef.current = true;
      return;
    }

    // Load design dimensions for Smart Fit computation
    let cancelled = false;
    const doBackfill = async () => {
      let designW = 0;
      let designH = 0;
      if (designImageUrl) {
        try {
          const dims = await new Promise<{ w: number; h: number }>(
            (resolve, reject) => {
              const img = new window.Image();
              img.crossOrigin = "anonymous";
              img.onload = () =>
                resolve({ w: img.naturalWidth, h: img.naturalHeight });
              img.onerror = () =>
                reject(new Error("Failed to load design"));
              img.src = designImageUrl;
            },
          );
          designW = dims.w;
          designH = dims.h;
        } catch {
          /* keep 0 */
        }
      }

      if (cancelled || backfillAppliedRef.current) return;
      if (!designW || !designH) {
        backfillAppliedRef.current = true;
        return;
      }

      const placementsBySourceId: Record<
        string,
        {
          x: number;
          y: number;
          width: number;
          height: number;
          rotationDeg: number;
          imageWidth: number;
          imageHeight: number;
        }
      > = {};

      for (const { sourceId, imageW, imageH } of needsBackfill) {
        const region = materializeSmartFitPlacement({
          printAreaMm: printAreaMm!,
          imageWidth: imageW,
          imageHeight: imageH,
          designWidth: designW,
          designHeight: designH,
        });
        if (region) {
          placementsBySourceId[sourceId] = region;
        }
      }

      const updatedCount = Object.keys(placementsBySourceId).length;
      if (updatedCount > 0) {
        // Merge with existing selection: preserve already-selected sources,
        // add newly backfilled template sources
        const sourceIds = [
          ...new Set([
            ...(sources.selectedSourceIds ?? []),
            ...Object.keys(placementsBySourceId),
          ]),
        ];
        const primarySourceId =
          sources.primarySourceId ?? sourceIds[0] ?? null;

        try {
          const res = await fetch(
            `/api/wizard/drafts/${draftId}/mockup-library-picks`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceIds,
                primarySourceId,
                placementsBySourceId,
              }),
            },
          );
          if (res.ok) {
            // Reload sources to pick up backfilled placements
            await loadSources();
          }
        } catch {
          /* silent — backfill is best-effort */
        }
      }

      backfillAppliedRef.current = true;
    };

    doBackfill();

    return () => {
      cancelled = true;
      backfillAppliedRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sources, printAreaMm, designImageUrl]);

  // Map color → best source (draft preferred over template)
  const sourceByColorId = useMemo(() => {
    if (!sources) return new Map<string, CardSource | null>();
    const allSources = [...(sources.draftSources ?? []), ...(sources.eligibleTemplateSources ?? [])];
    return new Map(
      selectedColors.map((color) => [
        color.id,
        findSourceForColor(color.id, allSources, selectedColors),
      ])
    );
  }, [sources, selectedColors]);

  // Map color → generated output URL
  const generatedByColorId = useMemo(() => {
    return new Map(
      selectedColors.map((color) => {
        const img = mockupImages.find(
          (m) => m.colorId === color.id || m.colorName?.toLowerCase() === color.name.toLowerCase()
        );
        return [color.id, img?.compositeUrl ?? null];
      })
    );
  }, [mockupImages, selectedColors]);

  const readiness = useMemo(
    () => computeReadiness(selectedColors, sourceByColorId, generatedByColorId),
    [selectedColors, sourceByColorId, generatedByColorId]
  );

  const modalTemplates = useMemo<UploadMockupTemplate[]>(() => {
    if (!sources?.template) return [];
    return [{
      id: sources.template.id,
      name: sources.template.name,
      blueprintTitle: sources.template.blueprintTitle,
      printProviderTitle: sources.template.printProviderTitle,
      colors: selectedColors,
    }];
  }, [sources, selectedColors]);

  async function handleUploadSave(value: UploadMockupModalValue) {
    if (value.sourceId) {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources/${value.sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: value.label, ...(value.compositeRegionPx ? { compositeRegionPx: value.compositeRegionPx } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Không lưu được mockup");
      toast.success("Đã cập nhật mockup");
    } else {
      if (!value.file) throw new Error("Chưa chọn ảnh");
      const form = new FormData();
      form.set("file", value.file);
      form.set("colorId", value.colorId);
      form.set("view", "front");
      form.set("sceneType", "flat_lay");
      form.set("renderMode", "COMPOSITE");
      form.set("isPrimary", "false");
      form.set("sortOrder", "0");
      if (!value.compositeRegionPx) throw new Error("Chưa có vùng ghép design");
      form.set("compositeRegionPx", JSON.stringify(value.compositeRegionPx));
      if (value.label.trim()) form.set("label", value.label.trim());
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources`, { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).error || "Upload thất bại");
      toast.success("Đã upload mockup");
    }
    setUploadOpen(false);
    setUploadColorId(null);
    await loadSources();
  }

  // Save TEMPLATE placement → update pick (not clone to DRAFT)
  const handleSaveTemplatePlacement = useCallback(
    async (sourceId: string, region: { x: number; y: number; width: number; height: number; rotationDeg: number; imageWidth: number; imageHeight: number }) => {
      if (!sources) return;
      const sourceIds = sources.selectedSourceIds?.length
        ? sources.selectedSourceIds
        : [sourceId];
      // Ensure the edited source is in the list
      const mergedSourceIds = [...new Set([...sourceIds, sourceId])];
      const primarySourceId = sources.primarySourceId ?? mergedSourceIds[0] ?? null;

      const res = await fetch(
        `/api/wizard/drafts/${draftId}/mockup-library-picks`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceIds: mergedSourceIds,
            primarySourceId,
            placementsBySourceId: { [sourceId]: region },
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Lỗi lưu vị trí");
      }
    },
    [draftId, sources],
  );

  if (loading) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", opacity: 0.5 }}>
        <Loader2 size={20} className="animate-spin" style={{ margin: "0 auto" }} />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontWeight: 700, fontSize: "1rem" }}>Mockup & Vị trí design</h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.78rem", opacity: 0.55 }}>
            {readiness.readyCount}/{readiness.totalCount} màu sẵn sàng
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`btn ${hasRenderedMockups ? "btn-secondary" : "btn-primary"}`}
            onClick={onGenerate}
            disabled={isGenerating || !readiness.allReady}
            title={!readiness.allReady ? `${readiness.totalCount - readiness.readyCount} màu chưa sẵn sàng` : undefined}
            style={(!readiness.allReady || isGenerating) ? { opacity: 0.5, cursor: "not-allowed" } : {}}
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {generateButtonLabel}
          </button>
          {hasRenderedMockups && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNextStep}
              disabled={isGenerating}
              style={isGenerating ? { opacity: 0.5, cursor: "not-allowed" } : {}}
            >
              Tiếp theo
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Color cards */}
      <div style={{ display: "grid", gap: 12 }}>
        {selectedColors.map((color) => (
          <ColorMockupCard
            key={color.id}
            color={color}
            source={sourceByColorId.get(color.id) ?? null}
            generatedOutputUrl={generatedByColorId.get(color.id)}
            designImageUrl={designImageUrl}
            draftId={draftId}
            onUploadClick={() => { setUploadColorId(color.id); setUploadOpen(true); }}
            onPlacementSaved={loadSources}
            onDeselectColor={onDeselectColor ? () => onDeselectColor(color.id) : undefined}
            onSaveTemplatePlacement={handleSaveTemplatePlacement}
            printAreaMm={printAreaMm}
          />
        ))}
      </div>

      {uploadOpen && (
        <UploadMockupModal
          open={uploadOpen}
          scope="DRAFT"
          draftId={draftId}
          onClose={() => { setUploadOpen(false); setUploadColorId(null); }}
          onSave={handleUploadSave}
          templates={modalTemplates}
          lockedTemplateId={templateId}
          lockedColorId={uploadColorId}
          designImageUrl={designImageUrl}
          printAreaMm={printAreaMm}
        />
      )}
    </div>
  );
}

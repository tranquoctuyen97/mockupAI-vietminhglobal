"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ColorMockupCard, type CardSource } from "./ColorMockupCard";
import { UploadMockupModal, type UploadMockupModalValue } from "./UploadMockupModal";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";

// --- Types ---

interface ColorInfo { id: string; name: string; hex: string }

interface PickData {
  id: string;
  templateMockupItemId: string;
  colorId: string;
  isPrimary: boolean;
  sortOrder: number;
  compositeRegionPx: unknown;
  templateMockupItem: {
    id: string;
    mockupId: string;
    appliesToColorIds: unknown;
    mockup: {
      id: string;
      name: string;
      storagePath: string;
      previewPath: string | null;
      width: number;
      height: number;
      view: string;
      sceneType: string;
      renderMode: string;
      compositeRegionPx: unknown;
    };
  };
}

interface TemplateMockupItemData {
  id: string;
  templateId: string;
  mockupId: string;
  appliesToColorIds: unknown;
  sortOrder: number;
  isPrimary: boolean;
  mockup: {
    id: string;
    name: string;
    storagePath: string;
    previewPath: string | null;
    width: number;
    height: number;
    view: string;
    sceneType: string;
    renderMode: string;
    compositeRegionPx: unknown;
  };
}

interface DesignPair {
  id: string;
  draftId: string;
  baseName: string;
  lightDraftDesignId: string;
  darkDraftDesignId: string;
}

interface DraftDesignEntry {
  id: string;
  designId: string;
  sortOrder: number;
  design?: { id: string; name?: string | null; previewPath?: string | null } | null;
}

interface MockupImageEntry {
  colorName?: string;
  compositeUrl?: string | null;
  colorId?: string | null;
  draftDesignId?: string;
}

interface GridRow {
  key: string;
  color: ColorInfo;
  mappedDraftDesignId: string;
  mappedDesignName: string;
  mappedDesignId: string;
  mappedMockupName: string;
  source: CardSource | null;
  generatedOutputUrl: string | null;
  isHighlighted: boolean;
  activeInspectDesignName: string;
  designPairBaseName?: string;
}

type SourceWithColor = CardSource & { colorId?: string | null };

// --- Helpers ---

function pickToCardSource(pick: PickData): SourceWithColor {
  const m = pick.templateMockupItem.mockup;
  const region = pick.compositeRegionPx ?? m.compositeRegionPx;
  return {
    id: pick.id,
    colorId: pick.colorId,
    scope: "TEMPLATE",
    label: m.name,
    imageUrl: `/api/files/${m.storagePath}`,
    outputUrl: null,
    imageWidth: m.width,
    imageHeight: m.height,
    compositeRegionPx: region && typeof region === "object"
      ? {
          x: (region as Record<string, number>).x ?? 0,
          y: (region as Record<string, number>).y ?? 0,
          width: (region as Record<string, number>).width ?? 0,
          height: (region as Record<string, number>).height ?? 0,
          rotationDeg: (region as Record<string, number>).rotationDeg ?? 0,
          imageWidth: m.width,
          imageHeight: m.height,
        }
      : null,
  };
}

function findMockupItemForColor(colorId: string, items: TemplateMockupItemData[]): TemplateMockupItemData | null {
  const exact = items.find((item) => {
    const ids = Array.isArray(item.appliesToColorIds) ? item.appliesToColorIds : [];
    return ids.includes(colorId);
  });
  if (exact) return exact;
  const generic = items.find((item) => {
    const ids = Array.isArray(item.appliesToColorIds) ? item.appliesToColorIds : [];
    return ids.length === 0;
  });
  if (generic) return generic;
  return items.find((item) => item.isPrimary) || items[0] || null;
}

// --- Pure logic (exported for tests) ---

export function findSourceForColor(
  colorId: string,
  sources: SourceWithColor[],
  colors?: ColorInfo[],
): SourceWithColor | null {
  const byId = sources.find((s) => s.colorId === colorId);
  if (byId) return byId;
  if (!colors) return null;
  const colorName = colors.find((c) => c.id === colorId)?.name;
  if (!colorName) return null;
  return sources.find((s) => (s as any).colorName === colorName || (s as any).color?.name === colorName) ?? null;
}

export interface ReadinessResult {
  readyCount: number;
  totalCount: number;
  allReady: boolean;
}

export function computeReadiness(
  rows: GridRow[],
  generatedByRowKey: Map<string, string | null>,
): ReadinessResult {
  let readyCount = 0;
  for (const row of rows) {
    const gen = generatedByRowKey.get(row.key) ?? null;
    const isReady = Boolean(gen || (row.source && row.source.compositeRegionPx));
    if (isReady) readyCount++;
  }
  return { readyCount, totalCount: rows.length, allReady: readyCount === rows.length };
}

// --- Component ---

interface ColorMockupCardGridProps {
  draftId: string;
  templateId: string;
  storeId: string;
  selectedColors: ColorInfo[];
  designImageUrl?: string | null;
  mockupImages: MockupImageEntry[];
  onGenerate: () => void;
  isGenerating: boolean;
  generateButtonLabel: string;
  hasRenderedMockups: boolean;
  onNextStep: () => Promise<void>;
  onDeselectColor?: (colorId: string) => void;
  onMockupsStale?: () => void;
  printAreaMm?: { widthMm: number; heightMm: number } | null;
  // Design pair / mapping props
  activeDraftDesignId?: string | null;
  designPairs?: DesignPair[];
  effectiveColorGroups?: Map<string, string>;
  draftDesigns?: DraftDesignEntry[];
}

export function ColorMockupCardGrid({
  draftId,
  templateId,
  storeId,
  selectedColors,
  designImageUrl,
  mockupImages,
  onGenerate,
  isGenerating,
  generateButtonLabel,
  hasRenderedMockups,
  onNextStep,
  onDeselectColor,
  onMockupsStale,
  printAreaMm,
  activeDraftDesignId,
  designPairs,
  effectiveColorGroups,
  draftDesigns,
}: ColorMockupCardGridProps) {
  const [loading, setLoading] = useState(true);
  const [picks, setPicks] = useState<PickData[]>([]);
  const [templateItems, setTemplateItems] = useState<TemplateMockupItemData[]>([]);
  const [uploadColorId, setUploadColorId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Tự tải lại picks khi wizard store lưu xong (saving: true → false)
  const saving = useWizardStore((s) => s.saving);
  const prevSavingRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [picksRes, itemsRes] = await Promise.all([
        fetch(`/api/wizard/drafts/${draftId}/mockup-library-picks`),
        fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups`),
      ]);
      if (picksRes.ok) {
        const data = await picksRes.json();
        setPicks(data.picks ?? []);
      }
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        setTemplateItems(data.items ?? []);
      }
    } catch {
      toast.error("Không tải được mockup sources");
    } finally {
      setLoading(false);
    }
  }, [draftId, storeId, templateId]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Reload picks khi save hoàn tất (saving chuyển true → false)
  useEffect(() => {
    if (prevSavingRef.current && !saving) {
      void loadData();
    }
    prevSavingRef.current = saving;
  }, [saving, loadData]);

  // --- Compute gridRows: stable per-color mapping ---
  const gridRows = useMemo<GridRow[]>(() => {
    const pairs = designPairs ?? [];
    const designs = draftDesigns ?? [];
    const colorGroups = effectiveColorGroups ?? new Map();
    const designById = new Map(designs.map((d) => [d.id, d]));
    const designNameById = new Map(designs.map((d) => [d.id, d.design?.name ?? d.id]));
    const activeDesign =
      designs.find((design) => design.id === activeDraftDesignId) ?? designs[0] ?? null;
    const activePair = pairs.find(
      (pair) =>
        pair.lightDraftDesignId === activeDesign?.id ||
        pair.darkDraftDesignId === activeDesign?.id,
    );
    const activeIndependentDesign = activeDesign && !activePair ? activeDesign : null;

    if (activePair) {
      return selectedColors.map((color) => {
        const colorGroup = colorGroups.get(color.id) ?? "dark";
        const mappedDraftDesignId =
          colorGroup === "light"
            ? activePair.lightDraftDesignId
            : activePair.darkDraftDesignId;
        const mappedDesign = designById.get(mappedDraftDesignId);
        const mappedDesignName = designNameById.get(mappedDraftDesignId) ?? mappedDraftDesignId;
        const mappedDesignId = mappedDesign?.designId ?? "";
        const mockupItem = findMockupItemForColor(color.id, templateItems);
        const pickSource = picks
          .filter((pick) => pick.colorId === color.id)
          .map(pickToCardSource);

        return {
          key: `${activePair.id}_${color.id}`,
          color,
          mappedDraftDesignId,
          mappedDesignName,
          mappedDesignId,
          mappedMockupName: mockupItem?.mockup.name ?? "",
          source: findSourceForColor(color.id, pickSource, selectedColors),
          generatedOutputUrl: null,
          isHighlighted: !activeDraftDesignId || mappedDraftDesignId === activeDraftDesignId,
          activeInspectDesignName: activeDesign?.design?.name ?? "",
          designPairBaseName: activePair.baseName,
        };
      });
    }

    if (!activeIndependentDesign) return [];

    const mappedDraftDesignId = activeIndependentDesign.id;
    const mappedDesignName = designNameById.get(mappedDraftDesignId) ?? "";
    const mappedDesignId = activeIndependentDesign.designId;

    return selectedColors.map((color) => {
      const mockupItem = findMockupItemForColor(color.id, templateItems);
      const mappedMockupName = mockupItem?.mockup.name ?? "";

      const pickSource = picks
        .filter((p) => p.colorId === color.id)
        .map(pickToCardSource);
      const source = findSourceForColor(color.id, pickSource, selectedColors);

      return {
        key: `${mappedDraftDesignId}_${color.id}`,
        color,
        mappedDraftDesignId,
        mappedDesignName,
        mappedDesignId,
        mappedMockupName,
        source,
        generatedOutputUrl: null,
        isHighlighted: true,
        activeInspectDesignName: activeIndependentDesign.design?.name ?? "",
      };
    });
  }, [selectedColors, designPairs, draftDesigns, effectiveColorGroups, picks, templateItems, activeDraftDesignId]);

  // --- Fill generatedOutputUrl by matching draftDesignId + color ---
  const gridRowsWithOutput = useMemo(() => {
    return gridRows.map((row) => {
      const img = mockupImages.find(
        (m) =>
          m.draftDesignId === row.mappedDraftDesignId &&
          (m.colorId === row.color.id || m.colorName?.toLowerCase() === row.color.name.toLowerCase()),
      );
      return { ...row, generatedOutputUrl: img?.compositeUrl ?? null };
    });
  }, [gridRows, mockupImages]);

  // --- Readiness ---
  const generatedByRowKey = useMemo(() => {
    return new Map(gridRowsWithOutput.map((r) => [r.key, r.generatedOutputUrl]));
  }, [gridRowsWithOutput]);

  const readiness = useMemo(
    () => computeReadiness(gridRowsWithOutput, generatedByRowKey),
    [gridRowsWithOutput, generatedByRowKey],
  );

  // --- Actions ---
  async function savePickSelection(templateMockupItemIds: string[]) {
    const uniqueIds = [...new Set(templateMockupItemIds)];
    if (uniqueIds.length === 0) return;
    await fetch(`/api/wizard/drafts/${draftId}/mockup-library-picks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateMockupItemIds: uniqueIds }),
    });
  }

  async function handleUploadSave(value: UploadMockupModalValue) {
    if (value.file) {
      const form = new FormData();
      form.set("file", value.file);
      form.set("name", value.file.name.replace(/\.[^.]+$/, ""));
      form.set("view", "front");
      form.set("sceneType", "flat_lay");
      form.set("renderMode", "COMPOSITE");
      if (value.compositeRegionPx) form.set("compositeRegionPx", JSON.stringify(value.compositeRegionPx));

      const uploadRes = await fetch("/api/mockups", { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error((await uploadRes.json().catch(() => ({}))).error || "Upload thất bại");
      const uploaded = await uploadRes.json();

      await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mockupId: uploaded.id, appliesToColorIds: value.colorId ? [value.colorId] : [] }),
      });
      toast.success("Đã upload mockup");
    }
    setUploadOpen(false);
    setUploadColorId(null);
    await loadData();
    onMockupsStale?.();
  }

  const handleSaveTemplatePlacement = useCallback(
    async (sourceId: string, region: { x: number; y: number; width: number; height: number; rotationDeg: number; imageWidth: number; imageHeight: number }) => {
      const currentIds = picks.map((p) => p.templateMockupItemId);
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-library-picks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateMockupItemIds: currentIds, placementsByPickId: { [sourceId]: region } }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Lỗi lưu vị trí");
      await loadData();
      onMockupsStale?.();
    },
    [draftId, picks],
  );

  // Design preview URL for the mapped design per row
  const designPreviewUrlsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of draftDesigns ?? []) {
      if (d.design?.previewPath) map.set(d.designId, `/api/files/${d.design.previewPath}`);
    }
    return map;
  }, [draftDesigns]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center", opacity: 0.5 }}>
        <Loader2 size={20} className="animate-spin" style={{ margin: "0 auto" }} />
      </div>
    );
  }

  return (
    <div>
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
            style={(!readiness.allReady || isGenerating) ? { opacity: 0.5, cursor: "not-allowed" } : {}}
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {generateButtonLabel}
          </button>
          {hasRenderedMockups && (
            <button type="button" className="btn btn-primary" onClick={onNextStep} disabled={isGenerating}
              style={isGenerating ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
              Tiếp theo <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {gridRowsWithOutput.map((row) => (
          <ColorMockupCard
            key={row.key}
            color={row.color}
            source={row.source}
            generatedOutputUrl={row.generatedOutputUrl}
            designImageUrl={designPreviewUrlsById.get(row.mappedDesignId) ?? designImageUrl}
            draftId={draftId}
            onUploadClick={() => { setUploadColorId(row.color.id); setUploadOpen(true); }}
            onPlacementSaved={async () => { await loadData(); onMockupsStale?.(); }}
            onDeselectColor={onDeselectColor ? () => onDeselectColor(row.color.id) : undefined}
            onSaveTemplatePlacement={handleSaveTemplatePlacement}
            printAreaMm={printAreaMm}
            mappedDesignName={row.mappedDesignName}
            mappedMockupName={row.mappedMockupName}
            isHighlightedByActiveDesign={row.isHighlighted}
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
          templates={[{ id: templateId, name: "", blueprintTitle: "", printProviderTitle: "", colors: selectedColors }]}
          lockedTemplateId={templateId}
          lockedColorId={uploadColorId}
          designImageUrl={designImageUrl}
          printAreaMm={printAreaMm}
        />
      )}
    </div>
  );
}

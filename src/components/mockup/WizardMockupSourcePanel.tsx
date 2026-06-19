"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle, ImagePlus, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { CanvasPlacementEditor, type CanvasRegionPx } from "@/components/placement/CanvasPlacementEditor";
import { MockupPreviewSection } from "./MockupPreviewSection";
import { normalizePreviewScope, type PreviewSource } from "./PreviewTile";
import { TemplateContextCard, type TemplateContext } from "./TemplateContextCard";
import {
  UploadMockupModal,
  type UploadMockupModalValue,
  type UploadMockupTemplate,
} from "./UploadMockupModal";

interface WizardMockupSourcePanelProps {
  draftId: string;
  storeId: string;
  templateId: string | null;
  enabledColorIds: string[];
  storeColors: Array<{ id: string; name: string; hex: string }>;
  designImageUrl?: string | null;
  onRegenerate?: () => void;
  onRemoveColor?: (colorId: string) => void | Promise<void>;
  onMockupsStale?: () => void;
  printAreaMm?: { widthMm: number; heightMm: number } | null;
}

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

function pickToPreviewSource(pick: PickData): PreviewSource {
  const m = pick.templateMockupItem.mockup;
  const region = (pick.compositeRegionPx ?? m.compositeRegionPx) as Record<string, number> | null;
  return {
    id: pick.id,
    colorId: pick.colorId,
    renderMode: m.renderMode,
    view: m.view ?? "front",
    sceneType: m.sceneType ?? "flat_lay",
    label: m.name,
    imageUrl: `/api/files/${m.storagePath}`,
    outputUrl: null,
    imageWidth: m.width,
    imageHeight: m.height,
    isPrimary: pick.isPrimary,
    scope: "TEMPLATE",
    compositeRegionPx: region
      ? { x: region.x ?? 0, y: region.y ?? 0, width: region.width ?? 0, height: region.height ?? 0, rotationDeg: region.rotationDeg ?? 0 }
      : null,
  };
}

function templateItemToPreviewSource(item: TemplateMockupItemData, colorId: string): PreviewSource {
  const m = item.mockup;
  const region = m.compositeRegionPx as Record<string, number> | null;
  return {
    id: item.id,
    colorId,
    renderMode: m.renderMode,
    view: m.view ?? "front",
    sceneType: m.sceneType ?? "flat_lay",
    label: m.name,
    imageUrl: `/api/files/${m.storagePath}`,
    outputUrl: null,
    imageWidth: m.width,
    imageHeight: m.height,
    isPrimary: item.isPrimary,
    scope: "TEMPLATE",
    compositeRegionPx: region
      ? { x: region.x ?? 0, y: region.y ?? 0, width: region.width ?? 0, height: region.height ?? 0, rotationDeg: region.rotationDeg ?? 0 }
      : null,
  };
}

export function WizardMockupSourcePanel({
  draftId,
  storeId,
  templateId,
  enabledColorIds,
  storeColors,
  designImageUrl,
  onRegenerate,
  onRemoveColor,
  onMockupsStale,
  printAreaMm,
}: WizardMockupSourcePanelProps) {
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<TemplateContext | null>(null);
  const [picks, setPicks] = useState<PickData[]>([]);
  const [templateItems, setTemplateItems] = useState<TemplateMockupItemData[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<PreviewSource | null>(null);
  const [placementEditorSource, setPlacementEditorSource] = useState<PreviewSource | null>(null);
  const [placementEditorImageSize, setPlacementEditorImageSize] = useState<{ width: number; height: number } | null>(null);
  const [lockedUploadColorId, setLockedUploadColorId] = useState<string | null>(null);

  const selectedColors = useMemo(() => {
    return storeColors.filter((color) => enabledColorIds.includes(color.id));
  }, [enabledColorIds, storeColors]);

  const selectedColorIds = selectedColors.map((c) => c.id);

  const modalTemplates = useMemo<UploadMockupTemplate[]>(() => {
    if (!template) return [];
    return [
      {
        id: template.id,
        name: template.name,
        blueprintTitle: template.blueprintTitle,
        printProviderTitle: template.printProviderTitle,
        colors: selectedColors,
      },
    ];
  }, [selectedColors, template]);

  // Map pick data to preview sources
  const draftPicksAsSources = useMemo<PreviewSource[]>(() => {
    return picks.map(pickToPreviewSource);
  }, [picks]);

  // Map template items to preview sources for colors without picks yet
  const templateItemSources = useMemo<PreviewSource[]>(() => {
    const pickedColorIds = new Set(picks.map((p) => p.colorId));
    return templateItems.flatMap((item) => {
      const colorIds = Array.isArray(item.appliesToColorIds)
        ? item.appliesToColorIds.filter((v): v is string => typeof v === "string")
        : [];
      // If specific colors, show only for those; if empty (all colors), show for uncovered colors
      if (colorIds.length > 0) {
        return colorIds
          .filter((cid) => !pickedColorIds.has(cid) && selectedColorIds.includes(cid))
          .map((cid) => templateItemToPreviewSource(item, cid));
      }
      return selectedColorIds
        .filter((cid) => !pickedColorIds.has(cid))
        .map((cid) => templateItemToPreviewSource(item, cid));
    });
  }, [templateItems, picks, selectedColorIds]);

  const allSources = useMemo(() => [...draftPicksAsSources, ...templateItemSources], [draftPicksAsSources, templateItemSources]);
  const selectedSourceIds = useMemo(() => picks.map((p) => p.id), [picks]);
  const primarySourceId = useMemo(() => picks.find((p) => p.isPrimary)?.id ?? picks[0]?.id ?? null, [picks]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [picksRes, itemsRes, templateRes] = await Promise.all([
        fetch(`/api/wizard/drafts/${draftId}/mockup-library-picks`),
        templateId
          ? fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups`)
          : null,
        templateId
          ? fetch(`/api/stores/${storeId}/mockup-templates?templateId=${templateId}`)
          : null,
      ]);

      if (picksRes.ok) {
        const data = await picksRes.json();
        setPicks(data.picks ?? []);
      }

      if (itemsRes && itemsRes.ok) {
        const data = await itemsRes.json();
        setTemplateItems(data.items ?? []);
      }

      if (templateRes && templateRes.ok) {
        const data = await templateRes.json();
        const tpl = data.templates?.[0] ?? data.template ?? null;
        if (tpl) {
          setTemplate({
            id: tpl.id,
            name: tpl.name,
            blueprintTitle: tpl.blueprintTitle ?? "",
            printProviderTitle: tpl.printProviderTitle ?? "",
            defaultMockupSource: tpl.defaultMockupSource ?? "PRINTIFY",
            selectedColors,
            selectedPlacements: [],
          });
        }
      }
    } catch {
      toast.error("Không tải được mockup sources");
    } finally {
      setLoading(false);
    }
  }, [draftId, storeId, templateId, selectedColors]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Save picks with template mockup item IDs
  async function savePickSelection(templateMockupItemIds: string[]) {
    const uniqueIds = [...new Set(templateMockupItemIds)];
    if (uniqueIds.length === 0) {
      toast.error("Phải chọn ít nhất 1 mockup.");
      return;
    }

    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-library-picks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateMockupItemIds: uniqueIds }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Không lưu được mockup đã chọn");
      }
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được mockup đã chọn");
    }
  }

  // Save placement on a pick
  async function savePlacementRegion(regionPx: CanvasRegionPx) {
    if (!placementEditorSource) return;

    try {
      const pickId = placementEditorSource.id;
      const regionToSave = {
        x: Math.round(regionPx.x),
        y: Math.round(regionPx.y),
        width: Math.round(regionPx.width),
        height: Math.round(regionPx.height),
        rotationDeg: regionPx.rotationDeg ?? 0,
        imageWidth: regionPx.imageWidth ?? placementEditorImageSize?.width ?? 0,
        imageHeight: regionPx.imageHeight ?? placementEditorImageSize?.height ?? 0,
      };

      // Update pick compositeRegionPx via draft PATCH
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-library-picks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateMockupItemIds: picks.map((p) => p.templateMockupItemId),
          placementsByPickId: { [pickId]: regionToSave },
        }),
      });

      if (!res.ok) {
        // Fallback: try direct pick PATCH
        const pickRes = await fetch(`/api/wizard/drafts/${draftId}/mockup-library-picks/${pickId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ compositeRegionPx: regionToSave }),
        });
        if (!pickRes.ok) {
          const body = await pickRes.json().catch(() => null);
          throw new Error(body?.error || "Không lưu được vùng ghép");
        }
      }

      // Mark mockups stale
      await fetch(`/api/wizard/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mockupsStale: true, mockupsStaleReason: "placement_changed" }),
      }).catch(() => {});

      toast.success("Đã lưu vị trí design");
      setPlacementEditorSource(null);
      setPlacementEditorImageSize(null);
      await loadData();
      onMockupsStale?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được vùng ghép");
    }
  }

  // Upload new mockup → global library → attach to template → select
  async function handleUploadSave(value: UploadMockupModalValue) {
    if (!template) return;

    if (value.file) {
      // New upload: POST /api/mockups → attach to template → select
      const form = new FormData();
      form.set("file", value.file);
      form.set("name", value.file.name.replace(/\.[^.]+$/, ""));
      form.set("view", "front");
      form.set("sceneType", "flat_lay");
      form.set("renderMode", "COMPOSITE");

      if (value.compositeRegionPx) {
        form.set("compositeRegionPx", JSON.stringify(value.compositeRegionPx));
      }

      const uploadRes = await fetch("/api/mockups", { method: "POST", body: form });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.error || "Upload thất bại");
      }
      const uploaded = await uploadRes.json();

      // Attach to template for this color
      const attachRes = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mockupId: uploaded.id,
          appliesToColorIds: value.colorId ? [value.colorId] : [],
        }),
      });
      if (!attachRes.ok) {
        const err = await attachRes.json().catch(() => ({}));
        throw new Error(err.error || "Không thể đính kèm mockup vào template");
      }

      toast.success("Đã upload mockup");
    }

    setUploadOpen(false);
    setEditingSource(null);
    setLockedUploadColorId(null);
    await loadData();
  }

  // Toggle source selection → add/remove template mockup item from picks
  async function toggleSourceSelection(source: PreviewSource) {
    // source.id is either a pick.id or a templateMockupItem.id
    const currentTemplateMockupItemIds = picks.map((p) => p.templateMockupItemId);
    const isSelected = picks.some((p) => p.id === source.id);

    let nextIds: string[];
    if (isSelected) {
      if (currentTemplateMockupItemIds.length <= 1) {
        toast.error("Phải chọn ít nhất 1 mockup.");
        return;
      }
      // source.id is the pick id; find its templateMockupItemId to remove
      const pickToRemove = picks.find((p) => p.id === source.id);
      nextIds = currentTemplateMockupItemIds.filter((id) => id !== pickToRemove?.templateMockupItemId);
    } else {
      // source.id is the templateMockupItem id for template item sources
      nextIds = [...new Set([...currentTemplateMockupItemIds, source.id])];
    }

    await savePickSelection(nextIds);
  }

  async function setSourceAsPrimary(source: PreviewSource) {
    // Primary is determined by isPrimary on the TemplateMockupItem
    // Just ensure this source is selected, then the API handles primary via templateMockupItem.isPrimary
    const currentTemplateMockupItemIds = picks.map((p) => p.templateMockupItemId);
    const itemId = source.id;
    const nextIds = [...new Set([...currentTemplateMockupItemIds, itemId])];
    await savePickSelection(nextIds);
  }

  // Switch template back to PRINTIFY
  async function switchTemplateToPrintify() {
    if (!templateId) return;
    try {
      const res = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultMockupSource: "PRINTIFY" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Template đã chuyển sang Printify");
      await loadData();
    } catch {
      toast.error("Không thể đổi template sang Printify");
    }
  }

  // Resolve image size for placement editor
  useEffect(() => {
    if (!placementEditorSource) {
      setPlacementEditorImageSize(null);
      return;
    }

    const knownWidth = placementEditorSource.imageWidth ?? null;
    const knownHeight = placementEditorSource.imageHeight ?? null;
    if (knownWidth && knownHeight) {
      setPlacementEditorImageSize({ width: knownWidth, height: knownHeight });
      return;
    }

    const backgroundUrl = placementEditorSource.imageUrl ?? null;
    if (!backgroundUrl) {
      setPlacementEditorImageSize(null);
      return;
    }

    let cancelled = false;
    setPlacementEditorImageSize(null);

    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      setPlacementEditorImageSize({
        width: image.naturalWidth || image.width || 1200,
        height: image.naturalHeight || image.height || 1200,
      });
    };
    image.onerror = () => {
      if (cancelled) return;
      setPlacementEditorImageSize({ width: 1200, height: 1200 });
    };
    image.src = backgroundUrl;

    return () => { cancelled = true; };
  }, [placementEditorSource]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="flex items-center gap-2" style={{ opacity: 0.55, fontSize: "0.85rem" }}>
          <Loader2 size={14} className="animate-spin" /> Đang tải mockup source...
        </div>
      </div>
    );
  }

  if (!templateId || !template) {
    return (
      <div className="card" style={{ padding: 18, marginBottom: 16, border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.08)" }}>
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} style={{ color: "#b45309", flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: "0.96rem", fontWeight: 900 }}>Bạn cần chọn template trước</h3>
            <p style={{ margin: "4px 0 12px", fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Mockup mặc định và mockup riêng đều cần template để giới hạn màu, placement và provider.
            </p>
            <button type="button" className="btn btn-secondary"
              onClick={() => document.getElementById("mockup-template-selector")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Quay lại chọn template
            </button>
          </div>
        </div>
      </div>
    );
  }

  const missingColors = selectedColors.filter(
    (color) => !allSources.some((source) => source.colorId === color.id),
  );
  const missingColorNames = missingColors.map((c) => c.name).join(", ");
  const customPreviewSources = allSources;
  const placementEditorBackgroundUrl = placementEditorSource?.imageUrl ?? null;
  const placementEditorInitialRegion = (() => {
    if (!placementEditorSource || !placementEditorImageSize) return null;
    const w = placementEditorImageSize.width;
    const h = placementEditorImageSize.height;
    const raw = placementEditorSource.compositeRegionPx
      ? {
          x: Math.round(placementEditorSource.compositeRegionPx.x),
          y: Math.round(placementEditorSource.compositeRegionPx.y),
          width: Math.round(placementEditorSource.compositeRegionPx.width),
          height: Math.round(placementEditorSource.compositeRegionPx.height),
          rotationDeg: Number(placementEditorSource.compositeRegionPx.rotationDeg ?? 0),
          imageWidth: w,
          imageHeight: h,
        }
      : sentinelPlacementRegion(w, h);
    return normalizePlacementRegion(raw, w, h);
  })();

  return (
    <div style={{ display: "grid", gap: 14, marginBottom: 16 }}>
      <TemplateContextCard
        template={template}
        onChangeTemplate={() => document.getElementById("mockup-template-selector")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />

      {template.defaultMockupSource === "CUSTOM" ? (
        <>
          <MockupPreviewSection
            colors={selectedColors}
            sources={customPreviewSources}
            scope="TEMPLATE"
            selectedSourceIds={selectedSourceIds}
            primarySourceId={primarySourceId}
            activeSourceId={primarySourceId}
            onToggleSelected={toggleSourceSelection}
            onSetPrimary={setSourceAsPrimary}
            onEditRegion={(source) => {
              setUploadOpen(false);
              setEditingSource(null);
              setLockedUploadColorId(null);
              setPlacementEditorSource(source);
            }}
            onUploadMissingColor={(color) => {
              setPlacementEditorSource(null);
              setPlacementEditorImageSize(null);
              setEditingSource(null);
              setLockedUploadColorId(color.id);
              setUploadOpen(true);
            }}
            onRemoveMissingColor={(color) => {
              void onRemoveColor?.(color.id);
            }}
            onAddDraftSource={() => {
              setLockedUploadColorId(null);
              setUploadOpen(true);
            }}
          />

          {missingColors.length > 0 && (
            <StatusCard
              tone="amber"
              icon={<AlertTriangle size={18} />}
              title={`Template đang dùng Custom nhưng còn ${missingColors.length} màu chưa có mockup`}
              desc={`Template đang dùng Custom nhưng ${missingColorNames} chưa có mockup custom. Màu này sẽ chưa thể tạo mockup cho tới khi bạn upload mockup custom hoặc bỏ màu này khỏi listing.`}
              details={
                <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                  {missingColors.map((color) => (
                    <span key={color.id} style={missingPillStyle}>
                      <span style={{ width: 10, height: 10, borderRadius: 999, background: color.hex }} />
                      {color.name}
                    </span>
                  ))}
                </div>
              }
              action={
                <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                  <a className="btn btn-primary" href={`/stores/${storeId}/config`}>
                    <ImagePlus size={14} />
                    Mở cấu hình template
                  </a>
                  <button className="btn btn-secondary" type="button" onClick={switchTemplateToPrintify}>
                    Đổi nguồn ảnh mặc định sang Printify
                  </button>
                  <OverrideButton onClick={() => { setLockedUploadColorId(null); setUploadOpen(true); }} />
                </div>
              }
            />
          )}
        </>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <OverrideButton onClick={() => { setLockedUploadColorId(null); setUploadOpen(true); }} />
      </div>

      {placementEditorSource && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div className="card" style={{ width: "min(1240px, 96vw)", maxHeight: "92vh", overflow: "auto", padding: 20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800 }}>Chỉnh vị trí design</h3>
                <p style={{ margin: "3px 0 0", opacity: 0.55, fontSize: "0.85rem" }}>
                  Thay đổi tại đây chỉ áp dụng cho listing hiện tại.
                </p>
              </div>
              <button className="btn btn-secondary" onClick={() => { setPlacementEditorSource(null); setPlacementEditorImageSize(null); }} aria-label="Đóng editor vị trí">
                <X size={16} /> Đóng
              </button>
            </div>

            {placementEditorBackgroundUrl && placementEditorInitialRegion && placementEditorImageSize ? (
              <CanvasPlacementEditor
                backgroundImageUrl={placementEditorBackgroundUrl}
                designImageUrl={designImageUrl}
                imageWidth={placementEditorImageSize.width}
                imageHeight={placementEditorImageSize.height}
                mode="CUSTOM_COMPOSITE"
                initialRegionPx={placementEditorInitialRegion}
                onSave={(regionPx) => { void savePlacementRegion(regionPx); }}
                showSaveButton
              />
            ) : (
              <div style={{ minHeight: 280, display: "grid", placeItems: "center", color: "var(--text-muted)" }}>
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}

      <UploadMockupModal
        open={uploadOpen}
        scope="DRAFT"
        draftId={draftId}
        templates={modalTemplates}
        lockedTemplateId={template.id}
        lockedColorId={editingSource?.colorId ?? lockedUploadColorId}
        designImageUrl={designImageUrl}
        printAreaMm={printAreaMm}
        initialValue={editingSource ? sourceToModalValue(editingSource, template.id) : null}
        onClose={() => { setUploadOpen(false); setEditingSource(null); setLockedUploadColorId(null); }}
        onSave={handleUploadSave}
      />
    </div>
  );
}

function sourceToModalValue(source: PreviewSource, templateId: string): Partial<UploadMockupModalValue> {
  return {
    sourceId: source.id,
    templateId,
    colorId: source.colorId ?? "",
    label: source.label ?? "",
    view: source.view,
    sceneType: source.sceneType,
    renderMode: source.renderMode === "COMPOSITE" ? "COMPOSITE" : "FINAL",
    isPrimary: Boolean(source.isPrimary),
    compositeRegionPx: source.compositeRegionPx
      ? {
          x: Math.round(source.compositeRegionPx.x),
          y: Math.round(source.compositeRegionPx.y),
          width: Math.round(source.compositeRegionPx.width),
          height: Math.round(source.compositeRegionPx.height),
          rotationDeg: Number(source.compositeRegionPx.rotationDeg ?? 0),
          imageWidth: source.imageWidth ?? 0,
          imageHeight: source.imageHeight ?? 0,
        }
      : null,
    previewUrl: source.imageUrl ?? null,
    imageWidth: source.imageWidth ?? 0,
    imageHeight: source.imageHeight ?? 0,
  };
}

function sentinelPlacementRegion(imageWidth: number, imageHeight: number): CanvasRegionPx {
  return { x: 0, y: 0, width: imageWidth, height: imageHeight, rotationDeg: 0, imageWidth, imageHeight };
}

function normalizePlacementRegion(region: CanvasRegionPx, imageWidth: number, imageHeight: number): CanvasRegionPx {
  return {
    x: clamp(Math.round(region.x), 0, Math.max(0, imageWidth)),
    y: clamp(Math.round(region.y), 0, Math.max(0, imageHeight)),
    width: clamp(Math.round(region.width), 1, Math.max(1, imageWidth)),
    height: clamp(Math.round(region.height), 1, Math.max(1, imageHeight)),
    rotationDeg: Number(region.rotationDeg ?? 0),
    imageWidth,
    imageHeight,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function OverrideButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-secondary" type="button" onClick={onClick}>
      <Upload size={14} />
      Thêm mockup riêng
    </button>
  );
}

function StatusCard({ tone, icon, title, desc, details, action }: {
  tone: "green" | "amber";
  icon: ReactNode;
  title: string;
  desc: string;
  details?: ReactNode;
  action?: ReactNode;
}) {
  const colors = tone === "green"
    ? { border: "rgba(159,232,112,0.48)", bg: "rgba(159,232,112,0.12)", fg: "var(--color-wise-dark-green)" }
    : { border: "rgba(245,158,11,0.36)", bg: "rgba(245,158,11,0.1)", fg: "#92400e" };

  return (
    <div className="card" style={{ padding: 16, border: `1px solid ${colors.border}`, background: colors.bg, display: "grid", gap: 12 }}>
      <div className="flex items-start gap-3">
        <span style={{ color: colors.fg, flexShrink: 0, marginTop: 2 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 950 }}>{title}</h3>
          <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.45 }}>{desc}</p>
        </div>
      </div>
      {details}
      {action}
    </div>
  );
}

const missingPillStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 999,
  border: "1px solid rgba(245,158,11,0.35)", background: "rgba(255,255,255,0.7)", color: "#92400e",
  fontSize: "0.72rem", fontWeight: 900,
};

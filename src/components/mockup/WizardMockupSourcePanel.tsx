"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
}

type SourceApi = PreviewSource & {
  colorId?: string;
  color?: { id: string; name: string; hex: string };
  colorName?: string;
  colorHex?: string;
};

interface SourcesResponse {
  template: TemplateContext | null;
  draftSources: SourceApi[];
  eligibleTemplateSources: SourceApi[];
  selectedSourceIds: string[];
  primarySourceId: string | null;
  templateChangedWarning?: boolean;
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
}: WizardMockupSourcePanelProps) {
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<TemplateContext | null>(null);
  const [draftSources, setDraftSources] = useState<PreviewSource[]>([]);
  const [templateSources, setTemplateSources] = useState<PreviewSource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [primarySourceId, setPrimarySourceId] = useState<string | null>(null);
  const [templateChangedWarning, setTemplateChangedWarning] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<PreviewSource | null>(null);
  const [placementEditorSource, setPlacementEditorSource] = useState<PreviewSource | null>(null);
  const [placementEditorImageSize, setPlacementEditorImageSize] = useState<{ width: number; height: number } | null>(null);
  const [lockedUploadColorId, setLockedUploadColorId] = useState<string | null>(null);
  const [dismissedTemplateWarning, setDismissedTemplateWarning] = useState(false);

  const selectedColors = useMemo(() => {
    if (template?.selectedColors.length) return template.selectedColors;
    return storeColors.filter((color) => enabledColorIds.includes(color.id));
  }, [enabledColorIds, storeColors, template?.selectedColors]);

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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = (await res.json()) as SourcesResponse;
      const nextDraftSources = (data.draftSources ?? []).map(normalizeSource);
      const nextTemplateSources = (data.eligibleTemplateSources ?? []).map(normalizeSource);
      const nextSourceIds = new Set([...nextDraftSources, ...nextTemplateSources].map((source) => source.id));
      setTemplate(data.template);
      setDraftSources(nextDraftSources);
      setTemplateSources(nextTemplateSources);
      setSelectedSourceIds((data.selectedSourceIds ?? []).filter((id) => nextSourceIds.has(id)));
      setPrimarySourceId(
        data.primarySourceId && nextSourceIds.has(data.primarySourceId) ? data.primarySourceId : null,
      );
      setTemplateChangedWarning(Boolean(data.templateChangedWarning));
    } catch {
      toast.error("Không tải được nguồn mockup");
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

    const backgroundUrl = placementEditorSource.imageUrl ?? placementEditorSource.outputUrl ?? null;
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

    return () => {
      cancelled = true;
    };
  }, [placementEditorSource]);

  async function savePlacementRegion(regionPx: CanvasRegionPx) {
    if (!placementEditorSource) return;
    if (normalizePreviewScope(placementEditorSource.scope) !== "DRAFT") {
      toast.error("Chỉ mockup riêng của listing này mới chỉnh vị trí được.");
      return;
    }

    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources/${placementEditorSource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compositeRegionPx: regionPx }),
      });
      if (!res.ok) {
        throw new Error((await res.json()).error || "Không lưu được vùng ghép");
      }

      toast.success("Đã lưu vị trí design");
      setPlacementEditorSource(null);
      setPlacementEditorImageSize(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được vùng ghép");
    }
  }

  async function saveUpload(value: UploadMockupModalValue) {
    if (!template) return;
    if (value.sourceId) {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources/${value.sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: value.label,
          ...(value.compositeRegionPx ? { compositeRegionPx: value.compositeRegionPx } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Không lưu được mockup");
      toast.success("Đã cập nhật mockup riêng");
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

      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Upload thất bại");
      toast.success("Đã upload mockup riêng");
    }

    setUploadOpen(false);
    setEditingSource(null);
    setLockedUploadColorId(null);
    await loadData();
  }

  async function deleteDraftSource(sourceId: string) {
    const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources/${sourceId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Không xóa được mockup");
  }

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

  async function persistSourceSelection(nextSelectedIds: string[], nextPrimarySourceId: string | null) {
    const orderedSourceIds = [...draftSources, ...templateSources].map((source) => source.id);
    const orderedSelectedIds = orderedSourceIds.filter((sourceId) => nextSelectedIds.includes(sourceId));
    if (orderedSelectedIds.length === 0) {
      toast.error("Phải chọn ít nhất 1 mockup.");
      return;
    }

    const normalizedPrimarySourceId =
      nextPrimarySourceId && orderedSelectedIds.includes(nextPrimarySourceId)
        ? nextPrimarySourceId
        : orderedSelectedIds[0] ?? null;

    const previousSelectedIds = selectedSourceIds;
    const previousPrimarySourceId = primarySourceId;

    setSelectedSourceIds(orderedSelectedIds);
    setPrimarySourceId(normalizedPrimarySourceId);

    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-library-picks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: orderedSelectedIds,
          primarySourceId: normalizedPrimarySourceId,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Không lưu được mockup đã chọn");
      }
    } catch (error) {
      setSelectedSourceIds(previousSelectedIds);
      setPrimarySourceId(previousPrimarySourceId);
      toast.error(error instanceof Error ? error.message : "Không lưu được mockup đã chọn");
    }
  }

  async function toggleSourceSelection(source: PreviewSource) {
    const nextSelectedIds = new Set(selectedSourceIds);
    const wasSelected = nextSelectedIds.has(source.id);

    if (wasSelected) {
      if (nextSelectedIds.size <= 1) {
        toast.error("Phải chọn ít nhất 1 mockup.");
        return;
      }
      nextSelectedIds.delete(source.id);
    } else {
      nextSelectedIds.add(source.id);
    }

    const nextOrderedSelectedIds = [...draftSources, ...templateSources]
      .map((item) => item.id)
      .filter((id) => nextSelectedIds.has(id));
    const nextPrimary =
      !wasSelected
        ? source.id
        : (primarySourceId && nextOrderedSelectedIds.includes(primarySourceId)
            ? primarySourceId
            : nextOrderedSelectedIds[0] ?? null);

    await persistSourceSelection(nextOrderedSelectedIds, nextPrimary);
  }

  async function setSourceAsPrimary(source: PreviewSource) {
    const nextSelectedIds = new Set(selectedSourceIds);
    nextSelectedIds.add(source.id);
    const nextOrderedSelectedIds = [...draftSources, ...templateSources]
      .map((item) => item.id)
      .filter((id) => nextSelectedIds.has(id));
    await persistSourceSelection(nextOrderedSelectedIds, source.id);
  }

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
      <div
        className="card"
        style={{
          padding: 18,
          marginBottom: 16,
          border: "1px solid rgba(245,158,11,0.35)",
          background: "rgba(245,158,11,0.08)",
        }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} style={{ color: "#b45309", flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: "0.96rem", fontWeight: 900 }}>Bạn cần chọn template trước</h3>
            <p style={{ margin: "4px 0 12px", fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Mockup mặc định và mockup riêng đều cần template để giới hạn màu, placement và provider.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => document.getElementById("mockup-template-selector")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Quay lại chọn template
            </button>
          </div>
        </div>
      </div>
    );
  }

  const missingColors = selectedColors.filter(
    (color) => ![...draftSources, ...templateSources].some((source) => source.colorId === color.id || source.colorName === color.name),
  );
  const missingColorNames = missingColors.map((color) => color.name).join(", ");
  const hasDraftSources = draftSources.length > 0;
  const customPreviewSources = [...draftSources, ...templateSources];
  const showTemplateChanged = templateChangedWarning && hasDraftSources && !dismissedTemplateWarning;
  const placementEditorBackgroundUrl = placementEditorSource?.imageUrl ?? placementEditorSource?.outputUrl ?? null;
  const placementEditorInitialRegion = (() => {
    if (!placementEditorSource || !placementEditorImageSize) return null;
    const width = placementEditorImageSize.width;
    const height = placementEditorImageSize.height;
    const rawRegion = placementEditorSource.compositeRegionPx
      ? {
          x: Math.round(placementEditorSource.compositeRegionPx.x),
          y: Math.round(placementEditorSource.compositeRegionPx.y),
          width: Math.round(placementEditorSource.compositeRegionPx.width),
          height: Math.round(placementEditorSource.compositeRegionPx.height),
          rotationDeg: Number(placementEditorSource.compositeRegionPx.rotationDeg ?? 0),
          imageWidth: width,
          imageHeight: height,
        }
      : defaultPlacementRegion(width, height);
    return normalizePlacementRegion(rawRegion, width, height);
  })();
  const openDraftUpload = (colorId?: string | null) => {
    setPlacementEditorSource(null);
    setPlacementEditorImageSize(null);
    setEditingSource(null);
    setLockedUploadColorId(colorId ?? null);
    setUploadOpen(true);
  };
  const editPreviewSource = (source: PreviewSource) => {
    if (normalizePreviewScope(source.scope) !== "DRAFT") return;
    if (source.renderMode !== "COMPOSITE") return;
    setUploadOpen(false);
    setEditingSource(null);
    setLockedUploadColorId(null);
    setPlacementEditorSource(source);
  };

  return (
    <div style={{ display: "grid", gap: 14, marginBottom: 16 }}>
      {showTemplateChanged && (
        <div
          className="card"
          style={{
            padding: 14,
            border: "1px solid rgba(245,158,11,0.35)",
            background: "rgba(245,158,11,0.09)",
          }}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} style={{ color: "#b45309", flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: "0.86rem" }}>
                Đã đổi mẫu — mockup cần cập nhật
              </strong>
              <p style={{ margin: "4px 0 10px", fontSize: "0.76rem", lineHeight: 1.45, color: "var(--text-muted)" }}>
                Bạn đổi mẫu trước đó. Draft mockup riêng vẫn giữ nguyên nhưng mockup tái sử dụng sẽ load lại cho mẫu mới.
              </p>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary" type="button" onClick={onRegenerate}>
                  <RefreshCw size={14} />
                  Tạo lại
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => setDismissedTemplateWarning(true)}>
                  Giữ nguyên
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            onEditRegion={editPreviewSource}
            onUploadMissingColor={(color) => openDraftUpload(color.id)}
            onRemoveMissingColor={(color) => {
              void onRemoveColor?.(color.id);
            }}
            onAddDraftSource={() => openDraftUpload(null)}
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
                  <a className="btn btn-primary" href={`/stores/${storeId}/mockup-library?templateId=${template.id}`}>
                    <ImagePlus size={14} />
                    Mở Thư viện mockup
                  </a>
                  <button className="btn btn-secondary" type="button" onClick={switchTemplateToPrintify}>
                    Đổi nguồn ảnh mặc định sang Printify
                  </button>
                  <OverrideButton onClick={() => openDraftUpload(null)} />
                </div>
              }
            />
          )}
        </>
      ) : null}

      {/* Override button — shown for both PRINTIFY and CUSTOM modes */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <OverrideButton onClick={() => openDraftUpload(null)} />
      </div>

      {placementEditorSource && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            className="card"
            style={{
              width: "min(1240px, 96vw)",
              maxHeight: "92vh",
              overflow: "auto",
              padding: 20,
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800 }}>Chỉnh vị trí design</h3>
                <p style={{ margin: "3px 0 0", opacity: 0.55, fontSize: "0.85rem" }}>
                  Thay đổi tại đây chỉ áp dụng cho listing hiện tại.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setPlacementEditorSource(null);
                  setPlacementEditorImageSize(null);
                }}
                aria-label="Đóng editor vị trí"
              >
                <X size={16} /> Đóng
              </button>
            </div>

            <div className="flex items-center gap-2" style={{ marginBottom: 12, flexWrap: "wrap" }}>
              <span
                style={{
                  ...statusBadgeStyle,
                  borderColor: normalizePreviewScope(placementEditorSource.scope) === "DRAFT"
                    ? "rgba(124,58,237,0.22)"
                    : "rgba(59,130,246,0.2)",
                  color: normalizePreviewScope(placementEditorSource.scope) === "DRAFT" ? "#6d28d9" : "#1d4ed8",
                  background: normalizePreviewScope(placementEditorSource.scope) === "DRAFT"
                    ? "rgba(124,58,237,0.08)"
                    : "rgba(59,130,246,0.08)",
                }}
              >
                {normalizePreviewScope(placementEditorSource.scope) === "DRAFT" ? "Mockup riêng" : "Từ thư viện"}
              </span>
              {placementEditorSource.label?.trim() && (
                <strong style={{ fontSize: "0.82rem" }}>{placementEditorSource.label.trim()}</strong>
              )}
              <span
                style={{
                  ...statusBadgeStyle,
                  borderColor: placementEditorSource.compositeRegionPx
                    ? "rgba(22,51,0,0.22)"
                    : "rgba(185,28,28,0.2)",
                  color: placementEditorSource.compositeRegionPx ? "var(--color-wise-dark-green)" : "#b91c1c",
                  background: placementEditorSource.compositeRegionPx
                    ? "rgba(159,232,112,0.18)"
                    : "#fee2e2",
                }}
              >
                {placementEditorSource.compositeRegionPx ? "Đã chỉnh vị trí" : "Chưa chỉnh vị trí"}
              </span>
            </div>

            {placementEditorBackgroundUrl && placementEditorInitialRegion && placementEditorImageSize ? (
              <CanvasPlacementEditor
                backgroundImageUrl={placementEditorBackgroundUrl}
                designImageUrl={designImageUrl}
                imageWidth={placementEditorImageSize.width}
                imageHeight={placementEditorImageSize.height}
                mode="CUSTOM_COMPOSITE"
                initialRegionPx={placementEditorInitialRegion}
                onSave={(regionPx) => {
                  void savePlacementRegion(regionPx);
                }}
                showSaveButton
              />
            ) : (
              <div
                style={{
                  minHeight: 280,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--text-muted)",
                }}
              >
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
        initialValue={editingSource ? sourceToModalValue(editingSource, template.id) : null}
        onClose={() => {
          setUploadOpen(false);
          setEditingSource(null);
          setLockedUploadColorId(null);
        }}
        onSave={saveUpload}
        onDelete={
          editingSource
            ? async () => {
                await deleteDraftSource(editingSource.id);
                setUploadOpen(false);
                setEditingSource(null);
                toast.success("Đã xóa mockup riêng");
                await loadData();
              }
            : undefined
        }
      />
    </div>
  );
}

function normalizeSource(source: SourceApi): PreviewSource {
  return {
    ...source,
    colorId: source.colorId ?? source.color?.id,
    colorName: source.colorName ?? source.color?.name,
    colorHex: source.colorHex ?? source.color?.hex,
    renderMode: source.renderMode,
  };
}

function sourceToModalValue(source: PreviewSource, templateId: string): Partial<UploadMockupModalValue> {
  const imageWidth = source.imageWidth ?? 0;
  const imageHeight = source.imageHeight ?? 0;
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
          imageWidth,
          imageHeight,
        }
      : null,
    previewUrl: source.imageUrl ?? source.outputUrl ?? null,
    imageWidth,
    imageHeight,
  };
}

function defaultPlacementRegion(imageWidth: number, imageHeight: number): CanvasRegionPx {
  const width = Math.max(1, Math.round(imageWidth * 0.42));
  const height = Math.max(1, Math.round(imageHeight * 0.28));
  return {
    x: Math.max(0, Math.round((imageWidth - width) / 2)),
    y: Math.max(0, Math.round((imageHeight - height) / 2)),
    width,
    height,
    rotationDeg: 0,
    imageWidth,
    imageHeight,
  };
}

function normalizePlacementRegion(
  region: CanvasRegionPx,
  imageWidth: number,
  imageHeight: number,
): CanvasRegionPx {
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

function StatusCard({
  tone,
  icon,
  title,
  desc,
  details,
  action,
}: {
  tone: "green" | "amber";
  icon: ReactNode;
  title: string;
  desc: string;
  details?: ReactNode;
  action?: ReactNode;
}) {
  const colors = tone === "green"
    ? {
        border: "rgba(159,232,112,0.48)",
        bg: "rgba(159,232,112,0.12)",
        fg: "var(--color-wise-dark-green)",
      }
    : {
        border: "rgba(245,158,11,0.36)",
        bg: "rgba(245,158,11,0.1)",
        fg: "#92400e",
      };

  return (
    <div
      className="card"
      style={{
        padding: 16,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        display: "grid",
        gap: 12,
      }}
    >
      <div className="flex items-start gap-3">
        <span style={{ color: colors.fg, flexShrink: 0, marginTop: 2 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 950 }}>{title}</h3>
          <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
            {desc}
          </p>
        </div>
      </div>
      {details}
      {action}
    </div>
  );
}

const missingPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid rgba(245,158,11,0.35)",
  background: "rgba(255,255,255,0.7)",
  color: "#92400e",
  fontSize: "0.72rem",
  fontWeight: 900,
};

const statusBadgeStyle: CSSProperties = {
  flexShrink: 0,
  border: "1px solid",
  borderRadius: 999,
  padding: "2px 7px",
  fontSize: "0.62rem",
  fontWeight: 900,
};

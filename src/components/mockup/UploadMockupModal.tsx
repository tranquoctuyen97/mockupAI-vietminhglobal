"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ImagePlus,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  CanvasPlacementEditor,
  type CanvasRegionPx,
} from "@/components/placement/CanvasPlacementEditor";

export type UploadMockupScope = "TEMPLATE" | "DRAFT";
export type UploadRenderMode = "FINAL" | "COMPOSITE";

export interface UploadMockupColor {
  id: string;
  name: string;
  hex: string;
}

export interface UploadMockupTemplate {
  id: string;
  name: string;
  blueprintTitle?: string | null;
  printProviderTitle?: string | null;
  colors: UploadMockupColor[];
}

export interface UploadMockupCompositeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  imageWidth: number;
  imageHeight: number;
}

export interface UploadMockupModalValue {
  sourceId?: string;
  templateId: string;
  colorId: string;
  label: string;
  view: string;
  sceneType: string;
  renderMode: UploadRenderMode;
  isPrimary: boolean;
  sortOrder: number;
  compositeRegionPx: UploadMockupCompositeRegion | null;
  file: File | null;
  previewUrl: string | null;
  imageWidth: number;
  imageHeight: number;
}

interface UploadMockupModalProps {
  open: boolean;
  scope: UploadMockupScope;
  draftId?: string;
  templates: UploadMockupTemplate[];
  designImageUrl?: string | null;
  initialValue?: Partial<UploadMockupModalValue> | null;
  lockedTemplateId?: string | null;
  lockedColorId?: string | null;
  onClose: () => void;
  onSave: (value: UploadMockupModalValue) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function UploadMockupModal({
  open,
  scope,
  draftId,
  templates,
  designImageUrl,
  initialValue,
  lockedTemplateId,
  lockedColorId,
  onClose,
  onSave,
  onDelete,
}: UploadMockupModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState<UploadMockupModalValue>(() =>
    createInitialValue(templates, initialValue, lockedTemplateId, lockedColorId),
  );
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValue(createInitialValue(templates, initialValue, lockedTemplateId, lockedColorId));
    setFileError(null);
  }, [open, templates, initialValue, lockedTemplateId, lockedColorId]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === value.templateId) ?? templates[0] ?? null,
    [templates, value.templateId],
  );
  const colorOptions = selectedTemplate?.colors ?? [];
  const selectedColor = colorOptions.find((color) => color.id === value.colorId) ?? colorOptions[0] ?? null;
  const isEditMode = Boolean(value.sourceId);
  const isTemplateScope = scope === "TEMPLATE";
  const isDraftScope = scope === "DRAFT";
  const isDraftEditorReady = isDraftScope && Boolean(value.previewUrl) && value.imageWidth > 0 && value.imageHeight > 0;
  const modalWidth = isDraftEditorReady ? 1120 : 680;
  const subtitle =
    isTemplateScope
      ? `${selectedTemplate?.name ?? "Template"} · ${selectedColor?.name ?? "Màu"} · dùng lại cho mọi listing`
      : `Listing #${draftId ?? ""} · chỉ dùng cho listing này`;

  if (!open) return null;

  function update(next: Partial<UploadMockupModalValue>) {
    setValue((current) => ({ ...current, ...next }));
  }

  async function pickFile(file: File) {
    setFileError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError(`File quá lớn · ${formatMb(file.size)} MB · tối đa 10 MB · resize hoặc nén trước khi upload`);
      return;
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      setFileError("Định dạng không hỗ trợ · HEIC không được hỗ trợ · chỉ nhận JPEG / PNG / WebP");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const dimensions = await readImageDimensions(previewUrl);
    const compositeRegionPx = isDraftScope
      ? defaultCanvasRegion(dimensions.width, dimensions.height)
      : null;
    update({
      file,
      previewUrl,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
      renderMode: isDraftScope ? "COMPOSITE" : "FINAL",
      compositeRegionPx,
    });
  }

  async function submit() {
    if (!isEditMode && !value.file) {
      setFileError("Chưa chọn ảnh mockup");
      return;
    }
    if (isDraftScope && !value.compositeRegionPx) {
      setFileError("Chưa có vùng ghép design");
      return;
    }

    setSubmitting(true);
    try {
      await onSave(
        isTemplateScope
          ? {
              ...value,
              view: "front",
              sceneType: "flat_lay",
              renderMode: "FINAL",
              isPrimary: false,
              sortOrder: 0,
              compositeRegionPx: null,
            }
          : {
              ...value,
              view: "front",
              sceneType: "flat_lay",
              renderMode: "COMPOSITE",
              isPrimary: false,
              sortOrder: 0,
            },
      );
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Không lưu được mockup");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

  const body = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 14,
      }}
    >
      <div style={{ display: "grid", gap: 14 }}>
        {isDraftEditorReady && (
          <CanvasPlacementEditor
            backgroundImageUrl={value.previewUrl}
            designImageUrl={designImageUrl}
            imageWidth={value.imageWidth}
            imageHeight={value.imageHeight}
            mode="CUSTOM_COMPOSITE"
            printAreaPx={{
              x: Math.round(value.imageWidth * 0.15),
              y: Math.round(value.imageHeight * 0.15),
              width: Math.round(value.imageWidth * 0.7),
              height: Math.round(value.imageHeight * 0.7),
            }}
            initialRegionPx={value.compositeRegionPx ?? defaultCanvasRegion(value.imageWidth, value.imageHeight)}
            onChange={(region) => update({ compositeRegionPx: toUploadCompositeRegion(region) })}
            onSave={(region) => update({ compositeRegionPx: toUploadCompositeRegion(region) })}
            onReset={() => update({ compositeRegionPx: defaultCanvasRegion(value.imageWidth, value.imageHeight) })}
            showSaveButton={false}
          />
        )}

        {!isEditMode && !isDraftEditorReady && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (file) void pickFile(file);
              }}
              style={{
                minHeight: 150,
                border: "1px dashed var(--border-default)",
                borderRadius: 16,
                background: "var(--bg-inset, #f7f7f4)",
                display: "grid",
                placeItems: "center",
                gap: 8,
                padding: 20,
                cursor: "pointer",
                color: "var(--text-primary)",
              }}
            >
              <Upload size={28} style={{ color: "var(--color-wise-dark-green)" }} />
              <strong style={{ fontSize: "0.95rem" }}>Kéo ảnh vào đây, hoặc chọn từ máy</strong>
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
                JPEG / PNG / WebP · tối đa 10MB · tự động xoay và tối ưu
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void pickFile(file);
              }}
            />
          </>
        )}

        {fileError && (
          <ErrorCard message={fileError} onAction={() => inputRef.current?.click()} actionLabel="Thay file" />
        )}

        {value.previewUrl && (
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: 10,
              borderRadius: 12,
              border: "1px solid var(--border-default)",
            }}
          >
            <img
              src={value.previewUrl}
              alt=""
              onLoad={(event) => {
                if (value.imageWidth && value.imageHeight) return;
                const img = event.currentTarget;
                update({
                  imageWidth: img.naturalWidth,
                  imageHeight: img.naturalHeight,
                  compositeRegionPx:
                    value.compositeRegionPx ?? (isDraftScope ? defaultCanvasRegion(img.naturalWidth, img.naturalHeight) : null),
                });
              }}
              style={{ width: 80, height: 96, objectFit: "cover", borderRadius: 10 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong
                style={{
                  display: "block",
                  fontSize: "0.82rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {value.file?.name ?? "Ảnh hiện tại"}
              </strong>
              <span style={{ display: "block", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                {value.file ? `${formatMb(value.file.size)} MB` : "Đang dùng file đã lưu"}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  marginTop: 5,
                  color: "var(--color-wise-dark-green)",
                  fontSize: "0.72rem",
                  fontWeight: 900,
                }}
              >
                <Check size={13} /> Đã tự động xoay và tối ưu
              </span>
            </div>
            {!isEditMode && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: 34, height: 34, padding: 0 }}
                onClick={() => update({ file: null, previewUrl: null, imageWidth: 0, imageHeight: 0, compositeRegionPx: null })}
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <Field label="Template">
            {isEditMode || !!lockedTemplateId ? (
              <ReadOnlyField value={selectedTemplate?.name ?? "Template"} />
            ) : (
              <select
                value={value.templateId}
                onChange={(event) => {
                  const template = templates.find((entry) => entry.id === event.target.value);
                  update({ templateId: event.target.value, colorId: template?.colors[0]?.id ?? "" });
                }}
                style={inputStyle}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Màu">
            {isEditMode || !!lockedColorId ? (
              <ReadOnlyField value={selectedColor?.name ?? "Màu"} color={selectedColor?.hex} />
            ) : (
              <select
                value={value.colorId}
                onChange={(event) => update({ colorId: event.target.value })}
                style={inputStyle}
              >
                {colorOptions.map((color) => (
                  <option key={color.id} value={color.id}>{color.name}</option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Nhãn">
            <input
              value={value.label}
              onChange={(event) => update({ label: event.target.value })}
              placeholder="VD: hero, lifestyle, detail..."
              style={inputStyle}
            />
          </Field>
        </div>
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(1.5px)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: `min(${modalWidth}px, calc(100vw - 32px))`,
          maxHeight: "calc(100dvh - 32px)",
          overflow: "auto",
          background: "var(--bg-primary)",
          borderRadius: 24,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.22)",
        }}
      >
        <div
          className="flex items-start justify-between gap-3"
          style={{ padding: "20px 22px 14px", borderBottom: "1px solid var(--border-default)" }}
        >
          <div className="flex items-start gap-3" style={{ minWidth: 0 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                background: scope === "TEMPLATE" ? "rgba(159,232,112,0.18)" : "rgba(124,58,237,0.12)",
                color: scope === "TEMPLATE" ? "var(--color-wise-dark-green)" : "#6d28d9",
                flexShrink: 0,
              }}
            >
              <ImagePlus size={19} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 950 }}>
                  {scope === "TEMPLATE" ? "Upload mockup tái sử dụng" : "Upload mockup riêng cho listing"}
                </h2>
                <span
                  style={{
                    borderRadius: 999,
                    padding: "3px 8px",
                    fontSize: "0.65rem",
                    fontWeight: 950,
                    background: scope === "TEMPLATE" ? "rgba(159,232,112,0.2)" : "rgba(124,58,237,0.12)",
                    color: scope === "TEMPLATE" ? "var(--color-wise-dark-green)" : "#6d28d9",
                  }}
                >
                  {scope}
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: "0.76rem", color: "var(--text-muted)" }}>
                {subtitle}
              </p>
            </div>
          </div>
          <button className="btn btn-secondary" style={iconButton} type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 22 }}>{body}</div>

        <div
          className="flex items-center gap-2"
          style={{
            justifyContent: "space-between",
            padding: "14px 22px 20px",
            borderTop: "1px solid var(--border-default)",
          }}
        >
          <div>
            {isEditMode && onDelete && (
              <button className="btn btn-danger" type="button" onClick={remove} disabled={deleting}>
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Xóa
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary" type="button" onClick={onClose}>
              Hủy
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={submit}
              disabled={
                submitting ||
                !value.templateId ||
                !value.colorId ||
                (!isEditMode && !value.file) ||
                (isDraftScope && !value.compositeRegionPx)
              }
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {scope === "TEMPLATE" ? "Lưu vào thư viện" : "Upload cho listing"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function createInitialValue(
  templates: UploadMockupTemplate[],
  initialValue: Partial<UploadMockupModalValue> | null | undefined,
  lockedTemplateId?: string | null,
  lockedColorId?: string | null,
): UploadMockupModalValue {
  const templateId = initialValue?.templateId ?? lockedTemplateId ?? templates[0]?.id ?? "";
  const template = templates.find((entry) => entry.id === templateId) ?? templates[0];
  const colorId = initialValue?.colorId ?? lockedColorId ?? template?.colors[0]?.id ?? "";
  const imageWidth = initialValue?.imageWidth ?? 0;
  const imageHeight = initialValue?.imageHeight ?? 0;
  return {
    sourceId: initialValue?.sourceId,
    templateId,
    colorId,
    label: initialValue?.label ?? "",
    view: initialValue?.view ?? "front",
    sceneType: initialValue?.sceneType ?? "flat_lay",
    renderMode: initialValue?.renderMode ?? "FINAL",
    isPrimary: initialValue?.isPrimary ?? false,
    sortOrder: initialValue?.sortOrder ?? 0,
    compositeRegionPx: normalizeInitialCompositeRegion(initialValue?.compositeRegionPx, imageWidth, imageHeight),
    file: initialValue?.file ?? null,
    previewUrl: initialValue?.previewUrl ?? null,
    imageWidth,
    imageHeight,
  };
}

function normalizeInitialCompositeRegion(
  region: UploadMockupCompositeRegion | null | undefined,
  imageWidth: number,
  imageHeight: number,
): UploadMockupCompositeRegion | null {
  if (!region) return null;
  return {
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.round(region.width),
    height: Math.round(region.height),
    rotationDeg: Number(region.rotationDeg ?? 0),
    imageWidth: Math.round(region.imageWidth ?? imageWidth),
    imageHeight: Math.round(region.imageHeight ?? imageHeight),
  };
}

function defaultCanvasRegion(imageWidth: number, imageHeight: number): UploadMockupCompositeRegion {
  const width = Math.max(1, Math.round(imageWidth * 0.38));
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

function toUploadCompositeRegion(region: CanvasRegionPx): UploadMockupCompositeRegion {
  return {
    x: Math.max(0, Math.round(region.x)),
    y: Math.max(0, Math.round(region.y)),
    width: Math.max(1, Math.round(region.width)),
    height: Math.max(1, Math.round(region.height)),
    rotationDeg: Number(region.rotationDeg ?? 0),
    imageWidth: Math.round(region.imageWidth),
    imageHeight: Math.round(region.imageHeight),
  };
}

function ReadOnlyField({ value, color }: { value: string; color?: string | null }) {
  return (
    <div
      style={{
        ...inputStyle,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg-inset, #f7f7f4)",
        color: "var(--text-primary)",
      }}
    >
      {color && (
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: color,
            border: "1px solid rgba(0,0,0,0.16)",
            flexShrink: 0,
          }}
        />
      )}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6, fontSize: "0.76rem", fontWeight: 900 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ErrorCard({ message, actionLabel, onAction }: { message: string; actionLabel: string; onAction: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(239,68,68,0.08)",
        color: "#b91c1c",
        border: "1px solid rgba(239,68,68,0.22)",
        fontSize: "0.78rem",
        fontWeight: 850,
      }}
    >
      <AlertTriangle size={16} />
      <span style={{ flex: 1 }}>{message}</span>
      <button className="btn btn-secondary" type="button" onClick={onAction} style={{ fontSize: "0.72rem" }}>
        {actionLabel}
      </button>
    </div>
  );
}

function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Không đọc được kích thước ảnh"));
    image.src = url;
  });
}

function formatMb(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: 40,
  padding: "9px 11px",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  fontSize: "0.84rem",
};

const iconButton: CSSProperties = {
  width: 34,
  height: 34,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

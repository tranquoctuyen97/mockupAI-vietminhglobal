"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Upload,
  ImagePlus,
  Library,
  Layers,
  CheckCircle,
  X,
  Loader2,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

type SourceMode = "AUTO" | "TEMPLATE_PRINTIFY" | "DRAFT_CUSTOM";

type SourceBadge = {
  id: string;
  label: string | null;
  colorName: string;
  colorHex: string;
  renderMode: string;
  view: string;
  sceneType: string;
  isPrimary: boolean;
};

interface WizardMockupSourcePanelProps {
  draftId: string;
  storeId: string;
  templateId: string | null;
  enabledColorIds: string[];
  storeColors: Array<{ id: string; name: string; hex: string }>;
  onModeChange?: (mode: SourceMode) => void;
}

const MODE_OPTIONS: Array<{
  value: SourceMode;
  label: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  {
    value: "AUTO",
    label: "Tự động",
    desc: "Ưu tiên draft → template → Printify",
    icon: <Layers size={16} />,
  },
  {
    value: "TEMPLATE_PRINTIFY",
    label: "Template / Printify",
    desc: "Dùng mockup từ thư viện template hoặc Printify",
    icon: <Library size={16} />,
  },
  {
    value: "DRAFT_CUSTOM",
    label: "Tùy chỉnh listing này",
    desc: "Upload ảnh mockup riêng cho listing này",
    icon: <ImagePlus size={16} />,
  },
];

const VIEW_OPTIONS = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "sleeve_left", label: "Sleeve Left" },
  { value: "sleeve_right", label: "Sleeve Right" },
  { value: "detail", label: "Detail" },
  { value: "lifestyle", label: "Lifestyle" },
];

const SCENE_OPTIONS = [
  { value: "flat_lay", label: "Flat Lay" },
  { value: "hanging", label: "Hanging" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "model", label: "Model" },
  { value: "detail", label: "Detail" },
];

const RENDER_MODE_OPTIONS = [
  { value: "FINAL", label: "Final", desc: "Ảnh hoàn chỉnh, không cần composite" },
  { value: "COMPOSITE", label: "Composite", desc: "Ghép design lên mockup" },
];

export function WizardMockupSourcePanel({
  draftId,
  storeId,
  templateId,
  enabledColorIds,
  storeColors,
  onModeChange,
}: WizardMockupSourcePanelProps) {
  const [mode, setMode] = useState<SourceMode>("AUTO");
  const [draftSources, setDraftSources] = useState<SourceBadge[]>([]);
  const [eligibleTemplateSources, setEligibleTemplateSources] = useState<SourceBadge[]>([]);
  const [pickedTemplateSourceIds, setPickedTemplateSourceIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // Upload form state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadColorId, setUploadColorId] = useState<string>(enabledColorIds[0] ?? "");
  const [uploadView, setUploadView] = useState("front");
  const [uploadScene, setUploadScene] = useState("flat_lay");
  const [uploadRenderMode, setUploadRenderMode] = useState("FINAL");
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadIsPrimary, setUploadIsPrimary] = useState(false);
  const [uploadRegion, setUploadRegion] = useState<{ x: number; y: number; width: number; height: number; rotationDeg: number } | null>(null);

  const enabledColors = useMemo(
    () => storeColors.filter((c) => enabledColorIds.includes(c.id)),
    [storeColors, enabledColorIds],
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setMode(data.mode || "AUTO");
      setDraftSources(data.draftSources ?? []);
      setEligibleTemplateSources(data.eligibleTemplateSources ?? []);
      setPickedTemplateSourceIds(new Set(data.pickedTemplateSourceIds ?? []));
    } catch {
      // silently fail — panel is non-blocking
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleModeChange = async (nextMode: SourceMode) => {
    setMode(nextMode);
    onModeChange?.(nextMode);
    try {
      await fetch(`/api/wizard/drafts/${draftId}/mockup-source-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
    } catch {
      toast.error("Không thể cập nhật chế độ mockup");
    }
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadColorId) {
      toast.error("Chọn file và màu để upload");
      return;
    }
    if (uploadRenderMode === "COMPOSITE" && !uploadRegion) {
      toast.error("Composite mode cần chọn vùng in");
      return;
    }

    setUploading(true);
    const form = new FormData();
    form.append("file", uploadFile);
    form.append("colorId", uploadColorId);
    form.append("view", uploadView);
    form.append("sceneType", uploadScene);
    form.append("renderMode", uploadRenderMode);
    form.append("isPrimary", String(uploadIsPrimary));
    if (uploadLabel.trim()) form.append("label", uploadLabel.trim());
    if (uploadRenderMode === "COMPOSITE" && uploadRegion) {
      form.append("compositeRegionPx", JSON.stringify(uploadRegion));
    }

    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Upload thất bại");
        return;
      }
      toast.success("Đã upload mockup!");
      setShowUploadForm(false);
      setUploadFile(null);
      setUploadLabel("");
      setUploadIsPrimary(false);
      setUploadRegion(null);
      await loadData();
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setUploading(false);
    }
  };

  const handleTogglePick = async (sourceId: string) => {
    const next = new Set(pickedTemplateSourceIds);
    if (next.has(sourceId)) next.delete(sourceId);
    else next.add(sourceId);
    setPickedTemplateSourceIds(next);

    try {
      await fetch(`/api/wizard/drafts/${draftId}/mockup-library-picks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: [...next] }),
      });
    } catch {
      toast.error("Không thể cập nhật picks");
    }
  };

  const handleDeleteDraftSource = async (sourceId: string) => {
    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/mockup-sources/${sourceId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Đã xóa");
      await loadData();
    } catch {
      toast.error("Không thể xóa");
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="flex items-center gap-2" style={{ opacity: 0.5, fontSize: "0.85rem" }}>
          <Loader2 size={14} className="animate-spin" /> Đang tải mockup source...
        </div>
      </div>
    );
  }

  const hasDraftSources = draftSources.length > 0;
  const hasLibrarySources = eligibleTemplateSources.length > 0;
  const summaryLabel =
    mode === "DRAFT_CUSTOM"
      ? `${draftSources.length} ảnh tùy chỉnh`
      : mode === "TEMPLATE_PRINTIFY"
        ? `${pickedTemplateSourceIds.size} ảnh từ thư viện`
        : "Tự động";

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <ImagePlus size={16} style={{ opacity: 0.6 }} />
          <div>
            <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>
              Nguồn Mockup
            </h3>
            <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.55 }}>
              {summaryLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasDraftSources && (
            <span className="badge badge-success" style={{ fontSize: "0.6rem" }}>
              {draftSources.length} Draft
            </span>
          )}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {!expanded && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: "0.72rem",
            opacity: 0.45,
            padding: "0 0 0 28px",
          }}
        >
          Nhấn để mở rộng — chọn chế độ mockup, upload ảnh riêng hoặc chọn từ thư viện.
        </p>
      )}

      {expanded && (
        <div style={{ marginTop: 16 }}>
          {/* Mode selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleModeChange(opt.value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 10,
                  border:
                    mode === opt.value
                      ? "1px solid var(--color-wise-green)"
                      : "1px solid var(--border-default)",
                  backgroundColor:
                    mode === opt.value ? "rgba(146, 198, 72, 0.06)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                {mode === opt.value ? (
                  <CheckCircle size={16} color="var(--color-wise-green)" />
                ) : (
                  <span style={{ opacity: 0.3 }}>{opt.icon}</span>
                )}
                <div>
                  <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>
                    {opt.label}
                  </span>
                  <span
                    style={{ fontSize: "0.7rem", opacity: 0.5, display: "block" }}
                  >
                    {opt.desc}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Help text */}
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              backgroundColor: "rgba(99,102,241,0.04)",
              border: "1px solid rgba(99,102,241,0.12)",
              marginBottom: 16,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <Info size={14} style={{ flexShrink: 0, marginTop: 2, color: "#6366f1" }} />
            <p style={{ margin: 0, fontSize: "0.72rem", lineHeight: 1.5, opacity: 0.7 }}>
              Draft custom mockups được dùng trước. Nếu không có, dùng mockup từ thư viện hoặc template. Printify sẽ là fallback cuối cùng.
              <br />
              <strong>Đổi chế độ không xóa ảnh đã upload</strong> — chỉ thay đổi mặc định hiển thị.
            </p>
          </div>

          {/* Draft sources list */}
          {hasDraftSources && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontWeight: 600, fontSize: "0.82rem", margin: "0 0 8px" }}>
                Ảnh tùy chỉnh ({draftSources.length})
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {draftSources.map((src) => (
                  <div
                    key={src.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--border-default)",
                      fontSize: "0.78rem",
                    }}
                  >
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        backgroundColor: src.colorHex,
                        border: "1px solid rgba(0,0,0,0.1)",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, fontWeight: 500 }}>
                      {src.label || `${src.view} · ${src.sceneType}`}
                    </span>
                    <span
                      className="badge"
                      style={{
                        fontSize: "0.6rem",
                        backgroundColor: src.renderMode === "COMPOSITE" ? "#ede9fe" : "#ccfbf1",
                        color: src.renderMode === "COMPOSITE" ? "#6d28d9" : "#0d9488",
                      }}
                    >
                      {src.renderMode}
                    </span>
                    {src.isPrimary && (
                      <span className="badge badge-success" style={{ fontSize: "0.6rem" }}>★</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteDraftSource(src.id)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        opacity: 0.4,
                        padding: 2,
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upload form toggle */}
          <button
            type="button"
            className="btn btn-secondary flex items-center gap-2"
            style={{ fontSize: "0.78rem", padding: "6px 12px", marginBottom: 12 }}
            onClick={() => setShowUploadForm(!showUploadForm)}
          >
            <Upload size={14} />
            {showUploadForm ? "Ẩn form upload" : "Upload ảnh mockup mới"}
          </button>

          {/* Upload form */}
          {showUploadForm && (
            <div
              style={{
                padding: 14,
                borderRadius: 10,
                border: "1px solid var(--border-default)",
                marginBottom: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {/* Color */}
              <div>
                <label style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: 4, display: "block" }}>
                  Màu
                </label>
                <select
                  value={uploadColorId}
                  onChange={(e) => setUploadColorId(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--border-default)" }}
                >
                  {enabledColors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* File */}
              <div>
                <label style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: 4, display: "block" }}>
                  Ảnh mockup (JPEG/PNG/WebP, max 10MB)
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  style={{ fontSize: "0.82rem" }}
                />
              </div>

              {/* View + Scene */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: 4, display: "block" }}>
                    View
                  </label>
                  <select
                    value={uploadView}
                    onChange={(e) => setUploadView(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--border-default)" }}
                  >
                    {VIEW_OPTIONS.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: 4, display: "block" }}>
                    Scene
                  </label>
                  <select
                    value={uploadScene}
                    onChange={(e) => setUploadScene(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 8, fontSize: "0.82rem", border: "1px solid var(--border-default)" }}
                  >
                    {SCENE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Render mode */}
              <div>
                <label style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: 4, display: "block" }}>
                  Render mode
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  {RENDER_MODE_OPTIONS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setUploadRenderMode(r.value)}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderRadius: 8,
                        fontSize: "0.78rem",
                        border: uploadRenderMode === r.value
                          ? "1px solid var(--color-wise-green)"
                          : "1px solid var(--border-default)",
                        backgroundColor: uploadRenderMode === r.value
                          ? "rgba(146, 198, 72, 0.06)"
                          : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <strong>{r.label}</strong>
                      <br />
                      <span style={{ fontSize: "0.65rem", opacity: 0.5 }}>{r.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Composite region numeric inputs */}
              {uploadRenderMode === "COMPOSITE" && (
                <div>
                  <label style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: 4, display: "block" }}>
                    Composite Region (px)
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                    {(["x", "y", "width", "height", "rotationDeg"] as const).map((field) => (
                      <div key={field}>
                        <label style={{ fontSize: "0.65rem", fontWeight: 600, opacity: 0.5 }}>{field}</label>
                        <input
                          type="number"
                          value={uploadRegion?.[field] ?? (field === "rotationDeg" ? 0 : "")}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setUploadRegion((prev) => ({
                              x: prev?.x ?? 0,
                              y: prev?.y ?? 0,
                              width: prev?.width ?? 200,
                              height: prev?.height ?? 200,
                              rotationDeg: prev?.rotationDeg ?? 0,
                              [field]: Number.isFinite(val) ? val : 0,
                            }));
                          }}
                          style={{
                            width: "100%",
                            padding: "4px 6px",
                            borderRadius: 6,
                            fontSize: "0.78rem",
                            border: "1px solid var(--border-default)",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: "0.65rem", opacity: 0.4 }}>
                    Vị trí và kích thước vùng ghép design lên mockup (tính bằng pixel ảnh gốc).
                  </p>
                </div>
              )}

              {/* Label + Primary */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "end" }}>
                <div>
                  <label style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: 4, display: "block" }}>
                    Label (tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={uploadLabel}
                    onChange={(e) => setUploadLabel(e.target.value)}
                    placeholder="VD: Hero shot, Detail view..."
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      borderRadius: 8,
                      fontSize: "0.82rem",
                      border: "1px solid var(--border-default)",
                    }}
                  />
                </div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "0.78rem",
                    cursor: "pointer",
                    paddingBottom: 4,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={uploadIsPrimary}
                    onChange={(e) => setUploadIsPrimary(e.target.checked)}
                  />
                  Primary
                </label>
              </div>

              {/* Submit */}
              <button
                type="button"
                className="btn btn-primary flex items-center gap-2"
                style={{ fontSize: "0.82rem", padding: "8px 16px" }}
                onClick={handleUpload}
                disabled={uploading || !uploadFile}
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? "Đang upload..." : "Upload"}
              </button>
            </div>
          )}

          {/* Library picker */}
          {hasLibrarySources && (
            <div>
              <h4 style={{ fontWeight: 600, fontSize: "0.82rem", margin: "0 0 8px" }}>
                Chọn từ thư viện template ({eligibleTemplateSources.length} có sẵn)
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {eligibleTemplateSources.map((src) => (
                  <div
                    key={src.id}
                    onClick={() => handleTogglePick(src.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: pickedTemplateSourceIds.has(src.id)
                        ? "1px solid var(--color-wise-green)"
                        : "1px solid var(--border-default)",
                      backgroundColor: pickedTemplateSourceIds.has(src.id)
                        ? "rgba(146, 198, 72, 0.05)"
                        : "transparent",
                      cursor: "pointer",
                      fontSize: "0.78rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={pickedTemplateSourceIds.has(src.id)}
                      readOnly
                    />
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        backgroundColor: src.colorHex,
                        border: "1px solid rgba(0,0,0,0.1)",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, fontWeight: 500 }}>
                      {src.label || `${src.view} · ${src.sceneType}`}
                    </span>
                    <span
                      className="badge"
                      style={{
                        fontSize: "0.6rem",
                        backgroundColor: "#dbeafe",
                        color: "#1d4ed8",
                      }}
                    >
                      {src.renderMode}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  CompositeRegionEditor,
  type CompositeRegion,
} from "@/components/mockup/CompositeRegionEditor";

const VIEW_OPTIONS = [
  "front",
  "back",
  "sleeve_left",
  "sleeve_right",
  "detail",
  "lifestyle",
] as const;

const SCENE_OPTIONS = ["flat_lay", "hanging", "lifestyle", "model", "detail"] as const;
const RENDER_OPTIONS = ["FINAL", "COMPOSITE"] as const;

interface CustomSource {
  id: string;
  storagePath: string;
  outputPath: string | null;
  imageUrl: string | null;
  outputUrl: string | null;
  label: string | null;
  view: string;
  sceneType: string;
  renderMode: "FINAL" | "COMPOSITE";
  compositeRegionPx: CompositeRegion | null;
  isPrimary: boolean;
  sortOrder: number;
}

interface TemplateGroup {
  id: string;
  name: string;
  blueprintTitle: string;
  printProviderTitle: string;
  colors: Array<{
    id: string;
    name: string;
    hex: string;
    sources: CustomSource[];
  }>;
}

interface LibraryResponse {
  store: { id: string; name: string };
  templates: TemplateGroup[];
}

interface UploadDraft {
  sourceId?: string;
  templateId: string;
  colorId: string;
  label: string;
  view: string;
  sceneType: string;
  renderMode: "FINAL" | "COMPOSITE";
  isPrimary: boolean;
  sortOrder: number;
  compositeRegionPx: CompositeRegion | null;
  file: File | null;
  previewUrl: string | null;
  imageWidth: number;
  imageHeight: number;
}

const emptyDraft: UploadDraft = {
  templateId: "",
  colorId: "",
  label: "",
  view: "front",
  sceneType: "flat_lay",
  renderMode: "FINAL",
  isPrimary: false,
  sortOrder: 0,
  compositeRegionPx: null,
  file: null,
  previewUrl: null,
  imageWidth: 0,
  imageHeight: 0,
};

export default function MockupLibraryPage() {
  const params = useParams<{ id: string }>();
  const storeId = params.id;
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<UploadDraft | null>(null);

  async function fetchLibrary() {
    setLoading(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/mockup-library`);
      if (!res.ok) throw new Error("Không tải được Mockup Library");
      setData(await res.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tải được Mockup Library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLibrary();
  }, [storeId]);

  const selectedTemplate = useMemo(
    () => data?.templates.find((template) => template.id === draft?.templateId) ?? null,
    [data?.templates, draft?.templateId],
  );
  const selectedColor = useMemo(
    () => selectedTemplate?.colors.find((color) => color.id === draft?.colorId) ?? null,
    [selectedTemplate, draft?.colorId],
  );

  function openUpload(templateId?: string, colorId?: string) {
    setDraft({
      ...emptyDraft,
      templateId: templateId ?? data?.templates[0]?.id ?? "",
      colorId: colorId ?? data?.templates[0]?.colors[0]?.id ?? "",
    });
  }

  function openEdit(source: CustomSource, templateId: string, colorId: string) {
    setDraft({
      sourceId: source.id,
      templateId,
      colorId,
      label: source.label ?? "",
      view: source.view,
      sceneType: source.sceneType,
      renderMode: source.renderMode,
      isPrimary: source.isPrimary,
      sortOrder: source.sortOrder,
      compositeRegionPx: source.compositeRegionPx,
      file: null,
      previewUrl: source.imageUrl,
      imageWidth: 0,
      imageHeight: 0,
    });
  }

  async function handleFile(file: File) {
    const previewUrl = URL.createObjectURL(file);
    const dimensions = await readImageDimensions(previewUrl);
    setDraft((current) => current
      ? {
          ...current,
          file,
          previewUrl,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
          compositeRegionPx: current.compositeRegionPx ?? defaultRegion(dimensions.width, dimensions.height),
        }
      : current);
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    try {
      if (draft.sourceId) {
        const res = await fetch(`/api/stores/${storeId}/mockup-library/${draft.sourceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: draft.label,
            view: draft.view,
            sceneType: draft.sceneType,
            sortOrder: draft.sortOrder,
            isPrimary: draft.isPrimary,
            ...(draft.renderMode === "COMPOSITE" ? { compositeRegionPx: draft.compositeRegionPx } : {}),
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Không lưu được mockup");
        toast.success("Đã cập nhật mockup");
      } else {
        if (!draft.file) throw new Error("Chưa chọn ảnh");
        const form = new FormData();
        form.set("file", draft.file);
        form.set("templateId", draft.templateId);
        form.set("colorId", draft.colorId);
        form.set("label", draft.label);
        form.set("view", draft.view);
        form.set("sceneType", draft.sceneType);
        form.set("renderMode", draft.renderMode);
        form.set("sortOrder", String(draft.sortOrder));
        form.set("isPrimary", String(draft.isPrimary));
        if (draft.renderMode === "COMPOSITE") {
          form.set("compositeRegionPx", JSON.stringify(draft.compositeRegionPx));
        }

        const res = await fetch(`/api/stores/${storeId}/mockup-library`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error((await res.json()).error || "Không upload được mockup");
        toast.success("Đã upload mockup");
      }
      setDraft(null);
      await fetchLibrary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được mockup");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSource(source: CustomSource) {
    if (!confirm(`Xóa mockup "${source.label || source.view}"?`)) return;
    try {
      const res = await fetch(`/api/stores/${storeId}/mockup-library/${source.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Không xóa được mockup");
      toast.success("Đã xóa mockup");
      await fetchLibrary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không xóa được mockup");
    }
  }

  async function setPrimary(source: CustomSource) {
    try {
      const res = await fetch(`/api/stores/${storeId}/mockup-library/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: true }),
      });
      if (!res.ok) throw new Error("Không đặt được primary");
      await fetchLibrary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không đặt được primary");
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <Loader2 className="animate-spin" size={24} style={{ margin: "0 auto" }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card" style={{ padding: 32 }}>
        <Link href="/stores" className="btn btn-secondary">
          <ArrowLeft size={14} />
          Stores
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: 22 }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/stores" style={{ opacity: 0.55 }}>
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>Mockup Library</h1>
            <p className="page-subtitle" style={{ margin: "4px 0 0" }}>{data.store.name}</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => openUpload()} type="button">
          <Upload size={16} />
          Upload Mockup
        </button>
      </div>

      {data.templates.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          Chưa có template nào.
        </div>
      ) : (
        data.templates.map((template) => (
          <section key={template.id} style={{ display: "grid", gap: 12 }}>
            <div>
              <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: 0 }}>
                {template.name}
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: "0.8rem", opacity: 0.55 }}>
                {template.blueprintTitle || "Blueprint chưa có tên"}
              </p>
            </div>

            {template.colors.map((color) => (
              <div key={color.id} className="card" style={{ padding: 16 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                  <div className="flex items-center gap-2">
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: color.hex,
                        border: "1px solid rgba(0,0,0,0.15)",
                      }}
                    />
                    <span style={{ fontWeight: 800 }}>{color.name}</span>
                    <span style={{ fontSize: "0.75rem", opacity: 0.5 }}>{color.sources.length} ảnh</span>
                  </div>
                  <button className="btn btn-secondary" onClick={() => openUpload(template.id, color.id)} type="button">
                    <Plus size={14} />
                    Add
                  </button>
                </div>

                {color.sources.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => openUpload(template.id, color.id)}
                    style={{
                      width: "100%",
                      padding: 24,
                      border: "1px dashed var(--border-default)",
                      borderRadius: 8,
                      background: "transparent",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                    }}
                  >
                    <ImagePlus size={22} style={{ margin: "0 auto 8px" }} />
                    Add mockup for {color.name}
                  </button>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
                    {color.sources.map((source) => {
                      const thumb = source.outputUrl ?? source.imageUrl;
                      return (
                        <div key={source.id} style={{ display: "grid", gap: 7 }}>
                          <button
                            type="button"
                            onClick={() => openEdit(source, template.id, color.id)}
                            style={{
                              position: "relative",
                              aspectRatio: "1 / 1",
                              borderRadius: 8,
                              overflow: "hidden",
                              border: source.isPrimary
                                ? "2px solid var(--color-wise-green)"
                                : "1px solid var(--border-default)",
                              background: "var(--bg-tertiary)",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            {thumb ? (
                              <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <div style={{ height: "100%", display: "grid", placeItems: "center", opacity: 0.55 }}>
                                <Loader2 className="animate-spin" size={20} />
                              </div>
                            )}
                            <div style={{ position: "absolute", top: 6, left: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                              <Badge tone={source.renderMode === "FINAL" ? "blue" : "purple"}>
                                {source.renderMode === "FINAL" ? "Custom Final" : "Custom Composite"}
                              </Badge>
                              {source.isPrimary && <Badge tone="green">Primary</Badge>}
                            </div>
                          </button>
                          <div className="flex items-center justify-between gap-2">
                            <span style={{ fontSize: "0.75rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {source.label || source.view}
                            </span>
                            <div className="flex items-center gap-1">
                              <button className="btn btn-secondary" title="Edit" style={iconButton} onClick={() => openEdit(source, template.id, color.id)} type="button">
                                <Pencil size={13} />
                              </button>
                              <button className="btn btn-secondary" title="Primary" style={iconButton} onClick={() => setPrimary(source)} type="button">
                                <Star size={13} fill={source.isPrimary ? "currentColor" : "none"} />
                              </button>
                              <button className="btn btn-danger" title="Delete" style={iconButton} onClick={() => deleteSource(source)} type="button">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </section>
        ))
      )}

      {draft && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div
            style={{
              width: "min(680px, 100vw)",
              height: "100%",
              overflow: "auto",
              background: "var(--bg-primary)",
              padding: 24,
              boxShadow: "-16px 0 40px rgba(0,0,0,0.18)",
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 900, margin: 0 }}>
                {draft.sourceId ? "Edit Mockup" : "Upload Mockup"}
              </h2>
              <button className="btn btn-secondary" style={iconButton} onClick={() => setDraft(null)} type="button">
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Template">
                  <select
                    value={draft.templateId}
                    disabled={!!draft.sourceId}
                    onChange={(event) => {
                      const template = data.templates.find((entry) => entry.id === event.target.value);
                      setDraft({ ...draft, templateId: event.target.value, colorId: template?.colors[0]?.id ?? "" });
                    }}
                    style={inputStyle}
                  >
                    {data.templates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Color">
                  <select
                    value={draft.colorId}
                    disabled={!!draft.sourceId}
                    onChange={(event) => setDraft({ ...draft, colorId: event.target.value })}
                    style={inputStyle}
                  >
                    {(selectedTemplate?.colors ?? []).map((color) => (
                      <option key={color.id} value={color.id}>{color.name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              {!draft.sourceId && (
                <Field label="Image">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                    style={inputStyle}
                  />
                </Field>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Field label="View">
                  <select value={draft.view} onChange={(event) => setDraft({ ...draft, view: event.target.value })} style={inputStyle}>
                    {VIEW_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </Field>
                <Field label="Scene">
                  <select value={draft.sceneType} onChange={(event) => setDraft({ ...draft, sceneType: event.target.value })} style={inputStyle}>
                    {SCENE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </Field>
                <Field label="Mode">
                  <select
                    value={draft.renderMode}
                    disabled={!!draft.sourceId}
                    onChange={(event) => setDraft({ ...draft, renderMode: event.target.value as UploadDraft["renderMode"] })}
                    style={inputStyle}
                  >
                    {RENDER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <Field label="Label">
                  <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} style={inputStyle} />
                </Field>
                <Field label="Sort">
                  <input
                    type="number"
                    value={draft.sortOrder}
                    onChange={(event) => setDraft({ ...draft, sortOrder: Number.parseInt(event.target.value, 10) || 0 })}
                    style={inputStyle}
                  />
                </Field>
              </div>

              <label className="flex items-center gap-2" style={{ fontSize: "0.82rem", fontWeight: 800 }}>
                <input
                  type="checkbox"
                  checked={draft.isPrimary}
                  onChange={(event) => setDraft({ ...draft, isPrimary: event.target.checked })}
                />
                Primary image
              </label>

              {draft.previewUrl && (
                draft.renderMode === "COMPOSITE" && draft.imageWidth > 0 && draft.imageHeight > 0 ? (
                  <CompositeRegionEditor
                    imageUrl={draft.previewUrl}
                    imageWidth={draft.imageWidth}
                    imageHeight={draft.imageHeight}
                    value={draft.compositeRegionPx}
                    onChange={(region) => setDraft({ ...draft, compositeRegionPx: region })}
                  />
                ) : (
                  <div style={{ width: 240, aspectRatio: "1 / 1", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border-default)" }}>
                    <img
                      src={draft.previewUrl}
                      alt=""
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        if (!draft.imageWidth || !draft.imageHeight) {
                          setDraft((current) => current
                            ? {
                                ...current,
                                imageWidth: image.naturalWidth,
                                imageHeight: image.naturalHeight,
                                compositeRegionPx: current.compositeRegionPx ?? defaultRegion(image.naturalWidth, image.naturalHeight),
                              }
                            : current);
                        }
                      }}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                )
              )}

              <div className="flex items-center justify-end gap-2" style={{ marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={() => setDraft(null)} type="button">
                  <X size={14} />
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={saving || !draft.templateId || !draft.colorId} onClick={saveDraft} type="button">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : draft.sourceId ? <Save size={14} /> : <Check size={14} />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "blue" | "purple" | "green" }) {
  const colors = {
    blue: ["#dbeafe", "#1d4ed8"],
    purple: ["#ede9fe", "#6d28d9"],
    green: ["rgba(159,232,112,0.24)", "var(--color-wise-dark-green)"],
  } as const;
  return (
    <span
      style={{
        borderRadius: 999,
        padding: "2px 7px",
        fontSize: "0.62rem",
        fontWeight: 900,
        background: colors[tone][0],
        color: colors[tone][1],
      }}
    >
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6, fontSize: "0.78rem", fontWeight: 800 }}>
      {label}
      {children}
    </label>
  );
}

function defaultRegion(width: number, height: number): CompositeRegion {
  return {
    x: Math.max(0, Math.round(width * 0.3)),
    y: Math.max(0, Math.round(height * 0.32)),
    width: Math.max(1, Math.round(width * 0.4)),
    height: Math.max(1, Math.round(height * 0.28)),
    rotationDeg: 0,
  };
}

function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Không đọc được kích thước ảnh"));
    image.src = url;
  });
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border-default)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  fontSize: "0.84rem",
};

const iconButton: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

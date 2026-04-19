"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import {
  PenTool,
  Loader2,
  RefreshCw,
  Zap,
  X,
  Plus,
  AlertTriangle,
} from "lucide-react";

interface AiContent {
  title: string;
  description: string;
  tags: string[];
  altText: string;
}

export default function Step5ContentPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const { draft } = useWizardStore();

  const existing = (draft?.aiContent as AiContent | null) || null;

  const [content, setContent] = useState<AiContent>({
    title: existing?.title || "",
    description: existing?.description || "",
    tags: existing?.tags || [],
    altText: existing?.altText || "",
  });
  const [generating, setGenerating] = useState(false);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync from draft when loaded
  useEffect(() => {
    if (existing) {
      setContent({
        title: existing.title || "",
        description: existing.description || "",
        tags: existing.tags || [],
        altText: existing.altText || "",
      });
    }
  }, [existing?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    setCached(false);

    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/generate-content`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Generation failed");
        return;
      }

      setContent({
        title: data.content.title,
        description: data.content.description,
        tags: data.content.tags,
        altText: data.content.altText,
      });
      setCached(data.cached || false);
    } catch {
      setError("Không thể kết nối server");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/wizard/drafts/${draftId}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content),
      });
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !content.tags.includes(tag)) {
      setContent({ ...content, tags: [...content.tags, tag] });
      setTagInput("");
    }
  }

  function removeTag(tag: string) {
    setContent({ ...content, tags: content.tags.filter((t) => t !== tag) });
  }

  const hasContent = content.title.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: 0 }}>
          AI Content
        </h2>
        {hasContent && (
          <div className="flex items-center gap-2">
            {cached && (
              <span
                className="flex items-center gap-1"
                style={{
                  fontSize: "0.75rem",
                  color: "var(--color-wise-green)",
                  fontWeight: 600,
                }}
              >
                <Zap size={12} /> Cached
              </span>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleGenerate}
              disabled={generating}
              style={{ fontSize: "0.8rem" }}
            >
              <RefreshCw size={14} />
              Regenerate
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
              style={{ fontSize: "0.8rem" }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Lưu
            </button>
          </div>
        )}
      </div>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Tạo nội dung SEO bằng AI hoặc viết tay
      </p>

      {/* Generate CTA when no content yet */}
      {!hasContent && !generating && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--color-wise-green), #6ba832)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <PenTool size={28} color="white" />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Tạo nội dung</h3>
          <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 24px" }}>
            AI sẽ viết title, description, tags và alt text dựa trên design & product
          </p>

          {error && (
            <div
              className="flex items-center justify-center gap-2"
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(239,68,68,0.1)",
                color: "var(--color-error)",
                fontSize: "0.85rem",
              }}
            >
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating}
            style={{ fontSize: "0.9rem", padding: "12px 32px" }}
          >
            {generating ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Đang tạo...
              </>
            ) : (
              <>
                <PenTool size={18} /> Tạo nội dung AI
              </>
            )}
          </button>
        </div>
      )}

      {/* Loading state */}
      {generating && hasContent && (
        <div
          className="flex items-center justify-center gap-2"
          style={{ padding: 24, opacity: 0.5 }}
        >
          <Loader2 size={18} className="animate-spin" />
          Đang regenerate...
        </div>
      )}

      {/* Content editor */}
      {hasContent && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Title */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "block",
                marginBottom: 6,
              }}
            >
              Title
              <span style={{ opacity: 0.4, fontWeight: 400, marginLeft: 8 }}>
                {content.title.length}/60
              </span>
            </label>
            <input
              type="text"
              className="input"
              value={content.title}
              onChange={(e) => setContent({ ...content, title: e.target.value })}
              maxLength={60}
              placeholder="Product title..."
            />
          </div>

          {/* Description */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "block",
                marginBottom: 6,
              }}
            >
              Description (HTML)
            </label>
            <textarea
              className="input"
              value={content.description}
              onChange={(e) =>
                setContent({ ...content, description: e.target.value })
              }
              rows={8}
              style={{ resize: "vertical", fontFamily: "monospace", fontSize: "0.82rem" }}
              placeholder="<p>Product description...</p>"
            />
          </div>

          {/* Tags */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "block",
                marginBottom: 6,
              }}
            >
              Tags ({content.tags.length})
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 8,
              }}
            >
              {content.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1"
                  style={{
                    padding: "4px 10px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--bg-tertiary)",
                    fontSize: "0.78rem",
                    fontWeight: 500,
                  }}
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                      opacity: 0.5,
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Thêm tag..."
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-secondary"
                onClick={addTag}
                style={{ fontSize: "0.8rem" }}
              >
                <Plus size={14} /> Thêm
              </button>
            </div>
          </div>

          {/* Alt Text */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "block",
                marginBottom: 6,
              }}
            >
              Alt Text
              <span style={{ opacity: 0.4, fontWeight: 400, marginLeft: 8 }}>
                {content.altText.length}/125
              </span>
            </label>
            <input
              type="text"
              className="input"
              value={content.altText}
              onChange={(e) =>
                setContent({ ...content, altText: e.target.value })
              }
              maxLength={125}
              placeholder="Image alt text for SEO..."
            />
          </div>

          {error && (
            <div
              className="flex items-center gap-2"
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(239,68,68,0.1)",
                color: "var(--color-error)",
                fontSize: "0.85rem",
              }}
            >
              <AlertTriangle size={14} />
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import { parseAIError } from "@/lib/ai/errors";
import type { AIProviderError } from "@/lib/ai/errors";
import {
  PenTool,
  Loader2,
  RefreshCw,
  Zap,
  X,
  Plus,
  AlertTriangle,
  Pencil,
  Wand2,
} from "lucide-react";

type ContentState = "empty" | "ai-loading" | "ai-failed" | "manual-edit" | "ready";

interface AiContent {
  title: string;
  description: string;
  tags: string[];
  altText: string;
  source?: "ai" | "manual";
}

const MAX_TAGS = 15; // Shopify product tags limit

export default function Step5ContentPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const { draft, updateDraft } = useWizardStore();

  const existing = (draft?.aiContent as AiContent | null) || null;

  const [state, setState] = useState<ContentState>(existing?.title ? "ready" : "empty");
  const [content, setContent] = useState<AiContent>({
    title: existing?.title || "",
    description: existing?.description || "",
    tags: existing?.tags || [],
    altText: existing?.altText || "",
  });
  const [aiError, setAiError] = useState<AIProviderError | null>(null);
  const [cached, setCached] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Sync from draft (e.g. after navigation back)
  useEffect(() => {
    if (existing?.title && state === "empty") {
      setContent({
        title: existing.title || "",
        description: existing.description || "",
        tags: existing.tags || [],
        altText: existing.altText || "",
      });
      setState("ready");
    }
  }, [existing?.title, state]);

  // Auto-sync local content to global store (so Tiếp theo saves it)
  useEffect(() => {
    if (state === "ready" || state === "manual-edit") {
      const syncedContent = state === "manual-edit" ? { ...content, source: "manual" } : content;
      updateDraft({ aiContent: syncedContent });
    }
  }, [content, state, updateDraft]);

  // ── AI generate ──────────────────────────────────────────────────────────
  async function handleGenerateAI() {
    setState("ai-loading");
    setAiError(null);
    setCached(false);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s timeout

    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/generate-content`, {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();

      if (!res.ok) {
        // data.message is already user-friendly (fixed in route.ts)
        setAiError({
          code: data.error ?? "unknown",
          userMessage: data.message ?? "Không tạo được nội dung. Vui lòng thử lại.",
          retryable: data.retryable ?? true,
          severity: "error",
          supportHint: data.supportHint,
        });
        setState("ai-failed");
        return;
      }

      const c = data.content as AiContent;
      setContent({
        title: c.title || "",
        description: c.description || "",
        tags: c.tags || [],
        altText: c.altText || "",
      });
      setCached(data.cached ?? false);
      setState("ready");
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === "AbortError") {
        setAiError({
          code: "timeout",
          userMessage: "AI quá tải hoặc mất quá lâu. Vui lòng thử lại sau hoặc viết tay.",
          retryable: true,
          severity: "error",
        });
      } else {
        setAiError(parseAIError(new Error("Network error")));
      }
      setState("ai-failed");
    }
  }

  // ── Manual save ──────────────────────────────────────────────────────────
  async function handleSaveManual() {
    setSaving(true);
    setSaveError("");
    try {
      updateDraft({ aiContent: { ...content, source: "manual" } });
      await useWizardStore.getState().saveDraftImmediately();
      setState("ready");
    } catch {
      setSaveError("Không thể kết nối server.");
    } finally {
      setSaving(false);
    }
  }

  // ── Auto-save (ready state) ───────────────────────────────────────────────
  async function handleSaveReady() {
    setSaving(true);
    try {
      updateDraft({ aiContent: content });
      await useWizardStore.getState().saveDraftImmediately();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  function addTag() {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !content.tags.includes(tag) && content.tags.length < MAX_TAGS) {
      setContent({ ...content, tags: [...content.tags, tag] });
      setTagInput("");
    }
  }

  function removeTag(tag: string) {
    setContent({ ...content, tags: content.tags.filter((t) => t !== tag) });
  }

  // ── Shared form (manual-edit + ready) ────────────────────────────────────
  const ContentForm = (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Title */}
      <div>
        <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
          Tiêu đề
          <span style={{ opacity: 0.4, fontWeight: 400, marginLeft: 8 }}>
            {content.title.length}/255
          </span>
        </label>
        <input
          type="text"
          className="input"
          value={content.title}
          onChange={(e) => setContent({ ...content, title: e.target.value })}
          maxLength={255}
          placeholder="Tiêu đề sản phẩm..."
          required
        />
      </div>

      {/* Description */}
      <div>
        <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
          Mô tả (HTML)
        </label>
        <textarea
          className="input"
          value={content.description}
          onChange={(e) => setContent({ ...content, description: e.target.value })}
          rows={8}
          style={{ resize: "vertical", fontFamily: "monospace", fontSize: "0.82rem" }}
          placeholder="<p>Mô tả sản phẩm...</p>"
        />
      </div>

      {/* Tags */}
      <div>
        <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
          Tags ({content.tags.length}/{MAX_TAGS})
          {content.tags.length >= MAX_TAGS && (
            <span style={{ color: "var(--color-warning, #f59e0b)", fontWeight: 400, marginLeft: 8, fontSize: "0.78rem" }}>
              Đã đạt giới hạn Shopify
            </span>
          )}
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {content.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1"
              style={{ padding: "4px 10px", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-tertiary)", fontSize: "0.78rem", fontWeight: 500 }}
            >
              {tag}
              <button onClick={() => removeTag(tag)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", opacity: 0.5 }}>
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
              if (e.key === "Enter") { e.preventDefault(); addTag(); }
            }}
            placeholder="Thêm tag..."
            style={{ flex: 1 }}
            disabled={content.tags.length >= MAX_TAGS}
          />
          <button
            className="btn btn-secondary"
            onClick={addTag}
            disabled={content.tags.length >= MAX_TAGS}
            style={{ fontSize: "0.8rem" }}
          >
            <Plus size={14} /> Thêm
          </button>
        </div>
      </div>

      {/* Alt Text */}
      <div>
        <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
          Alt Text (SEO)
          <span style={{ opacity: 0.4, fontWeight: 400, marginLeft: 8 }}>{content.altText.length}/512</span>
        </label>
        <input
          type="text"
          className="input"
          value={content.altText}
          onChange={(e) => setContent({ ...content, altText: e.target.value })}
          maxLength={512}
          placeholder="Mô tả ảnh cho SEO..."
        />
      </div>
    </div>
  );

  // ── Render by state ──────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: 0 }}>AI Content</h2>
        {state === "ready" && (
          <div className="flex items-center gap-2">
            {cached && (
              <span className="flex items-center gap-1" style={{ fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 600 }}>
                <Zap size={12} /> Cached
              </span>
            )}
            <button className="btn btn-secondary" onClick={handleGenerateAI} style={{ fontSize: "0.8rem" }}>
              <RefreshCw size={14} /> Regenerate AI
            </button>
            <button className="btn btn-secondary" onClick={() => setState("manual-edit")} style={{ fontSize: "0.8rem" }}>
              <Pencil size={14} /> Sửa tay
            </button>
            <button className="btn btn-primary" onClick={handleSaveReady} disabled={saving} style={{ fontSize: "0.8rem" }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Lưu
            </button>
          </div>
        )}
      </div>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Tạo nội dung SEO bằng AI hoặc viết tay
      </p>

      {/* ── EMPTY STATE ── */}
      {state === "empty" && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--color-wise-green), #6ba832)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <PenTool size={28} color="white" />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Tạo nội dung</h3>
          <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 24px" }}>
            AI sẽ viết title, description, tags và alt text dựa trên design & product
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={handleGenerateAI} style={{ fontSize: "0.9rem", padding: "12px 32px" }}>
              <Wand2 size={18} /> Tạo nội dung AI
            </button>
            <span style={{ opacity: 0.4, fontSize: "0.8rem" }}>hoặc</span>
            <button className="btn btn-secondary" onClick={() => setState("manual-edit")} style={{ fontSize: "0.85rem" }}>
              <Pencil size={16} /> Viết tay
            </button>
          </div>
        </div>
      )}

      {/* ── AI LOADING ── */}
      {state === "ai-loading" && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <Loader2 size={36} className="animate-spin" style={{ margin: "0 auto 16px", display: "block", color: "var(--color-wise-green)" }} />
          <p style={{ fontWeight: 600 }}>AI đang tạo nội dung…</p>
          <p style={{ opacity: 0.4, fontSize: "0.82rem", marginTop: 6 }}>
            Tự động thử lại nếu bị gián đoạn
          </p>
        </div>
      )}

      {/* ── AI FAILED ── */}
      {state === "ai-failed" && aiError && (
        <div className="card" style={{ padding: 24 }}>
          <div
            className="flex items-start gap-3"
            style={{
              padding: "12px 16px", borderRadius: "var(--radius-sm)",
              backgroundColor: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              marginBottom: 16,
            }}
          >
            <AlertTriangle size={16} style={{ color: "var(--color-error)", flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>Không tạo được nội dung</div>
              <div style={{ fontSize: "0.82rem", opacity: 0.8, marginTop: 2 }}>{aiError.userMessage}</div>
              {aiError.supportHint && (
                <div style={{ fontSize: "0.78rem", opacity: 0.55, marginTop: 6 }}>{aiError.supportHint}</div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {aiError.retryable && (
              <button className="btn btn-primary" onClick={handleGenerateAI} style={{ fontSize: "0.85rem" }}>
                <RefreshCw size={14} /> Thử lại
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setState("manual-edit")} style={{ fontSize: "0.85rem" }}>
              <Pencil size={14} /> Viết tay
            </button>
          </div>
        </div>
      )}

      {/* ── MANUAL EDIT ── */}
      {state === "manual-edit" && (
        <div className="card" style={{ padding: 24 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem" }}>Viết tay</h3>
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={handleGenerateAI} style={{ fontSize: "0.8rem" }}>
                <Wand2 size={14} /> Thử AI
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveManual}
                disabled={saving || !content.title.trim() || !content.description.trim()}
                style={{ fontSize: "0.8rem" }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Lưu
              </button>
            </div>
          </div>

          {saveError && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: "var(--radius-sm)", backgroundColor: "rgba(239,68,68,0.1)", color: "var(--color-error)", fontSize: "0.82rem" }}>
              {saveError}
            </div>
          )}

          {ContentForm}
        </div>
      )}

      {/* ── READY (content exists) ── */}
      {state === "ready" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {ContentForm}
        </div>
      )}
    </div>
  );
}

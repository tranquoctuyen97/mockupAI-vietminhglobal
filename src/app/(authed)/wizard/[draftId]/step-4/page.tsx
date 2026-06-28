"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Loader2,
  Pencil,
  PenTool,
  Plus,
  RefreshCw,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { parseAIError } from "@/lib/ai/errors";
import type { AIProviderError } from "@/lib/ai/errors";
import {
  MAX_ORGANIZATION_COLLECTIONS,
  MAX_TAGS,
  mergeOptimizedTags,
  normalizeOrganizationCollections,
  normalizeTags,
} from "@/lib/wizard/product-organization";
import { getIndependentDraftDesigns } from "@/lib/wizard/publish-units";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";

type ContentState = "empty" | "ai-loading" | "ai-failed" | "manual-edit" | "ready";

interface AiContent {
  title: string;
  description: string;
  tags: string[];
  collections: string[];
  altText: string;
  source?: "ai" | "manual";
}

interface PairContentEntry {
  id: string;
  baseName: string;
  lightDraftDesignId: string;
  darkDraftDesignId: string;
  sortOrder?: number | null;
  aiContent?: unknown | null;
  lightDesign?: { design?: { name?: string | null } | null } | null;
  darkDesign?: { design?: { name?: string | null } | null } | null;
}

interface DraftDesignEntry {
  id: string;
  designId: string;
  sortOrder?: number | null;
  aiContent?: unknown | null;
  design?: { name?: string | null } | null;
}

export default function Step5ContentPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const { draft, updateDraft, loadDraft, setStep4SaveHandler } = useWizardStore();

  const tabs = useMemo(() => {
    const list: Array<{
      key: string;
      kind: "pair" | "independent" | "draft";
      id: string;
      name: string;
      aiContent: any;
    }> = [];

    const sortedPairs = [...((draft?.designPairs ?? []) as PairContentEntry[])].sort(
      (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    for (const pair of sortedPairs) {
      list.push({
        key: `pair:${pair.id}`,
        kind: "pair",
        id: pair.id,
        name: pair.baseName,
        aiContent: pair.aiContent,
      });
    }

    const childRows = (draft?.draftDesigns ?? []) as DraftDesignEntry[];
    if (childRows.length > 0) {
      const sortedIndependents = getIndependentDraftDesigns(childRows, sortedPairs)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      for (const draftDesign of sortedIndependents) {
        list.push({
          key: `independent:${draftDesign.id}`,
          kind: "independent",
          id: draftDesign.id,
          name: draftDesign.design?.name ?? "Design",
          aiContent: draftDesign.aiContent,
        });
      }
    } else if (draft?.designId && list.length === 0) {
      list.push({
        key: "draft",
        kind: "draft",
        id: draft.id,
        name: draft.design?.name ?? "Design",
        aiContent: draft.aiContent,
      });
    }

    return list;
  }, [draft?.designPairs, draft?.draftDesigns, draft?.designId, draft?.design, draft?.aiContent]);

  const [activeTabKey, setActiveTabKey] = useState("");
  const activeTab = tabs.find((t) => t.key === activeTabKey) ?? tabs[0] ?? null;
  const existing = (activeTab?.aiContent as AiContent | null) || null;
  const templateDefaultTags = normalizeTags(draft?.template?.defaultTags);
  const existingTags = normalizeTags(existing?.tags || []);
  const initialTags = existingTags.length > 0 ? existingTags : templateDefaultTags;
  const existingTagsKey = existingTags.join("\u0000");
  const templateDefaultTagsKey = templateDefaultTags.join("\u0000");

  const [state, setState] = useState<ContentState>(existing?.title ? "ready" : "empty");
  const [content, setContent] = useState<AiContent>({
    title: existing?.title || "",
    description: existing?.description || "",
    tags: initialTags,
    collections: normalizeOrganizationCollections(existing?.collections || []),
    altText: existing?.altText || "",
  });

  const isDirty = useMemo(() => {
    if (!existing) {
      return Boolean(
        content.title.trim() ||
        content.description.trim() ||
        content.tags.length > 0 ||
        content.collections.length > 0 ||
        content.altText.trim()
      );
    }
    const titleChanged = content.title !== (existing.title || "");
    const descChanged = content.description !== (existing.description || "");
    const tagsChanged = JSON.stringify(content.tags) !== JSON.stringify(normalizeTags(existing.tags || []));
    const collsChanged = JSON.stringify(content.collections) !== JSON.stringify(normalizeOrganizationCollections(existing.collections || []));
    const altChanged = content.altText !== (existing.altText || "");
    return titleChanged || descChanged || tagsChanged || collsChanged || altChanged;
  }, [content, existing]);
  const [aiError, setAiError] = useState<AIProviderError | null>(null);
  const [cached, setCached] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [collectionInput, setCollectionInput] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [aiConfigAvailable, setAiConfigAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!activeTabKey && tabs[0]) {
      setActiveTabKey(tabs[0].key);
    }
  }, [activeTabKey, tabs]);

  // Sync from draft (e.g. after navigation back)
  useEffect(() => {
    setContent({
      title: existing?.title || "",
      description: existing?.description || "",
      tags: initialTags,
      collections: normalizeOrganizationCollections(existing?.collections || []),
      altText: existing?.altText || "",
    });
    setState(existing?.title ? "ready" : "empty");
  }, [activeTabKey, draft?.id, existing?.title, existingTagsKey, templateDefaultTagsKey]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/wizard/ai-config/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setAiConfigAvailable(Boolean(data?.available));
      })
      .catch(() => {
        if (!cancelled) setAiConfigAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ready content keeps current auto-save behavior. Manual edit content stays
  // pending in the wizard store for Save/Next, but does not debounce-write DB.
  useEffect(() => {
    if (activeTab?.kind === "pair" || activeTab?.kind === "independent") return;
    if (state === "ready") {
      updateDraft({ aiContent: content });
    }
    if (state === "manual-edit") {
      updateDraft({ aiContent: { ...content, source: "manual" } }, { debounce: false });
    }
  }, [content, activeTab?.kind, state, updateDraft]);

  // Register save handler to store for layout navigation auto-saves
  useEffect(() => {
    const saveCurrentTab = async () => {
      if (!isDirty) return;

      if (!content.title.trim()) {
        toast.error("Vui lòng nhập tiêu đề sản phẩm.");
        throw new Error("Title is required");
      }

      const contentToSave = {
        ...content,
        tags: mergeOptimizedTags([], content.tags),
        collections: normalizeOrganizationCollections(content.collections),
        source: (state === "manual-edit" ? "manual" : existing?.source) as "ai" | "manual" | undefined,
      };

      try {
        await saveTabContent(contentToSave);
        setState("ready");
      } catch (err) {
        toast.error("Không thể tự động lưu nội dung.");
        throw err;
      }
    };

    setStep4SaveHandler(saveCurrentTab);

    return () => {
      setStep4SaveHandler(null);
    };
  }, [content, activeTab, state, isDirty, existing?.source, setStep4SaveHandler]);

  async function saveTabContent(nextContent: AiContent) {
    if (!activeTab) return;
    let url = "";
    if (activeTab.kind === "pair") {
      url = `/api/wizard/drafts/${draftId}/design-pairs/${activeTab.id}/content`;
    } else if (activeTab.kind === "independent") {
      url = `/api/wizard/drafts/${draftId}/designs/${activeTab.id}/content`;
    } else {
      updateDraft({ aiContent: nextContent });
      await useWizardStore.getState().saveDraftImmediately();
      return;
    }

    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextContent),
    });
    if (!res.ok) {
      throw new Error(`Không lưu được nội dung ${activeTab.kind === "pair" ? "cặp" : "design"}`);
    }
    await loadDraft(draftId);
  }

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          activeTab?.kind === "pair"
            ? { pairId: activeTab.id }
            : activeTab?.kind === "independent"
              ? { designId: activeTab.id }
              : {},
        ),
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

      let activeContent = null;
      if (activeTab?.kind === "pair" && data.pairs) {
        activeContent = data.pairs.find((p: any) => p.id === activeTab.id)?.content;
      } else if (activeTab?.kind === "independent" && data.designs) {
        activeContent = data.designs.find((d: any) => d.id === activeTab.id)?.content;
      }
      const c = (activeContent ?? data.content) as AiContent;
      setContent({
        title: c.title || "",
        description: c.description || "",
        tags: c.tags || [],
        collections: normalizeOrganizationCollections(c.collections || []),
        altText: c.altText || "",
      });
      setCached(data.cached ?? false);
      setState("ready");
      if (activeTab?.kind === "pair" || activeTab?.kind === "independent") {
        await loadDraft(draftId);
      }
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
      const manualContent = {
        ...content,
        tags: mergeOptimizedTags([], content.tags),
        collections: normalizeOrganizationCollections(content.collections),
        source: "manual" as const,
      };
      setContent(manualContent);
      await saveTabContent(manualContent);
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
      const nextContent = {
        ...content,
        tags: mergeOptimizedTags([], content.tags),
        collections: normalizeOrganizationCollections(content.collections),
      };
      await saveTabContent(nextContent);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  // ── Auto-save on tab change ───────────────────────────────────────────────
  async function handleTabChange(nextTabKey: string) {
    if (nextTabKey === activeTabKey) return;
    if (isDirty) {
      if (!content.title.trim()) {
        toast.error("Vui lòng nhập tiêu đề sản phẩm trước khi chuyển tab.");
        return;
      }
      const contentToSave = {
        ...content,
        tags: mergeOptimizedTags([], content.tags),
        collections: normalizeOrganizationCollections(content.collections),
        source: (state === "manual-edit" ? "manual" : existing?.source) as "ai" | "manual" | undefined,
      };
      try {
        await saveTabContent(contentToSave);
        setState("ready");
      } catch (err) {
        toast.error("Không thể tự động lưu nội dung tab cũ.");
        return;
      }
    }
    setActiveTabKey(nextTabKey);
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  function addTag() {
    const tag = tagInput.trim();
    if (tag && content.tags.length < MAX_TAGS) {
      setContent({ ...content, tags: mergeOptimizedTags([tag], content.tags) });
      setTagInput("");
    }
  }

  function removeTag(tag: string) {
    setContent((current) => ({ ...current, tags: current.tags.filter((t) => t !== tag) }));
  }

  // ── Optimize ─────────────────────────────────────────────────────────────
  async function handleOptimizeOrganization() {
    setOptimizing(true);
    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/ai/optimize-product-organization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: content.title,
          descriptionHtml: content.description,
          productType: draft?.template?.blueprintTitle ?? draft?.store?.template?.blueprintTitle ?? "",
          canonicalProductType: null,
          currentTags: content.tags,
          currentCollections: content.collections,
          designContext: activeTab?.kind === "pair"
            ? `${activeTab.name}`
            : activeTab?.name ?? draft?.design?.name ?? null,
          niche: null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "Không thể tối ưu tags & collections");
      }

      setContent((current) => ({
        ...current,
        tags: mergeOptimizedTags(data?.tags ?? [], current.tags),
        collections: normalizeOrganizationCollections([
          ...(Array.isArray(data?.collections) ? data.collections : []),
          ...current.collections,
        ]),
      }));
      toast.success("Đã tối ưu tags & collections. Bấm Lưu để áp dụng.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể tối ưu tags & collections");
    } finally {
      setOptimizing(false);
    }
  }

  function addCollection() {
    setContent((current) => ({
      ...current,
      collections: normalizeOrganizationCollections([...current.collections, collectionInput]),
    }));
    setCollectionInput("");
  }

  function removeCollection(collection: string) {
    setContent((current) => ({
      ...current,
      collections: current.collections.filter((item) => item !== collection),
    }));
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
        <div className="flex items-center justify-between" style={{ marginBottom: 6, gap: 12 }}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>
            Tags ({content.tags.length}/{MAX_TAGS})
            {content.tags.length >= MAX_TAGS && (
              <span style={{ color: "var(--color-warning, #f59e0b)", fontWeight: 400, marginLeft: 8, fontSize: "0.78rem" }}>
                Đã đạt giới hạn Shopify
              </span>
            )}
          </label>
          {state === "manual-edit" && aiConfigAvailable && (
            <button
              className="btn btn-secondary"
              onClick={handleOptimizeOrganization}
              disabled={optimizing}
              style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}
            >
              {optimizing ? <Loader2 size={14} className="animate-spin" /> : null}
              {optimizing ? "Đang tối ưu..." : "✨ Tối ưu tags & collections"}
            </button>
          )}
        </div>
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

      <div>
        <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
          Collections ({content.collections.length}/{MAX_ORGANIZATION_COLLECTIONS})
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {content.collections.map((collection) => (
            <span
              key={collection}
              className="flex items-center gap-1"
              style={{ padding: "4px 10px", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-tertiary)", fontSize: "0.78rem", fontWeight: 500 }}
            >
              {collection}
              <button onClick={() => removeCollection(collection)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", opacity: 0.5 }}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            className="input"
            value={collectionInput}
            onChange={(e) => setCollectionInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addCollection(); }
            }}
            placeholder="Thêm collection..."
            style={{ flex: 1 }}
            disabled={content.collections.length >= MAX_ORGANIZATION_COLLECTIONS}
          />
          <button
            className="btn btn-secondary"
            onClick={addCollection}
            disabled={content.collections.length >= MAX_ORGANIZATION_COLLECTIONS}
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
        {tabs.length > 1 ? "Tạo nội dung riêng cho từng listing" : "Tạo nội dung SEO bằng AI hoặc viết tay"}
      </p>

      {tabs.length > 1 && (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 16,
            display: "flex",
            gap: 8,
            overflowX: "auto",
          }}
        >
          {tabs.map((tab) => {
            const active = tab.key === activeTab?.key;
            const ready = Boolean(tab.aiContent?.title);
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabChange(tab.key)}
                style={{
                  minWidth: 180,
                  textAlign: "left",
                  padding: "9px 11px",
                  borderRadius: "var(--radius-sm)",
                  border: active
                    ? "1px solid var(--color-wise-green)"
                    : "1px solid var(--border-default)",
                  backgroundColor: active ? "rgba(146, 198, 72, 0.08)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontWeight: 800,
                    fontSize: "0.82rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tab.name}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
                  {ready ? "Đã có content" : "Chưa có content"}
                </p>
              </button>
            );
          })}
        </div>
      )}

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
                disabled={saving || !content.title.trim()}
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

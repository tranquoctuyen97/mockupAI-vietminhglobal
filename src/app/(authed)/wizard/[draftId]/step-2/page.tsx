"use client";

import { useState, useEffect } from "react";
import {
  getDraftDesignIdsFromDraft,
  useWizardStore,
} from "@/lib/wizard/use-wizard-store";
import { Image as ImageIcon, Check, Loader2, Search, X } from "lucide-react";

interface Design {
  id: string;
  name: string;
  previewUrl: string | null;
  width: number;
  height: number;
}

export default function Step2DesignPage() {
  const { draft, updateDraft } = useWizardStore();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const selectedDesignIds = getDraftDesignIdsFromDraft(draft);
  const selectedDesignIdSet = new Set(selectedDesignIds);
  const selectedDesigns = selectedDesignIds
    .map((id) => designs.find((design) => design.id === id))
    .filter((design): design is Design => Boolean(design));

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (search) params.set("q", search);
        const res = await fetch(`/api/designs?${params}`, { signal });
        const data = await res.json();
        if (!signal.aborted && res.ok) setDesigns(data.designs);
      } catch {
        // ignore (AbortError or network error)
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [search]);

  function handleToggleDesign(designId: string) {
    const selected = getDraftDesignIdsFromDraft(useWizardStore.getState().draft);
    const isSelected = selected.includes(designId);
    const next = isSelected
      ? selected.filter((id) => id !== designId)
      : selected.length >= 5
        ? selected
        : [...selected, designId];

    updateDraft({
      designId: next[0] ?? null,
      designIds: next,
    });
  }

  function handleRemoveDesign(designId: string) {
    const next = getDraftDesignIdsFromDraft(useWizardStore.getState().draft).filter(
      (id) => id !== designId,
    );
    updateDraft({
      designId: next[0] ?? null,
      designIds: next,
    });
  }

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Chọn Design ({selectedDesignIds.length}/5 đã chọn)
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Chọn 1-5 designs để tạo listing
      </p>

      {selectedDesigns.length > 0 && (
        <div
          className="card"
          style={{
            padding: 10,
            marginBottom: 16,
            display: "flex",
            gap: 8,
            overflowX: "auto",
            alignItems: "center",
          }}
        >
          {selectedDesigns.map((design) => (
            <div
              key={design.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-sm)",
                padding: "6px 8px",
                flexShrink: 0,
                maxWidth: 220,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-tertiary)",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {design.previewUrl ? (
                  <img
                    src={design.previewUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <ImageIcon size={16} style={{ opacity: 0.35 }} />
                )}
              </div>
              <span
                style={{
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {design.name}
              </span>
              <button
                type="button"
                aria-label={`Remove ${design.name}`}
                onClick={() => handleRemoveDesign(design.id)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  padding: 2,
                  color: "inherit",
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search
          size={16}
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }}
        />
        <input
          className="input"
          placeholder="Tìm design..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 38 }}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center" style={{ padding: 48, opacity: 0.5 }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {!loading && designs.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <ImageIcon size={32} style={{ opacity: 0.3, margin: "0 auto 12px" }} />
          <p style={{ fontWeight: 600 }}>Chưa có design nào</p>
          <p style={{ opacity: 0.5, fontSize: "0.85rem" }}>Upload design trước rồi quay lại</p>
        </div>
      )}

      {!loading && designs.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          {designs.map((design) => {
            const isSelected = selectedDesignIdSet.has(design.id);
            const isDisabled = !isSelected && selectedDesignIds.length >= 5;
            return (
              <div
                key={design.id}
                onClick={() => {
                  if (!isDisabled) handleToggleDesign(design.id);
                }}
                style={{
                  padding: 0,
                  overflow: "hidden",
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  opacity: isDisabled ? 0.45 : 1,
                  border: isSelected
                    ? "2px solid var(--color-wise-green)"
                    : "1px solid var(--border-default)",
                  transition: "all 0.15s",
                  position: "relative",
                }}
              >
                {isSelected && (
                  <div
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      backgroundColor: "var(--color-wise-green)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 2,
                    }}
                  >
                    <Check size={14} color="white" />
                  </div>
                )}

                <div
                  style={{
                    aspectRatio: "1/1",
                    backgroundColor: "var(--bg-tertiary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {design.previewUrl ? (
                    <img
                      src={design.previewUrl}
                      alt={design.name}
                      style={{ width: "100%", height: "100%", objectFit: "contain", padding: 8 }}
                    />
                  ) : (
                    <ImageIcon size={28} style={{ opacity: 0.2 }} />
                  )}
                </div>

                <div style={{ padding: "8px 10px" }}>
                  <p
                    style={{
                      fontWeight: 600,
                      fontSize: "0.8rem",
                      margin: 0,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {design.name}
                  </p>
                  <p style={{ fontSize: "0.7rem", opacity: 0.4, margin: "2px 0 0" }}>
                    {design.width}×{design.height}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

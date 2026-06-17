"use client";

import { useState, useEffect } from "react";
import { pairDesigns } from "@/lib/designs/design-pairing";
import { MAX_WIZARD_DESIGNS } from "@/lib/wizard/design-selection";
import {
  getDraftDesignIdsFromDraft,
  useWizardStore,
} from "@/lib/wizard/use-wizard-store";
import { Image as ImageIcon, Check, Loader2, Search, X, AlertTriangle } from "lucide-react";

interface Design {
  id: string;
  name: string;
  previewUrl: string | null;
  width: number;
  height: number;
}

type DraftDesignEntry = NonNullable<
  NonNullable<ReturnType<typeof useWizardStore.getState>["draft"]>["draftDesigns"]
>[number];

function designFromDraftEntry(entry: DraftDesignEntry): Design | null {
  if (!entry.design) return null;
  return {
    id: entry.design.id,
    name: entry.design.name,
    previewUrl:
      typeof entry.design.previewUrl === "string"
        ? entry.design.previewUrl
        : typeof entry.design.previewPath === "string"
          ? entry.design.previewPath
          : null,
    width: typeof entry.design.width === "number" ? entry.design.width : 0,
    height: typeof entry.design.height === "number" ? entry.design.height : 0,
  };
}

export default function Step2DesignPage() {
  const { draft, updateDraft } = useWizardStore();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const selectedDesignIds = getDraftDesignIdsFromDraft(draft);
  const selectedDesignIdSet = new Set(selectedDesignIds);
  const availableDesigns = new Map(designs.map((design) => [design.id, design]));
  for (const draftDesign of draft?.draftDesigns ?? []) {
    const design = designFromDraftEntry(draftDesign);
    if (design && !availableDesigns.has(design.id)) {
      availableDesigns.set(design.id, design);
    }
  }
  const selectedDesigns = selectedDesignIds
    .map((id) => availableDesigns.get(id))
    .filter((design): design is Design => Boolean(design));
  const pairing = pairDesigns(selectedDesigns);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      setLoading(true);
      try {
        if (!draft?.storeId) {
          setDesigns([]);
          return;
        }

        const params = new URLSearchParams({
          limit: String(MAX_WIZARD_DESIGNS),
          storeId: draft.storeId,
        });
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
  }, [search, draft?.storeId]);

  function handleToggleDesign(designId: string) {
    const selected = getDraftDesignIdsFromDraft(useWizardStore.getState().draft);
    const isSelected = selected.includes(designId);
    const next = isSelected
      ? selected.filter((id) => id !== designId)
      : selected.length >= MAX_WIZARD_DESIGNS
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
        Chọn Design ({selectedDesignIds.length}/{MAX_WIZARD_DESIGNS} đã chọn)
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Chọn tối đa 40 cặp sáng/tối. Mỗi listing dùng 1 design sáng và 1 design tối.
      </p>

      {!draft?.storeId && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <p style={{ fontWeight: 700, margin: 0 }}>Chọn store trước</p>
          <p style={{ opacity: 0.55, fontSize: "0.85rem", margin: "4px 0 0" }}>
            Design trong wizard chỉ lấy từ store đã chọn ở Step 1.
          </p>
        </div>
      )}

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

      {selectedDesigns.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <p style={{ fontWeight: 700, margin: 0 }}>Cặp sáng/tối</p>
              <p style={{ opacity: 0.5, fontSize: "0.78rem", margin: "3px 0 0" }}>
                {pairing.pairs.length} listing hợp lệ
              </p>
            </div>
            {pairing.unpaired.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#b45309", fontSize: "0.78rem", fontWeight: 700 }}>
                <AlertTriangle size={15} />
                Cần ghép đủ trước khi qua bước tiếp theo
              </div>
            )}
          </div>

          {pairing.pairs.length > 0 && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {pairing.pairs.map((pair) => (
                <div
                  key={`${pair.lightDesignId}:${pair.darkDesignId}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                    gap: 8,
                    padding: 10,
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: "0.7rem", opacity: 0.5, margin: 0 }}>Sáng · {pair.baseName}</p>
                    <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: "3px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {pair.lightDesignName}
                    </p>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: "0.7rem", opacity: 0.5, margin: 0 }}>Tối · {pair.baseName}</p>
                    <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: "3px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {pair.darkDesignName}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pairing.unpaired.length > 0 && (
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              {pairing.unpaired.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(180, 83, 9, 0.08)",
                    color: "#92400e",
                    fontSize: "0.78rem",
                    fontWeight: 650,
                  }}
                >
                  {item.name}
                </div>
              ))}
            </div>
          )}
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
            const isDisabled = !isSelected && selectedDesignIds.length >= MAX_WIZARD_DESIGNS;
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

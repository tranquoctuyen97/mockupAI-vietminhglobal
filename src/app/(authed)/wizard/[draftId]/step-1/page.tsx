"use client";

import { useState, useEffect, useCallback } from "react";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import { Image as ImageIcon, Check, Loader2, Search } from "lucide-react";

interface Design {
  id: string;
  name: string;
  previewUrl: string | null;
  width: number;
  height: number;
}

export default function Step1DesignPage() {
  const { draft, updateDraft } = useWizardStore();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchDesigns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search) params.set("q", search);
      const res = await fetch(`/api/designs?${params}`);
      const data = await res.json();
      if (res.ok) setDesigns(data.designs);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchDesigns();
  }, [fetchDesigns]);

  function handleSelect(designId: string) {
    updateDraft({ designId });
  }

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Chọn Design
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Chọn 1 design từ thư viện để sử dụng
      </p>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search
          size={16}
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }}
        />
        <input
          type="text"
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
          {designs.map((d) => {
            const isSelected = draft?.designId === d.id;
            return (
              <div
                key={d.id}
                onClick={() => handleSelect(d.id)}
                className="card"
                style={{
                  padding: 0,
                  overflow: "hidden",
                  cursor: "pointer",
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
                  {d.previewUrl ? (
                    <img
                      src={d.previewUrl}
                      alt={d.name}
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
                    {d.name}
                  </p>
                  <p style={{ fontSize: "0.7rem", opacity: 0.4, margin: "2px 0 0" }}>
                    {d.width}×{d.height}
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

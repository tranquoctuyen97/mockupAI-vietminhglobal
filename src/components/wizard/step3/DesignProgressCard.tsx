"use client";

import { useEffect, useState } from "react";
import NextImage from "next/image";
import { Image as ImageIcon } from "lucide-react";

type DesignJobState = {
  jobId: string;
  draftDesignId: string | null;
  designId: string;
  designName: string;
  status: string;
  completed: number;
  total: number;
  failed: number;
  errorMessage: string | null;
};

type SelectedDesign = {
  id: string;
  designId: string;
  design?: { name?: string | null } | null;
};

type Props = {
  designs: SelectedDesign[];
  jobsByDesignId: Map<string, DesignJobState>;
  activeDraftDesignId: string | null;
  onSelectDesign: (id: string) => void;
  designPreviewUrls: Record<string, string | null>;
  generationStartedAt: number | null;
  isCustomTemplate: boolean;
};

export function DesignProgressCard({
  designs,
  jobsByDesignId,
  activeDraftDesignId,
  onSelectDesign,
  designPreviewUrls,
  generationStartedAt,
  isCustomTemplate,
}: Props) {
  const [elapsed, setElapsed] = useState(0);

  // Tick elapsed counter while generating
  useEffect(() => {
    if (!generationStartedAt) { setElapsed(0); return; }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - generationStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [generationStartedAt]);

  if (designs.length === 0) return null;

  const overallCompleted = Array.from(jobsByDesignId.values()).reduce((sum, j) => sum + j.completed, 0);
  const overallTotal = Array.from(jobsByDesignId.values()).reduce((sum, j) => sum + j.total, 0);
  const isGenerating = generationStartedAt !== null;

  const estimatedSeconds = designs.length * 15;

  const statusLabel = (status: string) => {
    if (status === "completed") return "Hoàn tất";
    if (status === "failed") return "Lỗi";
    if (status === "running") return isCustomTemplate ? "Đang ghép ảnh" : "Đang render";
    return "Đang chờ";
  };

  return (
    <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3" style={{ minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontWeight: 700, margin: 0, fontSize: "0.95rem" }}>
            {designs.length} design{designs.length > 1 ? "s" : ""}
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
            {isGenerating
              ? isCustomTemplate
                ? `Đang ghép ảnh custom · ${elapsed}s${elapsed < estimatedSeconds ? ` / ~${estimatedSeconds}s ước tính` : ""}`
                : `Printify đang render · ${elapsed}s${elapsed < estimatedSeconds ? ` / ~${estimatedSeconds}s ước tính` : ""}`
              : "Chọn design để xem mockup theo từng listing."}
          </p>
        </div>
        {overallTotal > 0 && (
          <span className="badge badge-success" style={{ flexShrink: 0, fontSize: "0.65rem" }}>
            {overallCompleted}/{overallTotal} ảnh
          </span>
        )}
      </div>

      {/* Design tabs (only shown when >1 design) */}
      {designs.length > 1 && (
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          {designs.map((entry, index) => {
            const state = jobsByDesignId.get(entry.id);
            const isActive = entry.id === activeDraftDesignId || (!activeDraftDesignId && index === 0);
            const thumbUrl = designPreviewUrls[entry.designId] ?? null;
            const label = entry.design?.name ?? `Design ${index + 1}`;
            return (
              <button
                key={entry.id}
                type="button"
                className={isActive ? "btn btn-primary" : "btn btn-secondary"}
                onClick={() => onSelectDesign(entry.id)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 42, padding: "6px 10px", flexShrink: 0 }}
              >
                <span
                  style={{
                    width: 24, height: 24, borderRadius: 6, overflow: "hidden",
                    backgroundColor: "var(--bg-tertiary)", display: "inline-flex",
                    alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}
                >
                  {thumbUrl ? (
                    <NextImage
                      src={thumbUrl}
                      alt=""
                      width={24}
                      height={24}
                      style={{ objectFit: "cover", width: "100%", height: "100%" }}
                    />
                  ) : (
                    <ImageIcon size={12} style={{ opacity: 0.35 }} />
                  )}
                </span>
                <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {label}
                </span>
                {state?.status && (
                  <span className="badge" style={{ fontSize: "0.62rem", opacity: 0.8 }}>
                    {statusLabel(state.status)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Per-design progress bars */}
      {jobsByDesignId.size > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {designs.map((entry, index) => {
            const state = jobsByDesignId.get(entry.id);
            if (!state) return null;
            const total = state.total ?? 0;
            const completed = state.completed ?? 0;
            const failed = state.failed ?? 0;
            const percent = total > 0
              ? Math.min(100, Math.round((completed / total) * 100))
              : state.status === "failed" ? 100 : 0;
            const label = entry.design?.name ?? `Design ${index + 1}`;
            return (
              <div key={entry.id} style={{ display: "grid", gap: 6 }}>
                <div className="flex items-center justify-between gap-3" style={{ minWidth: 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: "0.82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {label}
                    </strong>
                    <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55 }}>
                      {statusLabel(state.status)}
                      {total > 0 ? ` · ${completed}/${total} ảnh` : ""}
                      {failed > 0 ? ` · ${failed} lỗi` : ""}
                    </p>
                  </div>
                  {state.errorMessage && (
                    <span style={{ fontSize: "0.72rem", color: "var(--color-danger, #dc2626)", maxWidth: 220, textAlign: "right" }}>
                      {state.errorMessage}
                    </span>
                  )}
                </div>
                <div style={{ height: 8, borderRadius: 999, backgroundColor: "var(--bg-tertiary)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${percent}%`,
                      height: "100%",
                      backgroundColor: state.status === "failed" ? "var(--color-danger, #dc2626)" : "var(--color-wise-green)",
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

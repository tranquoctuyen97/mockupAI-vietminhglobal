"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import {
  ClipboardCheck,
  CheckCircle2,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Lock,
} from "lucide-react";

interface AiContent {
  title: string;
  description: string;
  tags: string[];
  altText: string;
}

interface MockupJob {
  id: string;
  colorName: string;
  colorHex: string;
  status: string;
  mockupStoragePath: string | null;
}

export default function Step6ReviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const { draft } = useWizardStore();

  const aiContent = (draft?.aiContent as AiContent | null) || null;
  const jobs = (draft?.mockupJobs || []) as MockupJob[];
  const succeededJobs = jobs.filter((j) => j.status === "SUCCEEDED");
  const colors = (draft?.selectedColors as Array<{ title: string; hex: string }>) || [];

  const [price, setPrice] = useState("24.99");
  const [carouselIdx, setCarouselIdx] = useState(0);

  // Fetch pricing template
  useEffect(() => {
    if (!draft?.productType) return;
    (async () => {
      try {
        const res = await fetch("/api/admin/pricing-templates");
        const data = await res.json();
        if (res.ok && data.templates) {
          const match = data.templates.find(
            (t: { productType: string; basePriceUsd: number }) =>
              t.productType === draft.productType,
          );
          if (match) setPrice(match.basePriceUsd.toFixed(2));
        }
      } catch {
        // ignore
      }
    })();
  }, [draft?.productType]);

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Review
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 24px" }}>
        Tổng hợp và kiểm tra trước khi publish
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Left: Mockup carousel */}
        <div>
          <div
            className="card"
            style={{
              aspectRatio: "1/1",
              backgroundColor: succeededJobs[carouselIdx]?.colorHex || "var(--bg-tertiary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              overflow: "hidden",
              maxHeight: 400,
            }}
          >
            {succeededJobs.length > 0 && succeededJobs[carouselIdx]?.mockupStoragePath ? (
              <img
                src={succeededJobs[carouselIdx].mockupStoragePath!}
                alt={succeededJobs[carouselIdx].colorName}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <ImageIcon size={48} style={{ opacity: 0.2 }} />
            )}

            {/* Carousel controls */}
            {succeededJobs.length > 1 && (
              <>
                <button
                  onClick={() =>
                    setCarouselIdx((i) =>
                      i === 0 ? succeededJobs.length - 1 : i - 1,
                    )
                  }
                  style={{
                    position: "absolute",
                    left: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "rgba(0,0,0,0.5)",
                    border: "none",
                    borderRadius: "50%",
                    width: 32,
                    height: 32,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "white",
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() =>
                    setCarouselIdx((i) =>
                      i === succeededJobs.length - 1 ? 0 : i + 1,
                    )
                  }
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "rgba(0,0,0,0.5)",
                    border: "none",
                    borderRadius: "50%",
                    width: 32,
                    height: 32,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "white",
                  }}
                >
                  <ChevronRight size={16} />
                </button>
                <div
                  style={{
                    position: "absolute",
                    bottom: 8,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "rgba(0,0,0,0.5)",
                    color: "white",
                    fontSize: "0.7rem",
                    padding: "3px 10px",
                    borderRadius: 12,
                  }}
                >
                  {carouselIdx + 1} / {succeededJobs.length}
                </div>
              </>
            )}
          </div>

          {/* Thumbnails */}
          {succeededJobs.length > 1 && (
            <div
              className="flex gap-2"
              style={{ marginTop: 8, overflowX: "auto" }}
            >
              {succeededJobs.map((job, idx) => (
                <div
                  key={job.id}
                  onClick={() => setCarouselIdx(idx)}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: job.colorHex,
                    border:
                      idx === carouselIdx
                        ? "2px solid var(--color-wise-green)"
                        : "1px solid var(--border-default)",
                    cursor: "pointer",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  {job.mockupStoragePath && (
                    <img
                      src={job.mockupStoragePath}
                      alt={job.colorName}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Content summary */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Title */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: "0.8rem",
                opacity: 0.5,
                display: "block",
                marginBottom: 4,
              }}
            >
              Title
            </label>
            <p style={{ fontWeight: 700, fontSize: "1rem", margin: 0 }}>
              {aiContent?.title || (
                <span style={{ opacity: 0.3 }}>Chưa tạo nội dung</span>
              )}
            </p>
          </div>

          {/* Description preview */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: "0.8rem",
                opacity: 0.5,
                display: "block",
                marginBottom: 4,
              }}
            >
              Description
            </label>
            {aiContent?.description ? (
              <div
                style={{
                  fontSize: "0.85rem",
                  lineHeight: 1.5,
                  maxHeight: 120,
                  overflow: "auto",
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-tertiary)",
                  borderRadius: "var(--radius-sm)",
                }}
                dangerouslySetInnerHTML={{ __html: aiContent.description }}
              />
            ) : (
              <p style={{ opacity: 0.3, fontSize: "0.85rem", margin: 0 }}>
                Chưa có description
              </p>
            )}
          </div>

          {/* Tags */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: "0.8rem",
                opacity: 0.5,
                display: "block",
                marginBottom: 4,
              }}
            >
              Tags
            </label>
            {aiContent?.tags && aiContent.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {aiContent.tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "3px 8px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-tertiary)",
                      fontSize: "0.75rem",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ opacity: 0.3, fontSize: "0.85rem", margin: 0 }}>
                Chưa có tags
              </p>
            )}
          </div>

          {/* Price */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: "0.8rem",
                opacity: 0.5,
                display: "block",
                marginBottom: 4,
              }}
            >
              Price (USD)
            </label>
            <input
              type="number"
              className="input"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              step="0.01"
              min="0"
              style={{ maxWidth: 160 }}
            />
          </div>

          {/* Summary card */}
          <div
            className="card"
            style={{
              padding: "12px 16px",
              backgroundColor: "var(--bg-tertiary)",
              fontSize: "0.8rem",
            }}
          >
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <CheckCircle2 size={16} style={{ color: "var(--color-wise-green)" }} />
              <strong>Tổng hợp</strong>
            </div>
            <div style={{ lineHeight: 1.8 }}>
              • Product: {draft?.productType || "—"}
              <br />• Colors: {colors.length} màu
              <br />• Mockups: {succeededJobs.length} ảnh
              <br />• Price: ${price}
            </div>
          </div>

          {/* Publish button — Phase 5 */}
          <button
            className="btn btn-primary"
            disabled
            style={{
              fontSize: "0.9rem",
              padding: "12px 24px",
              opacity: 0.5,
              cursor: "not-allowed",
              width: "100%",
            }}
          >
            <Lock size={16} />
            Publish to Shopify — Coming Soon (Phase 5)
          </button>
        </div>
      </div>
    </div>
  );
}

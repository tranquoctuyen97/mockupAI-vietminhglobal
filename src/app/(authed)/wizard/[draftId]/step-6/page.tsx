"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  ImageOff,
  ChevronLeft,
  ChevronRight,
  Lock,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

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

interface Checklist {
  mockupsMatchColors: boolean;
  contentComplete: boolean;
  placementValid: boolean;
  mockupsNotStale: boolean;
  readyToPublish: boolean;
}

/** Format price consistently as en-US decimal: e.g. "24.99" */
function formatPriceDisplay(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        color: "var(--color-wise-green)",
        fontSize: "0.78rem",
        marginLeft: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        textDecoration: "none",
        opacity: 0.85,
      }}
    >
      {children} <ExternalLink size={10} />
    </a>
  );
}

/** Normalize storage key → browser URL (same pattern as step-4) */
function toPublicUrl(storagePathOrUrl: string): string {
  if (storagePathOrUrl.startsWith("/") || storagePathOrUrl.startsWith("http")) {
    return storagePathOrUrl;
  }
  return `/api/files/${storagePathOrUrl}`;
}

export default function Step6ReviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const { draft, setChecklist } = useWizardStore();

  const aiContent = (draft?.aiContent as AiContent | null) || null;
  const jobs = (draft?.mockupJobs || []) as MockupJob[];
  const succeededJobs = jobs.filter((j) => j.status === "SUCCEEDED");
  const colors = (draft?.selectedColors as Array<{ title: string; hex: string }>) || [];

  // Price — stored as raw decimal string for consistency (Bug #5)
  const [price, setPrice] = useState("24.99");
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [localChecklist, setLocalChecklist] = useState<Checklist | null>(null);

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

  // Fetch checklist from GET draft API (Bug #7)
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const res = await fetch(`/api/wizard/drafts/${draftId}`);
        const data = await res.json();
        if (res.ok && data.checklist) setLocalChecklist(data.checklist);
      } catch {
        // ignore
      }
    })();
  }, [draftId]);

  // Sync checklist to store so layout Tiếp theo button can read it
  useEffect(() => {
    if (localChecklist) setChecklist(localChecklist);
  }, [localChecklist, setChecklist]);

  const step5Url = `/wizard/${draftId}/step-5`;
  const step4Url = `/wizard/${draftId}/step-4`;
  const step3Url = `/wizard/${draftId}/step-3`;

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>Review</h2>
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
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", overflow: "hidden", maxHeight: 400,
            }}
          >
            {succeededJobs.length > 0 && succeededJobs[carouselIdx]?.mockupStoragePath ? (
              <img
                src={toPublicUrl(succeededJobs[carouselIdx].mockupStoragePath!)}
                alt={succeededJobs[carouselIdx].colorName}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : succeededJobs.length === 0 ? (
              // Bug #6: empty state with clear action instead of silent grey icon
              <div style={{ textAlign: "center", padding: "0 24px" }}>
                <ImageOff size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
                <p style={{ fontSize: "0.82rem", opacity: 0.5, margin: "0 0 12px" }}>
                  Chưa có mockup nào.
                  <br />Quay lại bước Mockups để tạo.
                </p>
                <Link
                  href={`/wizard/${draftId}/step-4`}
                  style={{ fontSize: "0.8rem", color: "var(--color-wise-green)", textDecoration: "none" }}
                >
                  Fix ở Mockups →
                </Link>
              </div>
            ) : (
              <ImageIcon size={48} style={{ opacity: 0.2 }} />
            )}

            {succeededJobs.length > 1 && (
              <>
                <button
                  onClick={() => setCarouselIdx((i) => i === 0 ? succeededJobs.length - 1 : i - 1)}
                  style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "white" }}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setCarouselIdx((i) => i === succeededJobs.length - 1 ? 0 : i + 1)}
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "white" }}
                >
                  <ChevronRight size={16} />
                </button>
                <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.5)", color: "white", fontSize: "0.7rem", padding: "3px 10px", borderRadius: 12 }}>
                  {carouselIdx + 1} / {succeededJobs.length}
                </div>
              </>
            )}
          </div>

          {succeededJobs.length > 1 && (
            <div className="flex gap-2" style={{ marginTop: 8, overflowX: "auto" }}>
              {succeededJobs.map((job, idx) => (
                <div
                  key={job.id}
                  onClick={() => setCarouselIdx(idx)}
                  style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", backgroundColor: job.colorHex, border: idx === carouselIdx ? "2px solid var(--color-wise-green)" : "1px solid var(--border-default)", cursor: "pointer", overflow: "hidden", flexShrink: 0 }}
                >
                  {job.mockupStoragePath && (
                    <img src={toPublicUrl(job.mockupStoragePath)} alt={job.colorName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Content summary + checklist */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Title (Bug #6 — inline link) */}
          <div>
            <label style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.5, display: "block", marginBottom: 4 }}>
              Tiêu đề
            </label>
            {aiContent?.title ? (
              <p style={{ fontWeight: 700, fontSize: "1rem", margin: 0 }}>{aiContent.title}</p>
            ) : (
              <p style={{ opacity: 0.35, fontSize: "0.85rem", margin: 0 }}>
                Chưa tạo nội dung
                <InlineLink href={step5Url}>Sửa ở AI Content</InlineLink>
              </p>
            )}
          </div>

          {/* Description (Bug #6) */}
          <div>
            <label style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.5, display: "block", marginBottom: 4 }}>
              Mô tả
            </label>
            {aiContent?.description ? (
              <div
                style={{ fontSize: "0.85rem", lineHeight: 1.5, maxHeight: 120, overflow: "auto", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)" }}
                dangerouslySetInnerHTML={{ __html: aiContent.description }}
              />
            ) : (
              <p style={{ opacity: 0.35, fontSize: "0.85rem", margin: 0 }}>
                Chưa có description
                <InlineLink href={step5Url}>Sửa</InlineLink>
              </p>
            )}
          </div>

          {/* Tags (Bug #6) */}
          <div>
            <label style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.5, display: "block", marginBottom: 4 }}>
              Tags
            </label>
            {aiContent?.tags && aiContent.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {aiContent.tags.map((tag) => (
                  <span key={tag} style={{ padding: "3px 8px", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-tertiary)", fontSize: "0.75rem" }}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ opacity: 0.35, fontSize: "0.85rem", margin: 0 }}>
                Chưa có tags
                <InlineLink href={step5Url}>Thêm tags</InlineLink>
              </p>
            )}
          </div>

          {/* Price — Bug #5: force en-US decimal, consistent format */}
          <div>
            <label style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.5, display: "block", marginBottom: 4 }}>
              Giá (USD)
            </label>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: "0.85rem", opacity: 0.6 }}>$</span>
              <input
                type="text"
                className="input"
                value={price}
                onChange={(e) => {
                  // Only allow digits and one decimal point with max 2 decimal places
                  const v = e.target.value;
                  if (/^\d*\.?\d{0,2}$/.test(v)) setPrice(v);
                }}
                placeholder="24.99"
                style={{ maxWidth: 120 }}
                aria-label="Giá sản phẩm USD"
              />
            </div>
          </div>

          {/* Summary card */}
          <div className="card" style={{ padding: "12px 16px", backgroundColor: "var(--bg-tertiary)", fontSize: "0.8rem" }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <ClipboardCheck size={16} style={{ color: "var(--color-wise-green)" }} />
              <strong>Tổng hợp</strong>
            </div>
            <div style={{ lineHeight: 1.8 }}>
              • Product: {draft?.productType || "—"}
              <br />• Colors: {colors.length} màu
              <br />• Mockups: {succeededJobs.length} ảnh
              {/* Bug #5: show consistent en-US format */}
              <br />• Price: ${formatPriceDisplay(price)}
            </div>
          </div>

          {/* Pre-publish checklist (Bug #7) */}
          {localChecklist && (
            <div className="card" style={{ padding: "12px 16px", fontSize: "0.82rem" }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                <ClipboardCheck size={14} style={{ opacity: 0.5 }} />
                <span style={{ fontWeight: 600 }}>Kiểm tra trước khi Publish</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <ChecklistItem ok={localChecklist.mockupsMatchColors} label={`Mockup khớp số màu (${succeededJobs.length}/${colors.length})`} linkLabel="Fix ở Mockups" linkHref={step4Url} />
                <ChecklistItem ok={localChecklist.contentComplete}     label="Nội dung đầy đủ (title, description, tags)" linkLabel="Fix ở Content" linkHref={step5Url} />
                <ChecklistItem ok={localChecklist.placementValid}      label="Placement hợp lệ" linkLabel="Fix ở Placement" linkHref={step3Url} />
                <ChecklistItem ok={localChecklist.mockupsNotStale}     label="Mockup cập nhật (không bị outdated)" linkLabel="Tạo lại" linkHref={step4Url} />
              </div>
            </div>
          )}

          {/* Publish button */}
          <button
            className="btn btn-primary"
            disabled={localChecklist ? !localChecklist.readyToPublish : true}
            title={localChecklist && !localChecklist.readyToPublish ? "Hoàn tất checklist để Publish" : undefined}
            style={{
              fontSize: "0.9rem", padding: "12px 24px", width: "100%",
              opacity: localChecklist && !localChecklist.readyToPublish ? 0.5 : 1,
              cursor: localChecklist && !localChecklist.readyToPublish ? "not-allowed" : "pointer",
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

// ── ChecklistItem ────────────────────────────────────────────────────────────

function ChecklistItem({
  ok, label, linkLabel, linkHref,
}: { ok: boolean; label: string; linkLabel: string; linkHref: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok
        ? <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)", flexShrink: 0 }} />
        : <XCircle size={14} style={{ color: "var(--color-error)", flexShrink: 0 }} />}
      <span style={{ flex: 1, opacity: ok ? 0.8 : 1 }}>{label}</span>
      {!ok && (
        <a href={linkHref} style={{ fontSize: "0.75rem", color: "var(--color-wise-green)", textDecoration: "none", whiteSpace: "nowrap" }}>
          {linkLabel} →
        </a>
      )}
    </div>
  );
}

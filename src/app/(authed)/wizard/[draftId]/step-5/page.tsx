"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import { viewLabel } from "@/lib/placement/views";
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  ImageOff,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Play,
  RefreshCcw
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface AiContent {
  title: string;
  description: string;
  tags: string[];
  altText: string;
}

interface SizeOption {
  size: string;
  costCents: number;
  costDeltaCents: number;
}

interface MockupJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  totalImages?: number;
  completedImages?: number;
  failedImages?: number;
  images?: MockupImage[];
}

interface MockupImage {
  id: string;
  printifyMockupId?: string;
  variantId?: number;
  colorName: string;
  viewPosition: string;
  sourceUrl: string;
  compositeUrl: string | null;
  compositeStatus: string;
  included: boolean;
  isDefault?: boolean;
  cameraLabel?: string | null;
  mockupType?: string | null;
  sortOrder?: number;
}

interface StoreColor {
  id: string;
  name: string;
  hex: string;
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
function toPublicUrl(storagePathOrUrl: string | null | undefined): string | null {
  if (!storagePathOrUrl || storagePathOrUrl.startsWith("mockup://")) {
    return null;
  }

  if (
    storagePathOrUrl.startsWith("/") ||
    storagePathOrUrl.startsWith("http://") ||
    storagePathOrUrl.startsWith("https://") ||
    storagePathOrUrl.startsWith("data:")
  ) {
    return storagePathOrUrl;
  }
  return `/api/files/${storagePathOrUrl.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeColorName(value: string): string {
  return value.trim().toLowerCase();
}

function isRealPrintifyMockup(image: MockupImage): boolean {
  const url = image.compositeUrl ?? image.sourceUrl;
  if (!url || !/^https?:\/\//i.test(url)) return false;
  return !url.includes("via.placeholder.com");
}

export default function Step6ReviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const { draft, setDraft, setChecklist } = useWizardStore();

  const aiContent = (draft?.aiContent as AiContent | null) || null;
  const mockupJobs = (draft?.mockupJobs || []) as MockupJob[];
  const storeColors = ((draft?.store?.colors ?? []) as StoreColor[]);
  const selectedColorIds = new Set(draft?.enabledColorIds ?? []);
  const colors = storeColors.filter((color) => selectedColorIds.has(color.id));
  const colorHexLookup = useMemo(
    () => new Map(colors.map((color) => [color.name.toLowerCase(), color.hex])),
    [colors],
  );
  const allMockups = useMemo(
    () => mockupJobs
      .filter((job) => job.status === "completed")
      .flatMap((job) => job.images ?? [])
      .filter((image) =>
        image.included &&
        isRealPrintifyMockup(image) &&
        colorHexLookup.has(normalizeColorName(image.colorName)),
      ), // Only show real Printify mockups for selected colors
    [mockupJobs, colorHexLookup],
  );
  const latestMockupJob = mockupJobs[mockupJobs.length - 1] ?? null;
  const isPrintifyRendering = latestMockupJob?.status === "running" || latestMockupJob?.status === "pending";
  const hasPrintifyFailure = latestMockupJob?.status === "failed";
  const emptyMockupState = isPrintifyRendering
    ? {
        title: "Printify đang render mockups.",
        body: "Ảnh thật có thể mất vài phút. Quay lại bước Mockups để theo dõi tiến trình.",
        action: "Theo dõi Mockups →",
      }
    : hasPrintifyFailure
      ? {
          title: "Printify tạo mockup lỗi.",
          body: "Hãy tạo lại mockup hoặc kiểm tra cấu hình store/Printify trước khi publish.",
          action: "Tạo lại Mockups →",
        }
      : {
          title: "Chưa có mockup Printify thật.",
          body: "Quay lại bước Mockups để tạo ảnh thật trước khi publish Shopify.",
          action: "Tạo Mockups →",
        };
  const colorsWithMockup = useMemo(
    () => new Set(allMockups.map((image) => normalizeColorName(image.colorName))),
    [allMockups],
  );
  const selectedMockupColorCount = useMemo(
    () => colors.filter((color) => colorsWithMockup.has(normalizeColorName(color.name))).length,
    [colors, colorsWithMockup],
  );

  // Fetch pricing template and base state
  const [price, setPrice] = useState("24.99");
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [localChecklist, setLocalChecklist] = useState<Checklist | null>(null);

  // Publish state
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<"IDLE" | "PUBLISHING" | "SUCCESS" | "ERROR">("IDLE");
  const [publishLogs, setPublishLogs] = useState<{stage: string, message: string, status?: string}[]>([]);
  const [failedListingId, setFailedListingId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Fetch pricing template & store sizes
  useEffect(() => {
    const productType = draft?.store?.template?.blueprintTitle ?? draft?.productType;
    if (productType) {
      fetch("/api/admin/pricing-templates")
        .then(r => r.json())
        .then(data => {
          if (data.templates) {
            const match = data.templates.find((t: any) => t.productType === productType);
            if (match) setPrice(match.basePriceUsd.toFixed(2));
          }
        }).catch(() => {});
    }

    if (draft?.storeId) {
      fetch(`/api/stores/${draft.storeId}/sizes`)
        .then(r => r.json())
        .then(data => {
          if (data.sizes) setSizes(data.sizes);
        }).catch(() => {});
    }
  }, [draft?.productType, draft?.store?.template?.blueprintTitle, draft?.storeId]);

  // Fetch checklist from GET draft API (Bug #7)
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const res = await fetch(`/api/wizard/drafts/${draftId}`);
        const data = await res.json();
        if (res.ok) {
          const { checklist, ...freshDraft } = data;
          setDraft(freshDraft);
          if (checklist) setLocalChecklist(checklist);
        }
      } catch {
        // ignore
      }
    })();
  }, [draftId, setDraft]);

  // Sync checklist to store so layout Tiếp theo button can read it
  useEffect(() => {
    if (localChecklist) setChecklist(localChecklist);
  }, [localChecklist, setChecklist]);

  useEffect(() => {
    if (carouselIdx >= allMockups.length) {
      setCarouselIdx(0);
    }
  }, [allMockups.length, carouselIdx]);

  const step4Url = `/wizard/${draftId}/step-4`;
  const step3Url = `/wizard/${draftId}/step-3`;
  const currentMockup = allMockups[carouselIdx] ?? null;
  const currentMockupUrl = currentMockup
    ? toPublicUrl(currentMockup.compositeUrl ?? currentMockup.sourceUrl)
    : null;
  const currentMockupColorHex = currentMockup
    ? colorHexLookup.get(normalizeColorName(currentMockup.colorName)) ?? "var(--bg-tertiary)"
    : "var(--bg-tertiary)";

  async function handlePublish() {
    if (!localChecklist?.readyToPublish) return;
    setPublishing(true);
    setPublishStatus("PUBLISHING");
    setPublishLogs([
      { stage: "INIT", message: "Bắt đầu publish...", status: "pending" }
    ]);

    // Setup SSE connection
    const evtSource = new EventSource(`/api/wizard/drafts/${draftId}/events`);
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "publish.shopify.start" || data.type === "publish.printify.start") {
          setPublishLogs(prev => [...prev, { stage: data.data.stage, message: `Đang xử lý ${data.data.stage}...`, status: "pending" }]);
        }
        if (data.type === "publish.shopify.done") {
          setPublishLogs(prev => [...prev, { stage: "SHOPIFY", message: "Đã publish lên Shopify", status: "success" }]);
        }
        if (data.type === "publish.complete") {
          if (data.data.status === "ACTIVE") {
            setPublishStatus("SUCCESS");
            setPublishLogs(prev => [...prev, { stage: "DONE", message: "Publish hoàn tất!", status: "success" }]);
            toast.success("Publish thành công!");
          } else {
            setPublishStatus("ERROR");
            if (data.data.listingId) setFailedListingId(data.data.listingId);
            setPublishLogs(prev => [...prev, { stage: "ERROR", message: data.data.reason || "Có lỗi xảy ra", status: "error" }]);
            toast.error(data.data.reason || "Có lỗi xảy ra");
          }
          evtSource.close();
        }
        if (data.type === "publish.failed") {
          setPublishStatus("ERROR");
          setPublishLogs(prev => [...prev, { stage: "ERROR", message: data.data.error || "Có lỗi xảy ra khi publish", status: "error" }]);
          toast.error(data.data.error || "Có lỗi xảy ra khi publish");
          evtSource.close();
        }
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };
    evtSource.onerror = () => {
      evtSource.close();
      if (publishStatus === "PUBLISHING") {
        setPublishStatus("ERROR");
        toast.error("Mất kết nối server");
      }
    };

    // Call POST API
    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể khởi tạo tiến trình publish");
      }
      if (data.alreadyPublished) {
         if (data.status === "ACTIVE") {
           setPublishStatus("SUCCESS");
           setPublishLogs([{ stage: "DONE", message: "Draft này đã được publish rồi.", status: "success" }]);
           toast.info("Draft này đã được publish rồi.");
         } else if (data.status === "PARTIAL_FAILURE" || data.status === "FAILED") {
           setPublishStatus("ERROR");
           setFailedListingId(data.listingId);
           setPublishLogs([{ stage: "ERROR", message: `Publish trước đó bị lỗi (${data.status}). Nhấn "Thử lại Printify" bên dưới.`, status: "error" }]);
           toast.error(`Publish trước đó bị lỗi: ${data.status}`);
         } else {
           // PUBLISHING state — still in progress
           setPublishLogs([{ stage: "INIT", message: "Đang publish...", status: "pending" }]);
         }
         evtSource.close();
      }
    } catch (e: any) {
      setPublishStatus("ERROR");
      setPublishLogs(prev => [...prev, { stage: "ERROR", message: e.message, status: "error" }]);
      toast.error(e.message);
      evtSource.close();
    }
  }

  async function handleRetryPrintify() {
    if (!failedListingId) return;
    setRetrying(true);
    setPublishStatus("PUBLISHING");
    setPublishLogs([
      { stage: "SHOPIFY", message: "Đã publish lên Shopify (trước đó)", status: "success" },
      { stage: "PRINTIFY", message: "Đang thử lại Printify...", status: "pending" },
    ]);

    // Listen for SSE events
    const evtSource = new EventSource(`/api/wizard/drafts/${draftId}/events`);
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "publish.complete") {
          if (data.data.status === "ACTIVE") {
            setPublishStatus("SUCCESS");
            setPublishLogs(prev => [...prev, { stage: "DONE", message: "Printify publish thành công!", status: "success" }]);
            toast.success("Printify publish thành công!");
          } else {
            setPublishStatus("ERROR");
            setPublishLogs(prev => [...prev, { stage: "ERROR", message: data.data.reason || "Printify vẫn lỗi", status: "error" }]);
            toast.error(data.data.reason || "Printify vẫn lỗi");
          }
          evtSource.close();
          setRetrying(false);
        }
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };
    evtSource.onerror = () => {
      evtSource.close();
      setRetrying(false);
      if (publishStatus === "PUBLISHING") {
        setPublishStatus("ERROR");
        toast.error("Mất kết nối server");
      }
    };

    try {
      const res = await fetch(`/api/listings/${failedListingId}/retry-printify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể retry Printify");
      }
    } catch (e: any) {
      setPublishStatus("ERROR");
      setPublishLogs(prev => [...prev, { stage: "ERROR", message: e.message, status: "error" }]);
      toast.error(e.message);
      evtSource.close();
      setRetrying(false);
    }
  }

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
              backgroundColor: currentMockupColorHex,
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", overflow: "hidden", maxHeight: 400,
            }}
          >
            {currentMockup && currentMockupUrl ? (
              <img
                src={currentMockupUrl}
                alt={`${currentMockup.colorName} - ${viewLabel(currentMockup.viewPosition)}`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : allMockups.length === 0 ? (
              // Bug #6: empty state with clear action instead of silent grey icon
              <div style={{ textAlign: "center", padding: "0 24px" }}>
                {isPrintifyRendering ? (
                  <Loader2 size={36} className="animate-spin" style={{ opacity: 0.45, marginBottom: 12 }} />
                ) : (
                  <ImageOff size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
                )}
                <p style={{ fontSize: "0.82rem", opacity: 0.5, margin: "0 0 12px" }}>
                  {emptyMockupState.title}
                  <br />{emptyMockupState.body}
                </p>
                <Link
                  href={`/wizard/${draftId}/step-3`}
                  style={{ fontSize: "0.8rem", color: "var(--color-wise-green)", textDecoration: "none" }}
                >
                  {emptyMockupState.action}
                </Link>
              </div>
            ) : (
              <ImageIcon size={48} style={{ opacity: 0.2 }} />
            )}

            {currentMockup && (
              <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.55)", color: "white", fontSize: "0.72rem", padding: "4px 10px", borderRadius: 999 }}>
                {currentMockup.colorName} · {viewLabel(currentMockup.viewPosition)}
              </div>
            )}

            {allMockups.length > 1 && (
              <>
                <button
                  onClick={() => setCarouselIdx((i) => i === 0 ? allMockups.length - 1 : i - 1)}
                  style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "white" }}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setCarouselIdx((i) => i === allMockups.length - 1 ? 0 : i + 1)}
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "white" }}
                >
                  <ChevronRight size={16} />
                </button>
                <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)", color: "white", fontSize: "0.7rem", padding: "3px 10px", borderRadius: 12 }}>
                  {carouselIdx + 1} / {allMockups.length}
                </div>
              </>
            )}
          </div>

          {allMockups.length > 1 && (
            <div className="flex gap-2" style={{ marginTop: 8, overflowX: "auto" }}>
              {allMockups.map((mockup, idx) => {
                const thumbnailUrl = toPublicUrl(mockup.compositeUrl ?? mockup.sourceUrl);
                const thumbnailColorHex = colorHexLookup.get(normalizeColorName(mockup.colorName)) ?? "var(--bg-tertiary)";
                return (
                  <div
                    key={mockup.id}
                    onClick={() => setCarouselIdx(idx)}
                    title={`${mockup.colorName} · ${viewLabel(mockup.viewPosition)}`}
                    style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", backgroundColor: thumbnailColorHex, border: idx === carouselIdx ? "2px solid var(--color-wise-green)" : "1px solid var(--border-default)", cursor: "pointer", overflow: "hidden", flexShrink: 0 }}
                  >
                    {thumbnailUrl && (
                      <img src={thumbnailUrl} alt={`${mockup.colorName} ${viewLabel(mockup.viewPosition)}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    )}
                  </div>
                );
              })}
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
                <InlineLink href={step4Url}>Sửa ở AI Content</InlineLink>
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
                <InlineLink href={step4Url}>Sửa</InlineLink>
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
                <InlineLink href={step4Url}>Thêm tags</InlineLink>
              </p>
            )}
          </div>

          {/* Price & Sizes Table */}
          <div>
            <div className="flex items-center gap-4 mb-3">
              <div>
                <label style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.5, display: "block", marginBottom: 4 }}>
                  Base Price (USD)
                </label>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: "0.85rem", opacity: 0.6 }}>$</span>
                  <input
                    type="text"
                    className="input"
                    value={price}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d*\.?\d{0,2}$/.test(v)) setPrice(v);
                    }}
                    placeholder="24.99"
                    style={{ maxWidth: 100 }}
                  />
                </div>
              </div>
            </div>

            {sizes.length > 0 && draft?.enabledSizes && draft.enabledSizes.length > 0 && (
              <div style={{ backgroundColor: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border-default)" }}>
                <table style={{ width: "100%", fontSize: "0.8rem", textAlign: "left", borderCollapse: "collapse" }}>
                  <thead style={{ backgroundColor: "rgba(0,0,0,0.02)", borderBottom: "1px solid var(--border-default)" }}>
                    <tr>
                      <th style={{ padding: "8px 12px", fontWeight: 600, opacity: 0.6 }}>Size</th>
                      <th style={{ padding: "8px 12px", fontWeight: 600, opacity: 0.6 }}>Cost</th>
                      <th style={{ padding: "8px 12px", fontWeight: 600, opacity: 0.6 }}>Retail Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sizes.filter(s => draft.enabledSizes?.includes(s.size)).map((s, i) => {
                      const baseVal = parseFloat(price) || 0;
                      const retail = baseVal + (s.costDeltaCents / 100);
                      return (
                        <tr key={s.size} style={{ borderBottom: i === draft.enabledSizes!.length - 1 ? "none" : "1px solid var(--border-default)" }}>
                          <td style={{ padding: "8px 12px", fontWeight: 500 }}>{s.size}</td>
                          <td style={{ padding: "8px 12px", opacity: 0.7 }}>${(s.costCents / 100).toFixed(2)}</td>
                          <td style={{ padding: "8px 12px", fontWeight: 600 }}>${retail.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary card */}
          <div className="card" style={{ padding: "12px 16px", backgroundColor: "var(--bg-tertiary)", fontSize: "0.8rem" }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <ClipboardCheck size={16} style={{ color: "var(--color-wise-green)" }} />
              <strong>Tổng hợp</strong>
            </div>
            <div style={{ lineHeight: 1.8 }}>
              • Product: {draft?.store?.template?.blueprintTitle || draft?.productType || "—"}
              <br />• Colors: {colors.length} màu
              <br />• Sizes: {draft?.enabledSizes?.length || 0} size
              <br />• Mockups: {allMockups.length} ảnh đã chọn
              <br />• Base Price: ${formatPriceDisplay(price)}
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
                <ChecklistItem ok={localChecklist.mockupsMatchColors} label={`Mockup khớp số màu (${selectedMockupColorCount}/${colors.length})`} linkLabel="Fix ở Mockups" linkHref={step3Url} />
                <ChecklistItem ok={localChecklist.contentComplete}     label="Nội dung đầy đủ (title, description, tags)" linkLabel="Fix ở Content" linkHref={step4Url} />
                <ChecklistItem ok={localChecklist.placementValid}      label="Placement hợp lệ" linkLabel="Fix ở Placement" linkHref={step3Url} />
                <ChecklistItem ok={localChecklist.mockupsNotStale}     label="Mockup cập nhật (không bị outdated)" linkLabel="Tạo lại" linkHref={step3Url} />
              </div>
            </div>
          )}

          {/* Publish button & Progress */}
          {publishStatus !== "IDLE" && (
            <div className="card" style={{ padding: "16px", marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>Tiến trình Publish</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {publishLogs.map((log, i) => (
                  <div key={i} className="flex items-center gap-2" style={{ fontSize: "0.85rem" }}>
                    {log.status === "pending" ? (
                      <Loader2 size={14} className="animate-spin text-amber-500" />
                    ) : log.status === "error" ? (
                      <XCircle size={14} className="text-red-500" />
                    ) : (
                      <CheckCircle2 size={14} className="text-green-500" />
                    )}
                    <span style={{ opacity: log.status === "pending" ? 0.8 : 1 }}>{log.message}</span>
                  </div>
                ))}
              </div>
              {publishStatus === "SUCCESS" && (
                <div style={{ marginTop: 16 }}>
                  <Link href="/products" className="btn btn-primary" style={{ textDecoration: "none", width: "100%", justifyContent: "center" }}>
                    Xem sản phẩm
                  </Link>
                </div>
              )}
              {publishStatus === "ERROR" && failedListingId && (
                <button
                  className="btn btn-primary"
                  onClick={handleRetryPrintify}
                  disabled={retrying}
                  style={{
                    fontSize: "0.85rem",
                    padding: "10px 20px",
                    width: "100%",
                    marginTop: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    background: "var(--color-wise-green)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    cursor: retrying ? "not-allowed" : "pointer",
                    opacity: retrying ? 0.6 : 1,
                  }}
                >
                  {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                  Thử lại Printify
                </button>
              )}
            </div>
          )}

          {publishStatus === "IDLE" && (
            <button
              className="btn btn-primary"
              onClick={handlePublish}
              disabled={localChecklist ? !localChecklist.readyToPublish || publishing : true}
              title={localChecklist && !localChecklist.readyToPublish ? "Hoàn tất checklist để Publish" : undefined}
              style={{
                fontSize: "0.9rem", padding: "12px 24px", width: "100%",
                opacity: localChecklist && !localChecklist.readyToPublish ? 0.5 : 1,
                cursor: localChecklist && !localChecklist.readyToPublish ? "not-allowed" : "pointer",
              }}
            >
              {publishing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              Publish to Shopify & Printify
            </button>
          )}

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

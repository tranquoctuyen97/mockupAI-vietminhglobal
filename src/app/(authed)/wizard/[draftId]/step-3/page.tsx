"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import { pickLatestMockupJobId } from "@/lib/mockup/latest-job";
import { shouldSyncFinishedMockupJob } from "@/lib/mockup/job-sync";
import { MockupGallery } from "@/components/mockup/MockupGallery";
import { MultiViewPlacementEditor } from "@/components/placement/MultiViewPlacementEditor";
import { LivePreview } from "@/components/mockup/LivePreview";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  Image as ImageIcon,
  CheckSquare,
  Square,
  ArrowUpCircle,
  SlidersHorizontal,
  X,
  Ruler,
} from "lucide-react";
import type { PlacementData, ViewKey } from "@/lib/placement/types";
import {
  formatPlacementViewCount,
  formatPlacementViewDetails,
  getEnabledViews,
  getPlacementForView,
  normalizePlacementData,
} from "@/lib/placement/views";

function isRealPrintifyMockupImage(image: { compositeUrl?: string | null; sourceUrl?: string | null }): boolean {
  const url = image.compositeUrl ?? image.sourceUrl;
  if (!url || !/^https?:\/\//i.test(url)) return false;
  return !url.includes("via.placeholder.com");
}

export default function Step3PreviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const router = useRouter();
  const { draft, updateDraft, saveDraftImmediately, loadDraft } = useWizardStore();

  const [loading, setLoading] = useState(true);
  const [storeColors, setStoreColors] = useState<any[]>([]);
  const [template, setTemplate] = useState<any>(null);
  const [presetStatus, setPresetStatus] = useState<any>(null);
  const [designPreviewUrl, setDesignPreviewUrl] = useState<string | null>(null);
  const [previewColorIdx, setPreviewColorIdx] = useState(0);
  const [livePreviewView, setLivePreviewView] = useState<ViewKey>("front");

  // Local state for UI
  const [selectedColorIds, setSelectedColorIds] = useState<Set<string>>(new Set());
  const [placementOverride, setPlacementOverride] = useState<PlacementData | null>(null);
  const [isPlacementEditorOpen, setIsPlacementEditorOpen] = useState(false);

  // Generating state
  const [generating, setGenerating] = useState(false);
  const [mockupJobId, setMockupJobId] = useState<string | null>(null);
  const [mockupImages, setMockupImages] = useState<any[]>([]);
  const [jobProgress, setJobProgress] = useState({ completed: 0, total: 0, failed: 0 });

  // Size selection state
  const [storeSizes, setStoreSizes] = useState<Array<{ size: string; costDeltaCents: number; isAvailable: boolean }>>([]);
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const syncedJobIdsRef = useRef<Set<string>>(new Set());
  const draftEnabledColorKey = (draft?.enabledColorIds ?? []).join("|");
  const draftPlacementOverrideKey = useMemo(
    () => JSON.stringify(draft?.placementOverride ?? null),
    [draft?.placementOverride],
  );

  useEffect(() => {
    if (!draftId) {
      setError("Không tìm thấy draft.");
      setLoading(false);
      return;
    }
    if (draft?.id === draftId) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    loadDraft(draftId)
      .then(() => {
        if (cancelled) return;
        const loadedDraft = useWizardStore.getState().draft;
        if (loadedDraft?.id !== draftId) {
          setError("Không tải được draft. Vui lòng thử lại.");
          setLoading(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("Không tải được draft. Vui lòng thử lại.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draftId, draft?.id, loadDraft]);

  useEffect(() => {
    if (!draft) return;
    const nextSelectedColorIds = new Set(draft.enabledColorIds ?? []);
    setSelectedColorIds((current) => {
      if (
        current.size === nextSelectedColorIds.size &&
        Array.from(current).every((id) => nextSelectedColorIds.has(id))
      ) {
        return current;
      }
      return nextSelectedColorIds;
    });
  }, [draft?.id, draftEnabledColorKey]);

  useEffect(() => {
    if (!draft) return;
    setPlacementOverride((draft.placementOverride as PlacementData | null) ?? null);
  }, [draft?.id, draftPlacementOverrideKey]);

  useEffect(() => {
    if (!draft || draft.id !== draftId) return; // Wait for direct route draft hydration
    if (!draft.storeId) {
      setError("Chưa chọn Store ở bước 1.");
      setLoading(false);
      return;
    }

    setLoading(true);
    // Fetch store template and colors
    Promise.all([
      fetch(`/api/stores/${draft.storeId}/template`).then(r => r.json()),
      fetch(`/api/stores/${draft.storeId}/colors`).then(r => r.json()),
      fetch(`/api/stores/${draft.storeId}/preset-status`).then(r => r.json())
    ]).then(([tData, cData, pData]) => {
      setTemplate(tData.template);
      const enabledColors = (cData.colors || []).filter((c: any) => c.enabled);
      setStoreColors(enabledColors);
      setPresetStatus(pData);

      // Fetch sizes for this store
      if (draft.storeId) {
        fetch(`/api/stores/${draft.storeId}/sizes`)
          .then(async (r) => {
            if (!r.ok) return;
            const sData = await r.json();
            const templateEnabledSizes: string[] = sData.enabledSizes ?? sData.sizes?.map((s: any) => s.size) ?? [];
            setStoreSizes(
              (sData.sizes ?? []).filter((s: any) => templateEnabledSizes.includes(s.size)),
            );
            // Init selectedSizes from draft or default to all enabled
            const draftSizes: string[] = (draft as any)?.enabledSizes ?? [];
            if (draftSizes.length > 0) {
              setSelectedSizes(new Set(draftSizes));
            } else {
              setSelectedSizes(new Set(templateEnabledSizes));
            }
          })
          .catch(() => {});
      }
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setError("Không tải được preset store. Vui lòng thử lại.");
      setLoading(false);
    });
  }, [draft?.id, draft?.storeId, draftId, retryNonce]);

  // Load existing mockups if available
  useEffect(() => {
    if (draft?.mockupJobs && draft.mockupJobs.length > 0) {
      const latestJobId = pickLatestMockupJobId(draft.mockupJobs, mockupJobId);
      if (latestJobId) setMockupJobId(latestJobId);
    }
  }, [draft?.mockupJobs, mockupJobId]);

  // Fetch design preview URL for LivePreview
  useEffect(() => {
    if (!draft?.designId) {
      setDesignPreviewUrl(null);
      return;
    }
    fetch(`/api/designs/${draft.designId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setDesignPreviewUrl(d?.previewUrl ?? d?.originalUrl ?? null))
      .catch(() => setDesignPreviewUrl(null));
  }, [draft?.designId]);

  // Polling mockup job status
  useEffect(() => {
    if (!mockupJobId) return;

    let timeoutId: NodeJS.Timeout;

    const pollJob = async () => {
      try {
        const res = await fetch(`/api/mockup-jobs/${mockupJobId}`);
        if (!res.ok) throw new Error("Failed to fetch job");
        const job = await res.json();

        setJobProgress({
          completed: job.completedImages,
          total: job.totalImages,
          failed: job.failedImages
        });

        setMockupImages(job.images || []);

        if (job.status === "running" || job.status === "pending") {
          setGenerating(true);
          timeoutId = setTimeout(pollJob, 2000);
        } else {
          setGenerating(false);
          if (job.status === "completed" && job.images?.length > 0) {
            toast.success(`Đã tạo ${job.images.length} mockups`);
          } else if (job.status === "failed") {
            setError(job.errorMessage || "Printify tạo mockup lỗi. Vui lòng thử lại.");
          }
          const draftJobStatus = useWizardStore
            .getState()
            .draft?.mockupJobs?.find((draftJob) => draftJob.id === mockupJobId)
            ?.status;
          const alreadySynced = syncedJobIdsRef.current.has(mockupJobId);
          if (
            shouldSyncFinishedMockupJob({
              jobStatus: job.status,
              draftJobStatus,
              alreadySynced,
            })
          ) {
            syncedJobIdsRef.current.add(mockupJobId);
            useWizardStore.getState().loadDraft(draftId as string);
          } else if (!alreadySynced) {
            syncedJobIdsRef.current.add(mockupJobId);
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
        setGenerating(false);
      }
    };

    pollJob();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [mockupJobId, draftId]);

  const toggleColor = (id: string) => {
    const next = new Set(selectedColorIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedColorIds(next);
    updateDraft({ enabledColorIds: Array.from(next) });
  };

  const selectAllColors = () => {
    const next = new Set<string>();
    storeColors.forEach(c => next.add(c.id));
    setSelectedColorIds(next);
    updateDraft({ enabledColorIds: Array.from(next) });
  };

  const deselectAllColors = () => {
    setSelectedColorIds(new Set());
    updateDraft({ enabledColorIds: [] });
  };

  const toggleSize = (size: string) => {
    const next = new Set(selectedSizes);
    if (next.has(size)) next.delete(size);
    else next.add(size);
    setSelectedSizes(next);
    updateDraft({ enabledSizes: Array.from(next) });
  };

  const handleGenerate = async () => {
    if (selectedColorIds.size === 0) {
      setError("Vui lòng chọn ít nhất 1 màu");
      return;
    }

    setGenerating(true);
    setError("");

    // 1. Save state to draft
    const enabledColorIds = Array.from(selectedColorIds);
    await updateDraft({
      enabledColorIds,
      placementOverride: placementOverride || undefined,
    });
    await saveDraftImmediately();

    // 2. Trigger Mockup Generation Job
    try {
      const res = await fetch(`/api/mockup-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "No enabled variants") {
          setError("Store chưa chọn variants. Vui lòng cập nhật Blueprint trong Store Settings.");
        } else {
          setError(data.error || "Không thể tạo mockup");
        }
        setGenerating(false);
      } else {
        setMockupJobId(data.jobId);
      }
    } catch (e) {
      setError("Lỗi kết nối");
      setGenerating(false);
    }
  };

  const retryPageData = async () => {
    setError("");
    setLoading(true);
    if (!draft || draft.id !== draftId) {
      await loadDraft(draftId);
      const loadedDraft = useWizardStore.getState().draft;
      if (loadedDraft?.id !== draftId) {
        setError("Không tải được draft. Vui lòng thử lại.");
        setLoading(false);
      }
      return;
    }
    setRetryNonce((value) => value + 1);
  };

  if (loading) {
    return (
      <div>
        <div style={{ height: 20, width: 180, borderRadius: 6, backgroundColor: "var(--bg-tertiary)", marginBottom: 8 }} className="animate-pulse" />
        <div style={{ height: 14, width: 320, borderRadius: 4, backgroundColor: "var(--bg-tertiary)", marginBottom: 20 }} className="animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card animate-pulse" style={{ height: 280, padding: 16 }} />
            <div className="card animate-pulse" style={{ height: 180, padding: 16 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card animate-pulse" style={{ height: 460, padding: 20 }} />
            <div className="card animate-pulse" style={{ height: 200, padding: 20 }} />
          </div>
        </div>
      </div>
    );
  }

  // Determine active placement (override or default)
  const activePlacement = normalizePlacementData(placementOverride || template?.defaultPlacement, true);
  const placementCountLabel = formatPlacementViewCount(activePlacement);
  const placementDetailLabel = formatPlacementViewDetails(activePlacement);
  const enabledPlacementViews = getEnabledViews(activePlacement);
  const previewPlacementView = enabledPlacementViews.includes(livePreviewView)
    ? livePreviewView
    : enabledPlacementViews[0] ?? "front";
  const placementSourceLabel = placementOverride ? "Đã override cho design này" : "Dùng preset của store";
  const bgColor = storeColors.find((color) => color.enabled !== false)?.hex ?? "#EEEEEE";

  const updatePlacementOverride = (next: PlacementData | null) => {
    const normalized = next ? normalizePlacementData(next, false) : null;
    setPlacementOverride(normalized);
    updateDraft({ placementOverride: normalized });
  };

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Preview & Colors
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Chọn màu sắc và tùy chỉnh vị trí in (nếu cần) trước khi tạo mockup.
      </p>

      {presetStatus && !presetStatus.ready && (
        <div className="alert" style={{ marginBottom: 16, backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
          <div className="flex-1">
            <p style={{ margin: 0, fontWeight: 500 }}>⚠️ Preset chưa hoàn thiện</p>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>Store của bạn còn thiếu: {presetStatus.missing.join(", ")}.</p>
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
            onClick={() => router.push(`/stores/${draft?.storeId}/config`)}
          >
            Đi tới Store Settings →
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <span className="flex-1">{error}</span>
          {(!draft || !template) && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={retryPageData}
              style={{ padding: "5px 10px", fontSize: "0.78rem" }}
            >
              <RefreshCw size={14} /> Thử lại
            </button>
          )}
        </div>
      )}

      {!draft?.designId && (
        <div className="alert" style={{ marginBottom: 16, backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
          <div className="flex-1">
            <p style={{ margin: 0, fontWeight: 500 }}>Chưa có Design</p>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>Bạn cần chọn design ở bước trước để tạo mockup.</p>
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
            onClick={() => document.getElementById('step-nav-2')?.click() || window.history.back()}
          >
            ← Quay lại Design
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">

        {/* LEFT PANEL: COLORS & PLACEMENT */}
        <div className="space-y-6">
          <div className="card" style={{ padding: 16 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
              <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Màu sắc</h3>
              <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>{selectedColorIds.size}/{storeColors.length}</span>
            </div>

            <div className="flex gap-2 mb-4">
              <button className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: "0.75rem", flex: 1 }} onClick={selectAllColors}>Chọn hết</button>
              <button className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: "0.75rem", flex: 1 }} onClick={deselectAllColors}>Bỏ chọn</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
              {storeColors.map(color => (
                <div
                  key={color.id}
                  onClick={() => toggleColor(color.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    borderRadius: "var(--radius-md)",
                    border: selectedColorIds.has(color.id) ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                    backgroundColor: selectedColorIds.has(color.id) ? "rgba(146, 198, 72, 0.05)" : "transparent",
                    cursor: "pointer"
                  }}
                >
                  {selectedColorIds.has(color.id) ? (
                    <CheckSquare size={18} color="var(--color-wise-green)" />
                  ) : (
                    <Square size={18} opacity={0.3} />
                  )}
                  <div style={{ width: 16, height: 16, borderRadius: "50%", backgroundColor: color.hex, border: "1px solid rgba(0,0,0,0.1)" }} />
                  <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>{color.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SIZES PANEL */}
          {storeSizes.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>
                  <Ruler size={14} style={{ display: "inline", marginRight: 6, opacity: 0.5 }} />
                  Kích thước
                </h3>
                <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>{selectedSizes.size}/{storeSizes.length}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {storeSizes.map(s => {
                  const on = selectedSizes.has(s.size);
                  const disabled = !s.isAvailable;
                  return (
                    <button
                      key={s.size}
                      type="button"
                      onClick={() => !disabled && toggleSize(s.size)}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 8,
                        border: on ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                        backgroundColor: disabled ? "rgba(148,163,184,0.08)" : on ? "rgba(159,232,112,0.08)" : "transparent",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.4 : 1,
                        fontSize: "0.8rem",
                        fontWeight: on ? 600 : 400,
                        transition: "all 0.12s",
                      }}
                    >
                      {s.size}
                      {s.costDeltaCents > 0 && (
                        <span style={{ fontSize: "0.65rem", color: "#f59e0b", marginLeft: 3 }}>+${(s.costDeltaCents / 100).toFixed(2)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 16 }}>
            <div className="flex justify-between items-start gap-3" style={{ marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>Vị trí in</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                  {placementSourceLabel}
                </p>
              </div>
              <span
                className="badge badge-success"
                style={{
                  flexShrink: 0,
                  maxWidth: 86,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={placementDetailLabel}
              >
                {placementCountLabel}
              </span>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 5 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: "0.95rem", lineHeight: 1.25 }}>
                  {placementCountLabel}
                </p>
                <p
                  style={{
                    margin: 0,
                    opacity: 0.62,
                    fontSize: "0.75rem",
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}
                  title={placementDetailLabel}
                >
                  {placementDetailLabel}
                </p>
                <p style={{ margin: 0, opacity: 0.5, fontSize: "0.72rem", lineHeight: 1.35 }}>
                  {placementOverride
                    ? "Chỉ áp dụng cho listing hiện tại."
                    : "Đang dùng preset mặc định của store."}
                </p>
              </div>

              <button
                className="btn btn-secondary"
                onClick={() => setIsPlacementEditorOpen(true)}
                style={{
                  width: "100%",
                  fontSize: "0.78rem",
                  padding: "7px 10px",
                  minHeight: 44,
                  whiteSpace: "normal",
                  lineHeight: 1.2,
                }}
              >
                <SlidersHorizontal size={14} /> Điều chỉnh vị trí
              </button>

              <button
                className="btn btn-secondary"
                onClick={() => router.push(`/stores/${draft?.storeId}/config?step=placement`)}
                style={{
                  width: "100%",
                  fontSize: "0.78rem",
                  padding: "7px 10px",
                  minHeight: 44,
                  whiteSpace: "normal",
                  lineHeight: 1.2,
                }}
              >
                Mở preset store
              </button>

              {placementOverride && (
                <button
                  onClick={() => updatePlacementOverride(null)}
                  style={{
                    width: "100%",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    color: "var(--color-wise-green)",
                    fontWeight: 600,
                  }}
                >
                  Khôi phục preset store
                </button>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: LIVE PREVIEW + MOCKUP GALLERY */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Live Preview — Printify-style realistic shirt mockup */}
          {(() => {
            const selectedColors = storeColors.filter(c => selectedColorIds.has(c.id));
            const previewColors = selectedColors; // Don't fallback — require explicit selection
            const previewColor = previewColors[Math.min(previewColorIdx, previewColors.length - 1)];

            // Build per-view placements for LivePreview
            const livePreviewViews = enabledPlacementViews.filter(
              (v): v is Exclude<ViewKey, "hem"> => v !== "hem",
            );
            const placementsByView = Object.fromEntries(
              livePreviewViews.map((v) => [v, getPlacementForView(activePlacement, v)]),
            ) as Partial<Record<Exclude<ViewKey, "hem">, ReturnType<typeof getPlacementForView>>>;
            const selectedLivePreviewView = livePreviewViews.includes(previewPlacementView as Exclude<ViewKey, "hem">)
              ? (previewPlacementView as Exclude<ViewKey, "hem">)
              : livePreviewViews[0] ?? "front";
            const currentPreviewPlacement = getPlacementForView(activePlacement, selectedLivePreviewView)
              ?? getPlacementForView(activePlacement, "front");

            return (
              <div className="card" style={{ padding: 20 }}>
                <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
                  <div>
                    <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>Live Preview</h3>
                    <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55 }}>
                      Mockup tham khảo — chất lượng cuối cùng từ Printify
                    </p>
                  </div>
                  {previewColors.length > 1 && (
                    <div className="flex items-center gap-1" style={{ flexWrap: "wrap" }}>
                      {previewColors.map((c, idx) => (
                        <button
                          key={c.id}
                          onClick={() => setPreviewColorIdx(idx)}
                          aria-label={`Xem màu ${c.name}`}
                          title={c.name}
                          style={{
                            width: 24, height: 24, borderRadius: "50%",
                            backgroundColor: c.hex,
                            border: idx === Math.min(previewColorIdx, previewColors.length - 1)
                              ? "2px solid var(--text-primary, #2a2a2a)"
                              : "1px solid var(--border-default)",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {previewColor && currentPreviewPlacement ? (
                  <LivePreview
                    colorHex={previewColor.hex}
                    designUrl={designPreviewUrl}
                    placement={currentPreviewPlacement}
                    placementsByView={placementsByView}
                    availableViews={livePreviewViews}
                    selectedView={selectedLivePreviewView}
                    onViewChange={(view) => setLivePreviewView(view)}
                    printArea={{ widthMm: 355.6, heightMm: 406.4, safeMarginMm: 12.7 }}
                    height={420}
                  />
                ) : (
                  <div style={{ padding: 40, textAlign: "center", opacity: 0.5 }}>
                    {!draft?.designId ? (
                      <>
                        <ArrowUpCircle size={32} style={{ marginBottom: 8 }} />
                        <p style={{ fontSize: "0.85rem", margin: 0 }}>Chọn design ở bước trước.</p>
                      </>
                    ) : selectedColorIds.size === 0 && storeColors.length === 0 ? (
                      <p style={{ fontSize: "0.85rem", margin: 0 }}>Cấu hình màu ở Store Settings trước.</p>
                    ) : (
                      <p style={{ fontSize: "0.85rem", margin: 0 }}>Chọn màu và bật ít nhất 1 vị trí in để xem preview.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Generate button + Real Mockup Gallery */}
          <div className="card" style={{ padding: 20, minHeight: 200 }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
              <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>Mockup chính thức</h3>
              <button
                className={`btn flex items-center gap-2 px-4 py-2 rounded font-medium ${draft?.designId && !generating && presetStatus?.ready ? 'btn-primary' : ''}`}
                onClick={handleGenerate}
                disabled={generating || !draft?.designId || selectedColorIds.size === 0 || !presetStatus?.ready}
                style={(!draft?.designId || generating || selectedColorIds.size === 0 || !presetStatus?.ready) ? { backgroundColor: "var(--bg-tertiary)", color: "var(--color-text)", opacity: 0.5, cursor: "not-allowed" } : {}}
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {generating
                  ? `Đang tạo... (${jobProgress.completed}/${jobProgress.total || "..."})`
                  : "Tạo Mockups"}
              </button>
            </div>

            {/* Outdated mockup banner */}
            {draft?.mockupsStale && mockupImages.length > 0 && !generating && (
              <div
                className="alert"
                style={{
                  marginBottom: 12,
                  backgroundColor: "rgba(234, 179, 8, 0.06)",
                  border: "1px solid rgba(234, 179, 8, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <AlertTriangle size={16} style={{ color: "var(--color-warning)", flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: "0.82rem" }}>
                  Mockup cũ không khớp placement/màu hiện tại.
                </span>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: "0.75rem", padding: "4px 10px", flexShrink: 0 }}
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  Tạo lại mockup →
                </button>
              </div>
            )}

            {!mockupJobId && !generating ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 0.5, padding: 24 }}>
                <ImageIcon size={32} style={{ marginBottom: 8 }} />
                <p style={{ fontSize: "0.85rem", margin: 0, textAlign: "center" }}>
                  Khi sẵn sàng, nhấn "Tạo Mockups" để render ảnh chất lượng cao từ Printify.
                </p>
              </div>
            ) : (
              <MockupGallery
                draftId={draftId as string}
                images={mockupImages.filter((img) => {
                  const normalizedColorName = img.colorName.trim().toLowerCase();
                  return isRealPrintifyMockupImage(img) && storeColors.some(
                    (c) =>
                      selectedColorIds.has(c.id) &&
                      c.name.trim().toLowerCase() === normalizedColorName
                  );
                })}
                isPolling={generating}
                progress={jobProgress}
                onSelectionChange={async () => {
                  // Refetch mockup images so parent state stays in sync
                  if (!mockupJobId) return;
                  try {
                    const res = await fetch(`/api/mockup-jobs/${mockupJobId}`);
                    if (res.ok) {
                      const job = await res.json();
                      setMockupImages(job.images || []);
                    }
                  } catch { /* gallery already shows optimistic state */ }
                }}
              />
            )}
          </div>
        </div>
      </div>

      {isPlacementEditorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            className="card"
            style={{
              width: "min(1240px, 96vw)",
              maxHeight: "92vh",
              overflow: "auto",
              padding: 20,
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800 }}>Điều chỉnh vị trí in</h3>
                <p style={{ margin: "3px 0 0", opacity: 0.55, fontSize: "0.85rem" }}>
                  Thay đổi tại đây chỉ áp dụng cho listing hiện tại.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setIsPlacementEditorOpen(false)}
                aria-label="Đóng editor vị trí"
              >
                <X size={16} /> Đóng
              </button>
            </div>
            <MultiViewPlacementEditor
              value={activePlacement}
              onChange={updatePlacementOverride}
              bgColor={bgColor}
              title="Placement của listing"
              description={placementOverride ? "Listing đang dùng override riêng." : "Đang kế thừa preset store. Chỉnh sửa sẽ tạo override cho listing này."}
              compact
            />
            {placementOverride && (
              <button
                className="btn btn-secondary"
                onClick={() => updatePlacementOverride(null)}
                style={{ marginTop: 14 }}
              >
                Khôi phục toàn bộ preset store
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

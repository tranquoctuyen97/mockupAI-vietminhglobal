"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import { autoPlace } from "@/lib/placement/auto-place";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import type { PrintArea } from "@/lib/placement/types";
import {
  Move,
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  RefreshCw,
  XCircle,
  Clock,
  RotateCcw,
} from "lucide-react";

const STALE_MESSAGES: Record<string, string> = {
  colors_changed: "Bạn đã đổi màu ở bước trước. Nhấn 'Tạo lại' để cập nhật mockup cho các màu mới.",
  design_changed: "Bạn đã đổi design. Nhấn 'Tạo lại' để sinh mockup mới.",
  placement_changed: "Bạn đã chỉnh vị trí in. Nhấn 'Tạo lại' để cập nhật mockup theo vị trí mới.",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface DesignInfo {
  url: string;
  width: number;
  height: number;
  dpi: number | null;
}

interface PlacementValues {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Step4PlacementPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const router = useRouter();
  const { draft, updateDraft, updateMockupJob } = useWizardStore();

  // Placement state
  const [printArea, setPrintArea] = useState<PrintArea>(DEFAULT_PRINT_AREA);
  const [designInfo, setDesignInfo] = useState<DesignInfo | null>(null);
  const [placement, setPlacement] = useState<PlacementValues | null>(null);
  const [autoPlaced, setAutoPlaced] = useState(false);

  // Generate state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"placement" | "generating">("placement");
  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Load print area ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!draft?.blueprintId) return;
    (async () => {
      const res = await fetch(`/api/blueprint/${draft.blueprintId}/print-area?position=front`);
      if (res.ok) {
        const data = await res.json();
        setPrintArea(data.printArea);
      }
    })();
  }, [draft?.blueprintId]);

  // ── Load design info ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!draft?.designId) return;
    (async () => {
      const res = await fetch(`/api/designs/${draft.designId}`);
      if (res.ok) {
        const data = await res.json();
        setDesignInfo({
          url: data.previewUrl,
          width: data.width,
          height: data.height,
          dpi: data.dpi,
        });
      }
    })();
  }, [draft?.designId]);

  // ── Auto-place when both printArea + design are loaded ──────────────────────
  useEffect(() => {
    if (!designInfo || autoPlaced) return;

    // Check if draft already has placement data
    const existingPlacement = draft?.placement as any;
    if (existingPlacement?.variants) {
      // Draft already has placement, use existing
      const firstVariant = Object.values(existingPlacement.variants)[0] as any;
      if (firstVariant?.front) {
        setPlacement({
          xMm: firstVariant.front.xMm ?? 0,
          yMm: firstVariant.front.yMm ?? printArea.heightMm / 2,
          widthMm: firstVariant.front.widthMm ?? 100,
          heightMm: firstVariant.front.heightMm ?? 100,
        });
        setAutoPlaced(true);
        return;
      }
    }

    // No existing placement → auto-place
    const result = autoPlace({
      design: { widthPx: designInfo.width, heightPx: designInfo.height },
      printArea,
    });
    setPlacement(result);
    setAutoPlaced(true);

    // Save to draft
    const placementData = {
      version: "2.1",
      variants: {
        _default: {
          front: {
            xMm: result.xMm,
            yMm: result.yMm,
            widthMm: result.widthMm,
            heightMm: result.heightMm,
            rotationDeg: 0,
            lockAspect: true,
            mirrored: false,
            placementMode: "contain",
          },
        },
      },
    };
    updateDraft({ placement: placementData as any });

    // Save to API (fire-and-forget)
    fetch(`/api/wizard/drafts/${draftId}/placement`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variantKey: "_default",
        view: "front",
        placement: placementData.variants._default.front,
      }),
    }).catch(console.error);
  }, [designInfo, printArea, autoPlaced, draft?.placement, draftId, updateDraft]);

  // ── Placement adjustment handlers ───────────────────────────────────────────
  function handlePlacementChange(field: keyof PlacementValues, value: number) {
    if (!placement) return;
    const updated = { ...placement, [field]: value };
    setPlacement(updated);

    // Save to draft store
    const placementData = {
      version: "2.1",
      variants: {
        _default: {
          front: {
            ...updated,
            rotationDeg: 0,
            lockAspect: true,
            mirrored: false,
            placementMode: "contain",
          },
        },
      },
    };
    updateDraft({ placement: placementData as any });
  }

  function handleResetToCenter() {
    if (!designInfo) return;
    const result = autoPlace({
      design: { widthPx: designInfo.width, heightPx: designInfo.height },
      printArea,
    });
    setPlacement(result);
  }

  // ── DPI calculation ─────────────────────────────────────────────────────────
  const dpiInfo = useMemo(() => {
    if (!designInfo || !placement) return null;
    const dpi = designInfo.width / (placement.widthMm / 25.4);
    if (dpi >= 300) return { value: Math.round(dpi), severity: "good", label: "Tuyệt vời" };
    if (dpi >= 150) return { value: Math.round(dpi), severity: "ok", label: "Chấp nhận" };
    return { value: Math.round(dpi), severity: "low", label: "Thấp" };
  }, [designInfo, placement]);

  // ── SSE connection for mockup generation ────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();

    const es = new EventSource(`/api/wizard/drafts/${draftId}/events`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "mockup.completed") {
          updateMockupJob(data.data.jobId, {
            status: "SUCCEEDED",
            mockupStoragePath: data.data.previewUrl,
          });
        } else if (data.type === "mockup.failed") {
          updateMockupJob(data.data.jobId, {
            status: "FAILED",
            errorMessage: data.data.error,
          });
        } else if (data.type === "mockup.progress") {
          updateMockupJob(data.data.jobId, { status: "RUNNING" });
        } else if (data.type === "generation.complete") {
          setGenerating(false);
          useWizardStore.getState().loadDraft(draftId);
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {};
    eventSourceRef.current = es;
  }, [draftId, updateMockupJob]);

  useEffect(() => {
    connectSSE();
    return () => { eventSourceRef.current?.close(); };
  }, [connectSSE]);

  // ── Generate mockups ────────────────────────────────────────────────────────
  async function handleGenerate() {
    setGenerating(true);
    setError("");
    setPhase("generating");

    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/generate-mockups`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed");
        setGenerating(false);
        return;
      }
      await useWizardStore.getState().loadDraft(draftId);
    } catch {
      setError("Không thể kết nối server");
      setGenerating(false);
    }
  }

  // ── Derived state ───────────────────────────────────────────────────────────
  const jobs = draft?.mockupJobs || [];
  const colors = (draft?.selectedColors as Array<{ title: string; hex: string }>) || [];
  const completed = jobs.filter((j) => j.status === "SUCCEEDED").length;
  const failed = jobs.filter((j) => j.status === "FAILED" && j.errorMessage !== "superseded_by_regenerate").length;
  const total = jobs.filter((j) => j.errorMessage !== "superseded_by_regenerate").length;
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

  const isStale = (draft as any)?.mockupsStale === true;
  const staleReason = (draft as any)?.mockupsStaleReason as string | null;

  // Show generating phase if jobs exist
  const showGenerating = phase === "generating" || jobs.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Placement & Mockup
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Xem vị trí in tự động, chỉnh nếu cần, sau đó tạo mockup
      </p>

      {/* ═══ Placement Preview Section ═══ */}
      {!showGenerating && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24, marginBottom: 24 }}>
          {/* Canvas Preview */}
          <div
            className="card"
            style={{
              padding: 24,
              minHeight: 400,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "var(--bg-tertiary)",
            }}
          >
            {!designInfo ? (
              <div style={{ textAlign: "center", opacity: 0.5 }}>
                <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                <p style={{ fontSize: "0.85rem" }}>Đang tải design...</p>
              </div>
            ) : placement ? (
              <div style={{ position: "relative", width: "100%", maxWidth: 400 }}>
                {/* Print area visualization */}
                <div
                  style={{
                    width: "100%",
                    aspectRatio: `${printArea.widthMm}/${printArea.heightMm}`,
                    border: "2px dashed var(--color-wise-green)",
                    borderRadius: 8,
                    position: "relative",
                    backgroundColor: colors[0]?.hex || "#ffffff",
                    overflow: "hidden",
                  }}
                >
                  {/* Safe zone */}
                  <div
                    style={{
                      position: "absolute",
                      left: `${(printArea.safeMarginMm / printArea.widthMm) * 100}%`,
                      top: `${(printArea.safeMarginMm / printArea.heightMm) * 100}%`,
                      right: `${(printArea.safeMarginMm / printArea.widthMm) * 100}%`,
                      bottom: `${(printArea.safeMarginMm / printArea.heightMm) * 100}%`,
                      border: "1px dashed rgba(0,0,0,0.15)",
                      borderRadius: 4,
                    }}
                  />

                  {/* Design overlay */}
                  <img
                    src={designInfo.url}
                    alt="Design preview"
                    style={{
                      position: "absolute",
                      left: `${((placement.xMm + printArea.widthMm / 2 - placement.widthMm / 2) / printArea.widthMm) * 100}%`,
                      top: `${((placement.yMm - placement.heightMm / 2) / printArea.heightMm) * 100}%`,
                      width: `${(placement.widthMm / printArea.widthMm) * 100}%`,
                      height: `${(placement.heightMm / printArea.heightMm) * 100}%`,
                      objectFit: "contain",
                      pointerEvents: "none",
                    }}
                  />
                </div>

                <div style={{ marginTop: 8, textAlign: "center", fontSize: "0.75rem", opacity: 0.5 }}>
                  Vùng đứt nét xanh = vùng in · Đứt nét xám = safe zone
                </div>
              </div>
            ) : null}
          </div>

          {/* Right Panel — Placement controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Position inputs */}
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ fontWeight: 600, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.6, margin: "0 0 12px" }}>
                Vị trí (mm)
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {placement && (
                  <>
                    <PlacementInput label="X" value={placement.xMm} onChange={(v) => handlePlacementChange("xMm", v)} />
                    <PlacementInput label="Y" value={placement.yMm} onChange={(v) => handlePlacementChange("yMm", v)} />
                    <PlacementInput label="Rộng" value={placement.widthMm} onChange={(v) => handlePlacementChange("widthMm", v)} />
                    <PlacementInput label="Cao" value={placement.heightMm} onChange={(v) => handlePlacementChange("heightMm", v)} />
                  </>
                )}
              </div>

              <button
                onClick={handleResetToCenter}
                className="flex items-center gap-2"
                style={{
                  marginTop: 12,
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--border-default)",
                  borderRadius: 6,
                  background: "none",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  opacity: 0.7,
                }}
              >
                <RotateCcw size={13} /> Reset về center
              </button>
            </div>

            {/* DPI Info */}
            {dpiInfo && (
              <div className="card" style={{ padding: 12 }}>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>DPI</span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 99,
                      backgroundColor:
                        dpiInfo.severity === "good" ? "rgba(34, 197, 94, 0.15)"
                        : dpiInfo.severity === "ok" ? "rgba(245, 158, 11, 0.15)"
                        : "rgba(239, 68, 68, 0.15)",
                      color:
                        dpiInfo.severity === "good" ? "#22c55e"
                        : dpiInfo.severity === "ok" ? "#f59e0b"
                        : "#ef4444",
                    }}
                  >
                    {dpiInfo.value} DPI — {dpiInfo.label}
                  </span>
                </div>
              </div>
            )}

            {/* Color chips preview */}
            {colors.length > 0 && (
              <div className="card" style={{ padding: 12 }}>
                <h3 style={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.6, margin: "0 0 8px" }}>
                  {colors.length} màu sẽ tạo mockup
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {colors.map((c) => (
                    <div
                      key={c.title}
                      title={c.title}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        backgroundColor: c.hex,
                        border: "1px solid rgba(0,0,0,0.1)",
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Generate button */}
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generating || !placement}
              style={{ width: "100%", padding: "12px 24px", fontSize: "0.9rem" }}
            >
              {generating ? (
                <><Loader2 size={18} className="animate-spin" /> Đang tạo...</>
              ) : (
                <><Sparkles size={18} /> Tạo Mockups ({colors.length} màu)</>
              )}
            </button>

            {error && (
              <div
                className="flex items-center gap-2"
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  backgroundColor: "rgba(239,68,68,0.1)",
                  color: "var(--color-error)",
                  fontSize: "0.8rem",
                }}
              >
                <AlertTriangle size={14} /> {error}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ Generation Progress Section ═══ */}
      {showGenerating && (
        <>
          {/* Stale banner */}
          {isStale && (
            <div
              className="flex items-start gap-3"
              style={{
                marginBottom: 16,
                padding: "12px 16px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
              }}
            >
              <AlertTriangle size={16} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#f59e0b" }}>
                  Mockup chưa cập nhật
                </div>
                <div style={{ fontSize: "0.8rem", opacity: 0.8, marginTop: 2 }}>
                  {staleReason
                    ? STALE_MESSAGES[staleReason] ?? "Có thay đổi. Nhấn 'Tạo lại' để cập nhật."
                    : "Có thay đổi. Nhấn 'Tạo lại' để cập nhật mockup."}
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={generating}
                style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}
              >
                Tạo lại
              </button>
            </div>
          )}

          {/* Header with regenerate */}
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Mockup Results</h3>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => { setPhase("placement"); }}
                style={{ fontSize: "0.8rem" }}
              >
                <Move size={14} /> Chỉnh placement
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleGenerate}
                disabled={generating}
                style={{ fontSize: "0.8rem" }}
              >
                <RefreshCw size={14} /> Tạo lại
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="flex items-center justify-between" style={{ fontSize: "0.8rem", marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>
                  {completed}/{total} hoàn thành
                  {failed > 0 && (
                    <span style={{ color: "var(--color-error)", marginLeft: 8 }}>
                      {failed} lỗi
                    </span>
                  )}
                </span>
                <span style={{ opacity: 0.5 }}>{progress}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, backgroundColor: "var(--bg-tertiary)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    borderRadius: 3,
                    backgroundColor: failed > 0 && completed === 0 ? "var(--color-error)" : "var(--color-wise-green)",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          )}

          {/* Mockup grid */}
          {total > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {jobs
                .filter((j) => j.errorMessage !== "superseded_by_regenerate")
                .map((job) => (
                  <MockupCard key={job.id} job={job} isStale={isStale} onRetry={handleGenerate} />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── PlacementInput ───────────────────────────────────────────────────────────

function PlacementInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.7rem", opacity: 0.5, marginBottom: 2 }}>
        {label}
      </label>
      <input
        type="number"
        value={Math.round(value * 10) / 10}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        step={0.5}
        className="input"
        style={{ width: "100%", fontSize: "0.85rem", padding: "6px 10px" }}
      />
    </div>
  );
}

// ─── MockupCard ───────────────────────────────────────────────────────────────

function toPublicUrl(storagePathOrUrl: string): string {
  if (storagePathOrUrl.startsWith("/") || storagePathOrUrl.startsWith("http")) {
    return storagePathOrUrl;
  }
  return `/api/files/${storagePathOrUrl}`;
}

function MockupCard({
  job,
  isStale,
  onRetry,
}: {
  job: {
    id: string;
    colorName: string;
    colorHex: string;
    status: string;
    mockupStoragePath?: string | null;
    errorMessage?: string | null;
  };
  isStale: boolean;
  onRetry: () => void;
}) {
  const borderColor = job.status === "FAILED"
    ? "var(--color-error)"
    : isStale ? "#f59e0b" : "transparent";

  return (
    <div
      className="card"
      style={{
        padding: 0, overflow: "hidden",
        border: `2px solid ${borderColor}`,
        opacity: isStale ? 0.7 : 1,
        transition: "border-color 0.2s, opacity 0.2s",
        position: "relative",
      }}
    >
      {isStale && (
        <div
          style={{
            position: "absolute", top: 6, right: 6, zIndex: 1,
            fontSize: "0.68rem", fontWeight: 700,
            padding: "2px 6px", borderRadius: 4,
            backgroundColor: "#f59e0b", color: "#000",
          }}
        >
          Cũ
        </div>
      )}

      <div
        style={{
          aspectRatio: "1/1",
          backgroundColor: job.colorHex || "var(--bg-tertiary)",
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative", overflow: "hidden",
        }}
      >
        {job.status === "SUCCEEDED" && job.mockupStoragePath && (
          <img src={toPublicUrl(job.mockupStoragePath)} alt={job.colorName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
        {job.status === "SUCCEEDED" && !job.mockupStoragePath && (
          <div style={{ textAlign: "center", padding: "0 12px" }}>
            <ImageIcon size={24} style={{ opacity: 0.4 }} />
            <p style={{ fontSize: "0.7rem", marginTop: 6, opacity: 0.5 }}>Thumbnail không tải được</p>
          </div>
        )}
        {job.status === "RUNNING" && (
          <div style={{ textAlign: "center" }}>
            <Loader2 size={28} className="animate-spin" style={{ color: "white", opacity: 0.8 }} />
            <p style={{ color: "white", fontSize: "0.75rem", marginTop: 6, opacity: 0.7 }}>Đang tạo...</p>
          </div>
        )}
        {job.status === "PENDING" && (
          <div style={{ textAlign: "center" }}>
            <Clock size={24} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: "0.7rem", marginTop: 4, opacity: 0.4 }}>Đang chờ...</p>
          </div>
        )}
        {job.status === "FAILED" && (
          <div style={{ textAlign: "center", padding: "0 12px" }}>
            <XCircle size={24} style={{ color: "#ef4444" }} />
            <p style={{ color: "#ef4444", fontSize: "0.7rem", marginTop: 4 }}>Tạo lỗi</p>
            <button
              onClick={onRetry}
              style={{ fontSize: "0.7rem", marginTop: 6, background: "none", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "#ef4444" }}
            >
              Thử lại
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: "8px 12px" }}>
        <div className="flex items-center gap-2">
          <div style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: job.colorHex, border: "1px solid rgba(0,0,0,0.1)" }} />
          <span style={{ fontWeight: 600, fontSize: "0.8rem" }}>{job.colorName}</span>
          {job.status === "SUCCEEDED" && job.mockupStoragePath && (
            <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)", marginLeft: "auto" }} />
          )}
        </div>
      </div>
    </div>
  );
}

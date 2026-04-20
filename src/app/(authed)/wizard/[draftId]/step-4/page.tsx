"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  RefreshCw,
  XCircle,
  Clock,
} from "lucide-react";

const STALE_MESSAGES: Record<string, string> = {
  colors_changed: "Bạn đã đổi màu ở bước trước. Nhấn 'Tạo lại' để cập nhật mockup cho các màu mới.",
  design_changed: "Bạn đã đổi design. Nhấn 'Tạo lại' để sinh mockup mới.",
  placement_changed: "Bạn đã chỉnh vị trí in. Nhấn 'Tạo lại' để cập nhật mockup theo vị trí mới.",
};

export default function Step4MockupPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const router = useRouter();
  const { draft, updateDraft, updateMockupJob } = useWizardStore();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

  // SSE connection
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

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
          updateMockupJob(data.data.jobId, {
            status: "RUNNING",
          });
        } else if (data.type === "generation.complete") {
          setGenerating(false);
          useWizardStore.getState().loadDraft(draftId);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // Auto-reconnect handled by EventSource spec
    };

    eventSourceRef.current = es;
  }, [draftId, updateMockupJob]);

  useEffect(() => {
    connectSSE();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connectSSE]);

  async function handleGenerate() {
    setGenerating(true);
    setError("");

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

  const jobs = draft?.mockupJobs || [];
  const colors = (draft?.selectedColors as Array<{ title: string }>) || [];
  const completed = jobs.filter((j) => j.status === "SUCCEEDED").length;
  const failed = jobs.filter((j) => j.status === "FAILED" && j.errorMessage !== "superseded_by_regenerate").length;
  const total = jobs.filter((j) => j.errorMessage !== "superseded_by_regenerate").length;
  // Bug #3 fix: progress = completed / total (NOT (completed+failed)/total)
  // So 0/3 done + 3 failed → 0%, not 100%
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);


  // Sanity check: detect mismatch between jobs and current selected colors
  const jobColorNames = new Set(
    jobs
      .filter((j) => j.status === "SUCCEEDED" || j.status === "RUNNING" || j.status === "PENDING")
      .map((j) => j.colorName),
  );
  const missingColors = colors.filter((c) => !jobColorNames.has(c.title));

  const isStale = (draft as any)?.mockupsStale === true;
  const staleReason = (draft as any)?.mockupsStaleReason as string | null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: 0 }}>
          Mockup Generation
        </h2>
        {jobs.length > 0 && (
          <button
            className="btn btn-secondary"
            onClick={handleGenerate}
            disabled={generating}
            style={{ fontSize: "0.8rem" }}
          >
            <RefreshCw size={14} />
            Tạo lại
          </button>
        )}
      </div>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 16px" }}>
        Tạo mockup cho từng màu đã chọn
      </p>

      {/* Stale banner (Bug #1) */}
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

      {/* Missing colors warning */}
      {!isStale && missingColors.length > 0 && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            fontSize: "0.82rem",
            color: "var(--color-error)",
          }}
        >
          Thiếu mockup cho: <strong>{missingColors.map((c) => c.title).join(", ")}</strong>
          {" — "}
          <button
            onClick={handleGenerate}
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", textDecoration: "underline", padding: 0 }}
          >
            Tạo lại
          </button>
        </div>
      )}

      {/* Generate button (empty state) */}
      {jobs.length === 0 && !generating && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--color-wise-green), #6ba832)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <Sparkles size={28} color="white" />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Sẵn sàng tạo mockup</h3>
          <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 24px" }}>
            {colors.length || 0} màu sẽ được tạo mockup
          </p>

          {error && (
            <div
              className="flex items-center justify-center gap-2"
              style={{
                marginBottom: 16, padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(239,68,68,0.1)", color: "var(--color-error)",
                fontSize: "0.85rem",
              }}
            >
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating}
            style={{ fontSize: "0.9rem", padding: "12px 32px" }}
          >
            {generating ? (
              <><Loader2 size={18} className="animate-spin" />Đang tạo...</>
            ) : (
              <><Sparkles size={18} />Tạo Mockups</>
            )}
          </button>
        </div>
      )}

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
            <span style={{ opacity: 0.5 }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, backgroundColor: "var(--bg-tertiary)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%", width: `${progress}%`, borderRadius: 3,
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
              <MockupCard
                key={job.id}
                job={job}
                isStale={isStale}
                onRetry={handleGenerate}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ── MockupCard (Bug #2 — explicit status for each state) ──────────────────────

interface MockupCardProps {
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
}

/**
 * Convert raw storage key ("mockups/draftId/jobId.webp") to a browser-accessible URL.
 * SSE events already send /api/files/... (via getPublicUrl), but after loadDraft()
 * the DB returns the raw key — this normalizes both cases.
 */
function toPublicUrl(storagePathOrUrl: string): string {
  if (storagePathOrUrl.startsWith("/") || storagePathOrUrl.startsWith("http")) {
    return storagePathOrUrl; // already a full URL
  }
  return `/api/files/${storagePathOrUrl}`;
}

function MockupCard({ job, isStale, onRetry }: MockupCardProps) {
  const borderColor = job.status === "FAILED"
    ? "var(--color-error)"
    : isStale ? "#f59e0b"
    : "transparent";

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
      {/* Badge: Stale */}
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

      {/* Thumbnail area */}
      <div
        style={{
          aspectRatio: "1/1",
          backgroundColor: job.colorHex || "var(--bg-tertiary)",
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative", overflow: "hidden",
        }}
      >
        {/* SUCCESS with thumbnail */}
        {job.status === "SUCCEEDED" && job.mockupStoragePath && (
          <img
            src={toPublicUrl(job.mockupStoragePath)}
            alt={job.colorName}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        {/* SUCCESS but no thumbnail URL (Bug #2) */}
        {job.status === "SUCCEEDED" && !job.mockupStoragePath && (
          <div style={{ textAlign: "center", padding: "0 12px" }}>
            <ImageIcon size={24} style={{ opacity: 0.4 }} />
            <p style={{ fontSize: "0.7rem", marginTop: 6, opacity: 0.5 }}>
              Thumbnail không tải được
            </p>
            <button
              onClick={onRetry}
              style={{ fontSize: "0.7rem", marginTop: 4, background: "none", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "inherit" }}
            >
              Tạo lại
            </button>
          </div>
        )}

        {/* RUNNING */}
        {job.status === "RUNNING" && (
          <div style={{ textAlign: "center" }}>
            <Loader2 size={28} className="animate-spin" style={{ color: "white", opacity: 0.8 }} />
            <p style={{ color: "white", fontSize: "0.75rem", marginTop: 6, opacity: 0.7 }}>Đang tạo...</p>
          </div>
        )}

        {/* PENDING */}
        {job.status === "PENDING" && (
          <div style={{ textAlign: "center" }}>
            <Clock size={24} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: "0.7rem", marginTop: 4, opacity: 0.4 }}>Đang chờ...</p>
          </div>
        )}

        {/* FAILED */}
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

      {/* Footer */}
      <div style={{ padding: "8px 12px" }}>
        <div className="flex items-center gap-2">
          <div
            style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: job.colorHex, border: "1px solid rgba(0,0,0,0.1)" }}
          />
          <span style={{ fontWeight: 600, fontSize: "0.8rem" }}>{job.colorName}</span>
          {job.status === "SUCCEEDED" && job.mockupStoragePath && (
            <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)", marginLeft: "auto" }} />
          )}
        </div>
      </div>
    </div>
  );
}

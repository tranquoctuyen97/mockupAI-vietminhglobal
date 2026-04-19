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
} from "lucide-react";

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
          // Reload draft to get final state
          useWizardStore.getState().loadDraft(draftId);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // Auto-reconnect is handled by EventSource spec
    };

    eventSourceRef.current = es;
  }, [draftId, updateMockupJob]);

  // Connect SSE on mount
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

      // Reload draft to get new jobs
      await useWizardStore.getState().loadDraft(draftId);
    } catch {
      setError("Không thể kết nối server");
      setGenerating(false);
    }
  }

  const jobs = draft?.mockupJobs || [];
  const completed = jobs.filter((j) => j.status === "SUCCEEDED").length;
  const failed = jobs.filter((j) => j.status === "FAILED").length;
  const total = jobs.length;
  const progress = total > 0 ? ((completed + failed) / total) * 100 : 0;

  return (
    <div>
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
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Tạo mockup cho từng màu đã chọn
      </p>

      {/* Generate button */}
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
            {(draft?.selectedColors as unknown[])?.length || 0} màu sẽ được tạo mockup
          </p>

          {error && (
            <div
              className="flex items-center justify-center gap-2"
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(239,68,68,0.1)",
                color: "var(--color-error)",
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
              <>
                <Loader2 size={18} className="animate-spin" />
                Đang tạo...
              </>
            ) : (
              <>
                <Sparkles size={18} />
                Tạo Mockups
              </>
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
          <div
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: "var(--bg-tertiary)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                borderRadius: 3,
                backgroundColor: failed > 0 && completed === 0
                  ? "var(--color-error)"
                  : "var(--color-wise-green)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Mockup grid */}
      {total > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          {jobs.map((job) => (
            <div
              key={job.id}
              className="card"
              style={{ padding: 0, overflow: "hidden" }}
            >
              <div
                style={{
                  aspectRatio: "1/1",
                  backgroundColor: job.colorHex || "var(--bg-tertiary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                {job.status === "SUCCEEDED" && job.mockupStoragePath && (
                  <img
                    src={job.mockupStoragePath}
                    alt={job.colorName}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                )}

                {job.status === "RUNNING" && (
                  <div style={{ textAlign: "center" }}>
                    <Loader2
                      size={28}
                      className="animate-spin"
                      style={{ color: "white", opacity: 0.8 }}
                    />
                    <p style={{ color: "white", fontSize: "0.75rem", marginTop: 6, opacity: 0.7 }}>
                      Đang tạo...
                    </p>
                  </div>
                )}

                {job.status === "PENDING" && (
                  <ImageIcon size={28} style={{ opacity: 0.2 }} />
                )}

                {job.status === "FAILED" && (
                  <div style={{ textAlign: "center" }}>
                    <AlertTriangle size={24} style={{ color: "#ef4444" }} />
                    <p style={{ color: "#ef4444", fontSize: "0.7rem", marginTop: 4 }}>
                      Lỗi
                    </p>
                  </div>
                )}
              </div>

              <div style={{ padding: "8px 12px" }}>
                <div className="flex items-center gap-2">
                  <div
                    style={{
                      width: 12, height: 12, borderRadius: 3,
                      backgroundColor: job.colorHex,
                      border: "1px solid rgba(0,0,0,0.1)",
                    }}
                  />
                  <span style={{ fontWeight: 600, fontSize: "0.8rem" }}>
                    {job.colorName}
                  </span>

                  {job.status === "SUCCEEDED" && (
                    <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)", marginLeft: "auto" }} />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

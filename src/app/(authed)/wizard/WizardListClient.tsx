"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wand2, Trash2, Loader2, ChevronRight, CheckCircle2, Pencil, Clock3, AlertCircle } from "lucide-react";

interface Draft {
  id: string;
  designId: string | null;
  storeId: string | null;
  store?: {
    name?: string | null;
    shopifyDomain?: string | null;
    printifyShopTitle?: string | null;
  } | null;
  productType: string | null;
  currentStep: number;
  status: string;
  updatedAt: string;
  mockupJobs: { id: string; status: string }[];
  listings?: Array<{
    id: string;
    status: string;
    publishJobs?: Array<{
      stage: string;
      status: string;
    }>;
  }>;
}

const STEP_LABELS = ["Store", "Design", "Preview", "Content", "Review"];
const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: "Bản nháp", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
  GENERATING: { label: "Đang tạo mockup", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  READY: { label: "Sẵn sàng", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  PUBLISHED: { label: "Đã publish", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  PUBLISHING: { label: "Đang publish", color: "#f59e0b", bg: "rgba(245,158,11,0.14)" },
  SYNCING_SHOPIFY: { label: "Đang sync Shopify", color: "#f59e0b", bg: "rgba(245,158,11,0.14)" },
  PUBLISH_FAILED: { label: "Publish lỗi", color: "#dc2626", bg: "rgba(220,38,38,0.12)" },
};

interface Props {
  initialDrafts: Draft[];
}

function getDraftPublishDisplayStatus(draft: Draft): {
  key: string;
  subLabel: string;
  complete: boolean;
  running: boolean;
  failed: boolean;
} {
  const listings = draft.listings ?? [];
  if (listings.length === 0) {
    return {
      key: draft.status,
      subLabel:
        draft.status === "PUBLISHED"
          ? "Hoàn thành"
          : `Step ${draft.currentStep}/${STEP_LABELS.length}: ${STEP_LABELS[draft.currentStep - 1]}`,
      complete: draft.status === "PUBLISHED",
      running: false,
      failed: false,
    };
  }

  const jobs = listings.flatMap((listing) => listing.publishJobs ?? []);
  const hasRunningJob = jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING");
  const hasFailed = listings.some((listing) => listing.status === "FAILED" || listing.status === "PARTIAL_FAILURE") ||
    jobs.some((job) => job.status === "FAILED");
  const allActive = listings.every((listing) => listing.status === "ACTIVE");
  const printifyDone = jobs.some((job) => job.stage === "PRINTIFY" && job.status === "SUCCEEDED");
  const shopifyRunning = jobs.some(
    (job) => job.stage === "SHOPIFY" && (job.status === "PENDING" || job.status === "RUNNING"),
  );

  if (hasFailed) {
    return {
      key: "PUBLISH_FAILED",
      subLabel: "Cần kiểm tra",
      complete: false,
      running: false,
      failed: true,
    };
  }

  if (printifyDone && shopifyRunning) {
    return {
      key: "SYNCING_SHOPIFY",
      subLabel: "Printify đã xong",
      complete: false,
      running: true,
      failed: false,
    };
  }

  if (hasRunningJob || listings.some((listing) => listing.status === "PUBLISHING")) {
    return {
      key: "PUBLISHING",
      subLabel: "Đang xử lý",
      complete: false,
      running: true,
      failed: false,
    };
  }

  if (allActive) {
    return {
      key: "PUBLISHED",
      subLabel: "Hoàn thành",
      complete: true,
      running: false,
      failed: false,
    };
  }

  return {
    key: draft.status,
    subLabel: `Step ${draft.currentStep}/${STEP_LABELS.length}: ${STEP_LABELS[draft.currentStep - 1]}`,
    complete: draft.status === "PUBLISHED",
    running: false,
    failed: false,
  };
}

function getDraftStoreLabel(draft: Draft): string | null {
  const store = draft.store;
  if (!store) return null;

  return store.name || store.printifyShopTitle || store.shopifyDomain || null;
}

export default function WizardListClient({ initialDrafts }: Props) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts);
  const [creating, setCreating] = useState(false);

  async function fetchDrafts() {
    try {
      const res = await fetch("/api/wizard/drafts");
      const data = await res.json();
      if (res.ok) setDrafts(data.drafts);
    } catch {
      // ignore
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/wizard/drafts", { method: "POST" });
      const draft = await res.json();
      if (res.ok) {
        router.push(`/wizard/${draft.id}/step-1`);
      }
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Xóa draft này?")) return;
    await fetch(`/api/wizard/drafts/${id}`, { method: "DELETE" });
    fetchDrafts();
  }

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Wizard</h1>
          <p className="page-subtitle">Tạo listing sản phẩm POD</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Tạo mới
        </button>
      </div>

      {drafts.length === 0 && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <div
            style={{
              width: 72, height: 72, borderRadius: "50%",
              backgroundColor: "var(--bg-tertiary)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <Wand2 size={32} style={{ opacity: 0.3 }} />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Chưa có draft nào</h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: "0 0 24px" }}>
            Tạo draft đầu tiên để bắt đầu quy trình Wizard
          </p>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            <Plus size={16} /> Tạo mới
          </button>
        </div>
      )}

      {drafts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {drafts.map((d) => {
            const displayStatus = getDraftPublishDisplayStatus(d);
            const statusInfo = STATUS_LABELS[displayStatus.key] || STATUS_LABELS.DRAFT;
            const isPublished = displayStatus.complete;
            const isRunning = displayStatus.running;
            const isFailed = displayStatus.failed;
            const storeLabel = getDraftStoreLabel(d);
            return (
              <div
                key={d.id}
                className="card"
                style={{
                  padding: "16px 20px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer",
                  transition: "transform 0.15s, box-shadow 0.15s",
                  borderLeft: isPublished
                    ? `3px solid #3b82f6`
                    : isFailed
                      ? "3px solid #dc2626"
                      : isRunning
                        ? "3px solid #f59e0b"
                        : "3px solid transparent",
                }}
                onClick={() => router.push(`/wizard/${d.id}/step-${d.currentStep}`)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = "translateX(2px)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.1)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = "";
                  (e.currentTarget as HTMLElement).style.boxShadow = "";
                }}
              >
                <div className="flex items-center gap-4">
                  <div
                    style={{
                      width: 40, height: 40, borderRadius: "var(--radius-sm)",
                      backgroundColor: isPublished
                        ? "rgba(59,130,246,0.1)"
                        : isFailed
                          ? "rgba(220,38,38,0.1)"
                          : isRunning
                            ? "rgba(245,158,11,0.12)"
                            : "var(--bg-tertiary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {isPublished ? (
                      <CheckCircle2 size={18} style={{ color: "#3b82f6" }} />
                    ) : isFailed ? (
                      <AlertCircle size={18} style={{ color: "#dc2626" }} />
                    ) : isRunning ? (
                      <Clock3 size={18} style={{ color: "#f59e0b" }} />
                    ) : (
                      <Wand2 size={18} style={{ opacity: 0.4 }} />
                    )}
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>
                      Draft #{d.id.slice(-6)}
                    </p>
                    <div className="flex items-center gap-3" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                      <span style={{ opacity: 0.5 }}>
                        {displayStatus.subLabel}
                      </span>
                      <span style={{
                        color: statusInfo.color,
                        backgroundColor: statusInfo.bg,
                        fontWeight: 600,
                        padding: "1px 8px",
                        borderRadius: 99,
                        fontSize: "0.7rem",
                      }}>
                        {statusInfo.label}
                      </span>
                      <span style={{ opacity: 0.4 }}>{new Date(d.updatedAt).toLocaleDateString("vi-VN")}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {storeLabel && (
                    <span
                      title={storeLabel}
                      style={{
                        color: "var(--text-secondary)",
                        backgroundColor: "var(--bg-secondary)",
                        border: "1px solid var(--border-default)",
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: "0.76rem",
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {storeLabel}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(d.id); }}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      padding: 6, color: "var(--color-danger)", opacity: 0.5,
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                  {isPublished
                    ? <Pencil size={14} style={{ opacity: 0.45, color: "#3b82f6" }} />
                    : <ChevronRight size={16} style={{ opacity: 0.3 }} />
                  }
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

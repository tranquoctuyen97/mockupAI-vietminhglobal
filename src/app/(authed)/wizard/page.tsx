"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wand2, Trash2, Loader2, ChevronRight } from "lucide-react";
import Link from "next/link";

interface Draft {
  id: string;
  designId: string | null;
  storeId: string | null;
  productType: string | null;
  currentStep: number;
  status: string;
  updatedAt: string;
  mockupJobs: { id: string; status: string }[];
}

const STEP_LABELS = ["Design", "Product", "Placement", "Mockups", "Content", "Review", "Publish"];
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Bản nháp", color: "#6b7280" },
  GENERATING: { label: "Đang tạo mockup", color: "#f59e0b" },
  READY: { label: "Sẵn sàng", color: "#22c55e" },
  PUBLISHED: { label: "Đã publish", color: "#3b82f6" },
};

export default function WizardListPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function fetchDrafts() {
    try {
      const res = await fetch("/api/wizard/drafts");
      const data = await res.json();
      if (res.ok) setDrafts(data.drafts);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDrafts();
  }, []);

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

      {loading && (
        <div className="flex items-center justify-center" style={{ padding: 64, opacity: 0.5 }}>
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}

      {!loading && drafts.length === 0 && (
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

      {!loading && drafts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {drafts.map((d) => {
            const statusInfo = STATUS_LABELS[d.status] || STATUS_LABELS.DRAFT;
            return (
              <div
                key={d.id}
                className="card"
                style={{
                  padding: "16px 20px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer",
                  transition: "transform 0.1s",
                }}
                onClick={() => router.push(`/wizard/${d.id}/step-${d.currentStep}`)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = "translateX(2px)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = "";
                }}
              >
                <div className="flex items-center gap-4">
                  <div
                    style={{
                      width: 40, height: 40, borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-tertiary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Wand2 size={18} style={{ opacity: 0.4 }} />
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>
                      Draft #{d.id.slice(-6)}
                    </p>
                    <div className="flex items-center gap-3" style={{ fontSize: "0.75rem", opacity: 0.5, marginTop: 2 }}>
                      <span>Step {d.currentStep}/{STEP_LABELS.length}: {STEP_LABELS[d.currentStep - 1]}</span>
                      <span style={{ color: statusInfo.color, fontWeight: 600, opacity: 1 }}>
                        {statusInfo.label}
                      </span>
                      <span>{new Date(d.updatedAt).toLocaleDateString("vi-VN")}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(d.id); }}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      padding: 6, color: "var(--color-danger)", opacity: 0.5,
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                  <ChevronRight size={16} style={{ opacity: 0.3 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

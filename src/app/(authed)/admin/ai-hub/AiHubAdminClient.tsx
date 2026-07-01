"use client";

import { Activity, Bot, LogOut, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Status = {
  codexAccount: string;
  runtime: string;
  proxy: string;
};

export default function AiHubAdminClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState(false);
  const healthy = status?.runtime === "online" && status?.proxy === "reachable";

  async function loadStatus() {
    const res = await fetch("/api/admin/ai-hub/status");
    if (!res.ok) {
      toast.error("Không thể tải AI Hub status");
      return;
    }
    setStatus(await res.json());
  }

  async function restart() {
    setPending(true);
    try {
      const res = await fetch("/api/admin/ai-hub/restart", { method: "POST" });
      if (!res.ok) {
        toast.error("Restart thất bại");
        return;
      }
      toast.success("Đã restart AI Hub runtime");
      await loadStatus();
    } finally {
      setPending(false);
    }
  }

  async function disconnect() {
    setPending(true);
    try {
      const res = await fetch("/api/admin/ai-hub/disconnect", { method: "POST" });
      if (!res.ok) {
        toast.error("Disconnect thất bại");
        return;
      }
      toast.success("Đã disconnect Codex account");
      await loadStatus();
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-section-heading" style={{ color: "var(--text-primary)" }}>
          <Bot
            size={22}
            style={{ display: "inline", marginRight: 8, verticalAlign: "text-bottom" }}
          />
          AI Hub Admin
        </h1>
        <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
          Kiểm tra Codex Web runtime và proxy dùng chung cho team.
        </p>
      </div>

      <div
        className="card card-lg"
        style={{
          maxWidth: 768,
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.12)",
        }}
      >
        <div
          className="grid gap-3 mb-6"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
        >
          <StatusTile label="Codex account" value={status?.codexAccount ?? "unknown"} />
          <StatusTile label="Runtime" value={status?.runtime ?? "unknown"} />
          <StatusTile label="Proxy" value={status?.proxy ?? "unknown"} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={pending} onClick={loadStatus} type="button">
            <Activity size={16} />
            Check status
          </button>
          <button className="btn-secondary" disabled={pending} onClick={restart} type="button">
            <RotateCw size={16} />
            Restart runtime
          </button>
          <button className="btn-secondary" disabled={pending} onClick={disconnect} type="button">
            <LogOut size={16} />
            Disconnect Codex
          </button>
        </div>

      </div>

      {healthy && (
        <div
          className="mt-6"
          style={{
            maxWidth: 768,
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderRadius: "var(--radius-sm)",
            border: "1px solid #bbf7d0",
            backgroundColor: "#dcfce7",
            color: "#065f46",
            padding: "16px 18px",
            fontWeight: 700,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              flex: "0 0 auto",
              borderRadius: 999,
              backgroundColor: "#10b981",
            }}
          />
        </div>
      )}
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: "var(--radius-sm)",
        backgroundColor: "var(--bg-tertiary)",
      }}
    >
      <div className="text-caption" style={{ color: "var(--text-secondary)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

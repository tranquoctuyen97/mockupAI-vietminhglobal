"use client";

import { Activity, Bot, Copy, Link2, LogOut, RotateCw } from "lucide-react";
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
  const [authOutput, setAuthOutput] = useState("");
  const healthy = status?.runtime === "online" && status?.proxy === "reachable";
  const connected = status?.codexAccount === "connected";
  const deviceUrl = authOutput.match(/https:\/\/auth\.openai\.com\/codex\/device/)?.[0] ?? "";
  const deviceCode = authOutput.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/)?.[0] ?? "";

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

  async function connect() {
    setPending(true);
    try {
      const res = await fetch("/api/admin/ai-hub/connect", { method: "POST" });
      if (!res.ok) {
        toast.error("Connect thất bại");
        return;
      }
      const data = (await res.json()) as { output?: string };
      setAuthOutput(data.output ?? "");
      toast.success("Đã bắt đầu Codex device auth");
      await loadStatus();
    } finally {
      setPending(false);
    }
  }

  async function copyValue(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    toast.success(`Đã copy ${label}`);
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

  useEffect(() => {
    if (!authOutput || connected) return;
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [authOutput, connected]);

  return (
    <div style={{ maxWidth: 1120 }}>
      <div className="mb-10">
        <Bot size={22} style={{ color: "var(--text-tertiary)", marginBottom: 12 }} />
        <h1
          style={{
            color: "var(--text-primary)",
            fontSize: "clamp(3rem, 7vw, 4.5rem)",
            fontWeight: 800,
            lineHeight: 0.95,
            letterSpacing: 0,
          }}
        >
          AI Hub Admin
        </h1>
        <p className="text-body mt-5" style={{ color: "var(--text-secondary)", fontSize: 20 }}>
          Quản lý Codex account và runtime dùng chung cho team.
        </p>
      </div>

      <div
        className="card card-lg"
        style={{
          borderRadius: 20,
          padding: 36,
          boxShadow: "0 2px 10px rgba(15, 23, 42, 0.12)",
        }}
      >
        <div
          className="grid gap-8 mb-8"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", maxWidth: 560 }}
        >
          <StatusTile label="Codex account" value={status?.codexAccount ?? "unknown"} />
          <StatusTile label="Runtime" value={status?.runtime ?? "unknown"} />
          <StatusTile label="Proxy" value={status?.proxy ?? "unknown"} />
        </div>

        <div className="flex flex-wrap gap-3">
          {!connected && (
            <button className="btn-primary" disabled={pending} onClick={connect} type="button">
              <Link2 size={18} />
              Connect Codex
            </button>
          )}
          <button className="btn-secondary" disabled={pending} onClick={loadStatus} type="button">
            <Activity size={18} />
            Check status
          </button>
          <button className="btn-secondary" disabled={pending} onClick={restart} type="button">
            <RotateCw size={18} />
            Restart runtime
          </button>
          {connected && (
            <button className="btn-secondary" disabled={pending} onClick={disconnect} type="button">
              <LogOut size={18} />
              Disconnect Codex
            </button>
          )}
        </div>

        {authOutput && (
          <div
            className="mt-8"
            style={{
              borderRadius: 12,
              border: "1px solid var(--border-primary)",
              backgroundColor: "var(--bg-primary)",
              color: "var(--text-primary)",
              padding: "28px 30px",
            }}
          >
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontSize: 18,
                lineHeight: 1.7,
                color: "var(--text-secondary)",
              }}
            >
              {authOutput}
            </pre>
            <div className="grid gap-4 mt-6">
              {deviceUrl && (
                <CopyRow copyLabel="Copy link" label={deviceUrl} onCopy={() => void copyValue(deviceUrl, "link")} />
              )}
              {deviceCode && (
                <CopyRow copyLabel="Copy code" label={deviceCode} onCopy={() => void copyValue(deviceCode, "code")} />
              )}
            </div>
          </div>
        )}
      </div>

      {connected && healthy && (
        <div
          className="mt-6"
          style={{
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
          <span>
            Codex Web runtime đang online tại <code>127.0.0.1:8214</code>, proxy qua{" "}
            <code>/api/codex-proxy/</code>.
          </span>
        </div>
      )}
    </div>
  );
}

function CopyRow({ copyLabel, label, onCopy }: { copyLabel: string; label: string; onCopy: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        borderRadius: 8,
        border: "1px solid var(--border-primary)",
        padding: "10px 12px 10px 18px",
      }}
    >
      <span
        style={{
          minWidth: 0,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "monospace",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--text-primary)",
        }}
      >
        {label}
      </span>
      <button aria-label={copyLabel} className="btn-secondary" onClick={onCopy} type="button">
        <Copy size={16} />
        Copy
      </button>
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-caption" style={{ color: "var(--text-tertiary)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

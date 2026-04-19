"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { ToggleLeft, Loader2, Info } from "lucide-react";

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  rolloutPercent: number;
  updatedBy: string | null;
  updatedAt: string;
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const fetchFlags = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feature-flags");
      const data = await res.json();
      if (res.ok) setFlags(data.flags);
    } catch {
      toast.error("Không thể tải danh sách feature flags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  async function toggleFlag(flag: FeatureFlag) {
    setTogglingKey(flag.key);
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: flag.key, enabled: !flag.enabled }),
      });
      if (res.ok) {
        toast.success(`${flag.key} → ${!flag.enabled ? "ON" : "OFF"}`);
        fetchFlags();
      } else {
        const data = await res.json();
        toast.error(data.error || "Có lỗi xảy ra");
      }
    } catch {
      toast.error("Không thể cập nhật flag");
    } finally {
      setTogglingKey(null);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-section-heading" style={{ color: "var(--text-primary)" }}>
          Feature Flags
        </h1>
        <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
          Bật/tắt tính năng cho hệ thống. Thay đổi có hiệu lực trong vòng 60 giây.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-wise-green)" }} />
        </div>
      ) : (
        <div className="space-y-3">
          {flags.map((flag) => (
            <div
              key={flag.key}
              className="card card-sm flex items-center gap-4"
              style={{
                padding: "1rem 1.25rem",
                borderColor: flag.enabled ? "rgba(159,232,112,0.3)" : "var(--border-default)",
              }}
            >
              {/* Toggle */}
              <button
                onClick={() => toggleFlag(flag)}
                disabled={togglingKey === flag.key}
                className={`toggle ${flag.enabled ? "active" : ""}`}
                aria-label={`Toggle ${flag.key}`}
                style={{ flexShrink: 0 }}
              >
                {togglingKey === flag.key && (
                  <Loader2
                    size={12}
                    className="animate-spin absolute"
                    style={{ top: 6, left: flag.enabled ? 24 : 4, color: "var(--color-wise-dark-green)" }}
                  />
                )}
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code
                    style={{
                      fontFamily: "monospace",
                      fontSize: "0.9375rem",
                      fontWeight: 700,
                      color: flag.enabled ? "var(--color-wise-green)" : "var(--text-primary)",
                    }}
                  >
                    {flag.key}
                  </code>
                  <span
                    className={`badge ${flag.enabled ? "badge-success" : "badge-danger"}`}
                    style={{ fontSize: "0.6875rem" }}
                  >
                    {flag.enabled ? "ON" : "OFF"}
                  </span>
                  {flag.rolloutPercent < 100 && (
                    <span className="badge badge-warning" style={{ fontSize: "0.6875rem" }}>
                      {flag.rolloutPercent}%
                    </span>
                  )}
                </div>
                {flag.description && (
                  <p className="text-caption mt-1" style={{ color: "var(--text-muted)" }}>
                    <Info size={12} style={{ display: "inline", marginRight: "4px", verticalAlign: "text-bottom" }} />
                    {flag.description}
                  </p>
                )}
              </div>

              {/* Last updated */}
              <div className="text-small text-right" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                {new Date(flag.updatedAt).toLocaleDateString("vi-VN", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          ))}

          {flags.length === 0 && (
            <div className="card card-sm text-center py-8">
              <ToggleLeft size={32} style={{ color: "var(--text-muted)", margin: "0 auto 0.5rem" }} />
              <p className="text-body" style={{ color: "var(--text-muted)" }}>
                Chưa có feature flag nào
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

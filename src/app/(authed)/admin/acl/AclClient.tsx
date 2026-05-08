"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Shield } from "lucide-react";

const WORKSPACE_FEATURES = [
  { key: "stores", label: "Stores" },
  { key: "designs", label: "Designs" },
  { key: "wizard", label: "Wizard" },
  { key: "listings", label: "Listings" },
  { key: "auto_fulfill", label: "Auto Fulfill" },
] as const;

const ADMIN_FEATURES = [
  { key: "users", label: "Users" },
  { key: "pricing", label: "Pricing" },
  { key: "integrations", label: "Integrations" },
  { key: "ai_settings", label: "AI Settings" },
  { key: "inkhub_config", label: "InkHub Config" },
] as const;

const OPERATOR_DEFAULTS = ["stores", "designs", "wizard", "listings", "auto_fulfill"];

interface Props {
  initialAdminFeatures: string[];
}

export default function AclClient({ initialAdminFeatures }: Props) {
  const [activeTab, setActiveTab] = useState<"ADMIN" | "OPERATOR">("ADMIN");
  const [adminFeatures, setAdminFeatures] = useState<Set<string>>(
    new Set(initialAdminFeatures),
  );
  const [operatorFeatures, setOperatorFeatures] = useState<Set<string>>(
    new Set(OPERATOR_DEFAULTS),
  );
  const [saving, setSaving] = useState(false);
  const [loadingOp, setLoadingOp] = useState(false);

  async function handleTabChange(tab: "ADMIN" | "OPERATOR") {
    setActiveTab(tab);
    if (tab === "OPERATOR" && !loadingOp) {
      setLoadingOp(true);
      try {
        const res = await fetch("/api/admin/acl?role=OPERATOR");
        const data = await res.json();
        setOperatorFeatures(new Set(data.features));
      } catch {
        toast.error("Không thể tải permissions");
      } finally {
        setLoadingOp(false);
      }
    }
  }

  function toggle(key: string) {
    const set = activeTab === "ADMIN" ? adminFeatures : operatorFeatures;
    const setter = activeTab === "ADMIN" ? setAdminFeatures : setOperatorFeatures;
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  function isEnabled(key: string) {
    return activeTab === "ADMIN"
      ? adminFeatures.has(key)
      : operatorFeatures.has(key);
  }

  async function handleSave() {
    setSaving(true);
    const features = activeTab === "ADMIN"
      ? Array.from(adminFeatures)
      : Array.from(operatorFeatures);
    try {
      const res = await fetch("/api/admin/acl", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: activeTab, features }),
      });
      if (res.ok) toast.success(`Đã lưu permissions cho ${activeTab}`);
      else toast.error("Lưu thất bại");
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setSaving(false);
    }
  }

  const groups = [
    { label: "Workspace", items: WORKSPACE_FEATURES },
    { label: "Admin", items: ADMIN_FEATURES },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-section-heading" style={{ color: "var(--text-primary)" }}>
          <Shield size={22} style={{ display: "inline", marginRight: 8, verticalAlign: "text-bottom" }} />
          Permissions
        </h1>
        <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
          Cấu hình quyền truy cập theo role
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["ADMIN", "OPERATOR"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={activeTab === tab ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Permission groups */}
      <div className="card card-lg" style={{ maxWidth: 520 }}>
        {groups.map((group) => (
          <div key={group.label} className="mb-6 last:mb-0">
            <div className="mb-3">
              <span className="text-caption" style={{
                color: "rgba(255,255,255,0.4)", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.08em",
              }}>
                {group.label}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {group.items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between"
                  style={{
                    padding: "10px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--bg-tertiary)",
                  }}
                >
                  <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
                    {item.label}
                  </span>
                  <button
                    role="switch"
                    aria-checked={isEnabled(item.key)}
                    onClick={() => toggle(item.key)}
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      border: "none",
                      cursor: "pointer",
                      backgroundColor: isEnabled(item.key)
                        ? "var(--color-wise-green)"
                        : "var(--bg-surface)",
                      position: "relative",
                      transition: "background-color 0.15s",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: "absolute",
                      top: 3,
                      left: isEnabled(item.key) ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      backgroundColor: "white",
                      transition: "left 0.15s",
                    }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end mt-6">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

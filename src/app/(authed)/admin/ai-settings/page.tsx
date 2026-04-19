"use client";

import { useState, useEffect } from "react";
import {
  Bot,
  Loader2,
  Save,
  Check,
  Eye,
  EyeOff,
  DollarSign,
} from "lucide-react";

interface SettingsData {
  provider: string;
  model: string;
  apiKeyMasked: string;
  promptVersion: number;
  hasKey: boolean;
}

interface CostData {
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  requestCount: number;
}

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [cost, setCost] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/ai-settings");
        const data = await res.json();
        if (res.ok) {
          setSettings(data.settings);
          setCost(data.todayCost || null);
          setProvider(data.settings.provider);
          setModel(data.settings.model);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const body: Record<string, string> = { provider, model };
      if (apiKey.trim()) body.apiKey = apiKey.trim();

      const res = await fetch("/api/admin/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaved(true);
        setApiKey("");
        setTimeout(() => setSaved(false), 2000);
        // Reload settings
        const reloadRes = await fetch("/api/admin/ai-settings");
        const data = await reloadRes.json();
        if (reloadRes.ok) {
          setSettings(data.settings);
          setCost(data.todayCost);
        }
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">AI Settings</h1>
          <p className="page-subtitle">Cấu hình AI cho content generation</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : saved ? (
            <Check size={16} />
          ) : (
            <Save size={16} />
          )}
          {saved ? "Đã lưu!" : "Lưu"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center" style={{ padding: 64, opacity: 0.5 }}>
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Settings card */}
          <div className="card" style={{ padding: 24 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Bot size={20} style={{ opacity: 0.5 }} />
              <h3 style={{ fontWeight: 700, fontSize: "1rem", margin: 0 }}>
                Provider Config
              </h3>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Provider */}
              <div>
                <label
                  style={{
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Provider
                </label>
                <select
                  className="input"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="gemini">Google Gemini</option>
                </select>
              </div>

              {/* Model */}
              <div>
                <label
                  style={{
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Model
                </label>
                <select
                  className="input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                </select>
              </div>

              {/* API Key */}
              <div>
                <label
                  style={{
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  API Key
                  {settings?.hasKey && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: "0.75rem",
                        opacity: 0.5,
                        fontWeight: 400,
                      }}
                    >
                      Current: {settings.apiKeyMasked}
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type={showKey ? "text" : "password"}
                      className="input"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={
                        settings?.hasKey
                          ? "Nhập key mới để thay đổi..."
                          : "Nhập Gemini API Key..."
                      }
                    />
                  </div>
                  <button
                    onClick={() => setShowKey(!showKey)}
                    style={{
                      background: "none",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-sm)",
                      padding: 8,
                      cursor: "pointer",
                      display: "flex",
                      color: "inherit",
                    }}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p
                  style={{
                    fontSize: "0.75rem",
                    opacity: 0.4,
                    marginTop: 4,
                  }}
                >
                  Key được mã hóa AES-256-GCM trước khi lưu vào DB
                </p>
              </div>

              {/* Prompt version */}
              <div>
                <label
                  style={{
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Prompt Version
                </label>
                <span style={{ fontSize: "0.9rem" }}>
                  v{settings?.promptVersion || 1}
                </span>
              </div>
            </div>
          </div>

          {/* Cost card */}
          <div className="card" style={{ padding: 24 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 20 }}>
              <DollarSign size={20} style={{ opacity: 0.5 }} />
              <h3 style={{ fontWeight: 700, fontSize: "1rem", margin: 0 }}>
                Chi phí hôm nay
              </h3>
            </div>

            {cost ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
              >
                <div className="card" style={{ padding: "12px 16px", backgroundColor: "var(--bg-tertiary)" }}>
                  <p style={{ fontSize: "0.75rem", opacity: 0.5, margin: "0 0 4px" }}>
                    Requests
                  </p>
                  <p style={{ fontWeight: 700, fontSize: "1.2rem", margin: 0 }}>
                    {cost.requestCount}
                  </p>
                </div>
                <div className="card" style={{ padding: "12px 16px", backgroundColor: "var(--bg-tertiary)" }}>
                  <p style={{ fontSize: "0.75rem", opacity: 0.5, margin: "0 0 4px" }}>
                    Cost
                  </p>
                  <p style={{ fontWeight: 700, fontSize: "1.2rem", margin: 0 }}>
                    ${cost.totalCostUsd.toFixed(4)}
                  </p>
                </div>
                <div className="card" style={{ padding: "12px 16px", backgroundColor: "var(--bg-tertiary)" }}>
                  <p style={{ fontSize: "0.75rem", opacity: 0.5, margin: "0 0 4px" }}>
                    Input Tokens
                  </p>
                  <p style={{ fontWeight: 700, fontSize: "1.2rem", margin: 0 }}>
                    {cost.totalTokensIn.toLocaleString()}
                  </p>
                </div>
                <div className="card" style={{ padding: "12px 16px", backgroundColor: "var(--bg-tertiary)" }}>
                  <p style={{ fontSize: "0.75rem", opacity: 0.5, margin: "0 0 4px" }}>
                    Output Tokens
                  </p>
                  <p style={{ fontWeight: 700, fontSize: "1.2rem", margin: 0 }}>
                    {cost.totalTokensOut.toLocaleString()}
                  </p>
                </div>
              </div>
            ) : (
              <p style={{ opacity: 0.4, fontSize: "0.85rem" }}>
                Chưa có dữ liệu
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

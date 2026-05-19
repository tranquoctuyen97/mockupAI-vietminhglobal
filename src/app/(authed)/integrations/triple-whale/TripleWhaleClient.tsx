"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock,
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";

interface StoreCredential {
  customName: string;
  apiKeyMasked: string;
  lastSyncedAt: string | null;
  syncError: string | null;
}

interface StoreRow {
  id: string;
  name: string;
  shopifyDomain: string;
  credential: StoreCredential | null;
}

interface PageData {
  stores: StoreRow[];
  timezone: string;
}

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { value: "America/Denver", label: "America/Denver (MT)" },
  { value: "America/Chicago", label: "America/Chicago (CT)" },
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "UTC", label: "UTC" },
  { value: "Asia/Ho_Chi_Minh", label: "Asia/Ho_Chi_Minh (ICT)" },
];

function statusFor(credential: StoreCredential | null): "none" | "synced" | "stale" | "error" {
  if (!credential) return "none";
  if (credential.syncError) return "error";
  if (!credential.lastSyncedAt) return "stale";
  const age = Date.now() - new Date(credential.lastSyncedAt).getTime();
  return age < 6 * 60 * 60 * 1000 ? "synced" : "stale";
}

function StatusBadge({ credential }: { credential: StoreCredential | null }) {
  const status = statusFor(credential);
  const styles = {
    none: { label: "Not configured", color: "var(--text-muted)", bg: "rgba(134,134,133,0.12)" },
    synced: { label: "Synced", color: "#054d28", bg: "rgba(159,232,112,0.18)" },
    stale: { label: "Stale", color: "#854d0e", bg: "rgba(255,209,26,0.18)" },
    error: { label: "Error", color: "var(--color-danger)", bg: "rgba(208,50,56,0.12)" },
  }[status];

  return (
    <span
      style={{
        alignItems: "center",
        background: styles.bg,
        borderRadius: 9999,
        color: styles.color,
        display: "inline-flex",
        fontSize: 11,
        fontWeight: 700,
        gap: 5,
        letterSpacing: "0.04em",
        padding: "3px 10px",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          background: styles.color,
          borderRadius: "50%",
          height: 6,
          width: 6,
        }}
      />
      {styles.label}
    </span>
  );
}

function EditModal({
  store,
  onClose,
  onSaved,
}: {
  store: StoreRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customName, setCustomName] = useState(store.credential?.customName ?? "");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const customNameId = useId();
  const apiKeyId = useId();

  async function handleSave() {
    if (!customName.trim()) {
      toast.error("Custom name required");
      return;
    }
    if (!store.credential && !apiKey.trim()) {
      toast.error("API key required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/integrations/triple-whale/${store.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          customName: customName.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to save");
        return;
      }
      await fetch(`/api/integrations/triple-whale/${store.id}/sync`, { method: "POST" });
      toast.success("Saved and sync queued");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove Triple Whale config for ${store.shopifyDomain}?`)) return;
    const res = await fetch(`/api/integrations/triple-whale/${store.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to remove");
      return;
    }
    toast.success("Removed");
    onSaved();
  }

  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        position: "fixed",
        zIndex: 50,
      }}
    >
      <button
        aria-label="Close modal"
        onClick={onClose}
        style={{ background: "rgba(0,0,0,0.5)", border: 0, inset: 0, position: "absolute" }}
        type="button"
      />
      <div
        className="card"
        style={{
          borderRadius: 24,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
          padding: 0,
          position: "relative",
          width: 520,
          zIndex: 1,
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: "1px solid var(--border-default)",
            display: "flex",
            gap: 14,
            padding: "20px 24px",
          }}
        >
          <div
            style={{
              background: "rgba(107,92,255,0.12)",
              borderRadius: 12,
              color: "#6b5cff",
              display: "grid",
              flexShrink: 0,
              fontSize: 18,
              height: 40,
              placeItems: "center",
              width: 40,
            }}
          >
            🐋
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              Configure {store.credential?.customName ?? store.shopifyDomain}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{store.shopifyDomain}</div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            style={{ borderRadius: 9999, height: 32, padding: 0, width: 32 }}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
          <div>
            <label
              htmlFor={customNameId}
              style={{
                color: "var(--text-secondary)",
                display: "block",
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              Custom Name
            </label>
            <input
              className="input"
              id={customNameId}
              maxLength={20}
              onChange={(event) => setCustomName(event.target.value)}
              placeholder="e.g. HTS, TM, YM"
              value={customName}
            />
            <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
              Short name shown in dashboard charts
            </p>
          </div>

          <div>
            <label
              htmlFor={apiKeyId}
              style={{
                color: "var(--text-secondary)",
                display: "block",
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              Triple Whale API Key{" "}
              {store.credential && (
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                  (leave blank to keep current)
                </span>
              )}
            </label>
            <div style={{ position: "relative" }}>
              <input
                className="input"
                id={apiKeyId}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={store.credential ? store.credential.apiKeyMasked : "tw_sk_..."}
                style={{ paddingRight: 40 }}
                type={showKey ? "text" : "password"}
                value={apiKey}
              />
              <button
                aria-label={showKey ? "Hide API key" : "Show API key"}
                onClick={() => setShowKey(!showKey)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
                type="button"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
              Triple Whale → Settings → API Keys
            </p>
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-secondary)",
            borderTop: "1px solid var(--border-default)",
            display: "flex",
            gap: 8,
            padding: "16px 24px",
          }}
        >
          {store.credential && (
            <button
              className="btn"
              onClick={handleDelete}
              style={{
                background: "rgba(208,50,56,0.08)",
                border: "1px solid rgba(208,50,56,0.2)",
                borderRadius: 9999,
                color: "var(--color-danger)",
                fontSize: 13,
                padding: "6px 12px",
              }}
              type="button"
            >
              <Trash2 size={13} /> Remove
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={saving}
            onClick={handleSave}
            type="button"
          >
            {saving ? <Loader2 className="animate-spin" size={13} /> : <Check size={13} />}
            Save & Sync
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TripleWhaleClient() {
  const [data, setData] = useState<PageData | null>(null);
  const [editStore, setEditStore] = useState<StoreRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingStore, setSyncingStore] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/triple-whale");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function syncAll() {
    setSyncingAll(true);
    try {
      const res = await fetch("/api/integrations/triple-whale/sync-all", { method: "POST" });
      const json = await res.json();
      toast.success(`Queued sync for ${json.queued} stores`);
    } finally {
      setSyncingAll(false);
    }
  }

  async function syncOne(storeId: string) {
    setSyncingStore(storeId);
    try {
      const res = await fetch(`/api/integrations/triple-whale/${storeId}/sync`, { method: "POST" });
      if (res.ok) toast.success("Sync queued");
    } finally {
      setSyncingStore(null);
    }
  }

  async function saveTimezone(timezone: string) {
    const res = await fetch("/api/integrations/triple-whale/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    });
    if (!res.ok) {
      toast.error("Failed to update timezone");
      return;
    }
    toast.success("Timezone updated");
    if (data) setData({ ...data, timezone });
  }

  const configured = data?.stores.filter((store) => store.credential).length ?? 0;

  return (
    <div>
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          justifyContent: "space-between",
          padding: "32px 40px 20px",
        }}
      >
        <div style={{ alignItems: "flex-start", display: "flex", gap: 14 }}>
          <Link
            aria-label="Back to integrations"
            href="/integrations"
            style={{
              alignItems: "center",
              color: "inherit",
              display: "flex",
              height: 32,
              justifyContent: "center",
              opacity: 0.45,
              textDecoration: "none",
              width: 32,
            }}
          >
            <ArrowLeft size={18} />
          </Link>
          <div
            style={{
              background: "rgba(107,92,255,0.12)",
              borderRadius: 12,
              color: "#6b5cff",
              display: "grid",
              flexShrink: 0,
              fontSize: 22,
              height: 44,
              placeItems: "center",
              width: 44,
            }}
          >
            🐋
          </div>
          <div>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.3px", margin: 0 }}>
              Triple Whale
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", margin: "4px 0 0" }}>
              Sync daily revenue, profit and ads for each store · {configured} of{" "}
              {data?.stores.length ?? 0} configured
            </p>
          </div>
        </div>
        <button className="btn btn-primary" disabled={syncingAll} onClick={syncAll} type="button">
          {syncingAll ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
          Sync All
        </button>
      </div>

      <div style={{ padding: "0 40px 16px" }}>
        <div className="card" style={{ borderRadius: 20, overflow: "hidden", padding: 0 }}>
          {loading ? (
            <div style={{ color: "var(--text-muted)", padding: 40, textAlign: "center" }}>
              Loading...
            </div>
          ) : (
            <table
              style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 14, width: "100%" }}
            >
              <thead>
                <tr>
                  {["Store", "Alias", "API Key", "Status", ""].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        background: "var(--bg-secondary)",
                        borderBottom: "1px solid var(--border-default)",
                        color: "var(--text-muted)",
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        padding: "12px 16px",
                        textAlign: heading === "" ? "right" : "left",
                        textTransform: "uppercase",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.stores.map((store, index) => (
                  <tr
                    key={store.id}
                    style={{
                      borderBottom:
                        index < data.stores.length - 1 ? "1px solid var(--border-default)" : "none",
                    }}
                  >
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ fontWeight: 600 }}>{store.shopifyDomain}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{store.name}</div>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      {store.credential ? (
                        <span
                          style={{
                            background: "rgba(159,232,112,0.15)",
                            borderRadius: 8,
                            color: "var(--color-positive)",
                            display: "inline-block",
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "2px 10px",
                          }}
                        >
                          {store.credential.customName}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td
                      style={{
                        color: "var(--text-secondary)",
                        fontFamily: "ui-monospace,monospace",
                        fontSize: 12,
                        padding: "14px 16px",
                      }}
                    >
                      {store.credential?.apiKeyMasked ?? (
                        <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                          Not set
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <StatusBadge credential={store.credential} />
                      {store.credential?.syncError && (
                        <div style={{ color: "var(--color-danger)", fontSize: 11, marginTop: 3 }}>
                          <AlertCircle size={11} /> {store.credential.syncError}
                        </div>
                      )}
                      {store.credential?.lastSyncedAt && !store.credential.syncError && (
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3 }}>
                          {new Date(store.credential.lastSyncedAt).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditStore(store)}
                          title="Edit"
                          type="button"
                        >
                          <Edit2 size={13} />
                        </button>
                        {store.credential && (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={syncingStore === store.id}
                            onClick={() => syncOne(store.id)}
                            title="Sync now"
                            type="button"
                          >
                            {syncingStore === store.id ? (
                              <Loader2 className="animate-spin" size={13} />
                            ) : (
                              <RefreshCw size={13} />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ padding: "0 40px 40px" }}>
        <div
          className="card"
          style={{
            alignItems: "center",
            borderRadius: 20,
            display: "flex",
            gap: 16,
            padding: "18px 24px",
          }}
        >
          <div
            style={{
              background: "rgba(56,200,255,0.12)",
              borderRadius: 10,
              color: "#38c8ff",
              display: "grid",
              flexShrink: 0,
              height: 36,
              placeItems: "center",
              width: 36,
            }}
          >
            <Clock size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Dashboard Timezone</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              Triple Whale dates are interpreted in this timezone for all stores.
            </div>
          </div>
          <select
            className="input"
            onChange={(event) => saveTimezone(event.target.value)}
            style={{ width: 280 }}
            value={data?.timezone ?? "America/Los_Angeles"}
          >
            {TIMEZONES.map((timezone) => (
              <option key={timezone.value} value={timezone.value}>
                {timezone.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {editStore && (
        <EditModal
          onClose={() => setEditStore(null)}
          onSaved={() => {
            setEditStore(null);
            load();
          }}
          store={editStore}
        />
      )}
    </div>
  );
}

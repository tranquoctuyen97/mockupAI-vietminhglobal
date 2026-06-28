"use client";

import {
  AlertCircle, ArrowLeft, Check, Clock, Edit2,
  Calendar, Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Credential {
  id: string;
  shopDomain: string;
  customName: string;
  apiKeyMasked: string;
  lastSyncedAt: string | null;
  syncFromDate: string;
  syncIntervalMinutes: number;
  syncError: string | null;
}

interface ShopifyStore {
  id: string;
  name: string;
  shopifyDomain: string;
}

interface PageData {
  credentials: Credential[];
  shopifyStores: ShopifyStore[];
  timezone: string;
}

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { value: "America/Denver",      label: "America/Denver (MT)" },
  { value: "America/Chicago",     label: "America/Chicago (CT)" },
  { value: "America/New_York",    label: "America/New_York (ET)" },
  { value: "UTC",                 label: "UTC" },
  { value: "Asia/Ho_Chi_Minh",    label: "Asia/Ho_Chi_Minh (ICT)" },
];

function getDefaultSyncFromDate() {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseDateValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function dateToValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string) {
  const date = parseDateValue(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function buildCalendarDays(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function DatePickerField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [monthDate, setMonthDate] = useState(() => parseDateValue(value));
  const selectedValue = value;
  const days = buildCalendarDays(monthDate);

  function moveMonth(delta: number) {
    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1));
  }

  function selectDate(date: Date) {
    onChange(dateToValue(date));
    setMonthDate(date);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        id={id}
        className="input"
        onClick={() => setOpen(!open)}
        type="button"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: "left" }}
      >
        <span>{formatDateLabel(value)}</span>
        <Calendar size={16} color="var(--text-muted)" />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 5,
            bottom: "calc(100% + 6px)",
            left: 0,
            width: 280,
            padding: 12,
            border: "1px solid var(--border-default)",
            borderRadius: 14,
            background: "var(--bg-primary)",
            boxShadow: "0 16px 40px rgba(15,23,42,0.18)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => moveMonth(-1)} type="button">Prev</button>
            <div style={{ fontSize: 13, fontWeight: 800 }}>
              {monthDate.toLocaleString(undefined, { month: "long", year: "numeric" })}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => moveMonth(1)} type="button">Next</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <div key={`${day}-${index}`} style={{ textAlign: "center", fontSize: 11, color: "var(--text-muted)", fontWeight: 700, padding: "4px 0" }}>{day}</div>
            ))}
            {days.map((day) => {
              const dayValue = dateToValue(day);
              const selected = dayValue === selectedValue;
              const muted = day.getMonth() !== monthDate.getMonth();
              return (
                <button
                  key={dayValue}
                  onClick={() => selectDate(day)}
                  type="button"
                  style={{
                    height: 32,
                    border: selected ? "1px solid var(--color-wise-green)" : "1px solid transparent",
                    borderRadius: 8,
                    background: selected ? "rgba(159,232,112,0.3)" : "transparent",
                    color: muted ? "var(--text-muted)" : "var(--text-primary)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontWeight: selected ? 800 : 600,
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function statusFor(cred: Credential): "synced" | "stale" | "error" {
  if (cred.syncError) return "error";
  if (!cred.lastSyncedAt) return "stale";
  return Date.now() - new Date(cred.lastSyncedAt).getTime() < 6 * 3600_000 ? "synced" : "stale";
}

function StatusBadge({ cred }: { cred: Credential }) {
  const s = statusFor(cred);
  const map = {
    synced: { label: "Synced", color: "#054d28",           bg: "rgba(159,232,112,0.18)" },
    stale:  { label: "Stale",  color: "#854d0e",           bg: "rgba(255,209,26,0.18)"  },
    error:  { label: "Error",  color: "var(--color-danger)", bg: "rgba(208,50,56,0.12)" },
  }[s];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 9999, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", background: map.bg, color: map.color }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: map.color }} />
      {map.label}
    </span>
  );
}

// ── Add Modal ─────────────────────────────────────────────────────────────────

function AddModal({ shopifyStores, onClose, onSaved }: {
  shopifyStores: ShopifyStore[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"shopify" | "custom">(shopifyStores.length > 0 ? "shopify" : "custom");
  const [selectedStoreId, setSelectedStoreId] = useState(shopifyStores[0]?.id ?? "");
  const [customDomain, setCustomDomain] = useState("");
  const [customName, setCustomName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [syncFromDate, setSyncFromDate] = useState(getDefaultSyncFromDate);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState("30");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const domainId = useId();
  const nameId = useId();
  const keyId = useId();
  const fromDateId = useId();
  const intervalId = useId();

  const shopDomain = mode === "shopify"
    ? shopifyStores.find((s) => s.id === selectedStoreId)?.shopifyDomain ?? ""
    : customDomain;

  async function handleSave() {
    if (!shopDomain.trim()) { toast.error("Shop domain required"); return; }
    if (!customName.trim()) { toast.error("Custom name required"); return; }
    if (!apiKey.trim()) { toast.error("API key required"); return; }
    if (!syncFromDate) { toast.error("From date required"); return; }
    const syncIntervalValue = Number(syncIntervalMinutes);
    if (!Number.isInteger(syncIntervalValue) || syncIntervalValue < 30) return;
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/triple-whale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopDomain: shopDomain.trim(),
          customName: customName.trim(),
          apiKey: apiKey.trim(),
          syncFromDate,
          syncIntervalMinutes: syncIntervalValue,
        }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Failed to save"); return; }
      await fetch(`/api/integrations/triple-whale/${json.id}/sync`, { method: "POST" });
      toast.success("Added & sync queued");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button aria-label="Close" onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", border: 0 }} type="button" />
      <div className="card" style={{ position: "relative", zIndex: 1, width: 520, borderRadius: 24, overflow: "hidden", padding: 0, boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(107,92,255,0.12)", color: "#6b5cff", display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0 }}>🐋</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Add Triple Whale Shop</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Connect a shop to sync daily analytics</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ width: 32, height: 32, padding: 0, borderRadius: 9999 }} type="button"><X size={16} /></button>
        </div>

        {/* Mode toggle */}
        <div style={{ padding: "16px 24px 0" }}>
          <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--bg-secondary)", borderRadius: 9999 }}>
            {shopifyStores.length > 0 && (
              <button
                onClick={() => setMode("shopify")}
                type="button"
                style={{ padding: "6px 16px", borderRadius: 9999, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", background: mode === "shopify" ? "var(--color-wise-green)" : "transparent", color: mode === "shopify" ? "var(--color-wise-dark-green)" : "var(--text-secondary)" }}
              >
                From Shopify Store
              </button>
            )}
            <button
              onClick={() => setMode("custom")}
              type="button"
              style={{ padding: "6px 16px", borderRadius: 9999, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", background: mode === "custom" ? "var(--color-wise-green)" : "transparent", color: mode === "custom" ? "var(--color-wise-dark-green)" : "var(--text-secondary)" }}
            >
              Custom Domain
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Shop domain */}
          {mode === "shopify" ? (
            <div>
              <label htmlFor={domainId} style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-secondary)" }}>Shopify Store</label>
              <select id={domainId} className="input" value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)}>
                {shopifyStores.map((s) => (
                  <option key={s.id} value={s.id}>{s.shopifyDomain} — {s.name}</option>
                ))}
              </select>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Shop domain: <strong>{shopDomain}</strong></p>
            </div>
          ) : (
            <div>
              <label htmlFor={domainId} style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-secondary)" }}>Shop Domain</label>
              <input id={domainId} className="input" value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="mybrand.myshopify.com" />
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Exactly as it appears in Triple Whale</p>
            </div>
          )}

          {/* Custom name */}
          <div>
            <label htmlFor={nameId} style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-secondary)" }}>Custom Name</label>
            <input id={nameId} className="input" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. HTS, TM, YM" maxLength={20} />
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Short alias shown in charts</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 12 }}>
            <div>
              <label htmlFor={fromDateId} style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-secondary)" }}>From date</label>
              <DatePickerField id={fromDateId} value={syncFromDate} onChange={setSyncFromDate} />
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>First sync starts here</p>
            </div>
            <div>
              <label htmlFor={intervalId} style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-secondary)" }}>Sync every</label>
              <input
                id={intervalId}
                className="input"
                type="number"
                min={30}
                value={syncIntervalMinutes}
                onChange={(e) => setSyncIntervalMinutes(e.target.value)}
              />
              <p style={{ fontSize: 11, color: Number(syncIntervalMinutes) >= 30 ? "var(--text-muted)" : "var(--color-danger)", marginTop: 4 }}>
                {Number(syncIntervalMinutes) >= 30 ? "Minutes, min 30" : "Enter 30 minutes or more"}
              </p>
            </div>
          </div>

          {/* API key */}
          <div>
            <label htmlFor={keyId} style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-secondary)" }}>Triple Whale API Key</label>
            <div style={{ position: "relative" }}>
              <input id={keyId} className="input" type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="tw_sk_..." style={{ paddingRight: 40 }} />
              <button onClick={() => setShowKey(!showKey)} type="button" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Triple Whale → Settings → API Keys</p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-default)", background: "var(--bg-secondary)", display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="btn btn-ghost btn-sm" type="button">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm" type="button">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Add & Sync
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditModal({ cred, onClose, onSaved }: { cred: Credential; onClose: () => void; onSaved: () => void }) {
  const [customName, setCustomName] = useState(cred.customName);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const keyId = useId();

  async function handleSave() {
    if (!customName.trim()) { toast.error("Custom name required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/integrations/triple-whale/${cred.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customName: customName.trim(), apiKey: apiKey.trim() || undefined }),
      });
      if (!res.ok) { toast.error((await res.json()).error ?? "Failed"); return; }
      await fetch(`/api/integrations/triple-whale/${cred.id}/sync`, { method: "POST" });
      toast.success("Saved & sync queued");
      onSaved();
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm(`Remove Triple Whale config for ${cred.shopDomain}?`)) return;
    await fetch(`/api/integrations/triple-whale/${cred.id}`, { method: "DELETE" });
    toast.success("Removed");
    onSaved();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button aria-label="Close" onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", border: 0 }} type="button" />
      <div className="card" style={{ position: "relative", zIndex: 1, width: 480, borderRadius: 24, overflow: "hidden", padding: 0, boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(107,92,255,0.12)", color: "#6b5cff", display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0 }}>🐋</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{cred.customName}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{cred.shopDomain}</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ width: 32, height: 32, padding: 0, borderRadius: 9999 }} type="button"><X size={16} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label htmlFor={nameId} style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-secondary)" }}>Custom Name</label>
            <input id={nameId} className="input" value={customName} onChange={(e) => setCustomName(e.target.value)} maxLength={20} />
          </div>
          <div>
            <label htmlFor={keyId} style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-secondary)" }}>
              API Key <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(leave blank to keep current)</span>
            </label>
            <div style={{ position: "relative" }}>
              <input id={keyId} className="input" type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={cred.apiKeyMasked} style={{ paddingRight: 40 }} />
              <button onClick={() => setShowKey(!showKey)} type="button" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-default)", background: "var(--bg-secondary)", display: "flex", gap: 8 }}>
          <button onClick={handleDelete} className="btn" style={{ background: "rgba(208,50,56,0.08)", border: "1px solid rgba(208,50,56,0.2)", color: "var(--color-danger)", fontSize: 13, padding: "6px 12px", borderRadius: 9999 }} type="button">
            <Trash2 size={13} /> Remove
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="btn btn-ghost btn-sm" type="button">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm" type="button">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Save & Sync
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TripleWhaleClient() {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editCred, setEditCred] = useState<Credential | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/triple-whale");
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function syncAll() {
    setSyncingAll(true);
    try {
      const r = await fetch("/api/integrations/triple-whale/sync-all", { method: "POST" });
      const j = await r.json();
      toast.success(`Queued sync for ${j.queued} shops`);
    } finally { setSyncingAll(false); }
  }

  async function syncOne(id: string) {
    setSyncingId(id);
    try {
      await fetch(`/api/integrations/triple-whale/${id}/sync`, { method: "POST" });
      toast.success("Sync queued");
    } finally { setSyncingId(null); }
  }

  async function deleteOne(cred: Credential) {
    if (!confirm(`Remove Triple Whale shop ${cred.shopDomain}? This deletes synced stats and pending sync jobs.`)) return;
    const r = await fetch(`/api/integrations/triple-whale/${cred.id}`, { method: "DELETE" });
    if (!r.ok) { toast.error((await r.json()).error ?? "Failed to delete"); return; }
    toast.success("Triple Whale shop removed");
    await load();
  }

  async function saveTimezone(timezone: string) {
    const r = await fetch("/api/integrations/triple-whale/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    });
    if (!r.ok) { toast.error("Failed to update timezone"); return; }
    toast.success("Timezone updated");
    if (data) setData({ ...data, timezone });
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "32px 40px 20px" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <Link href="/integrations" aria-label="Back" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, opacity: 0.45, color: "inherit", textDecoration: "none" }}>
            <ArrowLeft size={18} />
          </Link>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(107,92,255,0.12)", color: "#6b5cff", display: "grid", placeItems: "center", fontSize: 22, flexShrink: 0 }}>🐋</div>
          <div>
            <h1 style={{ fontWeight: 800, fontSize: "1.6rem", letterSpacing: "-0.3px", margin: 0 }}>Triple Whale</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", margin: "4px 0 0" }}>
              {data?.credentials.length ?? 0} shops configured
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowAdd(true)} className="btn btn-ghost">
            <Plus size={14} /> Add Shop
          </button>
          <button onClick={syncAll} disabled={syncingAll} className="btn btn-primary">
            {syncingAll ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync All
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ padding: "0 40px 16px" }}>
        <div className="card" style={{ borderRadius: 20, overflow: "hidden", padding: 0 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
          ) : !data?.credentials.length ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🐋</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>No shops configured yet</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>Add a shop to start syncing Triple Whale analytics</div>
              <button onClick={() => setShowAdd(true)} className="btn btn-primary"><Plus size={14} /> Add Shop</button>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 14 }}>
              <thead>
                <tr>
                  {["Shop Domain", "Alias", "API Key", "Status", ""].map((h) => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: h === "" ? "right" : "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-default)", background: "var(--bg-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.credentials.map((cred, i) => (
                  <tr key={cred.id} style={{ borderBottom: i < data.credentials.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ fontWeight: 600 }}>{cred.shopDomain}</div>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 8, background: "rgba(159,232,112,0.15)", color: "var(--color-positive)", fontSize: 12, fontWeight: 700 }}>{cred.customName}</span>
                    </td>
                    <td style={{ padding: "14px 16px", fontFamily: "ui-monospace,monospace", fontSize: 12, color: "var(--text-secondary)" }}>{cred.apiKeyMasked}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <StatusBadge cred={cred} />
                      {cred.syncError && <div style={{ fontSize: 11, color: "var(--color-danger)", marginTop: 3 }}><AlertCircle size={11} /> {cred.syncError}</div>}
                      {cred.lastSyncedAt && !cred.syncError && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{new Date(cred.lastSyncedAt).toLocaleString()}</div>}
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button onClick={() => setEditCred(cred)} className="btn btn-ghost btn-sm" title="Edit" type="button"><Edit2 size={13} /></button>
                        <button onClick={() => syncOne(cred.id)} disabled={syncingId === cred.id} className="btn btn-ghost btn-sm" title="Sync now" type="button">
                          {syncingId === cred.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        </button>
                        <button onClick={() => deleteOne(cred)} className="btn btn-ghost btn-sm" title="Delete" type="button"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Timezone */}
      <div style={{ padding: "0 40px 40px" }}>
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 24px", borderRadius: 20 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(56,200,255,0.12)", color: "#38c8ff", display: "grid", placeItems: "center", flexShrink: 0 }}><Clock size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Dashboard Timezone</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Triple Whale dates are interpreted in this timezone for all shops</div>
          </div>
          <select className="input" style={{ width: 280 }} value={data?.timezone ?? "America/Los_Angeles"} onChange={(e) => saveTimezone(e.target.value)}>
            {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
        </div>
      </div>

      {showAdd && data && (
        <AddModal shopifyStores={data.shopifyStores} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}
      {editCred && (
        <EditModal cred={editCred} onClose={() => setEditCred(null)} onSaved={() => { setEditCred(null); load(); }} />
      )}
    </div>
  );
}

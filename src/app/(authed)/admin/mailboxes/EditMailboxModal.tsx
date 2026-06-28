"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { MailboxRow } from "./page";

interface Props {
  mailbox: MailboxRow;
  onClose: () => void;
  onUpdated: () => void;
}

export function EditMailboxModal({ mailbox, onClose, onUpdated }: Props) {
  const [name, setName] = useState(mailbox.name);
  const [appPassword, setAppPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const doSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (name !== mailbox.name) payload.name = name;
      if (appPassword.trim()) payload.appPassword = appPassword;

      const res = await fetch(`/api/admin/mailboxes/${mailbox.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success("Cập nhật thành công");
        onUpdated();
      } else {
        const err = await res.json();
        toast.error(err.message_human || err.details || err.error || "Lỗi cập nhật");
      }
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Sửa Mailbox</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label style={labelStyle}>
            Tên
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Email
            <input value={mailbox.email} type="email" disabled style={{ ...inputStyle, background: "#f3f4f6", color: "#6b7280" }} />
          </label>
          <label style={labelStyle}>
            App Password mới
            <input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="Để trống nếu không đổi"
              style={inputStyle}
            />
          </label>
          <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: 0 }}>
            Nếu nhập App Password mới, hệ thống sẽ kiểm tra Gmail SMTP + IMAP trước khi lưu.
          </p>

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={secondaryBtnStyle}>Hủy</button>
            <button onClick={doSave} disabled={saving} style={primaryBtnStyle}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : "Lưu"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000, padding: "1rem" };
const modalStyle: React.CSSProperties = { background: "var(--bg-primary, #fff)", borderRadius: 12, padding: "1.5rem", width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" };
const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 500 };
const inputStyle: React.CSSProperties = { padding: "0.5rem", border: "1px solid var(--border-color, #d1d5db)", borderRadius: 6, fontSize: "0.875rem" };
const primaryBtnStyle: React.CSSProperties = { padding: "0.625rem 1.25rem", background: "var(--color-primary, #4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 };
const secondaryBtnStyle: React.CSSProperties = { padding: "0.625rem 1.25rem", background: "transparent", border: "1px solid var(--border-color, #d1d5db)", borderRadius: 8, fontWeight: 600, cursor: "pointer" };

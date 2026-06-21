"use client";

import { Settings, Power, MailOpen } from "lucide-react";
import type { MailboxRow } from "./page";

interface Props {
  mailboxes: MailboxRow[];
  storeName: string | null;
  onEdit: (m: MailboxRow) => void;
  onToggleStatus: (m: MailboxRow) => void;
  onCreate?: () => void;
}

export function MailboxList({ mailboxes, storeName, onEdit, onToggleStatus, onCreate }: Props) {
  if (mailboxes.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 2rem", opacity: 0.8 }}>
        <MailOpen size={48} style={{ margin: "0 auto 1rem", opacity: 0.5 }} />
        <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          {storeName ? `Store "${storeName}" chưa có mailbox nào` : "Chưa có mailbox nào"}
        </h3>
        <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem" }}>
          Kết nối mailbox để bắt đầu nhận và trả lời email từ khách hàng.
        </p>
        {onCreate && (
          <button onClick={onCreate} style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            padding: "0.625rem 1.25rem", borderRadius: "var(--radius-md, 8px)",
            background: "var(--color-primary, #4f46e5)", color: "#fff",
            border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.875rem",
          }}>
            Tạo Mailbox
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border-color, #e5e7eb)", textAlign: "left" }}>
            <th style={{ padding: "0.75rem" }}>Tên</th>
            <th style={{ padding: "0.75rem" }}>Email</th>
            <th style={{ padding: "0.75rem" }}>Provider</th>
            <th style={{ padding: "0.75rem" }}>Trạng thái</th>
            <th style={{ padding: "0.75rem" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {mailboxes.map((m) => (
            <tr key={m.id} style={{ borderBottom: "1px solid var(--border-color, #e5e7eb)" }}>
              <td style={{ padding: "0.75rem", fontWeight: 600 }}>{m.name}</td>
              <td style={{ padding: "0.75rem" }}>{m.email}</td>
              <td style={{ padding: "0.75rem" }}>
                <span style={{
                  padding: "2px 8px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 600,
                  background: m.provider === "gmail" ? "#fef3c7" : "#e0e7ff",
                  color: m.provider === "gmail" ? "#92400e" : "#3730a3",
                }}>
                  {m.provider === "gmail" ? "Gmail" : "Custom"}
                </span>
              </td>
              <td style={{ padding: "0.75rem" }}>
                <span style={{
                  padding: "2px 8px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 600,
                  background: m.isActive ? "#d1fae5" : "#f3f4f6",
                  color: m.isActive ? "#065f46" : "#6b7280",
                }}>
                  {m.isActive ? "Active" : "Disabled"}
                </span>
              </td>
              <td style={{ padding: "0.75rem" }}>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button onClick={() => onEdit(m)} title="Edit" aria-label={`Chỉnh sửa ${m.name}`} style={btnStyle}>
                    <Settings size={14} />
                  </button>
                  <button onClick={() => onToggleStatus(m)} title={m.isActive ? "Disable" : "Enable"} aria-label={m.isActive ? `Tắt ${m.name}` : `Bật ${m.name}`} style={btnStyle}>
                    <Power size={14} style={{ color: m.isActive ? "#dc2626" : "#16a34a" }} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "10px", border: "1px solid var(--border-color, #d1d5db)",
  borderRadius: 6, background: "transparent", cursor: "pointer",
  display: "flex", alignItems: "center",
};

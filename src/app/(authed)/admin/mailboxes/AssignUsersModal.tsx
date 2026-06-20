"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import type { MailboxRow } from "./page";

interface Assignment {
  userId: string;
  email: string;
  role: string;
  status: string;
  canReply: boolean;
  canUpdateStatus: boolean;
}

interface PlatformUser {
  id: string;
  email: string;
  role: string;
  status: string;
}

interface Props {
  mailbox: MailboxRow;
  onClose: () => void;
  onSaved: () => void;
}

export function AssignUsersModal({ mailbox, onClose, onSaved }: Props) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [assignments, setAssignments] = useState<Map<string, { canReply: boolean; canUpdateStatus: boolean }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/users").then((r) => r.json()),
      fetch(`/api/admin/mailboxes/${mailbox.id}/assignments`).then((r) => r.json()),
    ]).then(([userData, assignData]) => {
      // Only show ADMIN/OPERATOR (SUPER_ADMIN bypasses assignments)
      const filtered = (userData.users ?? []).filter(
        (u: PlatformUser) => u.role === "ADMIN" || u.role === "OPERATOR"
      );
      setUsers(filtered);

      const map = new Map<string, { canReply: boolean; canUpdateStatus: boolean }>();
      for (const a of (assignData.assignments ?? []) as Assignment[]) {
        map.set(a.userId, { canReply: a.canReply, canUpdateStatus: a.canUpdateStatus });
      }
      setAssignments(map);
    }).catch(() => toast.error("Không thể tải dữ liệu"))
      .finally(() => setLoading(false));
  }, [mailbox.id]);

  const toggle = (userId: string) => {
    const next = new Map(assignments);
    if (next.has(userId)) next.delete(userId);
    else next.set(userId, { canReply: true, canUpdateStatus: true });
    setAssignments(next);
  };

  const setPerm = (userId: string, field: "canReply" | "canUpdateStatus", value: boolean) => {
    const next = new Map(assignments);
    const current = next.get(userId);
    if (current) { next.set(userId, { ...current, [field]: value }); setAssignments(next); }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const payload = Array.from(assignments.entries()).map(([userId, perms]) => ({
        userId, canReply: perms.canReply, canUpdateStatus: perms.canUpdateStatus,
      }));
      const res = await fetch(`/api/admin/mailboxes/${mailbox.id}/assignments`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: payload }),
      });
      if (res.ok) { toast.success("Đã cập nhật phân quyền"); onSaved(); }
      else { const err = await res.json(); toast.error(err.error || "Lỗi cập nhật"); }
    } catch { toast.error("Lỗi kết nối"); }
    finally { setSaving(false); }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Phân quyền — {mailbox.name}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "2rem" }}>
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : (
          <>
            <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: "0 0 1rem" }}>
              SUPER_ADMIN tự động có quyền truy cập mọi mailbox, không cần assign.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border-color, #e5e7eb)", textAlign: "left" }}>
                  <th style={{ padding: "0.5rem" }}>Assign</th>
                  <th style={{ padding: "0.5rem" }}>User</th>
                  <th style={{ padding: "0.5rem" }}>Role</th>
                  <th style={{ padding: "0.5rem" }}>Reply</th>
                  <th style={{ padding: "0.5rem" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const assigned = assignments.has(u.id);
                  const perms = assignments.get(u.id);
                  return (
                    <tr key={u.id} style={{ borderBottom: "1px solid var(--border-color, #e5e7eb)" }}>
                      <td style={{ padding: "0.5rem" }}>
                        <input type="checkbox" checked={assigned} onChange={() => toggle(u.id)} />
                      </td>
                      <td style={{ padding: "0.5rem" }}>{u.email}</td>
                      <td style={{ padding: "0.5rem" }}>
                        <span style={{ fontSize: "0.75rem", padding: "2px 6px", borderRadius: 8, background: u.role === "ADMIN" ? "#e0e7ff" : "#f3e8ff", color: u.role === "ADMIN" ? "#3730a3" : "#6b21a8" }}>
                          {u.role}
                        </span>
                      </td>
                      <td style={{ padding: "0.5rem" }}>
                        <input type="checkbox" checked={perms?.canReply ?? false} disabled={!assigned}
                          onChange={(e) => setPerm(u.id, "canReply", e.target.checked)} />
                      </td>
                      <td style={{ padding: "0.5rem" }}>
                        <input type="checkbox" checked={perms?.canUpdateStatus ?? false} disabled={!assigned}
                          onChange={(e) => setPerm(u.id, "canUpdateStatus", e.target.checked)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
              <button onClick={onClose} style={secondaryBtnStyle}>Hủy</button>
              <button onClick={doSave} disabled={saving} style={primaryBtnStyle}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : "Lưu"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000, padding: "1rem" };
const modalStyle: React.CSSProperties = { background: "var(--bg-primary, #fff)", borderRadius: 12, padding: "1.5rem", width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto" };
const primaryBtnStyle: React.CSSProperties = { padding: "0.625rem 1.25rem", background: "var(--color-primary, #4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 };
const secondaryBtnStyle: React.CSSProperties = { padding: "0.625rem 1.25rem", background: "transparent", border: "1px solid var(--border-color, #d1d5db)", borderRadius: 8, fontWeight: 600, cursor: "pointer" };

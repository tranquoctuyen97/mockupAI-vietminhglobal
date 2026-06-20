"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Mail, Plus, Loader2 } from "lucide-react";
import { MailboxList } from "./MailboxList";
import { CreateMailboxModal } from "./CreateMailboxModal";
import { EditMailboxModal } from "./EditMailboxModal";
import { AssignUsersModal } from "./AssignUsersModal";

export interface MailboxRow {
  id: string;
  name: string;
  email: string;
  provider: string;
  zammadGroupId: number;
  zammadChannelId: number | null;
  isActive: boolean;
  assignedUsers: number;
  createdAt: string;
}

export default function AdminMailboxesPage() {
  const [mailboxes, setMailboxes] = useState<MailboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editMailbox, setEditMailbox] = useState<MailboxRow | null>(null);
  const [assignMailbox, setAssignMailbox] = useState<MailboxRow | null>(null);

  const fetchMailboxes = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/mailboxes");
      const data = await res.json();
      if (res.ok) setMailboxes(data.mailboxes);
      else toast.error("Không thể tải danh sách mailbox");
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMailboxes(); }, [fetchMailboxes]);

  const handleToggleStatus = async (mailbox: MailboxRow) => {
    if (mailbox.isActive) {
      if (!window.confirm(`Bạn có chắc muốn tắt mailbox '${mailbox.name}'? Email sẽ không được đồng bộ nữa.`)) {
        return;
      }
    }

    try {
      const res = await fetch(`/api/admin/mailboxes/${mailbox.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !mailbox.isActive }),
      });
      if (res.ok) {
        toast.success(mailbox.isActive ? "Đã tắt mailbox" : "Đã bật mailbox");
        fetchMailboxes();
      } else {
        const err = await res.json();
        toast.error(err.error || "Lỗi thay đổi trạng thái");
      }
    } catch {
      toast.error("Lỗi kết nối");
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Mail size={24} />
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Mailbox Config</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: "flex", alignItems: "center", gap: "0.5rem",
            padding: "0.625rem 1.25rem", borderRadius: "var(--radius-md, 8px)",
            background: "var(--color-primary, #4f46e5)", color: "#fff",
            border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.875rem",
          }}
        >
          <Plus size={16} /> Tạo Mailbox
        </button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
          <Loader2 size={32} className="animate-spin" />
        </div>
      ) : (
        <MailboxList
          mailboxes={mailboxes}
          onEdit={setEditMailbox}
          onAssign={setAssignMailbox}
          onToggleStatus={handleToggleStatus}
          onCreate={() => setShowCreate(true)}
        />
      )}

      {showCreate && (
        <CreateMailboxModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchMailboxes(); }}
        />
      )}

      {editMailbox && (
        <EditMailboxModal
          mailbox={editMailbox}
          onClose={() => setEditMailbox(null)}
          onUpdated={() => { setEditMailbox(null); fetchMailboxes(); }}
        />
      )}

      {assignMailbox && (
        <AssignUsersModal
          mailbox={assignMailbox}
          onClose={() => setAssignMailbox(null)}
          onSaved={() => { setAssignMailbox(null); fetchMailboxes(); }}
        />
      )}
    </div>
  );
}

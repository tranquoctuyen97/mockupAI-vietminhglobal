"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Users,
  Plus,
  RotateCcw,
  Shield,
  ShieldOff,
  X,
  Loader2,
  UserPlus,
} from "lucide-react";

interface User {
  id: string;
  email: string;
  role: "ADMIN" | "OPERATOR";
  status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState<User | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (res.ok) setUsers(data.users);
    } catch {
      toast.error("Không thể tải danh sách user");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function toggleStatus(user: User) {
    const newStatus = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast.success(`${user.email} đã được ${newStatus === "ACTIVE" ? "kích hoạt" : "vô hiệu hóa"}`);
        fetchUsers();
      } else {
        const data = await res.json();
        toast.error(data.error || "Có lỗi xảy ra");
      }
    } catch {
      toast.error("Không thể cập nhật trạng thái");
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-section-heading" style={{ color: "var(--text-primary)" }}>
            Quản lý Users
          </h1>
          <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
            Tạo và quản lý tài khoản operator
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreateDialog(true)}>
          <Plus size={18} />
          Tạo User
        </button>
      </div>

      {/* Users table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--color-wise-green)" }} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                <th style={{ textAlign: "right" }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-small"
                        style={{
                          backgroundColor: user.role === "ADMIN" ? "rgba(159,232,112,0.15)" : "rgba(134,134,133,0.15)",
                          color: user.role === "ADMIN" ? "var(--color-wise-green)" : "var(--text-muted)",
                          fontWeight: 700,
                        }}>
                        {user.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{user.email}</div>
                        {user.mustChangePassword && (
                          <span className="text-small" style={{ color: "var(--color-warning)" }}>
                            Cần đổi mật khẩu
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${user.role === "ADMIN" ? "badge-success" : "badge-info"}`}>
                      {user.role}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${user.status === "ACTIVE" ? "badge-success" : "badge-danger"}`}>
                      {user.status === "ACTIVE" ? "Hoạt động" : "Vô hiệu"}
                    </span>
                  </td>
                  <td className="text-caption" style={{ color: "var(--text-muted)" }}>
                    {new Date(user.createdAt).toLocaleDateString("vi-VN")}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="btn-secondary"
                        style={{ padding: "0.375rem 0.75rem", fontSize: "0.8125rem" }}
                        onClick={() => setShowResetDialog(user)}
                        title="Reset mật khẩu"
                      >
                        <RotateCcw size={14} />
                        Reset
                      </button>
                      <button
                        className={user.status === "ACTIVE" ? "btn-danger" : "btn-primary"}
                        style={{ padding: "0.375rem 0.75rem", fontSize: "0.8125rem" }}
                        onClick={() => toggleStatus(user)}
                        title={user.status === "ACTIVE" ? "Vô hiệu hóa" : "Kích hoạt"}
                      >
                        {user.status === "ACTIVE" ? <ShieldOff size={14} /> : <Shield size={14} />}
                        {user.status === "ACTIVE" ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="text-center py-8">
                      <Users size={32} style={{ color: "var(--text-muted)", margin: "0 auto 0.5rem" }} />
                      <p className="text-body" style={{ color: "var(--text-muted)" }}>
                        Chưa có user nào
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create User Dialog */}
      {showCreateDialog && (
        <CreateUserDialog
          onClose={() => setShowCreateDialog(false)}
          onCreated={() => {
            setShowCreateDialog(false);
            fetchUsers();
          }}
        />
      )}

      {/* Reset Password Dialog */}
      {showResetDialog && (
        <ResetPasswordDialog
          user={showResetDialog}
          onClose={() => setShowResetDialog(null)}
          onReset={() => {
            setShowResetDialog(null);
            fetchUsers();
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Create User Dialog
   ============================================================ */
function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "OPERATOR">("OPERATOR");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`User ${email} đã được tạo`);
        onCreated();
      } else {
        setError(data.error || "Có lỗi xảy ra");
      }
    } catch {
      setError("Không thể kết nối server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="card-lg w-full max-w-md" style={{ backgroundColor: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-feature-title" style={{ color: "var(--text-primary)" }}>
            <UserPlus size={20} style={{ display: "inline", marginRight: "0.5rem", verticalAlign: "text-bottom" }} />
            Tạo User Mới
          </h2>
          <button onClick={onClose} className="p-1" aria-label="Close">
            <X size={18} style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-email" className="block mb-1.5 text-caption" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Email
            </label>
            <input id="new-email" type="email" className="input" value={email}
              onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label htmlFor="new-password" className="block mb-1.5 text-caption" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Mật khẩu tạm
            </label>
            <input id="new-password" type="text" className="input" value={password}
              onChange={(e) => setPassword(e.target.value)} required minLength={8}
              placeholder="Tối thiểu 8 ký tự" />
          </div>
          <div>
            <label htmlFor="new-role" className="block mb-1.5 text-caption" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Role
            </label>
            <select id="new-role" className="input" value={role}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "OPERATOR")}>
              <option value="OPERATOR">Operator</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>

          {error && (
            <div className="p-3 text-sm font-medium" role="alert"
              style={{ backgroundColor: "rgba(208,50,56,0.08)", color: "var(--color-danger)", borderRadius: "var(--radius-sm)" }}>
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>
              Hủy
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Tạo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================================
   Reset Password Dialog
   ============================================================ */
function ResetPasswordDialog({
  user,
  onClose,
  onReset,
}: {
  user: User;
  onClose: () => void;
  onReset: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Mật khẩu của ${user.email} đã được reset`);
        onReset();
      } else {
        setError(data.error || "Có lỗi xảy ra");
      }
    } catch {
      setError("Không thể kết nối server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="card-lg w-full max-w-md" style={{ backgroundColor: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-feature-title" style={{ color: "var(--text-primary)" }}>
            Reset mật khẩu
          </h2>
          <button onClick={onClose} className="p-1" aria-label="Close">
            <X size={18} style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        <p className="text-body mb-4" style={{ color: "var(--text-secondary)" }}>
          Đặt mật khẩu mới cho <strong>{user.email}</strong>. User sẽ được yêu cầu đổi mật khẩu lần đầu đăng nhập.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-password" className="block mb-1.5 text-caption" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Mật khẩu mới
            </label>
            <input id="reset-password" type="text" className="input" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} required minLength={8}
              placeholder="Tối thiểu 8 ký tự" autoFocus />
          </div>

          {error && (
            <div className="p-3 text-sm font-medium" role="alert"
              style={{ backgroundColor: "rgba(208,50,56,0.08)", color: "var(--color-danger)", borderRadius: "var(--radius-sm)" }}>
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>
              Hủy
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              Reset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Settings, CheckCircle, XCircle, Trash2 } from "lucide-react";

interface Props {
  savedUsername: string;
}

export default function InkhubConfigClient({ savedUsername }: Props) {
  const [username, setUsername] = useState(savedUsername);
  const [password, setPassword] = useState("");
  const [hasCredentials, setHasCredentials] = useState(!!savedUsername);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleTest() {
    if (!username || !password) {
      toast.error("Nhập đầy đủ username và password");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/inkhub/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      setTestResult({
        ok: data.ok,
        message: data.ok
          ? `Kết nối thành công — Org ID: ${data.orgId}`
          : data.error || "Kết nối thất bại",
      });
    } catch {
      setTestResult({ ok: false, message: "Lỗi kết nối" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!username || !password) {
      toast.error("Nhập đầy đủ username và password");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inkhub", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        toast.success("Đã lưu InkHub credentials");
        setPassword("");
        setTestResult(null);
        setHasCredentials(true);
      } else {
        const data = await res.json();
        toast.error(data.error || "Lưu thất bại");
      }
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Bạn chắc muốn xóa kết nối InkHub?\n\nAuto Fulfill sẽ không hoạt động cho đến khi cấu hình lại.")) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/inkhub", { method: "DELETE" });
      if (res.ok) {
        toast.success("Đã xóa kết nối InkHub");
        setUsername("");
        setPassword("");
        setTestResult(null);
        setHasCredentials(false);
      } else {
        const data = await res.json();
        toast.error(data.error || "Xóa thất bại");
      }
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-section-heading" style={{ color: "var(--text-primary)" }}>
          <Settings size={22} style={{ display: "inline", marginRight: 8, verticalAlign: "text-bottom" }} />
          InkHub Config
        </h1>
        <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
          Tài khoản InkHub dùng để nhúng Auto Fulfill
        </p>
      </div>

      <div className="card card-lg" style={{ maxWidth: 460 }}>
        <div className="space-y-4">
          <div>
            <label className="block mb-1.5 text-caption" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Username
            </label>
            <input
              type="text"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="InkHub username"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block mb-1.5 text-caption" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={savedUsername ? "Để trống nếu không thay đổi password" : "InkHub password"}
              autoComplete="current-password"
            />
          </div>

          {testResult && (
            <div
              className="flex items-center gap-2 p-3 text-sm"
              style={{
                borderRadius: "var(--radius-sm)",
                backgroundColor: testResult.ok
                  ? "rgba(159,232,112,0.1)"
                  : "rgba(208,50,56,0.08)",
                color: testResult.ok ? "var(--color-wise-green)" : "var(--color-danger)",
              }}
            >
              {testResult.ok
                ? <CheckCircle size={16} />
                : <XCircle size={16} />}
              {testResult.message}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? "Đang test..." : "Test Connection"}
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Đang lưu..." : "Lưu"}
            </button>
          </div>

          {hasCredentials && (
            <div className="pt-3 border-t" style={{ borderColor: "var(--border-default)" }}>
              <button
                type="button"
                className="btn-danger w-full flex items-center justify-center gap-2"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 size={16} />
                {deleting ? "Đang xóa..." : "Xóa kết nối"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

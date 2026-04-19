"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Đăng nhập thất bại");
        return;
      }

      toast.success("Đăng nhập thành công!");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Không thể kết nối server. Thử lại sau.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--bg-secondary)" }}>

      {/* Login Card */}
      <div className="card-lg w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-wise-green)" }}>
            <Sparkles size={20} style={{ color: "var(--color-wise-dark-green)" }} />
          </div>
          <h1 className="text-sub-heading" style={{ color: "var(--text-primary)" }}>
            MockupAI
          </h1>
        </div>

        <p className="text-center mb-8" style={{
          color: "var(--text-secondary)",
          fontSize: "1rem",
          fontWeight: 400,
        }}>
          Đăng nhập để tiếp tục
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email */}
          <div>
            <label htmlFor="login-email" className="block mb-1.5 text-caption"
              style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Email
            </label>
            <input
              id="login-email"
              type="email"
              className="input"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="login-password" className="block mb-1.5 text-caption"
              style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Mật khẩu
            </label>
            <input
              id="login-password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 text-sm font-medium"
              style={{
                backgroundColor: "rgba(208, 50, 56, 0.08)",
                color: "var(--color-danger)",
                borderRadius: "var(--radius-sm)",
              }}
              role="alert">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={loading}
            style={{ marginTop: "1.5rem" }}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Đang đăng nhập...
              </>
            ) : (
              "Đăng nhập"
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center mt-6 text-small"
          style={{ color: "var(--text-muted)" }}>
          Liên hệ Admin để reset mật khẩu
        </p>
      </div>
    </div>
  );
}

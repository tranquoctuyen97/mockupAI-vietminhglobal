"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Store,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  Shield,
  Key,
  Link2,
} from "lucide-react";
import Link from "next/link";

const REDIRECT_URL = `${typeof window !== "undefined" ? window.location.origin : ""}/api/shopify/callback`;
const REQUIRED_SCOPES = [
  { scope: "write_products", desc: "Tạo & sửa sản phẩm" },
  { scope: "read_products", desc: "Đọc thông tin sản phẩm" },
  { scope: "read_orders", desc: "Đọc đơn hàng (analytics)" },
  { scope: "write_inventory", desc: "Quản lý tồn kho" },
  { scope: "read_publications", desc: "Đọc thông tin xuất bản" },
  { scope: "write_publications", desc: "Quản lý xuất bản (publish sản phẩm)" },
];
const SETUP_STEPS = [
  {
    label: "Tạo app trong Dev Dashboard",
    desc: 'Vào Settings → Apps and sales channels → Develop apps → chọn "Build apps in Dev Dashboard". Chọn "Start from Dev Dashboard", nhập tên app (VD: MockupAI) → bấm Create.',
    image: "/guides/shopify/step1-create-app.png",
  },
  {
    label: "Cấu hình Version — URLs + Scopes + Redirect URL",
    desc: 'Tại trang "Create version": điền App URL, paste Redirect URL ở trên vào ô Redirect URLs, điền 4 Scopes bên dưới vào ô Scopes.',
    image: "/guides/shopify/step2-configure-version.png",
  },
  {
    label: 'Bấm "Release" → xác nhận',
    desc: "Bấm nút Release góc phải trên → popup hiện ra → bấm Release để publish version active.",
    image: "/guides/shopify/step3-release.png",
  },
  {
    label: "Lấy Client ID + Client Secret",
    desc: "Sau khi Release → vào tab API credentials → copy Client ID và Client Secret → dán vào form bên dưới.",
    image: null,
  },
];

function NewStoreContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(errorParam ? decodeError(errorParam) : "");
  const [copied, setCopied] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [expandedImg, setExpandedImg] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  function decodeError(err: string): string {
    const messages: Record<string, string> = {
      missing_params: "Thiếu thông tin từ Shopify callback. Vui lòng thử lại.",
      invalid_state: "Phiên xác thực hết hạn. Vui lòng thử lại.",
      invalid_hmac: "Xác thực HMAC thất bại. Kiểm tra Client Secret.",
      credentials_not_found: "Không tìm thấy credentials. Vui lòng tạo store lại.",
      oauth_failed: searchParams.get("message") || "Kết nối thất bại",
    };
    return messages[err] || `Lỗi: ${err}`;
  }

  async function handleCopy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleSubmit() {
    if (!name || !domain || !clientId || !clientSecret) {
      setError("Vui lòng điền đầy đủ thông tin");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          shopifyDomain: domain,
          shopifyClientId: clientId,
          shopifyClientSecret: clientSecret,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Tạo store thất bại");
        setLoading(false);
        return;
      }

      // Step 3: auto-redirect to OAuth
      setStep(3);
      window.location.href = `/api/shopify/authorize?storeId=${data.storeId}`;
    } catch {
      setError("Không thể kết nối server");
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Header */}
      <div className="flex items-center gap-3" style={{ marginBottom: 24 }}>
        <Link href="/stores" style={{ color: "inherit", opacity: 0.5, display: "flex" }}>
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>Kết nối Store mới</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>
            Tạo Custom App trên Shopify rồi nhập credentials
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="flex items-center gap-3"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            color: "var(--color-error)",
            marginBottom: 20,
            fontSize: "0.85rem",
          }}
        >
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-2" style={{ marginBottom: 24 }}>
        {["Hướng dẫn", "Nhập credentials", "Kết nối"].map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: 700,
                backgroundColor:
                  step > i + 1
                    ? "var(--color-wise-green)"
                    : step === i + 1
                      ? "var(--color-wise-green)"
                      : "var(--bg-tertiary)",
                color: step >= i + 1 ? "white" : "var(--text-muted)",
              }}
            >
              {step > i + 1 ? <Check size={14} /> : i + 1}
            </div>
            <span
              style={{
                fontSize: "0.8rem",
                fontWeight: step === i + 1 ? 600 : 400,
                opacity: step === i + 1 ? 1 : 0.5,
              }}
            >
              {label}
            </span>
            {i < 2 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  backgroundColor: "var(--border-default)",
                  margin: "0 4px",
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Setup Guide */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Redirect URL */}
          <div className="card" style={{ padding: 20 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
              <Link2 size={16} style={{ color: "var(--color-wise-green)" }} />
              <h3 style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>
                Redirect URL
              </h3>
            </div>
            <p style={{ fontSize: "0.8rem", opacity: 0.6, margin: "0 0 8px" }}>
              Paste URL này vào mục &quot;Allowed redirection URL(s)&quot; khi tạo app
            </p>
            <div
              className="flex items-center justify-between"
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-tertiary)",
                fontFamily: "monospace",
                fontSize: "0.8rem",
                wordBreak: "break-all",
              }}
            >
              <span>{REDIRECT_URL}</span>
              <button
                onClick={() => handleCopy(REDIRECT_URL, "url")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  flexShrink: 0,
                }}
              >
                {copied === "url" ? (
                  <Check size={14} style={{ color: "var(--color-wise-green)" }} />
                ) : (
                  <Copy size={14} style={{ opacity: 0.5 }} />
                )}
              </button>
            </div>
          </div>

          {/* Required Scopes */}
          <div className="card" style={{ padding: 20 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
              <Shield size={16} style={{ color: "var(--color-wise-green)" }} />
              <h3 style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>
                Required Scopes
              </h3>
            </div>
            <p style={{ fontSize: "0.8rem", opacity: 0.6, margin: "0 0 8px" }}>
              Tick các quyền này trong Admin API access scopes
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {REQUIRED_SCOPES.map((s) => (
                <div
                  key={s.scope}
                  className="flex items-center justify-between"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--bg-tertiary)",
                    fontSize: "0.8rem",
                  }}
                >
                  <code style={{ fontWeight: 600, color: "var(--color-wise-green)" }}>
                    {s.scope}
                  </code>
                  <span style={{ opacity: 0.6 }}>{s.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Setup Guide (collapsible) */}
          <div className="card" style={{ padding: 20 }}>
            <button
              onClick={() => setShowGuide(!showGuide)}
              className="flex items-center justify-between"
              style={{
                width: "100%",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                textAlign: "left",
              }}
            >
              <div className="flex items-center gap-2">
                <Key size={16} style={{ color: "var(--color-wise-green)" }} />
                <h3 style={{ fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>
                  Hướng dẫn tạo Custom App
                </h3>
              </div>
              <ArrowRight
                size={16}
                style={{
                  opacity: 0.3,
                  transform: showGuide ? "rotate(90deg)" : "none",
                  transition: "transform 0.15s",
                }}
              />
            </button>

            {showGuide && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {SETUP_STEPS.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-default)",
                    }}
                  >
                    {/* Step header */}
                    <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                      <span
                        style={{
                          minWidth: 20,
                          height: 20,
                          borderRadius: "50%",
                          backgroundColor: "var(--color-wise-green)",
                          color: "white",
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {i + 1}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>{s.label}</span>
                    </div>
                    {/* Description */}
                    <p style={{ fontSize: "0.77rem", opacity: 0.65, margin: "0 0 0 28px" }}>
                      {s.desc}
                    </p>
                    {/* Screenshot thumbnail */}
                    {s.image && (
                      <img
                        src={s.image}
                        alt={s.label}
                        onClick={() => setExpandedImg(s.image!)}
                        style={{
                          width: "100%",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-default)",
                          cursor: "zoom-in",
                          marginTop: 8,
                          maxHeight: 180,
                          objectFit: "cover",
                          objectPosition: "top",
                        }}
                      />
                    )}
                  </div>
                ))}

                <a
                  href="https://dev.shopify.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                  style={{
                    marginTop: 4,
                    fontSize: "0.8rem",
                    color: "var(--color-wise-green)",
                    fontWeight: 600,
                  }}
                >
                  Mở Shopify Dev Dashboard <ExternalLink size={12} />
                </a>
              </div>
            )}

            {/* Lightbox */}
            {expandedImg && (
              <div
                onClick={() => setExpandedImg(null)}
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 9999,
                  backgroundColor: "rgba(0,0,0,0.88)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "zoom-out",
                  padding: 24,
                }}
              >
                <img
                  src={expandedImg}
                  alt="Screenshot hướng dẫn"
                  style={{
                    maxWidth: "90vw",
                    maxHeight: "85vh",
                    borderRadius: 8,
                    objectFit: "contain",
                    boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
                  }}
                />
              </div>
            )}
          </div>

          <button
            className="btn btn-primary"
            onClick={() => setStep(2)}
            style={{ width: "100%", padding: "14px 24px" }}
          >
            Tôi đã tạo Custom App xong
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Step 2: Credentials Form */}
      {step === 2 && (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: "0 0 20px" }}>
            Nhập thông tin Store & Credentials
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 6 }}>
                Tên Store
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: My POD Store"
                className="input"
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 6 }}>
                Shopify Domain
              </label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="mystore.myshopify.com"
                className="input"
                style={{ width: "100%" }}
              />
              <span style={{ fontSize: "0.7rem", opacity: 0.5, marginTop: 4, display: "block" }}>
                Chỉ cần phần trước .myshopify.com cũng được
              </span>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 6 }}>
                Client ID
              </label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Paste từ Shopify API credentials"
                className="input"
                style={{ width: "100%", fontFamily: "monospace" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 6 }}>
                Client Secret
              </label>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Paste từ Shopify API credentials"
                className="input"
                style={{ width: "100%", fontFamily: "monospace" }}
              />
              <span style={{ fontSize: "0.7rem", opacity: 0.5, marginTop: 4, display: "block" }}>
                Mã hóa AES-256-GCM trước khi lưu
              </span>
            </div>
          </div>

          <div className="flex gap-3" style={{ marginTop: 24 }}>
            <button
              className="btn btn-secondary"
              onClick={() => setStep(1)}
              style={{ flex: 1 }}
            >
              <ArrowLeft size={16} />
              Quay lại
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={loading || !name || !domain || !clientId || !clientSecret}
              style={{ flex: 2 }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Đang tạo...
                </>
              ) : (
                <>
                  <Store size={16} />
                  Tạo & Kết nối Shopify
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Connecting */}
      {step === 3 && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <Loader2
            size={48}
            className="animate-spin"
            style={{ margin: "0 auto 16px", opacity: 0.5 }}
          />
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>
            Đang chuyển sang Shopify...
          </h3>
          <p style={{ opacity: 0.5, fontSize: "0.85rem" }}>
            Bạn sẽ được chuyển hướng để xác nhận quyền
          </p>
        </div>
      )}
    </div>
  );
}

export default function NewStorePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center" style={{ padding: 64, opacity: 0.5 }}>
          <Loader2 size={24} className="animate-spin" />
        </div>
      }
    >
      <NewStoreContent />
    </Suspense>
  );
}

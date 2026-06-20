"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { X, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, ExternalLink, Mail, Shield, Key, Eye, EyeOff } from "lucide-react";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

type Provider = "gmail" | "custom";
type TestStatus = "idle" | "testing" | "ok" | "fail";
type Encryption = "ssl" | "starttls" | "none";

const GMAIL_PRESET = {
  inbound: { host: "imap.gmail.com", port: 993, encryption: "ssl" as const },
  outbound: { host: "smtp.gmail.com", port: 587, encryption: "starttls" as const },
};

const GMAIL_GUIDE_STEPS = [
  {
    icon: Mail,
    title: "Kiểm tra IMAP đã bật",
    description: "Mở Gmail → ⚙️ Settings → Forwarding and POP/IMAP → kiểm tra \"IMAP access\" đã bật.",
    note: "Từ 1/2025, Gmail mặc định bật IMAP. Nếu không thấy nút Enable/Disable, IMAP đã bật sẵn.",
    image: "/guides/gmail/step1-imap-settings.png",
  },
  {
    icon: Shield,
    title: "Tạo App Password",
    description: "Vào myaccount.google.com/apppasswords → nhập tên app (VD: \"VietMinh CRM\") → bấm Create.",
    note: "Yêu cầu bật Xác minh 2 bước trước. Nếu chưa bật: myaccount.google.com/signinoptions/two-step-verification",
    link: "https://myaccount.google.com/apppasswords",
    image: "/guides/gmail/step2-app-passwords.png",
  },
  {
    icon: Key,
    title: "Copy App Password",
    description: "Copy 16 ký tự (VD: \"bhvl xzvg uvnq jsfk\") và dán vào ô App Password bên dưới.",
    note: "Password chỉ hiện 1 lần. Có thể dán cả khoảng trắng, hệ thống sẽ tự xử lý.",
    image: "/guides/gmail/step3-generated-password.png",
  },
];

export function CreateMailboxModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState<Provider>("gmail");
  const [appPassword, setAppPassword] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [importMode, setImportMode] = useState<"new_only" | "all_archive" | "all">("new_only");

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Step 2 — Custom only
  const [inHost, setInHost] = useState(GMAIL_PRESET.inbound.host);
  const [inPort, setInPort] = useState(GMAIL_PRESET.inbound.port);
  const [inEnc, setInEnc] = useState<Encryption>(GMAIL_PRESET.inbound.encryption);
  const [inUser, setInUser] = useState("");
  const [inPass, setInPass] = useState("");
  const [outHost, setOutHost] = useState(GMAIL_PRESET.outbound.host);
  const [outPort, setOutPort] = useState(GMAIL_PRESET.outbound.port);
  const [outEnc, setOutEnc] = useState<Encryption>(GMAIL_PRESET.outbound.encryption);
  const [outUser, setOutUser] = useState("");
  const [outPass, setOutPass] = useState("");

  const [inTest, setInTest] = useState<TestStatus>("idle");
  const [outTest, setOutTest] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState("");

  // Gmail probe result
  const [probeStatus, setProbeStatus] = useState<TestStatus>("idle");
  const [probeError, setProbeError] = useState("");

  const applyPreset = (p: Provider) => {
    setProvider(p);
    if (p === "gmail") {
      setInHost(GMAIL_PRESET.inbound.host);
      setInPort(GMAIL_PRESET.inbound.port);
      setInEnc(GMAIL_PRESET.inbound.encryption);
      setOutHost(GMAIL_PRESET.outbound.host);
      setOutPort(GMAIL_PRESET.outbound.port);
      setOutEnc(GMAIL_PRESET.outbound.encryption);
    } else {
      setInHost(""); setInPort(993); setInEnc("ssl");
      setOutHost(""); setOutPort(587); setOutEnc("starttls");
    }
  };

  const goStep2 = () => {
    if (!name.trim() || !email.trim()) {
      toast.error("Nhập tên và email");
      return;
    }
    if (provider === "gmail") {
      if (!appPassword.trim()) {
        toast.error("Nhập App Password");
        return;
      }
      // Gmail: probe auto-detect
      doGmailProbe();
    } else {
      setInUser(email); setOutUser(email);
      setStep(2);
    }
  };

  const doGmailProbe = async () => {
    setProbeStatus("testing");
    setProbeError("");
    setStep(2);
    try {
      const res = await fetch("/api/admin/mailboxes/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probe: true, email, password: appPassword }),
      });
      const data = await res.json();
      if (data.result === "ok") {
        setProbeStatus("ok");
        toast.success("Gmail kết nối thành công!");
      } else {
        setProbeStatus("fail");
        setProbeError(data.message_human || data.message || "Không thể kết nối Gmail. Kiểm tra email và App Password.");
      }
    } catch {
      setProbeStatus("fail");
      setProbeError("Lỗi kết nối server");
    }
  };

  const doTest = async (direction: "inbound" | "outbound") => {
    const setter = direction === "inbound" ? setInTest : setOutTest;
    setter("testing");
    setTestError("");
    try {
      const payload: Record<string, unknown> = {};
      if (direction === "inbound") {
        payload.inbound = { host: inHost, port: inPort, encryption: inEnc, username: inUser, password: inPass };
      } else {
        payload.outbound = { host: outHost, port: outPort, encryption: outEnc, username: outUser, password: outPass, email };
      }
      const res = await fetch("/api/admin/mailboxes/test-connection", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      const result = direction === "inbound" ? data.inbound : data.outbound;
      if (result?.result === "ok") {
        setter("ok");
        toast.success(`${direction === "inbound" ? "IMAP" : "SMTP"} kết nối thành công`);
      } else {
        setter("fail");
        setTestError(result?.message_human || result?.message || "Connection failed");
      }
    } catch {
      setter("fail");
      setTestError("Lỗi kết nối");
    }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name, email, provider, importMode };
      if (provider === "gmail") {
        payload.appPassword = appPassword;
      } else {
        payload.inbound = { host: inHost, port: inPort, encryption: inEnc, username: inUser, password: inPass };
        payload.outbound = { host: outHost, port: outPort, encryption: outEnc, username: outUser, password: outPass };
      }
      const res = await fetch("/api/admin/mailboxes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success("Tạo mailbox thành công!");
        onCreated();
      } else {
        const err = await res.json();
        toast.error(err.details || err.error || "Lỗi tạo mailbox");
      }
    } catch {
      toast.error("Lỗi kết nối");
    } finally {
      setSaving(false);
    }
  };

  const TestIcon = ({ status }: { status: TestStatus }) => {
    if (status === "testing") return <Loader2 size={14} className="animate-spin" />;
    if (status === "ok") return <CheckCircle2 size={14} style={{ color: "#16a34a" }} />;
    if (status === "fail") return <XCircle size={14} style={{ color: "#dc2626" }} />;
    return null;
  };

  return (
    <div style={{
      ...overlayStyle,
      opacity: isMounted ? 1 : 0,
      transition: "opacity 200ms ease-out"
    }}>
      <div style={{
        ...modalStyle,
        transform: isMounted ? "scale(1)" : "scale(0.95)",
        transition: "transform 200ms ease-out"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
              Tạo Mailbox
            </h2>
            <span style={{ padding: "2px 8px", background: "var(--bg-secondary, #f3f4f6)", borderRadius: 12, fontSize: "0.75rem", fontWeight: 600 }}>
              Step {step}/2
            </span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>

        {/* ── Step 1: Info + Gmail guide ───────────────────────────── */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <label style={labelStyle}>
              Tên mailbox
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Support" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="support@example.com" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Provider
              <select value={provider} onChange={(e) => applyPreset(e.target.value as Provider)} style={inputStyle}>
                <option value="gmail">Gmail</option>
                <option value="custom">Custom IMAP/SMTP</option>
              </select>
            </label>

            {provider === "gmail" && (
              <>
                <label style={labelStyle}>
                  App Password
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type={showPass ? "text" : "password"}
                      value={appPassword}
                      onChange={(e) => setAppPassword(e.target.value)}
                      placeholder="Dán 16 ký tự App Password"
                      style={{ ...inputStyle, width: "100%", paddingRight: "2.5rem" }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      style={{ position: "absolute", right: "0.5rem", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted, #9ca3af)", padding: 4 }}
                      aria-label={showPass ? "Ẩn password" : "Hiện password"}
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary, #6b7280)" }}>
                    16 ký tự từ Google App Passwords, VD: bhvl xzvg uvnq jsfk
                  </span>
                </label>

                {/* Collapsible Gmail Guide */}
                <div style={guideContainerStyle}>
                  <button
                    onClick={() => setGuideOpen(!guideOpen)}
                    style={guideToggleStyle}
                  >
                    {guideOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Mail size={14} /> Hướng dẫn cài đặt Gmail</span>
                  </button>

                  {guideOpen && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "0.75rem 0 0" }}>
                      {GMAIL_GUIDE_STEPS.map((gs, idx) => {
                        const Icon = gs.icon;
                        return (
                          <div key={idx} style={guideStepStyle}>
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                              <div style={guideStepIconStyle}>
                                <Icon size={14} />
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                                  {idx + 1}. {gs.title}
                                </div>
                                <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #4b5563)" }}>
                                  {gs.description}
                                </p>
                                {gs.note && (
                                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.7rem", color: "var(--text-tertiary, #9ca3af)", fontStyle: "italic" }}>
                                    💡 {gs.note}
                                  </p>
                                )}
                                {gs.link && (
                                  <a
                                    href={gs.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.7rem", color: "var(--color-primary, #4f46e5)", marginTop: "0.25rem" }}
                                  >
                                    Mở trang <ExternalLink size={10} />
                                  </a>
                                )}
                              </div>
                            </div>
                            {gs.image && (
                              <img
                                src={gs.image}
                                alt={gs.title}
                                onClick={() => setLightboxImg(gs.image)}
                                style={guideThumbnailStyle}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Import Mode selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary, #374151)" }}>Chế độ nhận email</span>
              {([
                { value: "new_only" as const, label: "Chỉ email mới", desc: "Chỉ nhận email chưa đọc. Nhanh, không ảnh hưởng email cũ.", recommended: true },
                { value: "all_archive" as const, label: "Tất cả + Lưu trữ email cũ", desc: "Import toàn bộ inbox. Email cũ được lưu trữ (trạng thái: closed)." },
                { value: "all" as const, label: "Tất cả (xóa khỏi mail server)", desc: "Import và xóa email khỏi server. Không khuyến nghị cho Gmail cá nhân.", warning: true },
              ]).map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex", gap: "0.5rem", padding: "0.6rem 0.75rem",
                    borderRadius: 8,
                    border: `1.5px solid ${importMode === opt.value ? "var(--color-primary, #4f46e5)" : "var(--border-color, #e5e7eb)"}`,
                    background: importMode === opt.value ? "var(--color-primary-light, #eef2ff)" : "transparent",
                    cursor: "pointer", transition: "all 0.15s ease",
                  }}
                >
                  <input
                    type="radio"
                    name="importMode"
                    value={opt.value}
                    checked={importMode === opt.value}
                    onChange={() => setImportMode(opt.value)}
                    style={{ marginTop: 2, accentColor: "var(--color-primary, #4f46e5)" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.375rem" }}>
                      {opt.label}
                      {opt.recommended && (
                        <span style={{ fontSize: "0.65rem", background: "#16a34a", color: "#fff", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>Khuyến nghị</span>
                      )}
                      {opt.warning && (
                        <span style={{ fontSize: "0.65rem", background: "#f59e0b", color: "#fff", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>⚠️</span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary, #6b7280)", marginTop: 2 }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <button onClick={goStep2} style={primaryBtnStyle}>
              {provider === "gmail" ? "Kiểm tra & Tiếp tục" : "Tiếp tục"}
            </button>
          </div>
        )}

        {/* ── Step 2 Gmail: Probe result ──────────────────────────── */}
        {step === 2 && provider === "gmail" && !saving && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={probeResultStyle}>
              {probeStatus === "testing" && (
                <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
                  <Loader2 size={32} className="animate-spin" style={{ margin: "0 auto 1rem", color: "var(--color-primary, #4f46e5)" }} />
                  <p style={{ fontWeight: 600, margin: "0 0 0.5rem" }}>Đang kiểm tra kết nối Gmail...</p>
                  <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: 0 }}>Tự động kiểm tra IMAP + SMTP, có thể mất 10-15 giây</p>
                </div>
              )}
              {probeStatus === "ok" && (
                <div style={{ textAlign: "center", padding: "1.5rem 1rem" }}>
                  <CheckCircle2 size={40} style={{ color: "#16a34a", margin: "0 auto 0.75rem" }} />
                  <p style={{ fontWeight: 600, margin: "0 0 0.5rem", color: "#16a34a" }}>Kết nối thành công!</p>
                  <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: 0 }}>
                    IMAP (imap.gmail.com:993) và SMTP (smtp.gmail.com:587) đã xác nhận.
                  </p>
                </div>
              )}
              {probeStatus === "fail" && (
                <div style={{ padding: "1.5rem 1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <XCircle size={20} style={{ color: "#dc2626" }} />
                    <p style={{ fontWeight: 600, margin: 0, color: "#dc2626" }}>Kết nối thất bại</p>
                  </div>
                  <p style={{ fontSize: "0.8rem", color: "#dc2626", margin: "0 0 0.75rem", background: "#fef2f2", padding: "0.5rem 0.75rem", borderRadius: 6 }}>
                    {probeError}
                  </p>
                  <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    <p style={{ margin: "0 0 0.25rem", fontWeight: 600 }}>Kiểm tra:</p>
                    <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                      <li>Email và App Password chính xác</li>
                      <li>Đã bật Xác minh 2 bước trên Google Account</li>
                      <li>App Password chưa bị thu hồi</li>
                      <li>IMAP đã bật trong Gmail Settings</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button onClick={() => { setStep(1); setProbeStatus("idle"); }} style={secondaryBtnStyle}>Quay lại</button>
              {probeStatus === "fail" && (
                <button onClick={doGmailProbe} style={{ ...secondaryBtnStyle, color: "var(--color-primary, #4f46e5)" }}>
                  Thử lại
                </button>
              )}
              {probeStatus === "ok" && (
                <button onClick={doSave} style={primaryBtnStyle}>Tạo Mailbox</button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2 Custom: Manual IMAP/SMTP ────────────────────── */}
        {step === 2 && provider === "custom" && !saving && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <fieldset style={fieldsetStyle}>
              <legend style={{ fontWeight: 600 }}>Inbound (IMAP)</legend>
              <div style={gridStyle}>
                <label style={labelStyle}>Host<input value={inHost} onChange={(e) => setInHost(e.target.value)} style={inputStyle} /></label>
                <label style={labelStyle}>Port<input type="number" value={inPort} onChange={(e) => setInPort(Number(e.target.value))} style={inputStyle} /></label>
              </div>
              <div style={gridStyle}>
                <label style={labelStyle}>Encryption
                  <select value={inEnc} onChange={(e) => setInEnc(e.target.value as Encryption)} style={inputStyle}>
                    <option value="ssl">SSL</option><option value="starttls">STARTTLS</option><option value="none">None</option>
                  </select>
                </label>
                <label style={labelStyle}>Username<input value={inUser} onChange={(e) => setInUser(e.target.value)} style={inputStyle} /></label>
              </div>
              <label style={labelStyle}>Password<input type="password" value={inPass} onChange={(e) => setInPass(e.target.value)} style={inputStyle} /></label>
              <button onClick={() => doTest("inbound")} disabled={inTest === "testing"} style={testBtnStyle}>
                <TestIcon status={inTest} /> Test Inbound
              </button>
            </fieldset>

            <fieldset style={fieldsetStyle}>
              <legend style={{ fontWeight: 600 }}>Outbound (SMTP)</legend>
              <div style={gridStyle}>
                <label style={labelStyle}>Host<input value={outHost} onChange={(e) => setOutHost(e.target.value)} style={inputStyle} /></label>
                <label style={labelStyle}>Port<input type="number" value={outPort} onChange={(e) => setOutPort(Number(e.target.value))} style={inputStyle} /></label>
              </div>
              <div style={gridStyle}>
                <label style={labelStyle}>Encryption
                  <select value={outEnc} onChange={(e) => setOutEnc(e.target.value as Encryption)} style={inputStyle}>
                    <option value="ssl">SSL</option><option value="starttls">STARTTLS</option><option value="none">None</option>
                  </select>
                </label>
                <label style={labelStyle}>Username<input value={outUser} onChange={(e) => setOutUser(e.target.value)} style={inputStyle} /></label>
              </div>
              <label style={labelStyle}>Password<input type="password" value={outPass} onChange={(e) => setOutPass(e.target.value)} style={inputStyle} /></label>
              <button onClick={() => doTest("outbound")} disabled={outTest === "testing"} style={testBtnStyle}>
                <TestIcon status={outTest} /> Test Outbound
              </button>
            </fieldset>

            {testError && <p style={{ color: "#dc2626", fontSize: "0.8rem", margin: 0 }}>{testError}</p>}

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button onClick={() => setStep(1)} style={secondaryBtnStyle}>Quay lại</button>
              <button onClick={doSave} style={primaryBtnStyle}>Tạo Mailbox</button>
            </div>
          </div>
        )}

        {saving && (
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: "0 auto 1rem" }} />
            <p style={{ fontWeight: 600 }}>Đang kiểm tra và tạo mailbox...</p>
            <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>Có thể mất tới 30 giây</p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxImg && (
        <div
          onClick={() => setLightboxImg(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
            display: "flex", justifyContent: "center", alignItems: "center",
            zIndex: 1100, cursor: "zoom-out", padding: "2rem",
          }}
        >
          <img
            src={lightboxImg}
            alt="Guide preview"
            style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
          />
        </div>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex",
  justifyContent: "center", alignItems: "center", zIndex: 1000, padding: "1rem",
};
const modalStyle: React.CSSProperties = {
  background: "var(--bg-primary, #fff)", borderRadius: 12, padding: "1.5rem",
  width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto",
};
const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 500 };
const inputStyle: React.CSSProperties = { padding: "0.5rem", border: "1px solid var(--border-color, #d1d5db)", borderRadius: 6, fontSize: "0.875rem" };
const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" };
const fieldsetStyle: React.CSSProperties = { border: "1px solid var(--border-color, #d1d5db)", borderRadius: 8, padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" };
const primaryBtnStyle: React.CSSProperties = { padding: "0.625rem 1.25rem", background: "var(--color-primary, #4f46e5)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" };
const secondaryBtnStyle: React.CSSProperties = { padding: "0.625rem 1.25rem", background: "transparent", border: "1px solid var(--border-color, #d1d5db)", borderRadius: 8, fontWeight: 600, cursor: "pointer" };
const testBtnStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem", border: "1px solid var(--border-color, #d1d5db)", borderRadius: 6, background: "transparent", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, alignSelf: "flex-start" };

const guideContainerStyle: React.CSSProperties = {
  border: "1px solid var(--border-color, #e5e7eb)",
  borderRadius: 8,
  padding: "0.75rem",
  background: "var(--bg-secondary, #f9fafb)",
};
const guideToggleStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, background: "none",
  border: "none", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600,
  color: "var(--text-primary, #1f2937)", padding: 0, width: "100%",
};
const guideStepStyle: React.CSSProperties = {
  background: "var(--bg-primary, #fff)",
  border: "1px solid var(--border-color, #e5e7eb)",
  borderRadius: 6,
  padding: "0.75rem",
};
const guideStepIconStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  background: "var(--color-primary-light, #eef2ff)",
  color: "var(--color-primary, #4f46e5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
};
const guideThumbnailStyle: React.CSSProperties = {
  width: "100%", maxHeight: 120, objectFit: "cover", objectPosition: "top",
  borderRadius: 4, marginTop: "0.5rem", cursor: "zoom-in",
  border: "1px solid var(--border-color, #e5e7eb)",
};
const probeResultStyle: React.CSSProperties = {
  border: "1px solid var(--border-color, #e5e7eb)",
  borderRadius: 8,
  background: "var(--bg-secondary, #f9fafb)",
  minHeight: 120,
};

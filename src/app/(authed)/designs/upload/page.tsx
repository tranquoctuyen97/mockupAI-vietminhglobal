"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
import Link from "next/link";

export default function UploadDesignPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    id: string;
    width: number;
    height: number;
    dpi: number | null;
    previewUrl: string;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFile = useCallback((f: File) => {
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(f.type)) {
      setError("Chỉ chấp nhận PNG, JPG, hoặc WEBP");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setError("File quá lớn (tối đa 20MB)");
      return;
    }
    setFile(f);
    setError("");
    setName(f.name.replace(/\.[^.]+$/, ""));
    // Generate local preview
    const url = URL.createObjectURL(f);
    setPreview(url);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
  }, []);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);
    if (name) formData.append("name", name);

    try {
      const res = await fetch("/api/designs/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Upload thất bại");
        return;
      }

      setResult(data);
    } catch {
      setError("Không thể kết nối server");
    } finally {
      setUploading(false);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Upload Design</h1>
        <p className="page-subtitle">Upload file thiết kế để sử dụng trong Wizard</p>
      </div>

      {/* Success State */}
      {result && (
        <div className="card" style={{ padding: 24 }}>
          <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
            <CheckCircle2 size={24} style={{ color: "var(--color-wise-green)" }} />
            <div>
              <h3 style={{ fontWeight: 700, margin: 0 }}>Upload thành công!</h3>
              <p style={{ opacity: 0.6, fontSize: "0.85rem", margin: 0 }}>
                {result.width} × {result.height}px
                {result.dpi && ` · ${result.dpi} DPI`}
              </p>
            </div>
          </div>

          {result.dpi && result.dpi < 150 && (
            <div
              className="flex items-center gap-2"
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(234, 179, 8, 0.1)",
                border: "1px solid rgba(234, 179, 8, 0.3)",
                color: "#b45309",
                fontSize: "0.8rem",
                marginBottom: 16,
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              DPI thấp ({result.dpi}). Chất lượng in có thể không tốt (khuyến nghị ≥ 150 DPI).
            </div>
          )}

          <div className="flex gap-3" style={{ marginTop: 16 }}>
            <button
              className="btn btn-primary"
              onClick={() => router.push("/designs")}
            >
              Xem thư viện
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setFile(null);
                setPreview(null);
                setResult(null);
                setName("");
              }}
            >
              Upload thêm
            </button>
          </div>
        </div>
      )}

      {/* Upload Form */}
      {!result && (
        <>
          {/* Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => document.getElementById("file-input")?.click()}
            className="card"
            style={{
              padding: 48,
              textAlign: "center",
              cursor: "pointer",
              border: dragActive
                ? "2px dashed var(--color-wise-green)"
                : "2px dashed var(--border-default)",
              backgroundColor: dragActive
                ? "rgba(146, 198, 72, 0.05)"
                : "transparent",
              transition: "all 0.2s",
            }}
          >
            <input
              id="file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />

            {preview ? (
              <div>
                <img
                  src={preview}
                  alt="Preview"
                  style={{
                    maxHeight: 200,
                    maxWidth: "100%",
                    borderRadius: "var(--radius-md)",
                    marginBottom: 12,
                  }}
                />
                <p style={{ fontWeight: 600, margin: 0 }}>{file?.name}</p>
                <p style={{ opacity: 0.5, fontSize: "0.8rem", margin: "4px 0 0" }}>
                  {file && formatSize(file.size)}
                </p>
              </div>
            ) : (
              <>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    backgroundColor: "var(--bg-tertiary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                  }}
                >
                  <ImageIcon size={28} style={{ opacity: 0.4 }} />
                </div>
                <p style={{ fontWeight: 600, margin: "0 0 4px" }}>
                  Kéo thả file vào đây hoặc click để chọn
                </p>
                <p style={{ opacity: 0.5, fontSize: "0.8rem", margin: 0 }}>
                  PNG, JPG, WEBP · Tối đa 20MB
                </p>
              </>
            )}
          </div>

          {/* Name input + Upload button */}
          {file && (
            <div style={{ marginTop: 16 }}>
              <label
                className="block mb-1.5 text-caption"
                style={{ fontWeight: 600, color: "var(--text-secondary)" }}
              >
                Tên design
              </label>
              <input
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nhập tên design"
              />

              {error && (
                <div
                  className="flex items-center gap-2"
                  style={{
                    marginTop: 12,
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    color: "var(--color-error)",
                    fontSize: "0.85rem",
                  }}
                >
                  <AlertTriangle size={14} />
                  {error}
                </div>
              )}

              <button
                className="btn btn-primary w-full"
                style={{ marginTop: 16, justifyContent: "center" }}
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Đang upload...
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    Upload Design
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Error without file */}
      {error && !file && (
        <div
          className="flex items-center gap-2"
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            color: "var(--color-error)",
            fontSize: "0.85rem",
          }}
        >
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Back link */}
      <div style={{ marginTop: 24, textAlign: "center" }}>
        <Link
          href="/designs"
          className="flex items-center justify-center gap-2"
          style={{ fontSize: "0.875rem", opacity: 0.6, color: "inherit" }}
        >
          <ArrowLeft size={14} />
          Quay lại thư viện Designs
        </Link>
      </div>
    </div>
  );
}

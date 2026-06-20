"use client";

import { AlertTriangle, CheckCircle2, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useId, useMemo, useRef, useState } from "react";

const MAX_FILES = 80;
const MAX_CONCURRENT_UPLOADS = 5;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_RETRIES = 3;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

interface StoreOption {
  id: string;
  name: string;
}

interface UploadFileItem {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  progress: number;
  status: "queued" | "uploading" | "success" | "error";
  attempts: number;
  error: string | null;
}

interface UploadedDesignResult {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number | null;
  previewUrl: string;
}

interface Props {
  stores: StoreOption[];
  initialStoreId: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}

function isUploadFinished(files: UploadFileItem[], uploading: boolean): boolean {
  return (
    files.length > 0 &&
    !uploading &&
    files.every((file) => file.status === "success" || file.status === "error")
  );
}

export default function UploadDesignClient({ stores, initialStoreId }: Props) {
  const storeSelectId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialSelectedStoreId =
    initialStoreId && stores.some((store) => store.id === initialStoreId) ? initialStoreId : "";
  const [storeId, setStoreId] = useState(initialSelectedStoreId);
  const [files, setFiles] = useState<UploadFileItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const runningRef = useRef(0);
  const queueRef = useRef<UploadFileItem[]>([]);

  const completeCount = files.filter((file) => file.status === "success").length;
  const failedCount = files.filter((file) => file.status === "error").length;
  const hasFiles = files.length > 0;
  const canUpload = hasFiles && Boolean(storeId) && !uploading;
  const uploadFinished = isUploadFinished(files, uploading);

  const selectedStoreName = useMemo(
    () => stores.find((store) => store.id === storeId)?.name ?? "",
    [storeId, stores],
  );

  const updateFile = useCallback((id: string, patch: Partial<UploadFileItem>) => {
    setFiles((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setError("");
    const nextFiles = Array.from(incoming);
    const accepted: UploadFileItem[] = [];

    for (const file of nextFiles) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setError("Chỉ chấp nhận PNG hoặc JPG");
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("File quá lớn (tối đa 100MB/file)");
        continue;
      }
      accepted.push({
        id: createFileId(file),
        file,
        name: file.name.replace(/\.[^.]+$/, ""),
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        status: "queued",
        attempts: 0,
        error: null,
      });
    }

    setFiles((current) => {
      const slots = Math.max(0, MAX_FILES - current.length);
      if (accepted.length > slots) {
        setError(`Chỉ upload tối đa ${MAX_FILES} files mỗi batch`);
      }
      return [...current, ...accepted.slice(0, slots)];
    });
  }, []);

  function removeFile(id: string) {
    setFiles((current) => {
      const removed = current.find((file) => file.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((file) => file.id !== id);
    });
  }

  function clearFiles() {
    setFiles((current) => {
      current.forEach((file) => {
        URL.revokeObjectURL(file.previewUrl);
      });
      return [];
    });
    queueRef.current = [];
  }

  function handleStoreChange(nextStoreId: string) {
    if (uploading) return;
    if (hasFiles && nextStoreId !== storeId) {
      const confirmed = window.confirm(
        "Đổi store sẽ xóa danh sách file đang chọn để tránh upload nhầm. Tiếp tục?",
      );
      if (!confirmed) return;
      clearFiles();
    }
    setError("");
    setStoreId(nextStoreId);
  }

  function openFileDialog() {
    fileInputRef.current?.click();
  }

  function uploadOne(
    fileItem: UploadFileItem,
    selectedStoreId: string,
  ): Promise<UploadedDesignResult> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("file", fileItem.file);
      form.append("name", fileItem.name);
      form.append("storeId", selectedStoreId);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/designs/upload");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          updateFile(fileItem.id, {
            progress: Math.round((event.loaded / event.total) * 100),
          });
        }
      };
      xhr.onload = () => {
        let data: { error?: string } & Partial<UploadedDesignResult> = {};
        try {
          data = JSON.parse(xhr.responseText || "{}");
        } catch {
          data = { error: xhr.responseText || "Upload thất bại" };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as UploadedDesignResult);
        } else {
          reject(new Error(data.error || "Upload thất bại"));
        }
      };
      xhr.onerror = () => reject(new Error("Không thể kết nối server"));
      xhr.send(form);
    });
  }

  async function runFile(fileItem: UploadFileItem, selectedStoreId: string) {
    updateFile(fileItem.id, {
      status: "uploading",
      attempts: fileItem.attempts + 1,
      error: null,
    });

    try {
      await uploadOne(fileItem, selectedStoreId);
      updateFile(fileItem.id, { status: "success", progress: 100, error: null });
    } catch (err) {
      const nextAttempts = fileItem.attempts + 1;
      if (nextAttempts < MAX_RETRIES) {
        queueRef.current.push({ ...fileItem, attempts: nextAttempts });
      } else {
        updateFile(fileItem.id, {
          status: "error",
          progress: 0,
          attempts: nextAttempts,
          error: err instanceof Error ? err.message : "Upload thất bại",
        });
      }
    } finally {
      runningRef.current -= 1;
      drainQueue(selectedStoreId);
    }
  }

  function drainQueue(selectedStoreId: string) {
    while (runningRef.current < MAX_CONCURRENT_UPLOADS && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) break;
      runningRef.current += 1;
      void runFile(next, selectedStoreId);
    }

    if (runningRef.current === 0 && queueRef.current.length === 0) {
      setUploading(false);
    }
  }

  function handleUpload() {
    if (!storeId) {
      setError("Vui lòng chọn store trước khi upload");
      return;
    }
    const queued = files.filter((file) => file.status === "queued" || file.status === "error");
    if (queued.length === 0) return;
    setUploading(true);
    setError("");
    queueRef.current = queued.map((file) => ({ ...file, progress: 0, status: "queued" }));
    drainQueue(storeId);
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Upload Designs</h1>
        <p className="page-subtitle">
          {selectedStoreName
            ? `Design mới sẽ được upload vào ${selectedStoreName}`
            : "Chọn store trước để tránh upload nhầm thư viện"}
        </p>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div className="flex items-center justify-between gap-3" style={{ marginBottom: 10 }}>
          <div>
            <label
              htmlFor={storeSelectId}
              className="block mb-1.5 text-caption"
              style={{ fontWeight: 600 }}
            >
              Store nhận design
            </label>
            <p style={{ opacity: 0.55, fontSize: "0.82rem", margin: 0 }}>
              File upload sẽ được gắn trực tiếp vào store đang chọn.
            </p>
          </div>
          {selectedStoreName ? (
            <span
              style={{
                borderRadius: 999,
                background: "rgba(146, 198, 72, 0.14)",
                color: "var(--color-wise-green)",
                fontSize: "0.78rem",
                fontWeight: 700,
                padding: "7px 12px",
                whiteSpace: "nowrap",
              }}
            >
              Uploading to {selectedStoreName}
            </span>
          ) : null}
        </div>
        <select
          id={storeSelectId}
          className="input"
          value={storeId}
          disabled={uploading}
          onChange={(event) => handleStoreChange(event.target.value)}
        >
          {stores.length > 0 ? <option value="">Chọn store...</option> : null}
          {stores.length === 0 ? <option value="">Chưa có store active</option> : null}
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </div>

      {storeId ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg"
            style={{ display: "none" }}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              addFiles(event.dataTransfer.files);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onClick={openFileDialog}
            className="card"
            style={{
              width: "100%",
              padding: 36,
              textAlign: "center",
              cursor: "pointer",
              border: dragActive
                ? "2px dashed var(--color-wise-green)"
                : "2px dashed var(--border-default)",
              backgroundColor: dragActive ? "rgba(146, 198, 72, 0.05)" : "transparent",
              color: "inherit",
            }}
          >
            <ImageIcon size={32} style={{ opacity: 0.35, marginBottom: 10 }} />
            <p style={{ fontWeight: 700, margin: "0 0 4px" }}>Kéo thả hoặc click để chọn files</p>
            <p style={{ opacity: 0.55, fontSize: "0.82rem", margin: 0 }}>
              PNG, JPG · tối đa {MAX_FILES} files · 100MB/file · 5 upload song song
            </p>
          </button>
        </>
      ) : (
        <div className="card" style={{ padding: 36, textAlign: "center" }}>
          <ImageIcon size={32} style={{ opacity: 0.28, marginBottom: 10 }} />
          <p style={{ fontWeight: 700, margin: "0 0 4px" }}>Chọn store trước khi chọn file</p>
          <p style={{ opacity: 0.55, fontSize: "0.82rem", margin: 0 }}>
            Dropzone sẽ mở sau khi có store nhận design.
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2"
          style={{ marginTop: 12, color: "var(--color-error)" }}
        >
          <AlertTriangle size={14} />
          <span style={{ fontSize: "0.85rem" }}>{error}</span>
        </div>
      )}

      {uploadFinished && (
        <div
          className="card flex items-center justify-between gap-3"
          style={{
            padding: 16,
            marginTop: 18,
            borderColor: failedCount ? "var(--color-error)" : "rgba(146, 198, 72, 0.45)",
          }}
        >
          <div className="flex items-center gap-2">
            {failedCount ? (
              <AlertTriangle size={18} style={{ color: "var(--color-error)" }} />
            ) : (
              <CheckCircle2 size={18} style={{ color: "var(--color-wise-green)" }} />
            )}
            <div>
              <strong>
                {completeCount} uploaded{failedCount ? ` · ${failedCount} lỗi` : ""}
              </strong>
              <p style={{ opacity: 0.55, fontSize: "0.8rem", margin: "2px 0 0" }}>
                {selectedStoreName
                  ? `Kết quả đã được ghi vào ${selectedStoreName}.`
                  : "Hoàn tất batch upload."}
              </p>
            </div>
          </div>
          <Link
            href={storeId ? `/designs?storeId=${storeId}` : "/designs"}
            className="btn btn-primary"
          >
            Xem design trong {selectedStoreName || "store"}
          </Link>
        </div>
      )}

      {hasFiles && (
        <>
          <div
            className="flex items-center justify-between"
            style={{ marginTop: 18, marginBottom: 12 }}
          >
            <div>
              <strong>{files.length} files</strong>
              <span style={{ opacity: 0.55, marginLeft: 8 }}>
                {completeCount} done {selectedStoreName ? `· ${selectedStoreName}` : ""}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={uploading}
                onClick={clearFiles}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canUpload}
                onClick={handleUpload}
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Upload vào {selectedStoreName || "store"}
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            {files.map((file) => (
              <div key={file.id} className="card" style={{ padding: 10 }}>
                <div
                  style={{
                    position: "relative",
                    aspectRatio: "1 / 1",
                    background: "var(--bg-tertiary)",
                    overflow: "hidden",
                  }}
                >
                  <Image
                    src={file.previewUrl}
                    alt={file.name}
                    fill
                    sizes="180px"
                    unoptimized
                    style={{ width: "100%", height: "100%", objectFit: "contain", padding: 8 }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    disabled={file.status === "uploading"}
                    onClick={() => removeFile(file.id)}
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      border: "none",
                      borderRadius: 999,
                      background: "rgba(0,0,0,0.55)",
                      color: "white",
                      padding: 4,
                      cursor: "pointer",
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
                <p
                  style={{
                    fontWeight: 700,
                    fontSize: "0.78rem",
                    margin: "8px 0 2px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {file.name}
                </p>
                <p style={{ opacity: 0.5, fontSize: "0.72rem", margin: 0 }}>
                  {formatSize(file.file.size)}
                </p>
                <div
                  style={{
                    height: 6,
                    background: "var(--bg-tertiary)",
                    marginTop: 8,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${file.progress}%`,
                      background:
                        file.status === "error" ? "var(--color-danger)" : "var(--color-wise-green)",
                    }}
                  />
                </div>
                <div
                  className="flex items-center gap-1"
                  style={{ marginTop: 6, fontSize: "0.72rem", opacity: 0.7 }}
                >
                  {file.status === "success" ? <CheckCircle2 size={13} /> : null}
                  {file.status === "uploading" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : null}
                  <span>{file.error ?? file.status}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 20 }}>
        <Link
          href={storeId ? `/designs?storeId=${storeId}` : "/designs"}
          className="btn btn-secondary"
        >
          Xem thư viện
        </Link>
      </div>
    </div>
  );
}

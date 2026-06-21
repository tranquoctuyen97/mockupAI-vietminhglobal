"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Crop,
  FileImage,
  GripVertical,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

const MAX_FILES = 80;
const MAX_CONCURRENT_UPLOADS = 5;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_RETRIES = 3;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

interface StoreOption {
  id: string;
  name: string;
  domain: string;
  printifyConnected: boolean;
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
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const initialSelectedStoreId =
    initialStoreId && stores.some((store) => store.id === initialStoreId)
      ? initialStoreId
      : (stores[0]?.id ?? "");
  const [storeId, setStoreId] = useState(initialSelectedStoreId);
  const [files, setFiles] = useState<UploadFileItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const runningRef = useRef(0);
  const queueRef = useRef<UploadFileItem[]>([]);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === storeId) ?? null,
    [storeId, stores],
  );
  const completeCount = files.filter((file) => file.status === "success").length;
  const failedCount = files.filter((file) => file.status === "error").length;
  const pendingUploadCount = files.filter(
    (file) => file.status === "queued" || file.status === "error",
  ).length;
  const canUpload = pendingUploadCount > 0 && Boolean(storeId) && !uploading;
  const uploadFinished = isUploadFinished(files, uploading);
  const canViewUploadedDesigns = uploadFinished && completeCount > 0 && failedCount === 0;
  const primaryActionEnabled = canUpload || canViewUploadedDesigns;
  const designsHref = storeId ? `/designs?storeId=${storeId}` : "/designs";

  const updateFile = useCallback((id: string, patch: Partial<UploadFileItem>) => {
    setFiles((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setError("");
    const nextFiles = Array.from(incoming);
    const accepted: UploadFileItem[] = [];

    for (const file of nextFiles) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setError("Only PNG or JPG files are supported.");
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("File is too large. Maximum size is 100 MB per file.");
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
        setError(`Only ${MAX_FILES} files can be uploaded in one batch.`);
      }
      return [...current, ...accepted.slice(0, slots)];
    });
  }, []);

  function clearFiles() {
    for (const file of files) {
      URL.revokeObjectURL(file.previewUrl);
    }
    setFiles([]);
    queueRef.current = [];
  }

  function removeFile(id: string) {
    setFiles((current) => {
      const removed = current.find((file) => file.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((file) => file.id !== id);
    });
  }

  function handleStoreChange(nextStoreId: string) {
    if (uploading) return;
    if (files.length > 0 && nextStoreId !== storeId) {
      const confirmed = window.confirm(
        "Changing store will clear selected files to prevent uploading to the wrong library. Continue?",
      );
      if (!confirmed) return;
      clearFiles();
    }
    setError("");
    setStoreId(nextStoreId);
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
          data = { error: xhr.responseText || "Upload failed" };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as UploadedDesignResult);
        } else {
          reject(new Error(data.error || "Upload failed"));
        }
      };
      xhr.onerror = () => reject(new Error("Could not connect to server"));
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
          error: err instanceof Error ? err.message : "Upload failed",
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
      setError("Choose a store before uploading.");
      return;
    }
    if (canViewUploadedDesigns) {
      router.push(designsHref);
      router.refresh();
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
    <div style={pageWrap}>
      <section style={modalCard}>
        <header style={header}>
          <div>
            <h1 style={title}>Upload designs</h1>
            <p style={subtitle}>
              Add design files to your selected store library so they are ready for listing
              creation.
            </p>
          </div>
          <Link
            href={storeId ? `/designs?storeId=${storeId}` : "/designs"}
            style={closeButton}
            aria-label="Close upload"
          >
            <X size={20} />
          </Link>
        </header>

        <div style={storePillRow}>
          <span style={storePill}>
            <StoreAvatar name={selectedStore?.name ?? "Store"} />
            <select
              value={storeId}
              onChange={(event) => handleStoreChange(event.target.value)}
              style={storeSelect}
              disabled={uploading}
              aria-label="Store"
            >
              {stores.length > 0 ? <option value="">Choose store...</option> : null}
              {stores.length === 0 ? <option value="">No active stores</option> : null}
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
            {selectedStore && <span style={activeBadge}>Store active</span>}
            {selectedStore && (
              <span style={selectedStore.printifyConnected ? printifyBadge : warningBadge}>
                {selectedStore.printifyConnected ? "Printify" : "No Printify"}
              </span>
            )}
          </span>
        </div>

        <div style={topGrid}>
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
            onClick={() => inputRef.current?.click()}
            disabled={!storeId}
            style={{
              ...dropzone,
              borderColor: dragActive ? "#35a527" : "#d9dee7",
              background: dragActive ? "#f4fbf0" : "#fff",
              opacity: storeId ? 1 : 0.65,
              cursor: storeId ? "pointer" : "not-allowed",
            }}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg"
              style={{ display: "none" }}
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <span style={dropIcon}>
              <UploadCloud size={34} />
            </span>
            <strong style={{ fontSize: 17, marginTop: 16 }}>Drag and drop design files here</strong>
            <span style={mutedText}>PNG or JPG, up to 100 MB each</span>
            <span style={chooseFilesButton}>Choose files</span>
            <span style={browseText}>Browse existing uploads</span>
          </button>

          <aside style={tipsCard}>
            <h2 style={tipsTitle}>Upload tips</h2>
            <Tip icon={<FileImage size={20} />} title="Use transparent PNG when possible">
              Transparent artwork is easier to place across multiple product colors.
            </Tip>
            <Tip icon={<Sparkles size={20} />} title="High-resolution files work best">
              Upload large source files to keep final listings crisp.
            </Tip>
            <Tip icon={<Crop size={20} />} title="Keep artwork tightly cropped">
              Remove extra whitespace when possible for cleaner mockup placement.
            </Tip>
            <Tip icon={<Palette size={20} />} title="Store-specific library">
              Files uploaded here will only appear in the selected store workflow.
            </Tip>
          </aside>
        </div>

        {error && (
          <div style={errorRow}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        {uploadFinished && (
          <div style={{ ...finishedCard, borderColor: failedCount ? "#fecdca" : "#b7e4b2" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {failedCount ? (
                <AlertTriangle size={18} style={{ color: "#b42318" }} />
              ) : (
                <CheckCircle2 size={18} style={{ color: "#35a527" }} />
              )}
              <div>
                <strong>
                  {completeCount} uploaded{failedCount ? ` · ${failedCount} failed` : ""}
                </strong>
                <p style={{ margin: "2px 0 0", color: "#667085", fontSize: 12 }}>
                  Results were saved to {selectedStore?.name ?? "the selected store"}.
                </p>
              </div>
            </div>
            <Link href={designsHref} style={smallPrimaryLink}>
              View designs
            </Link>
          </div>
        )}

        {files.length > 0 && (
          <section style={fileSection}>
            <div style={fileHeader}>
              <strong>Files to upload ({files.length})</strong>
              <button type="button" style={clearButton} disabled={uploading} onClick={clearFiles}>
                <Trash2 size={15} /> Clear all
              </button>
            </div>
            <div style={fileList}>
              {files.map((file) => (
                <FileRow key={file.id} file={file} onRemove={removeFile} />
              ))}
            </div>
          </section>
        )}

        <footer style={footer}>
          <Link href={designsHref} style={secondaryButton}>
            Cancel
          </Link>
          <button
            type="button"
            style={primaryButton}
            disabled={!primaryActionEnabled}
            onClick={handleUpload}
          >
            {uploading ? <Loader2 size={17} className="animate-spin" /> : null}
            {uploading ? `Uploading ${completeCount}/${files.length}` : null}
            {!uploading && canViewUploadedDesigns ? "View designs" : null}
            {!uploading && (!uploadFinished || failedCount > 0)
              ? `${failedCount > 0 ? "Retry" : "Upload"} ${pendingUploadCount || files.length || ""} designs`
              : null}
          </button>
        </footer>
      </section>
    </div>
  );
}

function FileRow({ file, onRemove }: { file: UploadFileItem; onRemove: (id: string) => void }) {
  const fileType = file.file.type.includes("jpeg") ? "JPG" : "PNG";
  return (
    <div style={fileRow}>
      <GripVertical size={16} color="#98a2b3" />
      <div style={thumbnailWrap}>
        {/* biome-ignore lint/performance/noImgElement: Object URLs from local file previews are not compatible with Next image optimization. */}
        <img src={file.previewUrl} alt={file.name} style={thumbnail} />
      </div>
      <div style={{ minWidth: 0 }}>
        <strong style={fileName}>{file.file.name}</strong>
        <span style={fileSize}>{formatSize(file.file.size)}</span>
      </div>
      <div style={progressCell}>
        <div style={progressTrack}>
          <div
            style={{
              ...progressBar,
              width: `${file.progress}%`,
              background: file.status === "error" ? "#dc2626" : "#35a527",
            }}
          />
        </div>
        <span style={progressText}>{file.progress}%</span>
      </div>
      <span style={metaBadge}>{fileType}</span>
      <span style={metaBadge}>Artwork</span>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        disabled={file.status === "uploading"}
        onClick={() => onRemove(file.id)}
        style={removeButton}
      >
        {file.status === "success" ? <CheckCircle2 size={17} color="#35a527" /> : <X size={17} />}
      </button>
    </div>
  );
}

function Tip({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={tipRow}>
      <span style={tipIcon}>{icon}</span>
      <div>
        <strong style={{ display: "block", fontSize: 13, marginBottom: 4 }}>{title}</strong>
        <p style={{ margin: 0, color: "#475467", fontSize: 12, lineHeight: 1.45 }}>{children}</p>
      </div>
    </div>
  );
}

function StoreAvatar({ name }: { name: string }) {
  return <span style={storeAvatar}>{name.slice(0, 2).toUpperCase()}</span>;
}

const pageWrap: React.CSSProperties = {
  minHeight: "calc(100vh - 4rem)",
  display: "grid",
  placeItems: "start center",
  padding: "3rem 1rem",
};

const modalCard: React.CSSProperties = {
  width: "min(920px, 100%)",
  border: "1px solid #dfe4ea",
  borderRadius: 14,
  background: "#fff",
  boxShadow: "0 30px 90px rgba(16, 24, 40, 0.18)",
  padding: 28,
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 20,
  marginBottom: 18,
};

const title: React.CSSProperties = {
  margin: 0,
  color: "#101828",
  fontSize: 24,
  lineHeight: 1.2,
  fontWeight: 700,
};

const subtitle: React.CSSProperties = {
  margin: "6px 0 0",
  color: "#667085",
  fontSize: 14,
};

const closeButton: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  color: "#344054",
  textDecoration: "none",
};

const storePillRow: React.CSSProperties = {
  display: "flex",
  marginBottom: 20,
};

const storePill: React.CSSProperties = {
  minHeight: 46,
  border: "1px solid #dfe4ea",
  borderRadius: 10,
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  padding: "0 12px",
};

const storeAvatar: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  background: "#111827",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontSize: 10,
  fontWeight: 700,
};

const storeSelect: React.CSSProperties = {
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#101828",
  font: "inherit",
  fontWeight: 600,
};

const activeBadge: React.CSSProperties = {
  border: "1px solid #b7e4b2",
  background: "#ecfdf3",
  color: "#2f7d32",
  borderRadius: 7,
  padding: "3px 9px",
  fontSize: 12,
  fontWeight: 600,
};

const printifyBadge: React.CSSProperties = {
  ...activeBadge,
};

const warningBadge: React.CSSProperties = {
  border: "1px solid #fed7aa",
  background: "#fff7ed",
  color: "#b45309",
  borderRadius: 7,
  padding: "3px 9px",
  fontSize: 12,
  fontWeight: 600,
};

const topGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 320px",
  gap: 24,
  marginBottom: 24,
};

const dropzone: React.CSSProperties = {
  minHeight: 260,
  border: "1.5px dashed #d9dee7",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  color: "#101828",
  padding: 28,
};

const dropIcon: React.CSSProperties = {
  width: 70,
  height: 70,
  borderRadius: "50%",
  background: "#e9f8e3",
  color: "#35a527",
  display: "grid",
  placeItems: "center",
};

const mutedText: React.CSSProperties = { marginTop: 8, color: "#667085", fontSize: 14 };

const chooseFilesButton: React.CSSProperties = {
  marginTop: 18,
  minHeight: 42,
  borderRadius: 8,
  background: "linear-gradient(180deg, #45b832, #2f9e24)",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 22px",
  fontWeight: 600,
};

const browseText: React.CSSProperties = {
  marginTop: 14,
  color: "#475467",
  fontSize: 13,
};

const tipsCard: React.CSSProperties = {
  border: "1px solid #dfe4ea",
  borderRadius: 12,
  padding: 20,
  background: "linear-gradient(135deg, #fbfff8, #fff)",
};

const tipsTitle: React.CSSProperties = { margin: "0 0 16px", fontSize: 16, fontWeight: 700 };

const tipRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "34px minmax(0, 1fr)",
  gap: 12,
  alignItems: "start",
  marginBottom: 18,
};

const tipIcon: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 9,
  border: "1px solid #b7e4b2",
  background: "#f0faec",
  color: "#35a527",
  display: "grid",
  placeItems: "center",
};

const errorRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  color: "#b42318",
  fontSize: 13,
  marginBottom: 16,
};

const finishedCard: React.CSSProperties = {
  minHeight: 58,
  border: "1px solid",
  borderRadius: 10,
  padding: "10px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 16,
};

const smallPrimaryLink: React.CSSProperties = {
  minHeight: 36,
  borderRadius: 8,
  background: "linear-gradient(180deg, #45b832, #2f9e24)",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 14px",
  fontWeight: 600,
  textDecoration: "none",
};

const fileSection: React.CSSProperties = { marginTop: 8 };

const fileHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
};

const clearButton: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#475467",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
};

const fileList: React.CSSProperties = {
  border: "1px solid #dfe4ea",
  borderRadius: 10,
  overflow: "hidden",
};

const fileRow: React.CSSProperties = {
  minHeight: 78,
  display: "grid",
  gridTemplateColumns: "24px 58px minmax(150px, 1fr) 230px 92px 110px 28px",
  gap: 12,
  alignItems: "center",
  padding: "8px 14px",
  borderBottom: "1px solid #edf0f2",
};

const thumbnailWrap: React.CSSProperties = {
  width: 58,
  height: 58,
  borderRadius: 8,
  background: "#f2f4f7",
  overflow: "hidden",
  display: "grid",
  placeItems: "center",
};

const thumbnail: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  padding: 5,
};

const fileName: React.CSSProperties = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#101828",
  fontSize: 13,
};

const fileSize: React.CSSProperties = {
  display: "block",
  marginTop: 4,
  color: "#667085",
  fontSize: 12,
};

const progressCell: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 42px",
  gap: 10,
  alignItems: "center",
};
const progressTrack: React.CSSProperties = {
  height: 5,
  borderRadius: 99,
  background: "#edf0f2",
  overflow: "hidden",
};
const progressBar: React.CSSProperties = { height: "100%", borderRadius: 99 };
const progressText: React.CSSProperties = { color: "#475467", fontSize: 12 };
const metaBadge: React.CSSProperties = {
  minHeight: 32,
  border: "1px solid #dfe4ea",
  borderRadius: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#344054",
  fontSize: 13,
};

const removeButton: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "none",
  background: "transparent",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  color: "#101828",
};

const footer: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
  marginTop: 28,
};

const secondaryButton: React.CSSProperties = {
  minHeight: 44,
  border: "1px solid #d9dee7",
  borderRadius: 9,
  background: "#fff",
  color: "#101828",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 24px",
  fontWeight: 600,
  textDecoration: "none",
};

const primaryButton: React.CSSProperties = {
  minHeight: 44,
  border: "none",
  borderRadius: 9,
  background: "linear-gradient(180deg, #45b832, #2f9e24)",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "0 24px",
  fontWeight: 600,
  cursor: "pointer",
};

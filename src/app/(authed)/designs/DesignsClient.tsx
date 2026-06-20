"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

interface Design {
  id: string;
  name: string;
  storeId: string | null;
  store: { id: string; name: string } | null;
  previewUrl: string | null;
  width: number;
  height: number;
  dpi: number | null;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
}

interface StoreOption {
  id: string;
  name: string;
}

interface Props {
  initialDesigns: Design[];
  stores: StoreOption[];
  initialStoreId: string | null;
  invalidStoreSelected: boolean;
  initialTotal: number;
  initialTotalPages: number;
}

export default function DesignsClient({
  initialDesigns,
  stores,
  initialStoreId,
  invalidStoreSelected,
  initialTotal,
  initialTotalPages,
}: Props) {
  const router = useRouter();
  const [designs, setDesigns] = useState<Design[]>(initialDesigns);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeStoreId, setActiveStoreId] = useState<string | null>(initialStoreId);
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === activeStoreId) ?? null,
    [activeStoreId, stores],
  );
  const hasStores = stores.length > 0;
  const uploadHref = selectedStore
    ? `/designs/upload?storeId=${selectedStore.id}`
    : "/designs/upload";

  const fetchDesigns = useCallback(async (q: string, p: number, storeId: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (storeId) params.set("storeId", storeId);
      params.set("page", String(p));
      params.set("limit", "20");

      const res = await fetch(`/api/designs?${params}`);
      const data = await res.json();

      if (res.ok) {
        setDesigns(data.designs);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/designs/${id}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Xóa thất bại");
        return;
      }

      setDeleteConfirm(null);
      fetchDesigns(search, page, activeStoreId);
    } catch {
      alert("Lỗi kết nối");
    } finally {
      setDeleting(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!activeStoreId) return;
    setPage(1);
    fetchDesigns(search, 1, activeStoreId);
  }

  function handlePageChange(newPage: number) {
    if (!activeStoreId) return;
    setPage(newPage);
    fetchDesigns(search, newPage, activeStoreId);
  }

  function handleStoreChange(storeId: string) {
    setActiveStoreId(storeId);
    setPage(1);
    setSearch("");
    router.replace(`/designs?storeId=${storeId}`);
    fetchDesigns("", 1, storeId);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Design Library</h1>
          <p className="page-subtitle">
            {selectedStore
              ? `${selectedStore.name} · ${total} design${total !== 1 ? "s" : ""}`
              : "Chọn store để xem và upload design vào đúng store"}
          </p>
        </div>
        {selectedStore ? (
          <Link href={uploadHref} className="btn btn-primary">
            <Plus size={16} />
            Upload Design
          </Link>
        ) : null}
      </div>

      {!hasStores && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Chưa có store active</h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: 0 }}>
            Kết nối hoặc kích hoạt store trước khi upload design.
          </p>
        </div>
      )}

      {hasStores && (
        <div className="card" style={{ padding: 18, marginBottom: selectedStore ? 18 : 24 }}>
          <div className="flex items-center justify-between gap-3" style={{ marginBottom: 14 }}>
            <div>
              <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 4px" }}>
                {selectedStore ? "Store đang xem" : "Chọn store để xem design"}
              </h2>
              <p style={{ opacity: 0.55, fontSize: "0.85rem", margin: 0 }}>
                {selectedStore
                  ? "Design và upload mới sẽ được gắn vào store này."
                  : "Mỗi thư viện design được tách theo store để tránh upload nhầm."}
              </p>
            </div>
          </div>

          {invalidStoreSelected && !selectedStore ? (
            <div
              className="flex items-center gap-2"
              style={{
                color: "var(--color-error)",
                fontSize: "0.85rem",
                marginBottom: 12,
              }}
            >
              <AlertTriangle size={15} />
              <span>Store không hợp lệ hoặc không còn active. Chọn store khác để tiếp tục.</span>
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {stores.map((store) => {
              const isActive = activeStoreId === store.id;
              return (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => handleStoreChange(store.id)}
                  style={{
                    border: isActive
                      ? "1.5px solid var(--color-wise-green)"
                      : "1px solid var(--border-default)",
                    borderRadius: 8,
                    background: isActive ? "rgba(146, 198, 72, 0.12)" : "var(--bg-primary)",
                    padding: 16,
                    textAlign: "left",
                    cursor: "pointer",
                    minHeight: 92,
                    transition: "border-color 0.15s, background-color 0.15s, transform 0.15s",
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span style={{ fontWeight: 700 }}>{store.name}</span>
                    {isActive ? (
                      <CheckCircle2 size={18} style={{ color: "var(--color-wise-green)" }} />
                    ) : null}
                  </span>
                  <span
                    style={{
                      display: "block",
                      opacity: 0.55,
                      fontSize: "0.8rem",
                      marginTop: 8,
                    }}
                  >
                    {isActive ? "Đang mở thư viện store này" : "Click để xem design và mở upload"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedStore && (
        <form onSubmit={handleSearch} style={{ marginBottom: 24 }}>
          <div className="flex gap-3">
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                size={16}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  opacity: 0.4,
                }}
              />
              <input
                type="text"
                className="input"
                placeholder="Tìm design theo tên..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 38 }}
              />
            </div>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center" style={{ padding: 64, opacity: 0.5 }}>
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {selectedStore && !loading && designs.length === 0 && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              backgroundColor: "var(--bg-tertiary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <ImageIcon size={32} style={{ opacity: 0.3 }} />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>
            {search ? "Không tìm thấy design" : `Chưa có design nào trong ${selectedStore.name}`}
          </h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: "0 0 24px" }}>
            {search
              ? `Không có kết quả cho "${search}" trong ${selectedStore.name}`
              : "Upload design đầu tiên cho store này để bắt đầu"}
          </p>
          {!search && (
            <Link href={uploadHref} className="btn btn-primary">
              <Plus size={16} />
              Upload Design
            </Link>
          )}
        </div>
      )}

      {/* Grid */}
      {selectedStore && !loading && designs.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {designs.map((design) => (
              <div
                key={design.id}
                className="card"
                style={{
                  padding: 0,
                  overflow: "hidden",
                  transition: "box-shadow 0.15s",
                }}
              >
                {/* Preview */}
                <div
                  style={{
                    aspectRatio: "1 / 1",
                    backgroundColor: "var(--bg-tertiary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  {design.previewUrl ? (
                    <Image
                      src={design.previewUrl}
                      alt={design.name}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 220px"
                      style={{
                        objectFit: "contain",
                        padding: 12,
                      }}
                      unoptimized
                    />
                  ) : (
                    <ImageIcon size={40} style={{ opacity: 0.2 }} />
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: "12px 14px" }}>
                  <p
                    style={{
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      margin: "0 0 4px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {design.name}
                  </p>
                  <p
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      margin: "0 0 6px",
                      opacity: 0.55,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {design.store?.name ?? selectedStore.name}
                  </p>
                  <div
                    className="flex items-center justify-between"
                    style={{ fontSize: "0.75rem", opacity: 0.5 }}
                  >
                    <span>
                      {design.width}×{design.height}
                      {design.dpi && (
                        <span
                          style={{
                            marginLeft: 6,
                            color: design.dpi < 150 ? "#b45309" : undefined,
                            fontWeight: design.dpi < 150 ? 600 : undefined,
                          }}
                        >
                          {design.dpi} DPI
                        </span>
                      )}
                    </span>
                    <span>{formatSize(design.fileSizeBytes)}</span>
                  </div>
                  <div
                    className="flex items-center justify-between"
                    style={{ fontSize: "0.7rem", opacity: 0.4, marginTop: 4 }}
                  >
                    <span>{formatDate(design.createdAt)}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(design.id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 4,
                        color: "var(--color-danger)",
                        opacity: 0.6,
                      }}
                      title="Xóa design"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3" style={{ marginTop: 24 }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span style={{ fontSize: "0.85rem", opacity: 0.6 }}>
                Trang {page}/{totalPages}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div className="card" style={{ padding: 24, maxWidth: 400, width: "90%" }}>
            <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
              <AlertTriangle size={24} style={{ color: "var(--color-danger)" }} />
              <h3 style={{ fontWeight: 700, margin: 0 }}>Xóa design?</h3>
            </div>
            <p style={{ opacity: 0.7, fontSize: "0.875rem", marginBottom: 24 }}>
              Design sẽ bị xóa mềm. File sẽ bị xóa vĩnh viễn sau 7 ngày.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteConfirm(null)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  backgroundColor: "var(--color-danger)",
                  color: "white",
                }}
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
              >
                {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

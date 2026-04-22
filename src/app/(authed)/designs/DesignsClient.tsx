"use client";

import { useState, useCallback } from "react";
import {
  Plus,
  Search,
  Trash2,
  Image as ImageIcon,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import Link from "next/link";

interface Design {
  id: string;
  name: string;
  previewUrl: string | null;
  width: number;
  height: number;
  dpi: number | null;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
}

interface Props {
  initialDesigns: Design[];
  initialTotal: number;
  initialTotalPages: number;
}

export default function DesignsClient({ initialDesigns, initialTotal, initialTotalPages }: Props) {
  const [designs, setDesigns] = useState<Design[]>(initialDesigns);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchDesigns = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
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
      fetchDesigns(search, page);
    } catch {
      alert("Lỗi kết nối");
    } finally {
      setDeleting(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchDesigns(search, 1);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    fetchDesigns(search, newPage);
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
          <p className="page-subtitle">{total} design{total !== 1 ? "s" : ""}</p>
        </div>
        <Link href="/designs/upload" className="btn btn-primary">
          <Plus size={16} />
          Upload Design
        </Link>
      </div>

      {/* Search */}
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

      {/* Loading */}
      {loading && (
        <div
          className="flex items-center justify-center"
          style={{ padding: 64, opacity: 0.5 }}
        >
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!loading && designs.length === 0 && (
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
            {search ? "Không tìm thấy design" : "Chưa có design nào"}
          </h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: "0 0 24px" }}>
            {search
              ? `Không có kết quả cho "${search}"`
              : "Upload design đầu tiên để bắt đầu"}
          </p>
          {!search && (
            <Link href="/designs/upload" className="btn btn-primary">
              <Plus size={16} />
              Upload Design
            </Link>
          )}
        </div>
      )}

      {/* Grid */}
      {!loading && designs.length > 0 && (
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
                  cursor: "pointer",
                  transition: "transform 0.15s, box-shadow 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = "";
                  (e.currentTarget as HTMLElement).style.boxShadow = "";
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
                  }}
                >
                  {design.previewUrl ? (
                    <img
                      src={design.previewUrl}
                      alt={design.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        padding: 12,
                      }}
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
            <div
              className="flex items-center justify-center gap-3"
              style={{ marginTop: 24 }}
            >
              <button
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
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="card"
            style={{ padding: 24, maxWidth: 400, width: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
              <AlertTriangle size={24} style={{ color: "var(--color-danger)" }} />
              <h3 style={{ fontWeight: 700, margin: 0 }}>Xóa design?</h3>
            </div>
            <p style={{ opacity: 0.7, fontSize: "0.875rem", marginBottom: 24 }}>
              Design sẽ bị xóa mềm. File sẽ bị xóa vĩnh viễn sau 7 ngày.
            </p>
            <div className="flex justify-end gap-3">
              <button
                className="btn btn-secondary"
                onClick={() => setDeleteConfirm(null)}
              >
                Hủy
              </button>
              <button
                className="btn"
                style={{
                  backgroundColor: "var(--color-danger)",
                  color: "white",
                }}
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

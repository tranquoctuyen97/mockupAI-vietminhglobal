"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Search,
  Settings,
  Store,
  Trash2,
  Upload,
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
  domain: string;
}

interface DesignsApiResponse {
  designs?: Design[];
  total?: number;
  totalPages?: number;
  error?: string;
}

interface Props {
  initialDesigns: Design[];
  stores: StoreOption[];
  initialStoreId: string | null;
  invalidStoreSelected: boolean;
  initialTotal: number;
  initialTotalPages: number;
}

const PAGE_SIZE = 12;
const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "High DPI", value: "high_dpi" },
  { label: "Low DPI", value: "low_dpi" },
];
const TYPE_OPTIONS = [
  { label: "All file types", value: "" },
  { label: "PNG", value: "png" },
  { label: "JPG", value: "jpg" },
  { label: "WEBP", value: "webp" },
];

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
  const [fileType, setFileType] = useState("");
  const [status, setStatus] = useState("");
  const [activeStoreId, setActiveStoreId] = useState<string | null>(initialStoreId);
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [storeSwitcherOpen, setStoreSwitcherOpen] = useState(false);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === activeStoreId) ?? null,
    [activeStoreId, stores],
  );
  const uploadHref = selectedStore
    ? `/designs/upload?storeId=${selectedStore.id}`
    : "/designs/upload";

  const fetchDesigns = useCallback(
    async (input: {
      q: string;
      page: number;
      storeId: string | null;
      fileType: string;
      status: string;
    }) => {
      if (!input.storeId) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          storeId: input.storeId,
          page: String(input.page),
          limit: String(PAGE_SIZE),
        });
        if (input.q) params.set("q", input.q);

        const res = await fetch(`/api/designs?${params}`);
        const data = (await res.json()) as DesignsApiResponse;

        if (!res.ok) {
          alert(data.error || "Không thể tải designs");
          return;
        }

        let nextDesigns = data.designs ?? [];
        if (input.fileType) {
          nextDesigns = nextDesigns.filter((design) =>
            design.mimeType.toLowerCase().includes(input.fileType),
          );
        }
        if (input.status === "high_dpi") {
          nextDesigns = nextDesigns.filter((design) => !design.dpi || design.dpi >= 150);
        }
        if (input.status === "low_dpi") {
          nextDesigns = nextDesigns.filter((design) => design.dpi !== null && design.dpi < 150);
        }

        setDesigns(nextDesigns);
        setTotal(data.total ?? nextDesigns.length);
        setTotalPages(data.totalPages ?? Math.ceil((data.total ?? 0) / PAGE_SIZE));
      } catch {
        alert("Lỗi kết nối");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

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
      fetchDesigns({ q: search, page, storeId: activeStoreId, fileType, status });
    } catch {
      alert("Lỗi kết nối");
    } finally {
      setDeleting(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchDesigns({ q: search, page: 1, storeId: activeStoreId, fileType, status });
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    fetchDesigns({ q: search, page: newPage, storeId: activeStoreId, fileType, status });
  }

  function handleStoreChange(storeId: string) {
    setActiveStoreId(storeId);
    setPage(1);
    setSearch("");
    setStoreSwitcherOpen(false);
    router.replace(`/designs?storeId=${storeId}`);
    fetchDesigns({ q: "", page: 1, storeId, fileType, status });
  }

  function handleFilter(next: { fileType?: string; status?: string }) {
    const nextFileType = next.fileType ?? fileType;
    const nextStatus = next.status ?? status;
    setFileType(nextFileType);
    setStatus(nextStatus);
    setPage(1);
    fetchDesigns({
      q: search,
      page: 1,
      storeId: activeStoreId,
      fileType: nextFileType,
      status: nextStatus,
    });
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
    <main style={pageWrap}>
      <DesignsPageHeader
        stores={stores}
        selectedStore={selectedStore}
        total={total}
        open={storeSwitcherOpen}
        invalidStoreSelected={invalidStoreSelected}
        onToggle={() => setStoreSwitcherOpen((value) => !value)}
        onChooseStore={handleStoreChange}
      />

      <DesignsToolbar
        search={search}
        fileType={fileType}
        status={status}
        uploadHref={uploadHref}
        disabled={!selectedStore}
        onSearchChange={setSearch}
        onSubmitSearch={handleSearch}
        onFilterChange={handleFilter}
      />

      {loading && (
        <div style={loadingPanel}>
          <Loader2 size={28} className="animate-spin" color="#35a527" />
        </div>
      )}

      {!loading && !selectedStore && (
        <EmptyState
          icon={<Store size={28} />}
          title="Choose a store to view designs"
          text="Design libraries are scoped by store. Use the store switcher in the header to continue."
        />
      )}

      {!loading && selectedStore && designs.length === 0 && (
        <EmptyState
          icon={<ImageIcon size={28} />}
          title={search ? "No designs found" : `No designs in ${selectedStore.name}`}
          text={search ? `No results for "${search}".` : "Upload the first design for this store."}
          action={!search ? uploadHref : null}
        />
      )}

      {!loading && selectedStore && designs.length > 0 && (
        <>
          <DesignGrid
            designs={designs}
            selectedStoreName={selectedStore.name}
            formatSize={formatSize}
            formatDate={formatDate}
            onDelete={setDeleteConfirm}
          />
          <DesignsPagination
            page={page}
            totalPages={totalPages}
            totalItems={total}
            onPageChange={handlePageChange}
          />
        </>
      )}

      {deleteConfirm && (
        <DeleteConfirmModal
          deleting={deleting}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => handleDelete(deleteConfirm)}
        />
      )}
    </main>
  );
}

function DesignsPageHeader({
  stores,
  selectedStore,
  total,
  open,
  invalidStoreSelected,
  onToggle,
  onChooseStore,
}: {
  stores: StoreOption[];
  selectedStore: StoreOption | null;
  total: number;
  open: boolean;
  invalidStoreSelected: boolean;
  onToggle: () => void;
  onChooseStore: (storeId: string) => void;
}) {
  return (
    <header style={header}>
      <div>
        <h1 style={title}>Design Library</h1>
        <p style={subtitle}>Manage your store design files and upload library.</p>
        {invalidStoreSelected && (
          <div style={warningText}>
            <AlertTriangle size={14} />
            Store không hợp lệ hoặc không còn active.
          </div>
        )}
      </div>
      <div style={headerActions}>
        <div style={{ position: "relative" }}>
          <button type="button" style={storeSwitcherButton} onClick={onToggle}>
            <StoreAvatar name={selectedStore?.name ?? "Store"} />
            <strong>{selectedStore?.name ?? "Choose store"}</strong>
            {selectedStore && <span style={activeBadge}>Active</span>}
            <span style={summaryBadge}>
              {selectedStore ? `${Math.min(total, 99)} designs` : `${stores.length} stores`}
            </span>
            <ChevronDown size={16} />
          </button>
          {open && (
            <StoreSwitcherPanel
              stores={stores}
              selectedStore={selectedStore}
              onChooseStore={onChooseStore}
            />
          )}
        </div>
        <Link href="/stores" style={manageStoresButton}>
          <Settings size={16} /> Manage stores
        </Link>
      </div>
    </header>
  );
}

function StoreSwitcherPanel({
  stores,
  selectedStore,
  onChooseStore,
}: {
  stores: StoreOption[];
  selectedStore: StoreOption | null;
  onChooseStore: (storeId: string) => void;
}) {
  const recentStores = stores.slice(0, 3);
  const allStores = stores.slice(3, 6);
  return (
    <div style={storePanel}>
      <div style={storeSearch}>
        <Search size={16} />
        <span>Search stores...</span>
      </div>
      <PanelLabel>Recent stores</PanelLabel>
      {recentStores.map((store, index) => (
        <StoreRow
          key={store.id}
          store={store}
          index={index}
          selected={store.id === selectedStore?.id}
          onChooseStore={onChooseStore}
        />
      ))}
      {allStores.length > 0 && <PanelLabel>All stores</PanelLabel>}
      {allStores.map((store, index) => (
        <StoreRow
          key={store.id}
          store={store}
          index={index + 3}
          selected={store.id === selectedStore?.id}
          onChooseStore={onChooseStore}
        />
      ))}
      <Link href="/stores" style={viewAllStores}>
        View all stores <ChevronRight size={15} />
      </Link>
    </div>
  );
}

function StoreRow({
  store,
  index,
  selected,
  onChooseStore,
}: {
  store: StoreOption;
  index: number;
  selected: boolean;
  onChooseStore: (storeId: string) => void;
}) {
  return (
    <button
      type="button"
      style={{ ...storeRow, background: selected ? "#f0faec" : "transparent" }}
      onClick={() => onChooseStore(store.id)}
    >
      <StoreAvatar name={store.name} index={index} />
      <span style={{ minWidth: 0 }}>
        <strong
          style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {store.name}
        </strong>
        <small style={storeDomain}>{store.domain}</small>
      </span>
      <span style={activeBadge}>Active</span>
      {selected && <Check size={16} color="#35a527" />}
    </button>
  );
}

function DesignsToolbar({
  search,
  fileType,
  status,
  uploadHref,
  disabled,
  onSearchChange,
  onSubmitSearch,
  onFilterChange,
}: {
  search: string;
  fileType: string;
  status: string;
  uploadHref: string;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onSubmitSearch: (e: React.FormEvent) => void;
  onFilterChange: (next: { fileType?: string; status?: string }) => void;
}) {
  return (
    <section style={toolbar}>
      <form onSubmit={onSubmitSearch} style={searchWrap}>
        <Search size={17} color="#98a2b3" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search designs..."
          style={searchInput}
        />
      </form>
      <button type="button" style={controlButton}>
        <Grid3X3 size={16} /> View
      </button>
      <SelectControl
        label="File type"
        value={fileType}
        options={TYPE_OPTIONS}
        onChange={(value) => onFilterChange({ fileType: value })}
      />
      <SelectControl
        label="Status"
        value={status}
        options={STATUS_OPTIONS}
        onChange={(value) => onFilterChange({ status: value })}
      />
      <div style={{ flex: 1 }} />
      <SelectControl
        label="Sort: Newest"
        value=""
        options={[{ label: "Sort: Newest", value: "" }]}
        onChange={() => undefined}
      />
      {disabled ? (
        <button
          type="button"
          style={{ ...uploadButton, opacity: 0.55, cursor: "not-allowed" }}
          disabled
        >
          <Upload size={17} /> Upload design
        </button>
      ) : (
        <Link href={uploadHref} style={uploadButton}>
          <Upload size={17} /> Upload design
        </Link>
      )}
    </section>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={selectControl}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={selectInput}
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={15} style={{ pointerEvents: "none" }} />
    </label>
  );
}

function DesignGrid({
  designs,
  selectedStoreName,
  formatSize,
  formatDate,
  onDelete,
}: {
  designs: Design[];
  selectedStoreName: string;
  formatSize: (bytes: number) => string;
  formatDate: (iso: string) => string;
  onDelete: (id: string) => void;
}) {
  return (
    <section style={grid}>
      {designs.map((design) => (
        <DesignCard
          key={design.id}
          design={design}
          selectedStoreName={selectedStoreName}
          formatSize={formatSize}
          formatDate={formatDate}
          onDelete={onDelete}
        />
      ))}
    </section>
  );
}

function DesignCard({
  design,
  selectedStoreName,
  formatSize,
  formatDate,
  onDelete,
}: {
  design: Design;
  selectedStoreName: string;
  formatSize: (bytes: number) => string;
  formatDate: (iso: string) => string;
  onDelete: (id: string) => void;
}) {
  const fileType = design.mimeType.split("/").pop()?.toUpperCase() ?? "FILE";
  const lowDpi = design.dpi !== null && design.dpi < 150;
  return (
    <article style={designCard}>
      <div style={imageWrap}>
        <input type="checkbox" aria-label={`Select ${design.name}`} style={checkbox} />
        <button type="button" style={moreButton} aria-label={`More actions for ${design.name}`}>
          <MoreHorizontal size={16} />
        </button>
        {design.previewUrl ? (
          <Image
            src={design.previewUrl}
            alt={design.name}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 33vw, 260px"
            style={designImage}
            unoptimized
          />
        ) : (
          <ImageIcon size={44} color="#98a2b3" />
        )}
      </div>
      <div style={cardBody}>
        <h2 style={cardTitle}>{design.name}</h2>
        <div style={metaRow}>
          <span style={storeChip}>{design.store?.name ?? selectedStoreName}</span>
          <span style={softChip}>{fileType}</span>
        </div>
        <div style={fileMeta}>
          <span>
            {design.width} x {design.height}
            {design.dpi && (
              <span style={{ marginLeft: 6, color: lowDpi ? "#b45309" : undefined }}>
                {design.dpi} DPI
              </span>
            )}
          </span>
          <span style={readyBadge}>{lowDpi ? "Check DPI" : "Ready"}</span>
        </div>
      </div>
      <div style={actionRow}>
        <span style={dateText}>{formatDate(design.createdAt)}</span>
        <span style={dateText}>{formatSize(design.fileSizeBytes)}</span>
        <button
          type="button"
          style={iconAction}
          onClick={() => onDelete(design.id)}
          title="Xóa design"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function DesignsPagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const end = Math.min(page * PAGE_SIZE, totalItems);
  const start = totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pages = Array.from({ length: Math.min(totalPages, 3) }, (_, index) => index + 1);
  return (
    <footer style={pagination}>
      <span style={paginationText}>
        Showing {start}-{end} of {totalItems} designs
      </span>
      <div style={paginationControls}>
        <button
          type="button"
          style={pageButton}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        {pages.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            style={{ ...pageNumberButton, ...(pageNumber === page ? activePageButton : null) }}
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </button>
        ))}
        {totalPages > 4 && <span style={paginationText}>...</span>}
        {totalPages > 3 && (
          <button type="button" style={pageNumberButton} onClick={() => onPageChange(totalPages)}>
            {totalPages}
          </button>
        )}
        <button
          type="button"
          style={pageButton}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <button type="button" style={perPageButton}>
        12 per page <ChevronDown size={15} />
      </button>
    </footer>
  );
}

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: string | null;
}) {
  return (
    <section style={emptyState}>
      <span style={emptyIcon}>{icon}</span>
      <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>{title}</h2>
      <p style={{ margin: 0, color: "#667085" }}>{text}</p>
      {action && (
        <Link href={action} style={{ ...uploadButton, marginTop: 18 }}>
          <Upload size={17} /> Upload design
        </Link>
      )}
    </section>
  );
}

function DeleteConfirmModal({
  deleting,
  onCancel,
  onConfirm,
}: {
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={modalBackdrop}>
      <div className="card" style={{ padding: 24, maxWidth: 400, width: "90%" }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
          <AlertTriangle size={24} style={{ color: "var(--color-danger)" }} />
          <h3 style={{ fontWeight: 600, margin: 0 }}>Xóa design?</h3>
        </div>
        <p style={{ opacity: 0.7, fontSize: "0.875rem", marginBottom: 24 }}>
          Design sẽ bị xóa mềm. File sẽ bị xóa vĩnh viễn sau 7 ngày.
        </p>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Hủy
          </button>
          <button
            type="button"
            className="btn"
            style={{ backgroundColor: "var(--color-danger)", color: "white" }}
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            Xóa
          </button>
        </div>
      </div>
    </div>
  );
}

function StoreAvatar({ name, index = 0 }: { name: string; index?: number }) {
  const colors = ["#101828", "#f75f9d", "#202124", "#e9b872"];
  return (
    <span style={{ ...storeAvatar, background: colors[index % colors.length] }}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <div style={panelLabel}>{children}</div>;
}

const pageWrap: React.CSSProperties = { maxWidth: 1600, margin: "0 auto", paddingBottom: 24 };
const header: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 24,
  marginBottom: 24,
};
const title: React.CSSProperties = {
  margin: 0,
  fontSize: 32,
  lineHeight: 1.15,
  fontWeight: 700,
  color: "#101828",
};
const subtitle: React.CSSProperties = { margin: "8px 0 0", color: "#667085", fontSize: 15 };
const warningText: React.CSSProperties = {
  marginTop: 10,
  color: "#b45309",
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
};
const headerActions: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};
const storeSwitcherButton: React.CSSProperties = {
  minHeight: 50,
  border: "1px solid #6abd5a",
  borderRadius: 10,
  background: "#fff",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 12px",
  boxShadow: "0 10px 24px rgba(16, 24, 40, 0.04)",
  cursor: "pointer",
};
const storeAvatar: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontSize: 10,
  fontWeight: 700,
  flexShrink: 0,
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
const summaryBadge: React.CSSProperties = {
  border: "1px solid #e4e7ec",
  background: "#f8fafc",
  color: "#475467",
  borderRadius: 7,
  padding: "3px 9px",
  fontSize: 12,
  fontWeight: 600,
};
const manageStoresButton: React.CSSProperties = {
  minHeight: 50,
  border: "1px solid #d9dee7",
  borderRadius: 10,
  background: "#fff",
  color: "#101828",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "0 16px",
  textDecoration: "none",
  fontWeight: 600,
  boxShadow: "0 10px 24px rgba(16, 24, 40, 0.04)",
};
const storePanel: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: 58,
  width: 410,
  zIndex: 20,
  border: "1px solid #dfe4ea",
  borderRadius: 12,
  background: "#fff",
  padding: 12,
  boxShadow: "0 24px 60px rgba(16, 24, 40, 0.16)",
};
const storeSearch: React.CSSProperties = {
  minHeight: 40,
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  color: "#98a2b3",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
};
const panelLabel: React.CSSProperties = {
  margin: "14px 0 6px",
  color: "#667085",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const storeRow: React.CSSProperties = {
  width: "100%",
  minHeight: 58,
  border: "none",
  borderRadius: 10,
  display: "grid",
  gridTemplateColumns: "30px minmax(0, 1fr) auto 18px",
  gap: 10,
  alignItems: "center",
  padding: "8px 10px",
  textAlign: "left",
  cursor: "pointer",
};
const storeDomain: React.CSSProperties = {
  display: "block",
  color: "#667085",
  marginTop: 2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const viewAllStores: React.CSSProperties = {
  minHeight: 40,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 8,
  borderTop: "1px solid #edf0f2",
  color: "#475467",
  textDecoration: "none",
  fontWeight: 600,
  marginTop: 8,
};
const toolbar: React.CSSProperties = {
  border: "1px solid #dfe4ea",
  borderRadius: 12,
  background: "#fff",
  padding: 18,
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 18,
  boxShadow: "0 12px 30px rgba(16, 24, 40, 0.04)",
};
const searchWrap: React.CSSProperties = {
  width: 330,
  maxWidth: "100%",
  minHeight: 42,
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 12px",
};
const searchInput: React.CSSProperties = {
  border: "none",
  outline: "none",
  flex: 1,
  font: "inherit",
  minWidth: 0,
};
const controlButton: React.CSSProperties = {
  minHeight: 42,
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  background: "#fff",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "0 14px",
  fontWeight: 600,
  cursor: "pointer",
};
const selectControl: React.CSSProperties = {
  minHeight: 42,
  border: "1px solid #e4e7ec",
  borderRadius: 9,
  background: "#fff",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "0 10px 0 14px",
};
const selectInput: React.CSSProperties = {
  appearance: "none",
  border: "none",
  outline: "none",
  background: "transparent",
  font: "inherit",
  fontWeight: 600,
  color: "#101828",
};
const uploadButton: React.CSSProperties = {
  minHeight: 42,
  border: "none",
  borderRadius: 9,
  background: "linear-gradient(180deg, #45b832, #2f9e24)",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "0 18px",
  fontWeight: 600,
  textDecoration: "none",
  cursor: "pointer",
};
const loadingPanel: React.CSSProperties = {
  minHeight: 420,
  display: "grid",
  placeItems: "center",
  border: "1px solid #dfe4ea",
  borderRadius: 12,
  background: "#fff",
};
const emptyState: React.CSSProperties = {
  minHeight: 360,
  border: "1px dashed #d9dee7",
  borderRadius: 12,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  textAlign: "center",
  padding: 40,
};
const emptyIcon: React.CSSProperties = {
  width: 58,
  height: 58,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  background: "#e9f8e3",
  color: "#35a527",
  marginBottom: 16,
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
  gap: 18,
};
const designCard: React.CSSProperties = {
  border: "1px solid #dfe4ea",
  borderRadius: 12,
  background: "#fff",
  overflow: "hidden",
  boxShadow: "0 8px 20px rgba(16, 24, 40, 0.035)",
};
const imageWrap: React.CSSProperties = {
  position: "relative",
  aspectRatio: "1.22 / 1",
  background: "linear-gradient(180deg, #f8fafc, #f2f4f7)",
  display: "grid",
  placeItems: "center",
};
const designImage: React.CSSProperties = { objectFit: "contain", padding: 12 };
const checkbox: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  width: 16,
  height: 16,
  zIndex: 2,
};
const moreButton: React.CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  width: 28,
  height: 28,
  borderRadius: 7,
  border: "1px solid #e4e7ec",
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  zIndex: 2,
};
const cardBody: React.CSSProperties = { padding: "10px 12px 8px" };
const cardTitle: React.CSSProperties = {
  margin: 0,
  color: "#101828",
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.35,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const metaRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
  marginTop: 8,
};
const storeChip: React.CSSProperties = {
  borderRadius: 7,
  background: "#f2f4f7",
  color: "#344054",
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 7px",
};
const softChip: React.CSSProperties = {
  borderRadius: 7,
  background: "#f8fafc",
  color: "#475467",
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 8px",
};
const fileMeta: React.CSSProperties = {
  marginTop: 8,
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  alignItems: "center",
  color: "#667085",
  fontSize: 12,
};
const readyBadge: React.CSSProperties = {
  borderRadius: 7,
  background: "#e9f8e3",
  color: "#2f7d32",
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 8px",
  whiteSpace: "nowrap",
};
const actionRow: React.CSSProperties = {
  borderTop: "1px solid #edf0f2",
  display: "grid",
  gridTemplateColumns: "1fr 1fr 36px",
  alignItems: "center",
};
const dateText: React.CSSProperties = {
  minHeight: 36,
  display: "grid",
  placeItems: "center",
  color: "#667085",
  fontSize: 12,
  borderRight: "1px solid #edf0f2",
};
const iconAction: React.CSSProperties = {
  minHeight: 36,
  border: "none",
  background: "#fff",
  color: "#344054",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};
const pagination: React.CSSProperties = {
  marginTop: 18,
  border: "1px solid #dfe4ea",
  borderRadius: 12,
  background: "#fff",
  minHeight: 62,
  padding: "0 18px",
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  gap: 16,
};
const paginationText: React.CSSProperties = { color: "#667085", fontSize: 13, fontWeight: 500 };
const paginationControls: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const pageButton: React.CSSProperties = {
  width: 34,
  height: 34,
  border: "1px solid #d9dee7",
  borderRadius: 8,
  background: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};
const pageNumberButton: React.CSSProperties = {
  ...pageButton,
  fontSize: 13,
  fontWeight: 600,
  color: "#101828",
};
const activePageButton: React.CSSProperties = {
  background: "#e9f8e3",
  color: "#2f7d32",
  borderColor: "#b7e4b2",
};
const perPageButton: React.CSSProperties = {
  justifySelf: "end",
  minHeight: 36,
  border: "1px solid #d9dee7",
  borderRadius: 8,
  background: "#fff",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  fontWeight: 600,
  color: "#344054",
  cursor: "pointer",
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Grid3X3,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  Store,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  GlobalMockupEditorModal,
  type GlobalMockupEditorValue,
} from "@/components/mockup/GlobalMockupEditorModal";

interface MockupItem extends GlobalMockupEditorValue {
  templateAttachmentCount: number;
}

interface StoreOption {
  id: string;
  name: string;
  domain: string;
}

interface MockupApiItem {
  id: string;
  name: string;
  imageUrl: string | null;
  previewUrl?: string | null;
  width: number;
  height: number;
  view: string;
  sceneType: string;
  compositeRegionPx: MockupItem["compositeRegionPx"];
  templateAttachmentCount?: number;
}

interface MockupApiResponse {
  items?: MockupApiItem[];
  total?: number;
  totalPages?: number;
  error?: string;
}

interface Props {
  initialMockups: MockupItem[];
  stores: StoreOption[];
  initialStoreId: string | null;
  invalidStoreSelected: boolean;
  initialTotal: number;
  initialTotalPages: number;
}

const PAGE_SIZE = 12;
const SCENE_OPTIONS = [
  { label: "All scene types", value: "" },
  { label: "Flat lay", value: "flat_lay" },
  { label: "Model", value: "model" },
  { label: "Lifestyle", value: "lifestyle" },
];
const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Frame ready", value: "frame_ready" },
  { label: "Needs frame", value: "needs_frame" },
];

export default function MockupsClient({
  initialMockups,
  stores,
  initialStoreId,
  invalidStoreSelected,
  initialTotal,
  initialTotalPages,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState<MockupItem[]>(initialMockups);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sceneType, setSceneType] = useState("");
  const [status, setStatus] = useState("");
  const [activeStoreId, setActiveStoreId] = useState<string | null>(initialStoreId);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<MockupItem | null>(null);
  const [storeSwitcherOpen, setStoreSwitcherOpen] = useState(false);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === activeStoreId) ?? null,
    [activeStoreId, stores],
  );
  const uploadHref = selectedStore
    ? `/mockups/upload?storeId=${selectedStore.id}`
    : "/mockups/upload";

  const fetchMockups = useCallback(
    async (input: {
      q: string;
      page: number;
      storeId: string | null;
      sceneType: string;
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
        if (input.sceneType) params.set("sceneType", input.sceneType);

        const res = await fetch(`/api/mockups?${params}`);
        const data = (await res.json()) as MockupApiResponse;
        if (!res.ok) {
          toast.error(data.error || "Không thể tải mockups");
          return;
        }
        const nextItems = (data.items ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          imageUrl: item.previewUrl ?? item.imageUrl,
          width: item.width,
          height: item.height,
          view: item.view,
          sceneType: item.sceneType,
          compositeRegionPx: item.compositeRegionPx,
          templateAttachmentCount: item.templateAttachmentCount ?? 0,
        }));
        setItems(
          input.status === "needs_frame"
            ? nextItems.filter((item: MockupItem) => !item.compositeRegionPx)
            : nextItems,
        );
        setTotal(data.total ?? nextItems.length ?? 0);
        setTotalPages(data.totalPages ?? Math.ceil((data.total ?? 0) / PAGE_SIZE));
      } catch {
        toast.error("Lỗi kết nối khi tải mockups");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (editId && items.length > 0) {
      setEditing(items.find((item) => item.id === editId) ?? null);
    }
  }, [items]);

  async function save(value: GlobalMockupEditorValue) {
    if (!value.id) return;
    const res = await fetch(`/api/mockups/${value.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: value.name,
        view: value.view,
        sceneType: value.sceneType,
        renderMode: "COMPOSITE",
        compositeRegionPx: value.compositeRegionPx,
      }),
    });
    if (!res.ok) throw new Error("Save failed");
    setEditing(null);
    fetchMockups({ q: search, page, storeId: activeStoreId, sceneType, status });
  }

  async function remove(item: MockupItem) {
    const res = await fetch(`/api/mockups/${item.id}`, { method: "DELETE" });
    if (res.status === 409) {
      toast.error("Mockup is attached to templates");
      return;
    }
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    fetchMockups({ q: search, page, storeId: activeStoreId, sceneType, status });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchMockups({ q: search, page: 1, storeId: activeStoreId, sceneType, status });
  }

  function handleStoreChange(storeId: string) {
    setActiveStoreId(storeId);
    setPage(1);
    setSearch("");
    setStoreSwitcherOpen(false);
    router.replace(`/mockups?storeId=${storeId}`);
    fetchMockups({ q: "", page: 1, storeId, sceneType, status });
  }

  function handleFilter(next: { sceneType?: string; status?: string }) {
    const nextSceneType = next.sceneType ?? sceneType;
    const nextStatus = next.status ?? status;
    setSceneType(nextSceneType);
    setStatus(nextStatus);
    setPage(1);
    fetchMockups({
      q: search,
      page: 1,
      storeId: activeStoreId,
      sceneType: nextSceneType,
      status: nextStatus,
    });
  }

  function handlePageChange(nextPage: number) {
    setPage(nextPage);
    fetchMockups({ q: search, page: nextPage, storeId: activeStoreId, sceneType, status });
  }

  return (
    <main style={pageWrap}>
      <MockupsPageHeader
        stores={stores}
        selectedStore={selectedStore}
        total={total}
        open={storeSwitcherOpen}
        invalidStoreSelected={invalidStoreSelected}
        onToggle={() => setStoreSwitcherOpen((value) => !value)}
        onChooseStore={handleStoreChange}
      />

      <MockupsToolbar
        search={search}
        sceneType={sceneType}
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
          title="Choose a store to view mockups"
          text="Mockup libraries are scoped by store. Use the store switcher in the header to continue."
        />
      )}

      {!loading && selectedStore && items.length === 0 && (
        <EmptyState
          icon={<ImagePlus size={28} />}
          title={search ? "No mockups found" : `No mockups in ${selectedStore.name}`}
          text={
            search ? `No results for "${search}".` : "Upload the first mockup frame for this store."
          }
          action={!search ? uploadHref : null}
        />
      )}

      {!loading && selectedStore && items.length > 0 && (
        <>
          <MockupGrid
            items={items}
            storeName={selectedStore.name}
            onEdit={setEditing}
            onRemove={remove}
          />
          <MockupsPagination
            page={page}
            totalPages={totalPages}
            totalItems={total}
            onPageChange={handlePageChange}
          />
        </>
      )}

      <GlobalMockupEditorModal
        open={Boolean(editing)}
        value={editing}
        onClose={() => setEditing(null)}
        onSave={save}
      />
    </main>
  );
}

function MockupsPageHeader({
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
        <h1 style={title}>Mockups</h1>
        <p style={subtitle}>Manage your store mockup library and design frames.</p>
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
              {selectedStore ? `${Math.min(total, 99)} mockups` : `${stores.length} stores`}
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

function MockupsToolbar({
  search,
  sceneType,
  status,
  uploadHref,
  disabled,
  onSearchChange,
  onSubmitSearch,
  onFilterChange,
}: {
  search: string;
  sceneType: string;
  status: string;
  uploadHref: string;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onSubmitSearch: (e: React.FormEvent) => void;
  onFilterChange: (next: { sceneType?: string; status?: string }) => void;
}) {
  return (
    <section style={toolbar}>
      <form onSubmit={onSubmitSearch} style={searchWrap}>
        <Search size={17} color="#98a2b3" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search mockups..."
          style={searchInput}
        />
      </form>
      <button type="button" style={controlButton}>
        <Grid3X3 size={16} /> View
      </button>
      <SelectControl
        label="Scene type"
        value={sceneType}
        options={SCENE_OPTIONS}
        onChange={(value) => onFilterChange({ sceneType: value })}
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
          <Upload size={17} /> Upload mockup
        </button>
      ) : (
        <Link href={uploadHref} style={uploadButton}>
          <Upload size={17} /> Upload mockup
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

function MockupGrid({
  items,
  storeName,
  onEdit,
  onRemove,
}: {
  items: MockupItem[];
  storeName: string;
  onEdit: (item: MockupItem) => void;
  onRemove: (item: MockupItem) => void;
}) {
  return (
    <section style={grid}>
      {items.map((item) => (
        <MockupCard
          key={item.id}
          item={item}
          storeName={storeName}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      ))}
    </section>
  );
}

function MockupCard({
  item,
  storeName,
  onEdit,
  onRemove,
}: {
  item: MockupItem;
  storeName: string;
  onEdit: (item: MockupItem) => void;
  onRemove: (item: MockupItem) => void;
}) {
  return (
    <article style={mockupCard}>
      <div style={imageWrap}>
        <input type="checkbox" aria-label={`Select ${item.name}`} style={checkbox} />
        <button type="button" style={moreButton} aria-label={`More actions for ${item.name}`}>
          <MoreHorizontal size={16} />
        </button>
        {item.imageUrl ? (
          // biome-ignore lint/performance/noImgElement: Mockup thumbnails come from tenant storage/proxy URLs that are already sized for this grid.
          <img src={item.imageUrl} alt={item.name} style={mockupImage} />
        ) : (
          <ImagePlus size={44} color="#98a2b3" />
        )}
      </div>
      <div style={cardBody}>
        <h2 style={cardTitle}>{item.name}</h2>
        <div style={metaRow}>
          <span style={storeChip}>{storeName}</span>
          <span style={softChip}>{formatView(item.view)}</span>
        </div>
        <div style={fileMeta}>
          {item.width} x {item.height}{" "}
          {item.imageUrl?.toLowerCase().includes(".jpg") ? "JPG" : "PNG"}
          <span style={readyBadge}>Frame ready</span>
        </div>
      </div>
      <div style={actionRow}>
        <button type="button" style={cardAction} onClick={() => onEdit(item)}>
          <Edit3 size={14} /> Edit frame
        </button>
        <Link href={`/mockups/upload?replace=${item.id}`} style={cardAction}>
          <RefreshCw size={14} /> Replace
        </Link>
        <button
          type="button"
          style={iconAction}
          onClick={() => onRemove(item)}
          disabled={item.templateAttachmentCount > 0}
          title={item.templateAttachmentCount > 0 ? "Attached to templates" : "Delete"}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function MockupsPagination({
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
        Showing {start}-{end} of {totalItems} mockups
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
          <Upload size={17} /> Upload mockup
        </Link>
      )}
    </section>
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

function formatView(value?: string | null): string {
  if (!value) return "Front";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const pageWrap: React.CSSProperties = {
  maxWidth: 1600,
  margin: "0 auto",
  paddingBottom: 24,
};
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
const mockupCard: React.CSSProperties = {
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
const mockupImage: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  padding: 12,
};
const checkbox: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  width: 16,
  height: 16,
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
};
const cardBody: React.CSSProperties = { padding: "10px 12px 8px" };
const cardTitle: React.CSSProperties = {
  margin: 0,
  color: "#101828",
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.35,
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
};
const cardAction: React.CSSProperties = {
  minHeight: 36,
  border: "none",
  borderRight: "1px solid #edf0f2",
  background: "#fff",
  color: "#344054",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
};
const iconAction: React.CSSProperties = { ...cardAction, borderRight: "none", padding: 0 };
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

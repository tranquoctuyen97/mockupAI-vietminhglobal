"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GlobalMockupEditorModal, type GlobalMockupEditorValue } from "@/components/mockup/GlobalMockupEditorModal";

interface MockupItem extends GlobalMockupEditorValue {
  templateAttachmentCount: number;
}

interface StoreOption {
  id: string;
  name: string;
}

interface Props {
  initialMockups: MockupItem[];
  stores: StoreOption[];
  initialStoreId: string | null;
  invalidStoreSelected: boolean;
  initialTotal: number;
  initialTotalPages: number;
}

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
  const [activeStoreId, setActiveStoreId] = useState<string | null>(initialStoreId);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<MockupItem | null>(null);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === activeStoreId) ?? null,
    [activeStoreId, stores],
  );
  const hasStores = stores.length > 0;
  const uploadHref = selectedStore ? `/mockups/upload?storeId=${selectedStore.id}` : "/mockups/upload";

  const fetchMockups = useCallback(async (q: string, p: number, storeId: string | null) => {
    if (!storeId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      params.set("storeId", storeId);
      params.set("page", String(p));
      params.set("limit", "20");

      const res = await fetch(`/api/mockups?${params}`);
      const data = await res.json();
      if (res.ok) {
        setItems((data.items ?? []).map((item: any) => ({
          id: item.id,
          name: item.name,
          imageUrl: item.imageUrl,
          width: item.width,
          height: item.height,
          view: item.view,
          sceneType: item.sceneType,
          compositeRegionPx: item.compositeRegionPx,
          templateAttachmentCount: item.templateAttachmentCount ?? 0,
        })));
        setTotal(data.total ?? data.items?.length ?? 0);
        setTotalPages(data.totalPages ?? Math.ceil((data.total ?? 0) / 20));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: if there's a selected store but no initial data, fetch
  useEffect(() => {
    if (activeStoreId && initialTotal === 0 && !invalidStoreSelected) {
      fetchMockups("", 1, activeStoreId);
    }
  }, []);

  // Handle "edit" query param
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
    fetchMockups(search, page, activeStoreId);
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
    fetchMockups(search, page, activeStoreId);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!activeStoreId) return;
    setPage(1);
    fetchMockups(search, 1, activeStoreId);
  }

  function handlePageChange(newPage: number) {
    if (!activeStoreId) return;
    setPage(newPage);
    fetchMockups(search, newPage, activeStoreId);
  }

  function handleStoreChange(storeId: string) {
    setActiveStoreId(storeId);
    setPage(1);
    setSearch("");
    router.replace(`/mockups?storeId=${storeId}`);
    fetchMockups("", 1, storeId);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Mockups</h1>
          <p className="page-subtitle">
            {selectedStore
              ? `${selectedStore.name} · ${total} mockup${total !== 1 ? "s" : ""}`
              : "Chọn store để xem mockup"}
          </p>
        </div>
        {selectedStore ? (
          <Link href={uploadHref} className="btn btn-primary">
            <ImagePlus size={16} />
            Upload
          </Link>
        ) : (
          <button type="button" className="btn btn-secondary" disabled>
            <ImagePlus size={16} />
            Upload
          </button>
        )}
      </div>

      <div className="flex gap-2" style={{ marginBottom: 18, flexWrap: "wrap" }}>
        {stores.map((store) => {
          const isActive = activeStoreId === store.id;
          return (
            <button
              key={store.id}
              type="button"
              className={isActive ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => handleStoreChange(store.id)}
            >
              {store.name}
            </button>
          );
        })}
      </div>

      {!hasStores && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Chưa có store active</h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: 0 }}>
            Kết nối hoặc kích hoạt store trước khi upload mockup.
          </p>
        </div>
      )}

      {hasStores && !selectedStore && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>
            {invalidStoreSelected ? "Store không hợp lệ hoặc không còn active" : "Chọn store để xem mockup"}
          </h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: 0 }}>
            Chọn một store phía trên để xem thư viện mockup của store đó.
          </p>
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
                placeholder="Tìm mockup theo tên..."
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
        <div className="flex justify-center" style={{ padding: 48 }}>
          <Loader2 className="animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {selectedStore && !loading && items.length === 0 && (
        <div className="card" style={{ padding: 64, textAlign: "center" }}>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>
            {search ? "Không tìm thấy mockup" : `Chưa có mockup nào trong ${selectedStore.name}`}
          </h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem", margin: "0 0 24px" }}>
            {search
              ? `Không có kết quả cho "${search}" trong ${selectedStore.name}`
              : "Upload mockup đầu tiên cho store này để bắt đầu"}
          </p>
          {!search && (
            <Link href={uploadHref} className="btn btn-primary">
              <ImagePlus size={16} />
              Upload
            </Link>
          )}
        </div>
      )}

      {/* Grid */}
      {selectedStore && !loading && items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {items.map((item) => (
            <article key={item.id} className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
              {item.imageUrl ? <img src={item.imageUrl} alt="" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "contain" }} /> : null}
              <strong>{item.name}</strong>
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>{item.width} x {item.height} · {item.view}</span>
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>{item.templateAttachmentCount} template attachments</span>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditing(item)}>Edit frame</button>
                <button className="btn btn-secondary btn-sm" type="button" disabled={item.templateAttachmentCount > 0} onClick={() => remove(item)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Pagination */}
      {selectedStore && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3" style={{ marginTop: 24 }}>
          <button
            className="btn btn-secondary"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            ←
          </button>
          <span style={{ fontSize: "0.85rem", opacity: 0.6 }}>
            Trang {page}/{totalPages}
          </span>
          <button
            className="btn btn-secondary"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            →
          </button>
        </div>
      )}

      <GlobalMockupEditorModal open={Boolean(editing)} value={editing} onClose={() => setEditing(null)} onSave={save} />
    </div>
  );
}

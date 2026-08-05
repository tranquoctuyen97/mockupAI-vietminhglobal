"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Search,
  ShoppingBag,
  Trash2,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import ListingOrdersChart, {
  type ListingOrderChartPoint,
  ListingOrdersSparkline,
} from "./ListingOrdersChart";

interface Listing {
  id: string;
  title: string;
  status: string;
  priceUsd: number;
  shopifyProductId: string | null;
  printifyProductId: string | null;
  createdAt: string;
  variants: Array<{ id: string; colorName: string; colorHex: string }>;
  publishJobs: Array<{ id: string; stage: string; status: string }>;
}

interface ListingOrderStats {
  orderCount: number;
  daily: Array<{ date: string; count: number }>;
}

interface Store {
  id: string;
  name: string;
}

const PAGE_SIZE = 20;
const ALL_LISTINGS_ID = "__all__";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PUBLISHING: {
    label: "Publishing...",
    color: "#3b82f6",
    icon: <Loader2 size={14} className="animate-spin" />,
  },
  ACTIVE: { label: "Active", color: "#22c55e", icon: <CheckCircle2 size={14} /> },
  PARTIAL_FAILURE: {
    label: "Partial Failure",
    color: "#f59e0b",
    icon: <AlertTriangle size={14} />,
  },
  FAILED: { label: "Failed", color: "#ef4444", icon: <XCircle size={14} /> },
};

const FILTER_TABS = [
  { key: "all", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "PARTIAL_FAILURE", label: "Partial" },
  { key: "FAILED", label: "Failed" },
];

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return toDateInputValue(date);
}

function buildChartData(
  stats: ListingOrderStats | undefined,
  from: string,
  to: string,
): ListingOrderChartPoint[] {
  if (!stats || !from || !to || from > to) return [];

  const counts = new Map(stats.daily.map((point) => [point.date, point.count]));
  const points: ListingOrderChartPoint[] = [];
  const current = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  while (current <= end) {
    const date = toDateInputValue(current);
    points.push({ date, count: counts.get(date) ?? 0 });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return points;
}

interface Props {
  initialListings: Listing[];
  initialTotal: number;
  stores: Store[];
}

export default function ListingsClient({ initialListings, initialTotal, stores }: Props) {
  const router = useRouter();
  const idPrefix = useId().replace(/:/g, "");
  const [listings, setListings] = useState<Listing[]>(initialListings);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [orderStats, setOrderStats] = useState<Record<string, ListingOrderStats>>({});
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedListingId, setSelectedListingId] = useState(ALL_LISTINGS_ID);
  const [listingPickerOpen, setListingPickerOpen] = useState(false);
  const [listingSearch, setListingSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const hasMountedSearch = useRef(false);

  const fromDate = daysAgo(29);
  const toDate = toDateInputValue(new Date());

  useEffect(() => {
    if (
      selectedListingId !== ALL_LISTINGS_ID &&
      !listings.some((listing) => listing.id === selectedListingId)
    ) {
      setSelectedListingId(ALL_LISTINGS_ID);
    }
  }, [listings, selectedListingId]);

  useEffect(() => {
    if (listings.length === 0 && total === 0) {
      setOrderStats({});
      setOrdersLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    if (selectedListingId === ALL_LISTINGS_ID) {
      params.set("aggregate", "true");
      params.set("status", filter);
      if (selectedStoreId) params.set("storeId", selectedStoreId);
      if (search) params.set("search", search);
    } else {
      for (const listing of listings) params.append("listingId", listing.id);
    }

    setOrdersLoading(true);
    fetch(`/api/listings/order-stats?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load listing order stats");
        return response.json() as Promise<{ stats: Record<string, ListingOrderStats> }>;
      })
      .then((data) => setOrderStats(data.stats))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setOrderStats({});
      })
      .finally(() => {
        if (!controller.signal.aborted) setOrdersLoading(false);
      });

    return () => controller.abort();
  }, [filter, fromDate, listings, search, selectedListingId, selectedStoreId, toDate, total]);

  const fetchListings = useCallback(async function fetchListings(
    status: string,
    storeId: string,
    nextPage: number,
    searchTerm: string,
  ) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status,
        page: String(nextPage),
        limit: String(PAGE_SIZE),
      });
      if (storeId) params.set("storeId", storeId);
      if (searchTerm) params.set("search", searchTerm);

      const url = `/api/listings?${params.toString()}`;
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) {
        setListings(data.listings);
        setTotal(data.total);
        setPage(data.page);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasMountedSearch.current) {
      hasMountedSearch.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      setSearch(nextSearch);
      setPage(1);
      fetchListings(filter, selectedStoreId, 1, nextSearch);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [fetchListings, filter, searchInput, selectedStoreId]);

  function handleFilterChange(key: string) {
    setFilter(key);
    setPage(1);
  }

  function handleStoreChange(storeId: string) {
    setSelectedStoreId(storeId);
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    fetchListings(filter, selectedStoreId, nextPage, search);
  }

  const selectedListing = listings.find((listing) => listing.id === selectedListingId);
  const isAllListingsSelected = selectedListingId === ALL_LISTINGS_ID;
  const selectedListingStats = selectedListingId ? orderStats[selectedListingId] : undefined;
  const chartData = buildChartData(selectedListingStats, fromDate, toDate);
  const pickerListings = listings.filter((listing) =>
    (listing.title || "Untitled").toLowerCase().includes(listingSearch.trim().toLowerCase()),
  );

  async function handleDelete(id: string) {
    if (!confirm("Archive listing này?")) return;
    await fetch(`/api/listings/${id}`, { method: "DELETE" });
    const nextPage = listings.length === 1 && page > 1 ? page - 1 : page;
    fetchListings(filter, selectedStoreId, nextPage, search);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstVisible = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastVisible = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Listings</h1>
          <p className="page-subtitle">Sản phẩm đã publish</p>
        </div>
      </div>

      {/* Filter tabs and store selector */}
      <div
        className="flex items-center justify-between gap-3"
        style={{ marginBottom: 20, flexWrap: "wrap" }}
      >
        <div className="flex gap-2">
          {FILTER_TABS.map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => handleFilterChange(tab.key)}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-default)",
                backgroundColor: filter === tab.key ? "var(--color-wise-green)" : "transparent",
                color: filter === tab.key ? "white" : "inherit",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <label
          className="flex items-center gap-2"
          style={{
            flex: "1 1 320px",
            maxWidth: 460,
            minWidth: 240,
            padding: "0 10px",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-primary)",
          }}
        >
          <Search size={15} style={{ opacity: 0.5, flexShrink: 0 }} />
          <input
            aria-label="Search listings"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Tìm theo tên, Shopify Product ID hoặc Printify Product ID"
            style={{
              width: "100%",
              padding: "8px 0",
              border: 0,
              outline: 0,
              background: "transparent",
              color: "inherit",
              fontSize: "0.8rem",
            }}
          />
        </label>

        <label className="flex items-center gap-2" style={{ fontSize: "0.8rem" }}>
          <span style={{ opacity: 0.6 }}>Store</span>
          <select
            aria-label="Filter listings by store"
            value={selectedStoreId}
            onChange={(event) => handleStoreChange(event.target.value)}
            style={{
              minWidth: 190,
              maxWidth: "min(260px, 70vw)",
              padding: "7px 30px 7px 10px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-default)",
              background: "var(--bg-primary)",
              color: "inherit",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            <option value="">All stores</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="flex items-center justify-between gap-4" style={{ flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontWeight: 700, fontSize: "1rem", margin: 0 }}>Orders theo ngày</h2>
            <p style={{ fontSize: "0.78rem", opacity: 0.5, margin: "4px 0 0" }}>
              Tính các order đã gắn với listing đang chọn hoặc toàn bộ listing đang lọc.
            </p>
          </div>
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            <label
              style={{ fontSize: "0.75rem", opacity: 0.6 }}
              htmlFor={`${idPrefix}-listing-order-select`}
            >
              Listing
            </label>
            <div style={{ position: "relative" }}>
              <button
                id={`${idPrefix}-listing-order-select`}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={listingPickerOpen}
                onClick={() => setListingPickerOpen((open) => !open)}
                disabled={listings.length === 0}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  width: 260,
                  maxWidth: "min(260px, 58vw)",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-primary)",
                  color: "inherit",
                  fontSize: "0.8rem",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {isAllListingsSelected
                    ? "All listings"
                    : selectedListing?.title || "Chọn listing"}
                </span>
                <ChevronDown size={15} style={{ flexShrink: 0, opacity: 0.6 }} />
              </button>
              {listingPickerOpen && (
                <div
                  style={{
                    position: "absolute",
                    zIndex: 20,
                    top: "calc(100% + 6px)",
                    right: 0,
                    width: 280,
                    maxWidth: "min(280px, 72vw)",
                    padding: 8,
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-primary)",
                    boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
                  }}
                >
                  <div
                    className="flex items-center gap-2"
                    style={{
                      padding: "0 8px",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    <Search size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                    <input
                      value={listingSearch}
                      onChange={(event) => setListingSearch(event.target.value)}
                      placeholder="Tìm listing..."
                      style={{
                        width: "100%",
                        padding: "8px 0",
                        border: 0,
                        outline: 0,
                        background: "transparent",
                        color: "inherit",
                        fontSize: "0.8rem",
                      }}
                    />
                  </div>
                  <div role="listbox" style={{ maxHeight: 220, overflowY: "auto", marginTop: 6 }}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isAllListingsSelected}
                      onClick={() => {
                        setSelectedListingId(ALL_LISTINGS_ID);
                        setListingPickerOpen(false);
                        setListingSearch("");
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "9px 8px",
                        border: 0,
                        borderRadius: "var(--radius-sm)",
                        background: isAllListingsSelected ? "var(--bg-tertiary)" : "transparent",
                        color: "inherit",
                        textAlign: "left",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      All listings
                    </button>
                    {pickerListings.length === 0 ? (
                      <div style={{ padding: "10px 8px", fontSize: "0.8rem", opacity: 0.5 }}>
                        Không tìm thấy listing
                      </div>
                    ) : (
                      pickerListings.map((listing) => (
                        <button
                          key={listing.id}
                          type="button"
                          role="option"
                          aria-selected={listing.id === selectedListingId}
                          onClick={() => {
                            setSelectedListingId(listing.id);
                            setListingPickerOpen(false);
                            setListingSearch("");
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: "9px 8px",
                            border: 0,
                            borderRadius: "var(--radius-sm)",
                            background:
                              listing.id === selectedListingId
                                ? "var(--bg-tertiary)"
                                : "transparent",
                            color: "inherit",
                            textAlign: "left",
                            fontSize: "0.8rem",
                            cursor: "pointer",
                          }}
                        >
                          {listing.title || "Untitled"}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, fontSize: "0.78rem", opacity: 0.55 }}>
          Khoảng thời gian: 30 ngày gần nhất
        </div>

        <div style={{ height: 220, marginTop: 18 }}>
          {ordersLoading ? (
            <div
              className="flex items-center justify-center"
              style={{ height: "100%", opacity: 0.5 }}
            >
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : !isAllListingsSelected && !selectedListing ? (
            <div
              className="flex items-center justify-center"
              style={{ height: "100%", opacity: 0.5 }}
            >
              Chưa có listing để hiển thị
            </div>
          ) : (
            <ListingOrdersChart data={chartData} />
          )}
        </div>
        {(isAllListingsSelected || selectedListing) && (
          <div style={{ fontSize: "0.8rem", opacity: 0.65, marginTop: 4 }}>
            {isAllListingsSelected ? "All listings" : selectedListing?.title || "Untitled"}:{" "}
            <strong>{selectedListingStats?.orderCount ?? 0}</strong> orders
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center" style={{ padding: 64, opacity: 0.5 }}>
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}

      {!loading && listings.length === 0 && (
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
            <ShoppingBag size={32} style={{ opacity: 0.3 }} />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Chưa có listing nào</h3>
          <p style={{ opacity: 0.5, fontSize: "0.875rem" }}>
            Publish từ Wizard để tạo listing đầu tiên
          </p>
        </div>
      )}

      {!loading && listings.length > 0 && (
        <>
          <div className="card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border-default)",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    opacity: 0.5,
                  }}
                >
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Title</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Colors</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "12px 16px" }}>Orders</th>
                  <th style={{ textAlign: "right", padding: "12px 16px" }}>Price</th>
                  <th style={{ textAlign: "right", padding: "12px 16px" }}>Date</th>
                  <th style={{ textAlign: "right", padding: "12px 16px" }}></th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing, idx) => {
                  const statusCfg = STATUS_CONFIG[listing.status] || STATUS_CONFIG.FAILED;
                  return (
                    <tr
                      key={listing.id}
                      style={{
                        borderBottom:
                          idx < listings.length - 1 ? "1px solid var(--border-default)" : "none",
                        cursor: "pointer",
                      }}
                      onClick={() => router.push(`/listings/${listing.id}`)}
                    >
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                          {listing.title || "Untitled"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div className="flex gap-1">
                          {listing.variants.slice(0, 5).map((v) => (
                            <div
                              key={v.id}
                              title={v.colorName}
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: "50%",
                                backgroundColor: v.colorHex,
                                border: "1px solid var(--border-default)",
                              }}
                            />
                          ))}
                          {listing.variants.length > 5 && (
                            <span style={{ fontSize: "0.75rem", opacity: 0.5 }}>
                              +{listing.variants.length - 5}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          className="flex items-center gap-1"
                          style={{
                            color: statusCfg.color,
                            fontWeight: 600,
                            fontSize: "0.8rem",
                          }}
                        >
                          {statusCfg.icon} {statusCfg.label}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          textAlign: "right",
                          fontWeight: 700,
                          fontSize: "0.9rem",
                        }}
                      >
                        <div className="flex items-center justify-end gap-3">
                          <span>
                            {ordersLoading ? "…" : (orderStats[listing.id]?.orderCount ?? 0)}
                          </span>
                          <ListingOrdersSparkline
                            data={buildChartData(orderStats[listing.id], fromDate, toDate)}
                          />
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          textAlign: "right",
                          fontWeight: 600,
                          fontSize: "0.9rem",
                        }}
                      >
                        ${listing.priceUsd.toFixed(2)}
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          textAlign: "right",
                          fontSize: "0.8rem",
                          opacity: 0.5,
                        }}
                      >
                        {new Date(listing.createdAt).toLocaleDateString("vi-VN")}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(listing.id);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 4,
                              color: "var(--color-danger)",
                              opacity: 0.5,
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                          <ExternalLink size={14} style={{ opacity: 0.3 }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div
            className="flex items-center justify-between gap-3"
            style={{ marginTop: 12, fontSize: "0.8rem", opacity: 0.65, flexWrap: "wrap" }}
          >
            <span>
              Showing {firstVisible}-{lastVisible} of {total} listings
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePageChange(page - 1)}
                disabled={loading || page <= 1}
                aria-label="Previous listings page"
                style={paginationButton}
              >
                <ChevronLeft size={15} />
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => handlePageChange(page + 1)}
                disabled={loading || page >= totalPages}
                aria-label="Next listings page"
                style={paginationButton}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const paginationButton: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-primary)",
  color: "inherit",
  cursor: "pointer",
};

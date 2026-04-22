"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import {
  Loader2, Check, Search, X, ChevronDown,
  Package, Truck, Palette,
} from "lucide-react";



interface Blueprint {
  id: number;
  title: string;
  brand: string;
  description: string;
  images: string[];
}

interface Provider {
  id: number;
  title: string;
}

interface ColorOption {
  title: string;
  hex: string;
}

/* ═══════════════════════════════════════════════════════════
   Searchable Combobox — generic, reusable
   ═══════════════════════════════════════════════════════════ */
function SearchCombobox<T extends { id: number | string }>({
  items,
  value,
  onChange,
  renderItem,
  renderSelected,
  searchFilter,
  placeholder = "Tìm kiếm...",
  emptyLabel = "Không tìm thấy kết quả",
  icon,
  maxVisible = 80,
}: {
  items: T[];
  value: T | null;
  onChange: (item: T | null) => void;
  renderItem: (item: T) => React.ReactNode;
  renderSelected: (item: T) => React.ReactNode;
  searchFilter: (item: T, query: string) => boolean;
  placeholder?: string;
  emptyLabel?: string;
  icon?: React.ReactNode;
  maxVisible?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, maxVisible);
    const lower = query.toLowerCase();
    return items.filter((it) => searchFilter(it, lower)).slice(0, maxVisible);
  }, [items, query, searchFilter, maxVisible]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Auto-focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setQuery(""); }}
        className="input"
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          width: "100%", display: "flex", alignItems: "center",
          gap: 8, textAlign: "left", cursor: "pointer",
          padding: "10px 14px", minHeight: 44,
        }}
      >
        {icon && <span style={{ flexShrink: 0, opacity: 0.4 }}>{icon}</span>}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value ? renderSelected(value) : (
            <span style={{ opacity: 0.4 }}>{placeholder}</span>
          )}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear selection"
            onClick={(e) => { e.stopPropagation(); onChange(null); setQuery(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange(null); setQuery(""); } }}
            style={{ flexShrink: 0, opacity: 0.3, cursor: "pointer", display: "flex", padding: 2, borderRadius: 4 }}
          >
            <X size={14} />
          </span>
        )}
        <ChevronDown
          size={14}
          style={{
            flexShrink: 0, opacity: 0.3,
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : "rotate(0)",
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            zIndex: 50,
            background: "var(--bg-surface, #fff)",
            border: "1px solid var(--border-default)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            overflow: "hidden",
          }}
        >
          {/* Search input */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.3 }} />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm kiếm..."
                aria-label="Search items"
                style={{
                  width: "100%", padding: "8px 10px 8px 32px",
                  border: "1px solid var(--border-default)",
                  borderRadius: 6, fontSize: "0.85rem",
                  outline: "none", background: "var(--bg-inset, #f8f8f8)",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-wise-green)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", opacity: 0.3, display: "flex",
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {items.length > 0 && (
              <div style={{ fontSize: "0.7rem", opacity: 0.35, marginTop: 4, paddingLeft: 2 }}>
                {filtered.length === items.length
                  ? `${items.length} mục`
                  : `${filtered.length} / ${items.length} mục`}
              </div>
            )}
          </div>

          {/* List */}
          <div
            ref={listRef}
            role="listbox"
            style={{ maxHeight: 280, overflowY: "auto" }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: "20px 16px", textAlign: "center", opacity: 0.4, fontSize: "0.85rem" }}>
                {emptyLabel}
              </div>
            ) : (
              filtered.map((item) => {
                const isActive = value?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => { onChange(item); setOpen(false); setQuery(""); }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 8,
                      padding: "9px 14px", border: "none", cursor: "pointer",
                      textAlign: "left", fontSize: "0.84rem",
                      background: isActive ? "rgba(159,232,112,0.1)" : "transparent",
                      color: "inherit",
                      borderBottom: "1px solid var(--border-default)",
                      transition: "background 0.08s",
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-inset)"; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>{renderItem(item)}</span>
                    {isActive && <Check size={14} style={{ flexShrink: 0, color: "var(--color-wise-green)" }} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Step 2 — Product Selection
   ═══════════════════════════════════════════════════════════ */
export default function Step2ProductPage() {
  const { draft, updateDraft } = useWizardStore();


  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [colors, setColors] = useState<ColorOption[]>([]);


  const [loadingBlueprints, setLoadingBlueprints] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingColors, setLoadingColors] = useState(false);

  const selectedColors = (draft?.selectedColors as ColorOption[] | null) || [];

  // Derived selected items
  const selectedBlueprint = blueprints.find((b) => b.id === draft?.blueprintId) || null;
  const selectedProvider = providers.find((p) => p.id === draft?.printProviderId) || null;



  // Load blueprints when store changes
  useEffect(() => {
    if (!draft?.storeId) return;
    setLoadingBlueprints(true);
    setBlueprints([]);
    setProviders([]);
    setColors([]);

    (async () => {
      try {
        const res = await fetch(`/api/stores/${draft.storeId}/catalog?action=blueprints`);
        const data = await res.json();
        if (res.ok) setBlueprints(data.blueprints || []);
      } catch { /* ignore */ }
      finally { setLoadingBlueprints(false); }
    })();
  }, [draft?.storeId]);

  // Load providers when blueprint changes
  useEffect(() => {
    if (!draft?.storeId || !draft?.blueprintId) return;
    setLoadingProviders(true);
    setProviders([]);
    setColors([]);

    (async () => {
      try {
        const res = await fetch(
          `/api/stores/${draft.storeId}/catalog?action=providers&blueprintId=${draft.blueprintId}`,
        );
        const data = await res.json();
        if (res.ok) setProviders(data.providers || []);
      } catch { /* ignore */ }
      finally { setLoadingProviders(false); }
    })();
  }, [draft?.storeId, draft?.blueprintId]);

  // Load colors when provider changes
  useEffect(() => {
    if (!draft?.storeId || !draft?.blueprintId || !draft?.printProviderId) return;
    setLoadingColors(true);
    setColors([]);

    (async () => {
      try {
        const res = await fetch(
          `/api/stores/${draft.storeId}/catalog?action=variants&blueprintId=${draft.blueprintId}&printProviderId=${draft.printProviderId}`,
        );
        const data = await res.json();
        if (res.ok) setColors(data.colors || []);
      } catch { /* ignore */ }
      finally { setLoadingColors(false); }
    })();
  }, [draft?.storeId, draft?.blueprintId, draft?.printProviderId]);

  function toggleColor(color: ColorOption) {
    const exists = selectedColors.find((c) => c.title === color.title);
    const updated = exists
      ? selectedColors.filter((c) => c.title !== color.title)
      : [...selectedColors, color];
    updateDraft({ selectedColors: updated });
  }

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Chọn Product
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 24px" }}>
        Chọn blueprint sản phẩm, print provider và màu sắc
      </p>

      {/* ── Blueprint selector (searchable) ── */}
      {draft?.storeId && (
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
            Product (Blueprint)
          </label>
          {loadingBlueprints ? (
            <LoadingRow label="Đang tải catalog..." />
          ) : (
            <SearchCombobox<Blueprint>
              items={blueprints}
              value={selectedBlueprint}
              placeholder="Tìm blueprint (VD: T-shirt, Hoodie, Mug...)"
              emptyLabel="Không tìm thấy blueprint nào"
              icon={<Package size={15} />}
              onChange={(bp) => {
                updateDraft({
                  blueprintId: bp?.id ?? null,
                  productType: bp?.title ?? null,
                  printProviderId: null,
                  selectedColors: [],
                });
              }}
              searchFilter={(bp, q) =>
                bp.title.toLowerCase().includes(q) ||
                bp.brand.toLowerCase().includes(q) ||
                String(bp.id).includes(q)
              }
              renderItem={(bp) => (
                <div>
                  <span style={{ fontWeight: 500 }}>{bp.title}</span>
                  <span style={{ opacity: 0.4, marginLeft: 6, fontSize: "0.78rem" }}>({bp.brand})</span>
                </div>
              )}
              renderSelected={(bp) => (
                <span>
                  <span style={{ fontWeight: 600 }}>{bp.title}</span>
                  <span style={{ opacity: 0.5, marginLeft: 4, fontSize: "0.82rem" }}>({bp.brand})</span>
                </span>
              )}
            />
          )}
        </div>
      )}

      {/* ── Provider selector (searchable) ── */}
      {draft?.blueprintId && (
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
            Print Provider
          </label>
          {loadingProviders ? (
            <LoadingRow label="Đang tải providers..." />
          ) : (
            <SearchCombobox<Provider>
              items={providers}
              value={selectedProvider}
              placeholder="Chọn print provider"
              emptyLabel="Không có provider nào"
              icon={<Truck size={15} />}
              onChange={(p) => {
                updateDraft({
                  printProviderId: p?.id ?? null,
                  selectedColors: [],
                });
              }}
              searchFilter={(p, q) =>
                p.title.toLowerCase().includes(q) ||
                String(p.id).includes(q)
              }
              renderItem={(p) => <span style={{ fontWeight: 500 }}>{p.title}</span>}
              renderSelected={(p) => <span style={{ fontWeight: 600 }}>{p.title}</span>}
            />
          )}
        </div>
      )}

      {/* ── Color picker ── */}
      {draft?.printProviderId && (
        <div>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <Palette size={15} style={{ opacity: 0.5 }} />
            <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>
              Màu sắc
            </label>
            {selectedColors.length > 0 && (
              <span style={{
                fontSize: "0.72rem", fontWeight: 600,
                padding: "1px 8px", borderRadius: 99,
                background: "rgba(159,232,112,0.15)",
                color: "var(--color-wise-green)",
              }}>
                {selectedColors.length} đã chọn
              </span>
            )}
          </div>

          {loadingColors ? (
            <LoadingRow label="Đang tải variants..." />
          ) : colors.length === 0 ? (
            <div style={{ padding: 16, opacity: 0.4, fontSize: "0.85rem", textAlign: "center" }}>
              Không có màu cho variant này
            </div>
          ) : (
            <>
              {/* Select All / Clear */}
              <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => updateDraft({ selectedColors: colors })}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: "0.75rem", color: "var(--color-wise-green)", fontWeight: 500,
                    padding: "2px 0",
                  }}
                >
                  Chọn tất cả
                </button>
                {selectedColors.length > 0 && (
                  <>
                    <span style={{ opacity: 0.2 }}>·</span>
                    <button
                      type="button"
                      onClick={() => updateDraft({ selectedColors: [] })}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: "0.75rem", color: "#94a3b8", fontWeight: 500,
                        padding: "2px 0",
                      }}
                    >
                      Bỏ chọn
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {colors.map((c) => {
                  const isSelected = selectedColors.some((sc) => sc.title === c.title);
                  return (
                    <button
                      key={c.title}
                      type="button"
                      onClick={() => toggleColor(c)}
                      className="flex items-center gap-2"
                      style={{
                        padding: "7px 12px",
                        borderRadius: 8,
                        border: isSelected
                          ? "2px solid var(--color-wise-green)"
                          : "1px solid var(--border-default)",
                        backgroundColor: isSelected ? "rgba(159,232,112,0.08)" : "transparent",
                        cursor: "pointer",
                        fontSize: "0.8rem",
                        fontWeight: isSelected ? 600 : 400,
                        transition: "all 0.12s",
                        minHeight: 36,
                      }}
                    >
                      <div
                        style={{
                          width: 14, height: 14, borderRadius: 3,
                          backgroundColor: c.hex,
                          border: "1px solid rgba(0,0,0,0.1)",
                          flexShrink: 0,
                        }}
                      />
                      {c.title}
                      {isSelected && <Check size={13} style={{ color: "var(--color-wise-green)" }} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Loading Row Helper ─── */
function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2" style={{ opacity: 0.5, fontSize: "0.85rem", padding: "10px 0" }}>
      <Loader2 size={14} className="animate-spin" /> {label}
    </div>
  );
}

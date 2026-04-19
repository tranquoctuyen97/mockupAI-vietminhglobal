"use client";

import { useState, useEffect } from "react";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import { Store, Loader2, ChevronDown, Check } from "lucide-react";

interface StoreItem {
  id: string;
  name: string;
  shopifyDomain: string;
  printifyShopId: string | null;
  status: string;
}

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

export default function Step2ProductPage() {
  const { draft, updateDraft } = useWizardStore();

  const [stores, setStores] = useState<StoreItem[]>([]);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [colors, setColors] = useState<ColorOption[]>([]);

  const [loadingStores, setLoadingStores] = useState(true);
  const [loadingBlueprints, setLoadingBlueprints] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingColors, setLoadingColors] = useState(false);

  const selectedColors = (draft?.selectedColors as ColorOption[] | null) || [];

  // Load stores
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/stores");
        const data = await res.json();
        if (res.ok) setStores(data.stores || []);
      } catch { /* ignore */ }
      finally { setLoadingStores(false); }
    })();
  }, []);

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
        Chọn Store & Product
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Chọn store, blueprint sản phẩm và màu sắc
      </p>

      {/* Store selector */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
          Store
        </label>
        {loadingStores ? (
          <div className="flex items-center gap-2" style={{ opacity: 0.5, fontSize: "0.85rem" }}>
            <Loader2 size={14} className="animate-spin" /> Loading...
          </div>
        ) : (
          <select
            className="input"
            value={draft?.storeId || ""}
            onChange={(e) => {
              updateDraft({
                storeId: e.target.value || null,
                blueprintId: null,
                printProviderId: null,
                selectedColors: [],
              });
            }}
          >
            <option value="">-- Chọn store --</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.shopifyDomain})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Blueprint selector */}
      {draft?.storeId && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
            Product (Blueprint)
          </label>
          {loadingBlueprints ? (
            <div className="flex items-center gap-2" style={{ opacity: 0.5, fontSize: "0.85rem" }}>
              <Loader2 size={14} className="animate-spin" /> Đang tải catalog...
            </div>
          ) : (
            <select
              className="input"
              value={draft?.blueprintId || ""}
              onChange={(e) => {
                const bp = blueprints.find((b) => b.id === parseInt(e.target.value, 10));
                updateDraft({
                  blueprintId: parseInt(e.target.value, 10) || null,
                  productType: bp?.title || null,
                  printProviderId: null,
                  selectedColors: [],
                });
              }}
            >
              <option value="">-- Chọn product --</option>
              {blueprints.map((bp) => (
                <option key={bp.id} value={bp.id}>
                  {bp.title} ({bp.brand})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Provider selector */}
      {draft?.blueprintId && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
            Print Provider
          </label>
          {loadingProviders ? (
            <div className="flex items-center gap-2" style={{ opacity: 0.5, fontSize: "0.85rem" }}>
              <Loader2 size={14} className="animate-spin" /> Đang tải providers...
            </div>
          ) : (
            <select
              className="input"
              value={draft?.printProviderId || ""}
              onChange={(e) => {
                updateDraft({
                  printProviderId: parseInt(e.target.value, 10) || null,
                  selectedColors: [],
                });
              }}
            >
              <option value="">-- Chọn provider --</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Color picker */}
      {draft?.printProviderId && (
        <div>
          <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
            Chọn màu ({selectedColors.length} đã chọn)
          </label>
          {loadingColors ? (
            <div className="flex items-center gap-2" style={{ opacity: 0.5, fontSize: "0.85rem" }}>
              <Loader2 size={14} className="animate-spin" /> Đang tải variants...
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {colors.map((c) => {
                const isSelected = selectedColors.some((sc) => sc.title === c.title);
                return (
                  <button
                    key={c.title}
                    onClick={() => toggleColor(c)}
                    className="flex items-center gap-2"
                    style={{
                      padding: "8px 14px",
                      borderRadius: "var(--radius-sm)",
                      border: isSelected
                        ? "2px solid var(--color-wise-green)"
                        : "1px solid var(--border-default)",
                      backgroundColor: isSelected ? "rgba(146,198,72,0.08)" : "transparent",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      fontWeight: isSelected ? 600 : 400,
                      transition: "all 0.15s",
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        backgroundColor: c.hex,
                        border: "1px solid rgba(0,0,0,0.1)",
                        flexShrink: 0,
                      }}
                    />
                    {c.title}
                    {isSelected && <Check size={14} style={{ color: "var(--color-wise-green)" }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

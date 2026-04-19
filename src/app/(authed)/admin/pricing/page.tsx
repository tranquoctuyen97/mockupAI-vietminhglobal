"use client";

import { useState, useEffect } from "react";
import { DollarSign, Loader2, Save, Check } from "lucide-react";

interface PricingTemplate {
  productType: string;
  basePriceUsd: number;
}

const DEFAULT_PRODUCTS = [
  { productType: "T-Shirt", basePriceUsd: 24.99 },
  { productType: "Hoodie", basePriceUsd: 39.99 },
  { productType: "Mug", basePriceUsd: 14.99 },
  { productType: "Tote Bag", basePriceUsd: 19.99 },
  { productType: "Phone Case", basePriceUsd: 16.99 },
];

export default function PricingAdminPage() {
  const [templates, setTemplates] = useState<PricingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/pricing-templates");
        const data = await res.json();
        if (res.ok && data.templates?.length > 0) {
          setTemplates(data.templates);
        } else {
          setTemplates(DEFAULT_PRODUCTS);
        }
      } catch {
        setTemplates(DEFAULT_PRODUCTS);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/pricing-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  function updatePrice(idx: number, value: string) {
    const updated = [...templates];
    updated[idx] = { ...updated[idx], basePriceUsd: parseFloat(value) || 0 };
    setTemplates(updated);
  }

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Pricing Templates</h1>
          <p className="page-subtitle">Giá mặc định theo loại sản phẩm</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : saved ? (
            <Check size={16} />
          ) : (
            <Save size={16} />
          )}
          {saved ? "Đã lưu!" : "Lưu"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center" style={{ padding: 64, opacity: 0.5 }}>
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
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
                <th style={{ textAlign: "left", padding: "12px 16px" }}>Product Type</th>
                <th style={{ textAlign: "right", padding: "12px 16px" }}>Base Price (USD)</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t, idx) => (
                <tr
                  key={t.productType}
                  style={{
                    borderBottom:
                      idx < templates.length - 1
                        ? "1px solid var(--border-default)"
                        : "none",
                  }}
                >
                  <td style={{ padding: "12px 16px" }}>
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--bg-tertiary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <DollarSign size={16} style={{ opacity: 0.4 }} />
                      </div>
                      <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                        {t.productType}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right" }}>
                    <input
                      type="number"
                      className="input"
                      value={t.basePriceUsd}
                      onChange={(e) => updatePrice(idx, e.target.value)}
                      step="0.01"
                      min="0"
                      style={{
                        maxWidth: 120,
                        textAlign: "right",
                        display: "inline-block",
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import { Loader2, Palette, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

type ColorGroup = "auto" | "light" | "dark";

type ConfiguredColor = {
  id: string;
  colorName: string;
  colorNameKey: string;
  colorGroup: Exclude<ColorGroup, "auto">;
  source: string;
  hex: string | null;
  storesCount: number;
  catalogsCount: number;
  rowsCount: number;
  updatedAt: string;
};

type ColorRow = {
  colorNameKey: string;
  colorName: string;
  hex: string | null;
  rowsCount: number;
  storesCount: number;
  catalogsCount: number;
  colorGroup: ColorGroup;
};

type ColorGroupsResponse = {
  configured: ConfiguredColor[];
  colors: ColorRow[];
};

function groupLabel(group: ColorGroup): string {
  if (group === "light") return "Dùng design sáng";
  if (group === "dark") return "Dùng design tối";
  return "Auto";
}

export default function AdminColorGroupsPage() {
  const [data, setData] = useState<ColorGroupsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"configured" | "all">("configured");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const searchInputId = useId();

  const loadColorGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/color-groups");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Không tải được rule màu");
      setData(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tải được rule màu");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadColorGroups();
  }, [loadColorGroups]);

  async function updateColorGroup(colorName: string, colorGroup: ColorGroup) {
    const colorNameKey = colorName.trim().toLowerCase();
    setSavingKey(colorNameKey);
    try {
      const res = await fetch("/api/admin/color-groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorName, colorGroup }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Không lưu được rule màu");
      toast.success(`${colorName}: ${groupLabel(colorGroup)}`);
      await loadColorGroups();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được rule màu");
    } finally {
      setSavingKey(null);
    }
  }

  const configured = useMemo(() => {
    const rows = data?.configured ?? [];
    return rows.filter((row) => row.colorName.toLowerCase().includes(query.trim().toLowerCase()));
  }, [data, query]);

  const colors = useMemo(() => {
    const rows = data?.colors ?? [];
    return rows.filter((row) => row.colorName.toLowerCase().includes(query.trim().toLowerCase()));
  }, [data, query]);

  const activeRowsCount = tab === "configured" ? configured.length : colors.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            style={{
              color: "var(--text-primary)",
              fontSize: "2rem",
              fontWeight: 900,
              lineHeight: 1.05,
              margin: 0,
            }}
          >
            Match màu mockup
          </h1>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.95rem",
              lineHeight: 1.45,
              margin: "0.45rem 0 0",
            }}
          >
            Rule global quyết định màu áo nào dùng design sáng hoặc design tối.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5" style={{ flexWrap: "wrap" }}>
        <div style={{ position: "relative", minWidth: 280, maxWidth: 420, flex: "1 1 320px" }}>
          <label className="sr-only" htmlFor={searchInputId}>
            Tìm màu Printify
          </label>
          <Search
            size={16}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            id={searchInputId}
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search màu, ví dụ Azalea..."
            style={{
              height: 44,
              padding: "0 14px 0 42px",
              lineHeight: "44px",
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={tab === "configured" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
            onClick={() => setTab("configured")}
          >
            Đã cấu hình {data ? `(${data.configured.length})` : ""}
          </button>
          <button
            type="button"
            className={tab === "all" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
            onClick={() => setTab("all")}
          >
            Tất cả màu {data ? `(${data.colors.length})` : ""}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2
            size={24}
            className="animate-spin"
            style={{ color: "var(--color-wise-green)" }}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Màu</th>
                <th>Đang dùng</th>
                <th>Phạm vi</th>
                <th style={{ textAlign: "right" }}>Cấu hình</th>
              </tr>
            </thead>
            <tbody>
              {tab === "configured" &&
                configured.map((row) => (
                  <ColorRuleRow
                    key={row.colorNameKey}
                    colorName={row.colorName}
                    colorNameKey={row.colorNameKey}
                    colorGroup={row.colorGroup}
                    hex={row.hex}
                    storesCount={row.storesCount}
                    catalogsCount={row.catalogsCount}
                    savingKey={savingKey}
                    onChange={updateColorGroup}
                  />
                ))}
              {tab === "all" &&
                colors.map((row) => (
                  <ColorRuleRow
                    key={row.colorNameKey}
                    colorName={row.colorName}
                    colorNameKey={row.colorNameKey}
                    colorGroup={row.colorGroup}
                    hex={row.hex}
                    storesCount={row.storesCount}
                    catalogsCount={row.catalogsCount}
                    savingKey={savingKey}
                    onChange={updateColorGroup}
                  />
                ))}
              {activeRowsCount === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="text-center py-10">
                      <Palette
                        size={32}
                        style={{ color: "var(--text-muted)", margin: "0 auto 0.5rem" }}
                      />
                      <p style={{ color: "var(--text-primary)", fontWeight: 700, margin: 0 }}>
                        Không có màu phù hợp
                      </p>
                      <p
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "0.88rem",
                          margin: "0.35rem 0 0",
                        }}
                      >
                        Thử search bằng tên màu khác hoặc chuyển sang tab Tất cả màu.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ColorRuleRow({
  colorName,
  colorNameKey,
  colorGroup,
  hex,
  storesCount,
  catalogsCount,
  savingKey,
  onChange,
}: {
  colorName: string;
  colorNameKey: string;
  colorGroup: ColorGroup;
  hex: string | null;
  storesCount: number;
  catalogsCount: number;
  savingKey: string | null;
  onChange: (colorName: string, colorGroup: ColorGroup) => void;
}) {
  return (
    <tr>
      <td>
        <ColorName name={colorName} hex={hex} />
      </td>
      <td>
        <span className={colorGroup === "auto" ? "badge badge-info" : "badge badge-success"}>
          {groupLabel(colorGroup)}
        </span>
      </td>
      <td className="text-caption" style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
        {catalogsCount > 0 ? `${catalogsCount} catalog Printify` : "Chưa có trong cache"}
        {storesCount > 0 ? ` · ${storesCount} store đang dùng` : ""}
      </td>
      <td style={{ textAlign: "right" }}>
        <GroupSelect
          value={colorGroup}
          disabled={savingKey === colorNameKey}
          onChange={(group) => onChange(colorName, group)}
        />
      </td>
    </tr>
  );
}

function ColorName({ name, hex }: { name: string; hex: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          border: "1px solid var(--border-default)",
          background: hex ?? "var(--bg-tertiary)",
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 700 }}>{name}</span>
    </div>
  );
}

function GroupSelect({
  value,
  disabled,
  onChange,
}: {
  value: ColorGroup;
  disabled: boolean;
  onChange: (group: ColorGroup) => void;
}) {
  return (
    <select
      aria-label={`Cấu hình rule màu: ${groupLabel(value)}`}
      title={groupLabel(value)}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as ColorGroup)}
      style={{
        width: 190,
        height: 44,
        padding: "0 42px 0 14px",
        border: "1px solid var(--border-default)",
        borderRadius: 12,
        background: "var(--bg-surface)",
        color: "var(--text-primary)",
        cursor: disabled ? "wait" : "pointer",
        fontSize: "0.92rem",
        fontWeight: 800,
        lineHeight: "44px",
        outline: "none",
      }}
    >
      <option value="auto">Auto</option>
      <option value="light">Dùng design sáng</option>
      <option value="dark">Dùng design tối</option>
    </select>
  );
}

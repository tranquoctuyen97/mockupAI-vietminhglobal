"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Eye,
  ImagePlus,
  Info,
  Loader2,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import {
  MockupLibraryFilterBar,
  type MockupLibraryFilter,
} from "@/components/mockup/MockupLibraryFilterBar";
import {
  UploadMockupModal,
  type UploadMockupModalValue,
} from "@/components/mockup/UploadMockupModal";
import type { CompositeRegion } from "@/components/mockup/CompositeRegionEditor";

interface CustomSource {
  id: string;
  storagePath: string;
  outputPath: string | null;
  imageUrl: string | null;
  outputUrl: string | null;
  label: string | null;
  view: string;
  sceneType: string;
  renderMode: "FINAL" | "COMPOSITE";
  compositeRegionPx: CompositeRegion | null;
  isPrimary: boolean;
  sortOrder: number;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

interface TemplateGroup {
  id: string;
  name: string;
  blueprintTitle: string;
  printProviderTitle: string;
  defaultMockupSource?: "PRINTIFY" | "CUSTOM";
  colors: Array<{
    id: string;
    name: string;
    hex: string;
    sources: CustomSource[];
  }>;
}

interface LibraryResponse {
  store: { id: string; name: string };
  templates: TemplateGroup[];
}

type ModalTarget = {
  source?: CustomSource;
  templateId?: string;
  colorId?: string;
} | null;

export default function MockupLibraryPage() {
  return (
    <Suspense fallback={<LibraryLoading />}>
      <MockupLibraryPageContent />
    </Suspense>
  );
}

function MockupLibraryPageContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const storeId = params.id;
  const templateIdFromUrl = searchParams.get("templateId");
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<MockupLibraryFilter>("all");
  const [search, setSearch] = useState("");
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);

  async function fetchLibrary() {
    setLoading(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/mockup-library`);
      if (!res.ok) throw new Error("Không tải được Mockup Library");
      setData(await res.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tải được Mockup Library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchLibrary();
  }, [storeId]);

  const libraryTemplates = useMemo(() => {
    if (!data) return [];
    return data.templates.filter((template) => {
      if (templateIdFromUrl) {
        return template.defaultMockupSource === "CUSTOM" && template.id === templateIdFromUrl;
      }
      return template.defaultMockupSource === "CUSTOM";
    });
  }, [data, templateIdFromUrl]);

  const rows = useMemo(() => {
    return libraryTemplates.flatMap((template) =>
      template.colors.map((color) => ({
        template,
        color,
        sourceCount: color.sources.length,
      })),
    );
  }, [libraryTemplates]);

  const stats = useMemo(() => {
    const readyPairs = rows.filter((row) => row.sourceCount > 0).length;
    const totalPairs = rows.length;
    const totalMockups = rows.reduce((sum, row) => sum + row.sourceCount, 0);
    return { readyPairs, totalPairs, totalMockups };
  }, [rows]);

  const counts = useMemo<Record<MockupLibraryFilter, number>>(
    () => ({
      all: rows.length,
      has: rows.filter((row) => row.sourceCount > 0).length,
      missing: rows.filter((row) => row.sourceCount === 0).length,
    }),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !query ||
        row.template.name.toLowerCase().includes(query) ||
        row.template.blueprintTitle.toLowerCase().includes(query) ||
        row.color.name.toLowerCase().includes(query);
      const matchesFilter =
        activeFilter === "all" ||
        (activeFilter === "has" && row.sourceCount > 0) ||
        (activeFilter === "missing" && row.sourceCount === 0);
      return matchesSearch && matchesFilter;
    });
  }, [activeFilter, rows, search]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, { template: TemplateGroup; rows: typeof filteredRows }>();
    for (const row of filteredRows) {
      const current = groups.get(row.template.id) ?? { template: row.template, rows: [] };
      current.rows.push(row);
      groups.set(row.template.id, current);
    }
    return Array.from(groups.values());
  }, [filteredRows]);

  const modalTemplates = useMemo(() => {
    if (!data || !modalTarget) return null;
    const templates = modalTarget.templateId
      ? data.templates.filter((entry) => entry.id === modalTarget.templateId)
      : libraryTemplates;
    return templates.map((template) => ({
      id: template.id,
      name: template.name,
      blueprintTitle: template.blueprintTitle,
      printProviderTitle: template.printProviderTitle,
      colors: template.colors.map((color) => ({ id: color.id, name: color.name, hex: color.hex })),
    }));
  }, [data, libraryTemplates, modalTarget]);

  function openTemplateColorDetail(templateId: string, colorId: string) {
    const template = data?.templates.find((entry) => entry.id === templateId);
    const color = template?.colors.find((entry) => entry.id === colorId);
    if (!color) return;
    const source = color.sources.find((entry) => entry.isPrimary) ?? color.sources[0];
    setModalTarget(source ? { source, templateId, colorId } : { templateId, colorId });
  }

  async function saveModal(value: UploadMockupModalValue) {
    if (value.sourceId) {
      const res = await fetch(`/api/stores/${storeId}/mockup-library/${value.sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: value.label,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Không lưu được mockup");
      toast.success("Đã cập nhật mockup");
    } else {
      if (!value.file) throw new Error("Chưa chọn ảnh");
      const form = new FormData();
      form.set("file", value.file);
      form.set("templateId", value.templateId);
      form.set("colorId", value.colorId);
      form.set("label", value.label);
      form.set("view", "front");
      form.set("sceneType", "flat_lay");
      form.set("renderMode", "FINAL");
      form.set("isPrimary", "false");

      const res = await fetch(`/api/stores/${storeId}/mockup-library`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Không upload được mockup");
      toast.success("Đã upload mockup");
    }

    setModalTarget(null);
    await fetchLibrary();
  }

  async function deleteModalSource() {
    const sourceId = modalTarget?.source?.id;
    if (!sourceId) return;
    const res = await fetch(`/api/stores/${storeId}/mockup-library/${sourceId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Không xóa được mockup");
    toast.success("Đã xóa mockup");
    setModalTarget(null);
    await fetchLibrary();
  }

  if (loading) {
    return <LibraryLoading />;
  }

  if (!data) {
    return (
      <div className="card" style={{ padding: 32 }}>
        <Link href="/stores" className="btn btn-secondary">
          <ArrowLeft size={14} />
          Stores
        </Link>
      </div>
    );
  }

  const nextMissing = rows.find((row) => row.sourceCount === 0);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 22 }}>
      <div className="flex items-start justify-between gap-4" style={{ flexWrap: "wrap" }}>
        <div className="flex items-center gap-3">
          <Link href="/stores" style={{ opacity: 0.55 }}>
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>Mockup Library</h1>
            <p className="page-subtitle" style={{ margin: "4px 0 0" }}>{data.store.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatCounter value={`${stats.readyPairs}/${stats.totalPairs}`} label="Cặp đã có mockup" />
          <StatCounter value={String(stats.totalMockups)} label="Mockup tổng" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3" style={{ flexWrap: "wrap" }}>
        <label
          style={{
            flex: "1 1 320px",
            display: "flex",
            alignItems: "center",
            gap: 9,
            minHeight: 42,
            padding: "0 12px",
            border: "1px solid var(--border-default)",
            borderRadius: 10,
            background: "var(--bg-primary)",
          }}
        >
          <Search size={16} style={{ color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm theo mẫu hoặc màu..."
            style={{
              border: 0,
              outline: 0,
              background: "transparent",
              width: "100%",
              fontSize: "0.86rem",
              color: "var(--text-primary)",
            }}
          />
        </label>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            if (libraryTemplates.length === 0) {
              toast.info("Tạo Custom template và màu trước khi upload mockup.");
              return;
            }
            setModalTarget({});
          }}
        >
          <Upload size={16} />
          Upload mockup tái sử dụng
        </button>
      </div>

      <MockupLibraryFilterBar activeFilter={activeFilter} counts={counts} onChange={setActiveFilter} />

      {rows.length === 0 ? (
        <CmlEmptyLibrary
          missing={0}
          total={0}
          onUpload={() => toast.info("Tạo template và màu trước khi upload mockup.")}
          nextMissingLabel={null}
        />
      ) : groupedRows.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center", color: "var(--text-muted)" }}>
          Không có dòng nào khớp bộ lọc hiện tại.
        </div>
      ) : (
        groupedRows.map(({ template, rows: templateRows }) => {
          const missingCount = template.colors.filter((color) => color.sources.length === 0).length;
          return (
            <section key={template.id} style={{ display: "grid", gap: 10 }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 style={{ fontSize: "1rem", fontWeight: 950, margin: 0 }}>{template.name}</h2>
                  <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    {template.blueprintTitle || "Blueprint chưa có tên"} · {template.printProviderTitle || "Provider chưa có tên"}
                  </p>
                </div>
                <span
                  style={{
                    borderRadius: 999,
                    padding: "5px 10px",
                    fontSize: "0.72rem",
                    fontWeight: 950,
                    background: missingCount === 0 ? "rgba(159,232,112,0.2)" : "rgba(245,158,11,0.12)",
                    color: missingCount === 0 ? "var(--color-wise-dark-green)" : "#92400e",
                  }}
                >
                  {missingCount === 0 ? "Đủ mockup" : `Thiếu ${missingCount} màu`}
                </span>
              </div>

              <div style={{ display: "grid", gap: 9 }}>
                {templateRows.map((row) => (
                  <TemplateColorRow
                    key={`${row.template.id}:${row.color.id}`}
                    template={row.template}
                    color={row.color}
                    onOpen={() => openTemplateColorDetail(row.template.id, row.color.id)}
                    onView={() => openTemplateColorDetail(row.template.id, row.color.id)}
                    onUpload={() => setModalTarget({ templateId: row.template.id, colorId: row.color.id })}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {rows.length > 0 && stats.readyPairs === 0 && (
        <CmlEmptyLibrary
          missing={stats.totalPairs - stats.readyPairs}
          total={stats.totalPairs}
          onUpload={() => {
            const first = rows[0];
            if (first) setModalTarget({ templateId: first.template.id, colorId: first.color.id });
          }}
          nextMissingLabel={nextMissing ? `${nextMissing.template.name} · ${nextMissing.color.name}` : null}
        />
      )}

      <div
        className="card"
        style={{
          padding: 14,
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          background: "rgba(59,130,246,0.07)",
          border: "1px solid rgba(59,130,246,0.18)",
          color: "#1d4ed8",
        }}
      >
        <Info size={17} style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: "0.8rem", lineHeight: 1.45, fontWeight: 800 }}>
          Mockup tái sử dụng chỉ ảnh hưởng tới ảnh listing. Sản phẩm, variants và fulfill vẫn lấy từ Printify theo template.
        </span>
      </div>

      {modalTarget && modalTemplates && modalTemplates.length > 0 && (
        <UploadMockupModal
          open
          scope="TEMPLATE"
          templates={modalTemplates}
          lockedTemplateId={modalTarget.templateId ?? null}
          lockedColorId={modalTarget.colorId ?? null}
          initialValue={
            modalTarget.source && modalTarget.templateId && modalTarget.colorId
              ? sourceToModalValue(modalTarget.source, modalTarget.templateId, modalTarget.colorId)
              : null
          }
          onClose={() => setModalTarget(null)}
          onSave={saveModal}
          onDelete={modalTarget.source ? deleteModalSource : undefined}
        />
      )}
    </div>
  );
}

function LibraryLoading() {
  return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <Loader2 className="animate-spin" size={24} style={{ margin: "0 auto" }} />
    </div>
  );
}

function TemplateColorRow({
  template,
  color,
  onOpen,
  onView,
  onUpload,
}: {
  template: TemplateGroup;
  color: TemplateGroup["colors"][number];
  onOpen: () => void;
  onView: () => void;
  onUpload: () => void;
}) {
  const hasMockup = color.sources.length > 0;
  return (
    <div
      className="card"
      role="button"
      tabIndex={0}
      aria-label={`Mở ${template.name} · ${color.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      style={{
        padding: 14,
        borderLeft: hasMockup ? "3px solid #9fe870" : "3px solid var(--border-default)",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "center",
        cursor: "pointer",
      }}
    >
      <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            background: color.hex,
            border: "1px solid rgba(0,0,0,0.14)",
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 950, overflowWrap: "anywhere" }}>
            {template.name} · {color.name}
          </h3>
          <p style={{ margin: "3px 0 0", fontSize: "0.74rem", color: "var(--text-muted)" }}>
            {template.blueprintTitle || "Blueprint chưa có tên"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3" style={{ justifyContent: "end", flexWrap: "wrap" }}>
        {hasMockup ? (
          <div style={{ textAlign: "right" }}>
            <strong style={{ display: "block", fontSize: 18, lineHeight: 1 }}>{color.sources.length}</strong>
            <span style={{ fontSize: "0.62rem", fontWeight: 950, color: "var(--text-muted)" }}>MOCKUP</span>
          </div>
        ) : (
          <span
            style={{
              borderRadius: 999,
              border: "1px dashed var(--border-default)",
              padding: "5px 9px",
              fontSize: "0.72rem",
              color: "var(--text-muted)",
              fontWeight: 900,
            }}
          >
            Chưa có mockup
          </span>
        )}
        {hasMockup && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onView();
            }}
          >
            <Eye size={14} />
            Xem
          </button>
        )}
        <button
          className={hasMockup ? "btn btn-secondary" : "btn btn-primary"}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUpload();
          }}
        >
          {hasMockup ? <Plus size={14} /> : <Upload size={14} />}
          {hasMockup ? "Thêm" : "Upload"}
        </button>
      </div>
    </div>
  );
}

function CmlEmptyLibrary({
  missing,
  total,
  onUpload,
  nextMissingLabel,
}: {
  missing: number;
  total: number;
  onUpload: () => void;
  nextMissingLabel: string | null;
}) {
  return (
    <div className="card" style={{ padding: 32, display: "grid", gap: 18 }}>
      <div style={{ textAlign: "center", display: "grid", gap: 8, justifyItems: "center" }}>
        <ImagePlus size={34} style={{ color: "var(--color-wise-dark-green)" }} />
        <h2 style={{ margin: 0, fontSize: "1.12rem", fontWeight: 950 }}>
          {missing} · {total} chưa có mockup
        </h2>
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap", justifyContent: "center" }}>
          <button className="btn btn-primary" type="button" onClick={onUpload}>
            <Upload size={14} />
            Upload mockup tái sử dụng
          </button>
        </div>
      </div>

      {nextMissingLabel && (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(245,158,11,0.1)",
            color: "#92400e",
            fontSize: "0.78rem",
            fontWeight: 850,
          }}
        >
          Màu chưa có mockup tiếp theo: {nextMissingLabel}
        </div>
      )}
    </div>
  );
}

function StatCounter({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        minWidth: 120,
        padding: "9px 12px",
        borderRadius: 10,
        border: "1px solid var(--border-default)",
        background: "var(--bg-primary)",
      }}
    >
      <strong style={{ display: "block", fontSize: "1rem", lineHeight: 1 }}>{value}</strong>
      <span style={{ display: "block", marginTop: 4, fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 900 }}>
        {label}
      </span>
    </div>
  );
}

function sourceToModalValue(
  source: CustomSource,
  templateId: string,
  colorId: string,
): Partial<UploadMockupModalValue> {
  return {
    sourceId: source.id,
    templateId,
    colorId,
    label: source.label ?? "",
    view: source.view,
    sceneType: source.sceneType,
    renderMode: source.renderMode,
    isPrimary: source.isPrimary,
    sortOrder: source.sortOrder,
    compositeRegionPx: null,
    previewUrl: source.imageUrl ?? source.outputUrl,
    imageWidth: source.imageWidth ?? 0,
    imageHeight: source.imageHeight ?? 0,
  };
}

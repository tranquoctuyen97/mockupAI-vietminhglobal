"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GlobalMockupEditorModal, type GlobalMockupEditorValue } from "@/components/mockup/GlobalMockupEditorModal";

interface MockupItem extends GlobalMockupEditorValue {
  templateAttachmentCount: number;
}

export default function MockupsClient() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<MockupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MockupItem | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/mockups");
      const data = await res.json();
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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (editId && items.length > 0) {
      setEditing(items.find((item) => item.id === editId) ?? null);
    }
  }, [items]);

  async function upload(file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set("name", file.name.replace(/\.[^.]+$/, ""));
    form.set("view", "front");
    form.set("sceneType", "flat_lay");
    form.set("renderMode", "COMPOSITE");
    const res = await fetch("/api/mockups", { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Upload failed");
      return;
    }
    await load();
  }

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
    await load();
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
    await load();
  }

  const sortedItems = useMemo(() => [...items], [items]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Mockups</h1>
          <p className="page-subtitle">Global mockup library for this workspace.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => inputRef.current?.click()}>
          <ImagePlus size={16} /> Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {loading ? (
        <div className="flex justify-center" style={{ padding: 48 }}><Loader2 className="animate-spin" /></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {sortedItems.map((item) => (
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
      <GlobalMockupEditorModal open={Boolean(editing)} value={editing} onClose={() => setEditing(null)} onSave={save} />
    </div>
  );
}

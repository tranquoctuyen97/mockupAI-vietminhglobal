"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { CompositeRegionEditor, type CompositeRegion } from "@/components/mockup/CompositeRegionEditor";

export interface GlobalMockupEditorValue {
  id?: string;
  name: string;
  imageUrl: string | null;
  width: number;
  height: number;
  view: string;
  sceneType: string;
  compositeRegionPx: (CompositeRegion & { imageWidth: number; imageHeight: number }) | null;
}

export function GlobalMockupEditorModal({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: GlobalMockupEditorValue | null;
  onClose: () => void;
  onSave: (value: GlobalMockupEditorValue) => Promise<void>;
}) {
  const [draft, setDraft] = useState<GlobalMockupEditorValue | null>(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  if (!open || !draft) return null;

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="card" style={{ padding: 18, width: "min(960px, 96vw)", maxHeight: "90vh", overflow: "auto" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>Mockup frame</h2>
          <button className="btn btn-ghost" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <label style={{ display: "grid", gap: 6, marginBottom: 12, fontSize: "0.8rem", fontWeight: 700 }}>
          Name
          <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        {draft.imageUrl && draft.width > 0 && draft.height > 0 && (
          <CompositeRegionEditor
            imageUrl={draft.imageUrl}
            imageWidth={draft.width}
            imageHeight={draft.height}
            value={draft.compositeRegionPx}
            onChange={(region) => setDraft({
              ...draft,
              compositeRegionPx: { ...region, imageWidth: draft.width, imageHeight: draft.height },
            })}
            context="library"
            scope="TEMPLATE"
          />
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" size={14} /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
}

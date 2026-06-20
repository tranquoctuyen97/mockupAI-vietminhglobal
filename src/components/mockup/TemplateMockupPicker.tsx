"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { buildAssignMockupToColorOperations } from "./template-mockup-assignment";

interface StoreColor {
  id: string;
  name: string;
  hex: string;
}

interface LibraryMockup {
  id: string;
  name: string;
  imageUrl: string | null;
  width: number;
  height: number;
}

export interface PendingAssignment {
  mockupId: string;
  mockupName: string;
  mockupImageUrl: string | null;
}

interface AttachedItem {
  id: string;
  mockupId: string;
  appliesToColorIds: string[];
  isPrimary: boolean;
  sortOrder: number;
  mockup: LibraryMockup;
}

export function TemplateMockupPicker({
  storeId,
  templateId,
  colors,
  // Create mode: external pending state
  pendingAssignments,
  onAssignmentsChange,
}: {
  storeId: string;
  templateId: string;
  colors: StoreColor[];
  pendingAssignments?: Map<string, PendingAssignment>;
  onAssignmentsChange?: (map: Map<string, PendingAssignment>) => void;
}) {
  const isCreate = templateId === "new";
  const uploadRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  // Edit mode: attached items from API
  const [attachedItems, setAttachedItems] = useState<AttachedItem[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [refreshingAttached, setRefreshingAttached] = useState(false);

  // Library picker modal state
  const [pickerState, setPickerState] = useState<{ colorId: string; colorName: string } | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryMockup[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");

  // ===== Edit mode: load attached items =====
  async function loadAttached(options?: { silent?: boolean }) {
    if (isCreate) return;
    if (options?.silent) {
      setRefreshingAttached(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups`);
      const data = await res.json();
      setAttachedItems(data.items ?? []);
    } catch {
      // ignore
    } finally {
      if (options?.silent) {
        setRefreshingAttached(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!isCreate) void loadAttached();
  }, [storeId, templateId]);

  // ===== Resolve assignment for a color =====
  function getAssignmentForColor(colorId: string): PendingAssignment | null {
    if (isCreate && pendingAssignments) {
      return pendingAssignments.get(colorId) ?? null;
    }
    // Edit mode: find exact match from attached items
    const exact = attachedItems.find(
      (item) => item.appliesToColorIds.length > 0 && item.appliesToColorIds.includes(colorId),
    );
    if (exact) return { mockupId: exact.mockupId, mockupName: exact.mockup.name, mockupImageUrl: exact.mockup.imageUrl };
    return null;
  }

  // ===== Edit mode: attach =====
  async function assignMockupToColor(mockupId: string, colorId: string): Promise<boolean> {
    const operations = buildAssignMockupToColorOperations(attachedItems, mockupId, colorId);
    try {
      for (const operation of operations) {
        let res: Response;
        if (operation.type === "delete") {
          res = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups/${operation.itemId}`, {
            method: "DELETE",
          });
        } else if (operation.type === "patch") {
          res = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups/${operation.itemId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appliesToColorIds: operation.appliesToColorIds }),
          });
        } else {
          res = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mockupId: operation.mockupId,
              appliesToColorIds: operation.appliesToColorIds,
              isPrimary: attachedItems.length === 0,
              sortOrder: attachedItems.length,
            }),
          });
        }

        if (res.status === 409) {
          toast.error("Mockup attachment is used by drafts");
          return false;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? "Could not assign mockup");
          return false;
        }
      }

      await loadAttached({ silent: true });
      return true;
    } catch {
      toast.error("Could not assign mockup");
      return false;
    }
  }

  // ===== Edit mode: detach =====
  async function editDetach(itemId: string) {
    const res = await fetch(`/api/stores/${storeId}/mockup-templates/${templateId}/mockups/${itemId}`, { method: "DELETE" });
    if (res.status === 409) { toast.error("Mockup is used by drafts"); return; }
    if (!res.ok) { toast.error("Could not detach mockup"); return; }
    await loadAttached();
  }

  // ===== Create mode: assign =====
  function createAssign(colorId: string, assignment: PendingAssignment) {
    if (!onAssignmentsChange) return;
    const next = new Map(pendingAssignments ?? []);
    next.set(colorId, assignment);
    onAssignmentsChange(next);
  }

  // ===== Create mode: remove =====
  function createRemove(colorId: string) {
    if (!onAssignmentsChange) return;
    const next = new Map(pendingAssignments ?? []);
    next.delete(colorId);
    onAssignmentsChange(next);
  }

  // ===== Upload new flow =====
  async function uploadForColor(colorId: string) {
    const input = uploadRefs.current.get(colorId);
    const file = input?.files?.[0];
    if (!file) return;

    const form = new FormData();
    form.set("file", file);
    form.set("storeId", storeId);
    form.set("name", file.name.replace(/\.[^.]+$/, ""));
    form.set("view", "front");
    form.set("sceneType", "flat_lay");
    form.set("renderMode", "COMPOSITE");

    const uploadRes = await fetch("/api/mockups", { method: "POST", body: form });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !uploadData.id) {
      toast.error(uploadData.error ?? "Could not upload mockup");
      return;
    }

    const assignment: PendingAssignment = {
      mockupId: uploadData.id,
      mockupName: uploadData.name,
      mockupImageUrl: uploadData.imageUrl ?? null,
    };

    if (isCreate) {
      createAssign(colorId, assignment);
    } else {
      await assignMockupToColor(uploadData.id, colorId);
    }

    // Reset input
    if (input) input.value = "";
  }

  // ===== Library picker =====
  async function openPicker(color: StoreColor) {
    setPickerState({ colorId: color.id, colorName: color.name });
    setLibraryQuery("");
    setLibraryLoading(true);
    try {
      const res = await fetch(`/api/mockups?storeId=${encodeURIComponent(storeId)}`);
      const data = await res.json();
      setLibraryItems(data.items ?? []);
    } finally {
      setLibraryLoading(false);
    }
  }

  function pickFromLibrary(mockup: LibraryMockup) {
    const assignment: PendingAssignment = {
      mockupId: mockup.id,
      mockupName: mockup.name,
      mockupImageUrl: mockup.imageUrl,
    };
    const colorId = pickerState?.colorId;
    if (!colorId) return;

    if (isCreate) {
      createAssign(colorId, assignment);
      setPickerState(null);
    } else {
      void assignMockupToColor(mockup.id, colorId).then((ok) => {
        if (ok) setPickerState(null);
      });
    }
  }

  if (loading) return <div style={{ padding: 24 }}><Loader2 className="animate-spin" /></div>;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Mockups per color</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {colors.map((color) => {
            const assignment = getAssignmentForColor(color.id);
            const pickerActive = pickerState?.colorId === color.id;
            return (
              <div
                key={color.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 10px",
                  border: pickerActive ? "1px solid var(--color-wise-green)" : "1px solid transparent",
                  borderBottom: pickerActive ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                  borderRadius: pickerActive ? 8 : 0,
                  background: pickerActive ? "rgba(159, 232, 112, 0.12)" : "transparent",
                }}
              >
                {/* Color swatch */}
                <div style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: color.hex, border: "1px solid var(--border-default)", flexShrink: 0 }} />
                <span style={{ fontWeight: 600, minWidth: 100, fontSize: "0.85rem" }}>{color.name}</span>

                {assignment ? (
                  <>
                    {assignment.mockupImageUrl && (
                      <img src={assignment.mockupImageUrl} alt="" style={{ width: 48, height: 36, objectFit: "contain", borderRadius: 4 }} />
                    )}
                    <span style={{ fontSize: "0.8rem", flex: 1 }}>{assignment.mockupName}</span>
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => {
                        if (isCreate) {
                          createRemove(color.id);
                        } else {
                          const item = attachedItems.find(
                            (i) => i.appliesToColorIds.length > 0 && i.appliesToColorIds.includes(color.id),
                          );
                          if (item) void editDetach(item.id);
                        }
                      }}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                    <a className="btn btn-secondary btn-sm" href={`/mockups?edit=${assignment.mockupId}`}>Edit frame</a>
                  </>
                ) : (
                  <div style={{ display: "flex", gap: 8, flex: 1, justifyContent: "flex-end" }}>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => openPicker(color)}>
                      <Search size={13} /> Choose from library
                    </button>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => uploadRefs.current.get(color.id)?.click()}>
                      <ImagePlus size={13} /> Upload new
                    </button>
                    <input
                      ref={(el) => { uploadRefs.current.set(color.id, el); }}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={() => { void uploadForColor(color.id); }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {refreshingAttached && <span className="sr-only">Refreshing attached mockups</span>}

      {/* ===== Fixed library picker drawer/modal ===== */}
      {pickerState && (
        <div
          className="mockup-picker-overlay"
          onClick={() => setPickerState(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "flex",
            justifyContent: "flex-end",
            background: "rgba(0, 0, 0, 0.32)",
            padding: "16px",
          }}
        >
          <div
            className="card mockup-picker-drawer"
            style={{
              padding: 18,
              width: "min(520px, 100%)",
              height: "100%",
              maxHeight: "calc(100vh - 32px)",
              overflow: "auto",
              borderRadius: 8,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 style={{ margin: 0 }}>
                Select mockup for {pickerState.colorName}
              </h3>
              <button className="btn btn-ghost" type="button" onClick={() => setPickerState(null)}><X size={16} /></button>
            </div>
            <input
              className="input"
              placeholder="Search mockups..."
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            {libraryLoading ? (
              <div style={{ padding: 24, textAlign: "center" }}><Loader2 className="animate-spin" /></div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                {libraryItems
                  .filter((m) => !libraryQuery || m.name.toLowerCase().includes(libraryQuery.toLowerCase()))
                  .map((mockup) => (
                    <button
                      key={mockup.id}
                      className="card"
                      type="button"
                      onClick={() => pickFromLibrary(mockup)}
                      style={{ padding: 10, textAlign: "left", cursor: "pointer" }}
                    >
                      {mockup.imageUrl ? (
                        <img src={mockup.imageUrl} alt="" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "contain", borderRadius: 4 }} />
                      ) : (
                        <div style={{ width: "100%", aspectRatio: "4 / 3", backgroundColor: "var(--bg-muted)", borderRadius: 4 }} />
                      )}
                      <strong style={{ display: "block", marginTop: 6, fontSize: "0.82rem" }}>{mockup.name}</strong>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{mockup.width} x {mockup.height}</span>
                    </button>
                  ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setPickerState(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

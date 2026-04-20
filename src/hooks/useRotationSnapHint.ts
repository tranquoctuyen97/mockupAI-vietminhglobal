/**
 * Hook: rotation snap toast hint (Phase 6.8c)
 * Shows a one-time Sonner toast when the user first experiences rotation snap.
 * Gated by localStorage so it only shows once per browser.
 */
import { useCallback } from "react";
import { toast } from "sonner";

const STORAGE_KEY = "rotation_snap_hint_seen";

export function useRotationSnapHint() {
  const triggerHint = useCallback((snappedTo: number) => {
    // Only show once
    if (typeof window === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY) === "true") return;

    toast(`Đã snap về ${snappedTo}°`, {
      description: "Giữ Shift khi kéo slider để tắt snap và chỉnh chính xác.",
      duration: 5000,
      id: "rotation-snap-hint", // dedup — won't stack
    });

    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  return { triggerHint };
}

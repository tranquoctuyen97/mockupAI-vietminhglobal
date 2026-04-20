/**
 * Keyboard shortcut map for Placement Editor (Phase 6.7)
 * Shared utility — used by CanvasWorkspace to attach window-level listeners.
 */

export type NudgeAxis = "x" | "y";
export type CenterAxis = "x" | "y" | "both";

export type KeyAction =
  | { type: "nudge"; axis: NudgeAxis; amount: number }
  | { type: "rotate"; amount: number }
  | { type: "center"; axis: CenterAxis }
  | { type: "mirror" }
  | { type: "scale"; factor: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };

/**
 * Full keyboard map.
 * Keys use the format: [Modifier+]*Key where modifiers are Meta/Ctrl/Shift/Alt.
 * buildKeyName() normalises event to this format.
 */
export const KEYBOARD_MAP: Record<string, KeyAction> = {
  // Arrow nudge — 1mm
  "ArrowUp":    { type: "nudge", axis: "y", amount: -1 },
  "ArrowDown":  { type: "nudge", axis: "y", amount: 1 },
  "ArrowLeft":  { type: "nudge", axis: "x", amount: -1 },
  "ArrowRight": { type: "nudge", axis: "x", amount: 1 },
  // Shift+Arrow — 10mm
  "Shift+ArrowUp":    { type: "nudge", axis: "y", amount: -10 },
  "Shift+ArrowDown":  { type: "nudge", axis: "y", amount: 10 },
  "Shift+ArrowLeft":  { type: "nudge", axis: "x", amount: -10 },
  "Shift+ArrowRight": { type: "nudge", axis: "x", amount: 10 },
  // Alt+Arrow — 0.1mm precision
  "Alt+ArrowUp":    { type: "nudge", axis: "y", amount: -0.1 },
  "Alt+ArrowDown":  { type: "nudge", axis: "y", amount: 0.1 },
  "Alt+ArrowLeft":  { type: "nudge", axis: "x", amount: -0.1 },
  "Alt+ArrowRight": { type: "nudge", axis: "x", amount: 0.1 },
  // Rotation
  "r": { type: "rotate", amount: 15 },
  "R": { type: "rotate", amount: -15 },
  // Center shortcuts
  "c": { type: "center", axis: "both" },
  "H": { type: "center", axis: "x" },
  "V": { type: "center", axis: "y" },
  // Mirror
  "f": { type: "mirror" },
  // Scale
  "[": { type: "scale", factor: 0.95 },
  "]": { type: "scale", factor: 1.05 },
  // Undo/redo — Mac (Meta) and Windows/Linux (Ctrl)
  "Meta+z":       { type: "undo" },
  "Meta+Shift+z": { type: "redo" },
  "Ctrl+z":       { type: "undo" },
  "Ctrl+Shift+z": { type: "redo" },
  // Reset
  "Delete":    { type: "reset" },
  "Backspace": { type: "reset" },
};

/**
 * Normalise a KeyboardEvent into our compound key string format.
 * Examples: "Shift+ArrowUp", "Meta+z", "ArrowLeft"
 */
export function buildKeyName(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push("Meta");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(e.key);
  return parts.join("+");
}

/**
 * Returns true when focus is inside a text input / textarea / contenteditable.
 * Used to gate keyboard shortcuts so they don't fire while typing.
 */
export function isTypingInInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

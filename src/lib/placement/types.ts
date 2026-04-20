/**
 * Placement types for Phase 6.6 + 6.7 — Placement Editor Pro
 * All spatial values in millimeters (mm)
 */

// ── Placement Mode (6.7) ──────────────────────────────────────────────
export type PlacementMode = "stretch" | "preserve" | "exact";

// ── Core Placement ────────────────────────────────────────────────────
export interface Placement {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  lockAspect: boolean;
  placementMode: PlacementMode;
  mirrored: boolean;
  presetKey?: string;
}

export interface PrintArea {
  widthMm: number;
  heightMm: number;
  safeMarginMm: number;
}

export interface DesignMeta {
  widthPx: number;
  heightPx: number;
  dpi: number | null;
}

// ── Placement Data (stored in wizard_drafts.placement JSON) ───────────
export type PlacementVersion = 2 | "2.1";

export interface PlacementData {
  version: PlacementVersion;
  variants: Record<string, VariantViews>;
}

export interface VariantViews {
  front?: Placement | null;
  back?: Placement | null;
  sleeve_left?: Placement | null;
  sleeve_right?: Placement | null;
  neck_label?: Placement | null;
  hem?: Placement | null;
}

export type ViewKey = keyof VariantViews;

export const VIEW_KEYS: ViewKey[] = [
  "front",
  "back",
  "sleeve_left",
  "sleeve_right",
  "neck_label",
  "hem",
];

export const DEFAULT_PLACEMENT: Placement = {
  xMm: 150,
  yMm: 200,
  widthMm: 200,
  heightMm: 250,
  rotationDeg: 0,
  lockAspect: true,
  placementMode: "preserve",
  mirrored: false,
};

/** Default print area for T-shirt front if not synced */
export const DEFAULT_PRINT_AREA: PrintArea = {
  widthMm: 355.6,
  heightMm: 406.4,
  safeMarginMm: 3,
};

/**
 * Placement presets — hardcoded common placement configurations
 * Expanded library per view for Sprint 2.4
 */

import type { PlacementMode, ViewKey } from "./types";

export interface PlacementValues {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  placementMode: PlacementMode;
}

export interface PlacementPreset {
  key: string;
  label: string;
  view: ViewKey;
  placement: PlacementValues;
}

export const PLACEMENT_PRESETS: PlacementPreset[] = [
  // ── Front ──────────────────────────────────────────────
  {
    key: "full_front",
    label: "Full front",
    view: "front",
    placement: { xMm: 77.8, yMm: 78.2, widthMm: 200, heightMm: 250, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "left_chest",
    label: "Ngực trái",
    view: "front",
    placement: { xMm: 60, yMm: 80, widthMm: 100, heightMm: 100, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "center_chest",
    label: "Ngực giữa",
    view: "front",
    placement: { xMm: 127.8, yMm: 80, widthMm: 100, heightMm: 100, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "logo_top",
    label: "Logo trên cao",
    view: "front",
    placement: { xMm: 127.8, yMm: 50, widthMm: 100, heightMm: 80, rotationDeg: 0, placementMode: "preserve" },
  },

  // ── Back ───────────────────────────────────────────────
  {
    key: "full_back",
    label: "Full back",
    view: "back",
    placement: { xMm: 77.8, yMm: 78.2, widthMm: 200, heightMm: 250, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "center_back",
    label: "Center back",
    view: "back",
    placement: { xMm: 102.8, yMm: 130, widthMm: 150, heightMm: 150, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "yoke",
    label: "Yoke (cổ sau)",
    view: "back",
    placement: { xMm: 102.8, yMm: 50, widthMm: 150, heightMm: 80, rotationDeg: 0, placementMode: "preserve" },
  },

  // ── Sleeve Left ────────────────────────────────────────
  {
    key: "left_sleeve",
    label: "Tay trái",
    view: "sleeve_left",
    placement: { xMm: 0, yMm: 120, widthMm: 70, heightMm: 90, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "logo_sleeve_left",
    label: "Logo nhỏ tay trái",
    view: "sleeve_left",
    placement: { xMm: 10, yMm: 130, widthMm: 50, heightMm: 50, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "center_sleeve_left",
    label: "Center tay trái",
    view: "sleeve_left",
    placement: { xMm: 5, yMm: 125, widthMm: 60, heightMm: 60, rotationDeg: 0, placementMode: "preserve" },
  },

  // ── Sleeve Right ───────────────────────────────────────
  {
    key: "right_sleeve",
    label: "Tay phải",
    view: "sleeve_right",
    placement: { xMm: 0, yMm: 120, widthMm: 70, heightMm: 90, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "logo_sleeve_right",
    label: "Logo nhỏ tay phải",
    view: "sleeve_right",
    placement: { xMm: 10, yMm: 130, widthMm: 50, heightMm: 50, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "center_sleeve_right",
    label: "Center tay phải",
    view: "sleeve_right",
    placement: { xMm: 5, yMm: 125, widthMm: 60, heightMm: 60, rotationDeg: 0, placementMode: "preserve" },
  },

  // ── Neck Label ─────────────────────────────────────────
  {
    key: "neck_label",
    label: "Nhãn cổ",
    view: "neck_label",
    placement: { xMm: 0, yMm: 36, widthMm: 55, heightMm: 35, rotationDeg: 0, placementMode: "preserve" },
  },
  {
    key: "neck_logo",
    label: "Logo cổ compact",
    view: "neck_label",
    placement: { xMm: 5, yMm: 5, widthMm: 40, heightMm: 50, rotationDeg: 0, placementMode: "preserve" },
  },

  // ── Hem ────────────────────────────────────────────────
  {
    key: "hem",
    label: "Gấu áo",
    view: "hem",
    placement: { xMm: 0, yMm: 340, widthMm: 80, heightMm: 45, rotationDeg: 0, placementMode: "preserve" },
  },
];

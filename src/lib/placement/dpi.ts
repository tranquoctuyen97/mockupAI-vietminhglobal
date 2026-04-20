/**
 * Calculate effective DPI at the given placement size
 */
import type { DesignMeta, Placement } from "./types";

export interface DpiResult {
  dpi: number;
  severity: "ok" | "warn" | "error";
  label: string;
}

export function calculateDpi(
  design: DesignMeta,
  placement: Placement,
): DpiResult {
  const inchesW = placement.widthMm / 25.4;
  const inchesH = placement.heightMm / 25.4;

  const dpiW = design.widthPx / inchesW;
  const dpiH = design.heightPx / inchesH;
  const dpi = Math.round(Math.min(dpiW, dpiH));

  let severity: DpiResult["severity"];
  let label: string;

  if (dpi >= 250) {
    severity = "ok";
    label = `${dpi} DPI ✓`;
  } else if (dpi >= 150) {
    severity = "warn";
    label = `${dpi} DPI — chất lượng trung bình`;
  } else {
    severity = "error";
    label = `${dpi} DPI — in có thể bị mờ`;
  }

  return { dpi, severity, label };
}

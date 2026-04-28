/**
 * Multi-variant placement validation for Phase 6.7
 * Validates all variants × views at once before allowing step transition.
 */
import type { Placement, PlacementData, PrintArea, DesignMeta } from "./types";
import { calculateDpi } from "./dpi";

export type ViolationIssue =
  | "outside_print_area"
  | "outside_safe_zone"
  | "dpi_too_low"
  | "size_too_small";

export type ViolationSeverity = "error" | "warn";

export interface BoundaryViolation {
  variantId: string;
  view: string;
  issue: ViolationIssue;
  severity: ViolationSeverity;
  detail: { xMm?: number; yMm?: number; dpi?: number };
}

// DPI < 150 is warn-only (not a blocker) per Phase 6.6 decision
const ISSUE_SEVERITY: Record<ViolationIssue, ViolationSeverity> = {
  outside_print_area: "error",
  size_too_small: "error",
  dpi_too_low: "warn",      // warn-only as per user decision
  outside_safe_zone: "warn",
};

function rotatedBoundingBox(w: number, h: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: w * cos + h * sin,
    height: w * sin + h * cos,
  };
}

/**
 * Validate a single placement against print area and design resolution.
 * Returns list of violations (may be empty).
 */
function validateOne(
  placement: Placement,
  printArea: PrintArea,
  design: DesignMeta,
  variantId: string,
  view: string,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];

  // Min size
  if (placement.widthMm < 10 || placement.heightMm < 10) {
    violations.push({
      variantId, view,
      issue: "size_too_small",
      severity: ISSUE_SEVERITY.size_too_small,
      detail: {},
    });
    return violations; // No point checking bounds on tiny element
  }

  // Rotation-aware bounding box
  const bb = rotatedBoundingBox(placement.widthMm, placement.heightMm, placement.rotationDeg);

  // Placement (xMm, yMm) = top-left corner of design within print area
  // Calculate center of design, then compute rotated bounding box edges
  const centerX = placement.xMm + placement.widthMm / 2;
  const centerY = placement.yMm + placement.heightMm / 2;
  const left = centerX - bb.width / 2;
  const right = centerX + bb.width / 2;
  const top = centerY - bb.height / 2;
  const bottom = centerY + bb.height / 2;

  // Print area bounds: origin at (0,0), extends to (widthMm, heightMm)
  if (left < 0 || right > printArea.widthMm || top < 0 || bottom > printArea.heightMm) {
    violations.push({
      variantId, view,
      issue: "outside_print_area",
      severity: ISSUE_SEVERITY.outside_print_area,
      detail: { xMm: placement.xMm, yMm: placement.yMm },
    });
    return violations; // If already outside, safe zone is moot
  }

  // Safe zone check
  const m = printArea.safeMarginMm;
  if (left < m || right > printArea.widthMm - m || top < m || bottom > printArea.heightMm - m) {
    violations.push({
      variantId, view,
      issue: "outside_safe_zone",
      severity: ISSUE_SEVERITY.outside_safe_zone,
      detail: { xMm: placement.xMm, yMm: placement.yMm },
    });
  }

  // DPI check — warn only
  const dpiResult = calculateDpi(design, placement);
  if (dpiResult.dpi < 150) {
    violations.push({
      variantId, view,
      issue: "dpi_too_low",
      severity: ISSUE_SEVERITY.dpi_too_low,
      detail: { dpi: dpiResult.dpi },
    });
  }

  return violations;
}

/**
 * Validate all variants × views in a PlacementData.
 * Returns all violations with severity for FE to display + gate "Tiếp theo".
 */
export function validatePlacementSet(
  placementData: PlacementData,
  printArea: PrintArea,
  design: DesignMeta,
): BoundaryViolation[] {
  const all: BoundaryViolation[] = [];

  for (const [variantId, views] of Object.entries(placementData.variants)) {
    for (const [view, placement] of Object.entries(views)) {
      if (!placement) continue;
      const violations = validateOne(placement as Placement, printArea, design, variantId, view);
      all.push(...violations);
    }
  }

  return all;
}

// ── Legacy single-placement validator (kept for per-drag validation) ───
interface SingleValidationResult {
  valid: boolean;
  errors: Array<{ code: string; message: string; severity: "error" | "warn" }>;
}

export function validatePlacement(
  placement: Placement,
  printArea: PrintArea,
): SingleValidationResult {
  const errors: SingleValidationResult["errors"] = [];

  if (placement.widthMm < 10 || placement.heightMm < 10) {
    errors.push({ code: "TOO_SMALL", message: "Kích thước tối thiểu 10mm × 10mm", severity: "error" });
  }

  if (placement.rotationDeg < -180 || placement.rotationDeg > 180) {
    errors.push({ code: "ROTATION_RANGE", message: "Góc xoay phải từ -180° đến 180°", severity: "error" });
  }

  const bbox = rotatedBoundingBox(placement.widthMm, placement.heightMm, placement.rotationDeg);
  const safeW = printArea.widthMm - printArea.safeMarginMm * 2;
  const safeH = printArea.heightMm - printArea.safeMarginMm * 2;
  const leftEdge = placement.xMm - bbox.width / 2;
  const rightEdge = placement.xMm + bbox.width / 2;
  const topEdge = placement.yMm - bbox.height / 2;
  const bottomEdge = placement.yMm + bbox.height / 2;

  if (
    leftEdge < printArea.safeMarginMm ||
    rightEdge > printArea.safeMarginMm + safeW ||
    topEdge < printArea.safeMarginMm ||
    bottomEdge > printArea.safeMarginMm + safeH
  ) {
    errors.push({ code: "OUT_OF_BOUNDS", message: "Design vượt ngoài vùng in an toàn", severity: "warn" });
  }

  return { valid: errors.filter((e) => e.severity === "error").length === 0, errors };
}

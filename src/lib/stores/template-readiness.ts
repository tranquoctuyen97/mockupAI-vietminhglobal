import { getEnabledViews, normalizePlacementData } from "@/lib/placement/views";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";

export type TemplateMissing =
  | "blueprint"
  | "provider"
  | "variants"
  | "colors"
  | "placement"
  | "mockups";

export type TemplateReadinessLabel =
  | "DEFAULT"
  | "DEFAULT INCOMPLETE"
  | "READY"
  | "INCOMPLETE";

export interface TemplateReadiness {
  ready: boolean;
  missing: TemplateMissing[];
}

export const TEMPLATE_MISSING_LABELS: Record<TemplateMissing, string> = {
  blueprint: "Blueprint",
  provider: "Provider",
  variants: "Variants",
  colors: "Colors",
  placement: "Placement",
  mockups: "Mockups",
};

export type TemplateReadinessInput = {
  printifyBlueprintId?: number | null;
  printifyPrintProviderId?: number | null;
  enabledVariantIds?: number[] | null;
  defaultPlacement?: unknown;
  defaultMockupSource?: "PRINTIFY" | "CUSTOM" | string | null;
  colors?: unknown[] | null;
  mockupItems?: unknown[] | null;
  isDefault?: boolean | null;
};

export function getTemplateReadiness(
  template: TemplateReadinessInput | null | undefined,
): TemplateReadiness {
  const missing: TemplateMissing[] = [];

  if (!template?.printifyBlueprintId) missing.push("blueprint");
  if (!template?.printifyPrintProviderId) missing.push("provider");
  if (!template?.enabledVariantIds?.length) missing.push("variants");
  if (!template?.colors?.length) missing.push("colors");

  if ((template?.defaultMockupSource ?? "PRINTIFY") === "CUSTOM") {
    if (!hasCustomMockupCoverage(template)) missing.push("mockups");
  } else {
    const hasPlacement = Boolean(
      template?.defaultPlacement &&
        getEnabledViews(normalizePlacementData(template.defaultPlacement, false)).length > 0,
    );
    if (!hasPlacement) missing.push("placement");
  }

  return {
    ready: missing.length === 0,
    missing,
  };
}

function hasCustomMockupCoverage(template: TemplateReadinessInput | null | undefined): boolean {
  const colorIds = new Set((template?.colors ?? []).map(readColorId).filter((id): id is string => Boolean(id)));
  if (colorIds.size === 0) return false;

  const coveredColorIds = new Set<string>();
  for (const item of template?.mockupItems ?? []) {
    if (!customMockupItemHasRegion(item)) continue;
    const appliesToColorIds = readAppliesToColorIds(item);
    if (appliesToColorIds.length === 0) {
      for (const colorId of colorIds) coveredColorIds.add(colorId);
    } else {
      for (const colorId of appliesToColorIds) coveredColorIds.add(colorId);
    }
  }

  for (const colorId of colorIds) {
    if (!coveredColorIds.has(colorId)) return false;
  }
  return true;
}

function readColorId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.colorId === "string") return record.colorId;
  const color = record.color;
  if (color && typeof color === "object" && typeof (color as Record<string, unknown>).id === "string") {
    return (color as Record<string, string>).id;
  }
  if (typeof record.id === "string") return record.id;
  return null;
}

function readAppliesToColorIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const ids = (value as Record<string, unknown>).appliesToColorIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function customMockupItemHasRegion(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const mockup = (value as Record<string, unknown>).mockup;
  if (!mockup || typeof mockup !== "object") return false;
  const record = mockup as Record<string, unknown>;
  if (record.renderMode !== "COMPOSITE") return true;
  return Boolean(normalizeCompositeRegionPx(record.compositeRegionPx));
}

export function getTemplateReadinessLabel(
  template: TemplateReadinessInput,
): TemplateReadinessLabel {
  const readiness = getTemplateReadiness(template);
  if (template.isDefault && readiness.ready) return "DEFAULT";
  if (template.isDefault) return "DEFAULT INCOMPLETE";
  return readiness.ready ? "READY" : "INCOMPLETE";
}

export function formatTemplateMissing(missing: TemplateMissing[]): string {
  return missing.map((key) => TEMPLATE_MISSING_LABELS[key]).join(", ");
}

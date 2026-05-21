import { getEnabledViews, normalizePlacementData } from "@/lib/placement/views";

export type TemplateMissing =
  | "blueprint"
  | "provider"
  | "variants"
  | "colors"
  | "placement";

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
};

export type TemplateReadinessInput = {
  printifyBlueprintId?: number | null;
  printifyPrintProviderId?: number | null;
  enabledVariantIds?: number[] | null;
  defaultPlacement?: unknown;
  colors?: unknown[] | null;
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

  const hasPlacement = Boolean(
    template?.defaultPlacement &&
      getEnabledViews(normalizePlacementData(template.defaultPlacement, false)).length > 0,
  );
  if (!hasPlacement) missing.push("placement");

  return {
    ready: missing.length === 0,
    missing,
  };
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

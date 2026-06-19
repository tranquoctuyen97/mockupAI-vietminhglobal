import type { EffectiveColorGroup } from "@/lib/designs/color-classifier";

type PrintifyVariantLike = {
  id: number;
  title: string;
  options?: Record<string, string | undefined> | null;
};

type StoreColorLike = {
  id: string;
  name: string;
  printifyColorId?: string | null;
};

function normalizeColorKey(value: string): string {
  return value.trim().toLowerCase();
}

function variantColorKeys(variant: PrintifyVariantLike): string[] {
  return [
    variant.options?.color ?? "",
    ...Object.values(variant.options ?? {}),
    ...variant.title.split(/[/,|]/g),
  ]
    .map((value) => normalizeColorKey(String(value ?? "")))
    .filter(Boolean);
}

export function resolveVariantGroupsByColor(input: {
  variants: PrintifyVariantLike[];
  storeColors: StoreColorLike[];
  effectiveColorGroups: Map<string, EffectiveColorGroup>;
}): { lightVariantIds: number[]; darkVariantIds: number[] } {
  const colorByKey = new Map<string, StoreColorLike>();
  for (const color of input.storeColors) {
    colorByKey.set(normalizeColorKey(color.name), color);
    if (color.printifyColorId) colorByKey.set(normalizeColorKey(color.printifyColorId), color);
  }

  const lightVariantIds: number[] = [];
  const darkVariantIds: number[] = [];

  for (const variant of input.variants) {
    const color = variantColorKeys(variant)
      .map((key) => colorByKey.get(key))
      .find(Boolean);
    if (!color) continue;
    const group = input.effectiveColorGroups.get(color.id);
    if (group === "light") lightVariantIds.push(variant.id);
    if (group === "dark") darkVariantIds.push(variant.id);
  }

  return { lightVariantIds, darkVariantIds };
}

export function assertNonEmptyVariantGroups(groups: {
  lightVariantIds: number[];
  darkVariantIds: number[];
}) {
  if (groups.lightVariantIds.length === 0) {
    throw new Error("No light color variants are available for the selected colors");
  }
  if (groups.darkVariantIds.length === 0) {
    throw new Error("No dark color variants are available for the selected colors");
  }
}

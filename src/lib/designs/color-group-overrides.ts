import type { EffectiveColorGroup } from "@/lib/designs/color-classifier";
import { normalizeColorNameKey } from "@/lib/designs/color-classifier";
import { prisma } from "@/lib/db";

export type ManualColorGroup = EffectiveColorGroup;

export type ColorGroupOverrideRow = {
  id: string;
  colorName: string;
  colorNameKey: string;
  colorGroup: ManualColorGroup;
  source: string;
  updatedAt: Date;
};

function isManualColorGroup(value: string): value is ManualColorGroup {
  return value === "light" || value === "dark";
}

export async function loadColorGroupOverrideMap(
  tenantId: string,
): Promise<Map<string, ManualColorGroup>> {
  const rows = await prisma.colorGroupOverride.findMany({
    where: { tenantId },
    select: { colorNameKey: true, colorGroup: true },
  });

  const entries: Array<[string, ManualColorGroup]> = [];
  for (const row of rows) {
    if (isManualColorGroup(row.colorGroup)) {
      entries.push([row.colorNameKey, row.colorGroup]);
    }
  }
  return new Map(entries);
}

export function resolveEffectiveColorGroupValue(input: {
  colorName: string;
  storeColorGroup?: string | null;
  globalOverrides: Map<string, ManualColorGroup>;
}): "auto" | ManualColorGroup {
  const override = input.globalOverrides.get(normalizeColorNameKey(input.colorName));
  if (override) return override;
  return input.storeColorGroup === "light" || input.storeColorGroup === "dark"
    ? input.storeColorGroup
    : "auto";
}

export async function listColorGroupOverrides(tenantId: string): Promise<ColorGroupOverrideRow[]> {
  const rows = await prisma.colorGroupOverride.findMany({
    where: { tenantId },
    orderBy: { colorNameKey: "asc" },
    select: {
      id: true,
      colorName: true,
      colorNameKey: true,
      colorGroup: true,
      source: true,
      updatedAt: true,
    },
  });

  const overrides: ColorGroupOverrideRow[] = [];
  for (const row of rows) {
    if (isManualColorGroup(row.colorGroup)) {
      overrides.push({ ...row, colorGroup: row.colorGroup });
    }
  }
  return overrides;
}

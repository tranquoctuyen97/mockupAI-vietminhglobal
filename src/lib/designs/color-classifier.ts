export type EffectiveColorGroup = "light" | "dark";

export type ColorGroupOverrideMap = Map<string, EffectiveColorGroup>;

export function normalizeColorNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function classifyColorHex(hex: string): EffectiveColorGroup {
  const normalized = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma > 128 ? "light" : "dark";
}

export function resolveColorGroups(
  colors: Array<{ id: string; name?: string; hex: string; colorGroup: string }>,
  globalOverrides: ColorGroupOverrideMap = new Map(),
): Map<string, EffectiveColorGroup> {
  const result = new Map<string, EffectiveColorGroup>();
  for (const color of colors) {
    const nameOverride = color.name
      ? globalOverrides.get(normalizeColorNameKey(color.name))
      : undefined;
    if (nameOverride) {
      result.set(color.id, nameOverride);
    } else if (color.colorGroup === "light" || color.colorGroup === "dark") {
      result.set(color.id, color.colorGroup);
    } else {
      result.set(color.id, classifyColorHex(color.hex));
    }
  }
  return result;
}

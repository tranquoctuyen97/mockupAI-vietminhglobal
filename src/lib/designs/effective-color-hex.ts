import { enrichColorHex } from "@/lib/printify/color-hex";

type ColorLike = {
  name?: string | null;
  hex: string;
};

type PrintifyColorHexLike = {
  colorName: string;
  colorHex?: string | null;
};

function normalizeColorName(name: string): string {
  return name.trim().toLowerCase();
}

export function buildPrintifyColorHexByName(
  rows: PrintifyColorHexLike[],
): Map<string, string> {
  const colorHexByName = new Map<string, string>();

  for (const row of rows) {
    if (!row.colorHex) continue;
    const key = normalizeColorName(row.colorName);
    if (!key || colorHexByName.has(key)) continue;
    colorHexByName.set(key, row.colorHex);
  }

  return colorHexByName;
}

export function applyEffectivePrintifyColorHexes<T extends ColorLike>(
  colors: T[],
  printifyColorHexes: PrintifyColorHexLike[] | Map<string, string>,
): T[] {
  const colorHexByName =
    printifyColorHexes instanceof Map
      ? printifyColorHexes
      : buildPrintifyColorHexByName(printifyColorHexes);

  return colors.map((color) => {
    const name = color.name?.trim() ?? "";
    const printifyHex = name ? colorHexByName.get(normalizeColorName(name)) : null;
    return {
      ...color,
      hex: printifyHex ?? enrichColorHex(name, color.hex),
    };
  });
}

/**
 * Color Name → Hex mapping for Printify colors
 *
 * Usage:
 * - Catalog API: mapping raw Printify variant color names to hex
 * - Template list: enriching stored StoreColor hex when it's wrong
 * - Wizard: displaying correct color swatches
 *
 * Priority: PrintifyVariantCache hex > this fallback map > #CCCCCC
 */

const COLOR_MAP: Record<string, string> = {
  // ── Neutrals ──
  white: "#FFFFFF",
  black: "#111111",
  grey: "#808080",
  gray: "#808080",
  "light grey": "#D3D3D3",
  "light gray": "#D3D3D3",
  charcoal: "#36454F",
  "ash grey": "#B2BEB5",
  "heavy metal": "#545454",
  natural: "#F5F5DC",
  cream: "#FFFDD0",
  sand: "#C2B280",
  tan: "#D2B48C",
  brown: "#8B4513",
  "dark chocolate": "#3B2F2F",
  "sport grey": "#9B9B9B",
  "dark heather": "#414141",
  "heather grey": "#9B9B9B",
  "heather gray": "#9B9B9B",
  "athletic heather": "#9B9B9B",
  heather: "#B7C9E2",
  "dark grey heather": "#4A4A4A",
  // ── Blues ──
  navy: "#131E3A",
  "midnight navy": "#131E3A",
  "heather navy": "#2B3A5C",
  "royal blue": "#4169E1",
  royal: "#4169E1",
  blue: "#0000FF",
  "light blue": "#ADD8E6",
  "dusty blue": "#6B8FAD",
  "baby blue": "#89CFF0",
  "carolina blue": "#56A0D3",
  "steel blue": "#4682B4",
  "slate blue": "#6A5ACD",
  "sky blue": "#87CEEB",
  "ice blue": "#D6ECF0",
  indigo: "#4B0082",
  // ── Reds ──
  red: "#C41E3A",
  "cardinal red": "#8A0303",
  "dark red": "#8B0000",
  maroon: "#800000",
  crimson: "#DC143C",
  scarlet: "#FF2400",
  berry: "#8E4585",
  wine: "#722F37",
  burgundy: "#800020",
  // ── Greens ──
  green: "#008000",
  "forest green": "#228B22",
  forest: "#228B22",
  "kelly green": "#4CBB17",
  "irish green": "#008000",
  "military green": "#4B5320",
  "dark green": "#006400",
  olive: "#808000",
  sage: "#BCB88A",
  "heather forest": "#2E5A3A",
  mint: "#98FF98",
  "leaf green": "#4DBD33",
  "lime green": "#32CD32",
  lime: "#00FF00",
  "army green": "#4B5320",
  // ── Purples / Mauve ──
  purple: "#800080",
  "purple rush": "#7851A9",
  mauve: "#E0B0FF",
  "heather mauve": "#C68EA3",
  lilac: "#C8A2C8",
  lavender: "#E6E6FA",
  plum: "#8E4585",
  violet: "#7F00FF",
  "dusty purple": "#8B668B",
  magenta: "#FF00FF",
  // ── Pinks ──
  pink: "#FFC0CB",
  "light pink": "#FFB6C1",
  "hot pink": "#FF69B4",
  "dusty pink": "#DCAE96",
  blush: "#DE5D83",
  rose: "#FF007F",
  "dusty rose": "#DCAE96",
  salmon: "#FA8072",
  // ── Oranges / Yellows ──
  orange: "#FFA500",
  "burnt orange": "#CC5500",
  coral: "#FF7F50",
  peach: "#FFE5B4",
  gold: "#FFD700",
  yellow: "#FFFF00",
  mustard: "#FFDB58",
  "daisy yellow": "#FFF700",
  sunset: "#FAD6A5",
  // ── Teals / Cyans ──
  teal: "#008080",
  turquoise: "#40E0D0",
  cyan: "#00FFFF",
  aqua: "#00FFFF",
  "sea foam": "#93E9BE",
  "sea green": "#2E8B57",
};

const PREFIXES_TO_STRIP = ["solid ", "vintage ", "heather ", "neon ", "antique "];

const FUZZY_BASE_COLORS = [
  "black", "white", "navy", "red", "royal", "green", "forest",
  "maroon", "purple", "mauve", "orange", "yellow", "grey", "gray",
  "brown", "blue", "pink", "coral", "teal", "olive", "gold",
  "cream", "lavender", "salmon", "mint", "sage", "plum", "berry",
];

/**
 * Convert a Printify color name to hex.
 * Uses exact match → prefix stripping → fuzzy substring → #CCCCCC fallback.
 */
export function colorToHex(colorName: string): string {
  const key = colorName.toLowerCase().trim();

  // 1. Exact match
  if (COLOR_MAP[key]) return COLOR_MAP[key];

  // 2. Strip common Printify prefixes and try again
  for (const prefix of PREFIXES_TO_STRIP) {
    if (key.startsWith(prefix)) {
      const strippedKey = key.slice(prefix.length).trim();
      if (COLOR_MAP[strippedKey]) return COLOR_MAP[strippedKey];
    }
  }

  // 3. Fuzzy search — if key contains a known base color word
  for (const base of FUZZY_BASE_COLORS) {
    if (key.includes(base)) {
      return COLOR_MAP[base];
    }
  }

  // 4. Default fallback
  return "#CCCCCC";
}

/** Check if a hex is a known fallback/placeholder (wrong data) */
const FALLBACK_HEXES = new Set(["#CCCCCC", "#EEEEEE", "#cccccc", "#eeeeee"]);
export function isPlaceholderHex(hex: string | null | undefined): boolean {
  return !hex || FALLBACK_HEXES.has(hex);
}

/**
 * Enrich a color hex — if the stored hex is a placeholder,
 * replace it with the best available hex from the color name.
 */
export function enrichColorHex(name: string, storedHex: string): string {
  if (isPlaceholderHex(storedHex)) {
    return colorToHex(name);
  }
  return storedHex;
}

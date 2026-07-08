export const LIGHT_TOKENS = ["sang", "light", "bright"];
export const DARK_TOKENS = ["toi", "dark"];
const BRACKET_STRIP = /^[[(]|[)\]]$/g;
const FILE_EXT = /\.[^.]+$/;
const TOKEN_MATCH = /[^\s_\-–—·]+/g;

export type DesignVariantType = "LIGHT" | "DARK";

export interface ParsedDesignName {
  baseName: string;
  type: DesignVariantType;
  originalSuffix: string;
}

export interface DesignPairResult {
  baseName: string;
  lightDesignId: string;
  darkDesignId: string;
  lightDesignName: string;
  darkDesignName: string;
}

export interface PairingResult {
  pairs: DesignPairResult[];
  /** Designs that have a light/dark suffix but are missing their counterpart */
  unpaired: Array<{ id: string; name: string; reason: string }>;
  /** Designs that have no detectable pair pattern — treated as independent */
  independent: Array<{ id: string; name: string }>;
  /** True when at least one design had a pair marker (for UI display decisions) */
  hasPairIntent: boolean;
}

type NameToken = {
  raw: string;
  start: number;
  end: number;
};

/**
 * Strip Vietnamese diacritics via NFD decomposition.
 * "sáng" → "sang", "tối" → "toi"
 */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Normalize a token for suffix comparison.
 * Lowercase + strip diacritics so "Sáng", "sáng", "SANG" all → "sang".
 */
function normalizeToken(value: string): string {
  return stripDiacritics(value.trim().toLocaleLowerCase("vi-VN"));
}

function markerType(value: string): DesignVariantType | null {
  const normalized = normalizeToken(value);
  if (LIGHT_TOKENS.includes(normalized)) return "LIGHT";
  if (DARK_TOKENS.includes(normalized)) return "DARK";
  return null;
}

/**
 * Strip file extension from a design name.
 * "Cat - Sáng.png" → "Cat - Sáng"
 */
function stripFileExtension(name: string): string {
  return name.replace(FILE_EXT, "").trim();
}

function tokenizeName(name: string): NameToken[] {
  return Array.from(name.matchAll(TOKEN_MATCH), (match) => {
    const start = match.index ?? 0;
    const raw = match[0].replace(BRACKET_STRIP, "");
    return raw ? { raw, start, end: start + match[0].length } : null;
  }).filter((token): token is NameToken => Boolean(token));
}

function baseNameWithoutToken(name: string, token: NameToken): string {
  return `${name.slice(0, token.start)} ${name.slice(token.end)}`
    .replace(/[\s_\-–—·()[\]]+/g, " ")
    .trim();
}

/**
 * Parse a design name to detect light/dark pair markers.
 *
 * Supports:
 * - Suffixes after separators: "1 - sáng", "1_toi", "1·light"
 * - Prefix/internal markers: "sáng 1", "ver sáng 1", "ver_sang_1"
 * - Bracketed suffixes: "1 (sáng)", "1 [tối]"
 * - File extensions are stripped first: "1 - sáng.png" → baseName "1", LIGHT
 * - Vietnamese diacritics are normalized: "Sáng" ≈ "sang"
 *
 * Returns null if no pair marker is detected (independent design).
 */
export function parseDesignName(rawName: string): ParsedDesignName | null {
  const name = stripFileExtension(rawName.trim());
  if (!name) return null;

  const tokens = tokenizeName(name);

  if (tokens.length < 2) return null;

  const orderedTokens = [tokens[tokens.length - 1], ...tokens.slice(0, -1)];
  for (const token of orderedTokens) {
    const type = markerType(token.raw);
    if (!type) continue;

    const baseName = baseNameWithoutToken(name, token);
    if (baseName) return { baseName, type, originalSuffix: token.raw };
  }

  return null;
}

/**
 * Compute a normalized key for bucket grouping.
 * Strips diacritics and lowercases so "sáng" and "sang" group together.
 */
function pairKey(baseName: string): string {
  return stripDiacritics(baseName.trim().toLocaleLowerCase("vi-VN"));
}

export function pairDesigns(designs: Array<{ id: string; name: string }>): PairingResult {
  const orderById = new Map(designs.map((design, index) => [design.id, index]));
  const buckets = new Map<
    string,
    {
      baseName: string;
      light?: { id: string; name: string };
      dark?: { id: string; name: string };
      extras: Array<{ id: string; name: string }>;
    }
  >();
  const independent: PairingResult["independent"] = [];
  const unpaired: PairingResult["unpaired"] = [];
  let hasPairIntent = false;

  for (const design of designs) {
    const parsed = parseDesignName(design.name);
    if (!parsed) {
      independent.push({ id: design.id, name: design.name });
      continue;
    }

    hasPairIntent = true;
    const key = pairKey(parsed.baseName);
    const bucket = buckets.get(key) ?? { baseName: parsed.baseName, extras: [] };
    const slot = parsed.type === "LIGHT" ? "light" : "dark";

    if (bucket[slot]) {
      bucket.extras.push(design);
    } else {
      bucket[slot] = design;
    }

    buckets.set(key, bucket);
  }

  const pairs: DesignPairResult[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.light && bucket.dark) {
      pairs.push({
        baseName: bucket.baseName,
        lightDesignId: bucket.light.id,
        darkDesignId: bucket.dark.id,
        lightDesignName: bucket.light.name,
        darkDesignName: bucket.dark.name,
      });
      for (const extra of bucket.extras) {
        unpaired.push({ id: extra.id, name: extra.name, reason: "duplicate_suffix_for_base_name" });
      }
      continue;
    }

    for (const design of [bucket.light, bucket.dark, ...bucket.extras]) {
      if (design) unpaired.push({ id: design.id, name: design.name, reason: "missing_pair_match" });
    }
  }

  pairs.sort((a, b) => a.baseName.localeCompare(b.baseName, "vi"));
  unpaired.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
  independent.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
  return { pairs, unpaired, independent, hasPairIntent };
}

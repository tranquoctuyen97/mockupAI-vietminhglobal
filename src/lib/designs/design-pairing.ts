export const LIGHT_TOKENS = ["sang", "light", "bright"];
export const DARK_TOKENS = ["toi", "dark"];
const SEPARATORS = /[\s_\-–—·]+/;
const BRACKET_STRIP = /^[[(]|[)\]]$/g;
const FILE_EXT = /\.[^.]+$/;

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

/**
 * Strip file extension from a design name.
 * "Cat - Sáng.png" → "Cat - Sáng"
 */
function stripFileExtension(name: string): string {
  return name.replace(FILE_EXT, "").trim();
}

/**
 * Parse a design name to detect light/dark pair markers.
 *
 * Supports:
 * - Suffixes after separators: "1 - sáng", "1_toi", "1·light"
 * - Bracketed suffixes: "1 (sáng)", "1 [tối]"
 * - File extensions are stripped first: "1 - sáng.png" → baseName "1", LIGHT
 * - Vietnamese diacritics are normalized: "Sáng" ≈ "sang"
 *
 * Returns null if no pair marker is detected (independent design).
 */
export function parseDesignName(rawName: string): ParsedDesignName | null {
  const name = stripFileExtension(rawName.trim());
  if (!name) return null;

  // Tokenize by separators, stripping brackets from each token
  const tokens = name
    .split(SEPARATORS)
    .map((t) => t.replace(BRACKET_STRIP, ""))
    .filter(Boolean);

  if (tokens.length < 2) return null;

  // Check the last token as a potential suffix
  const lastToken = tokens[tokens.length - 1];
  const normalizedLast = normalizeToken(lastToken);
  const lightType = LIGHT_TOKENS.includes(normalizedLast);
  const darkType = DARK_TOKENS.includes(normalizedLast);
  const type = lightType ? "LIGHT" : darkType ? "DARK" : null;

  if (!type) return null;

  // Reconstruct baseName from the original name up to the suffix
  // Find the suffix's position in the original (case-insensitive, accent-insensitive)
  const suffixStart = findSuffixPosition(name, lastToken);
  const baseName = name.slice(0, suffixStart).replace(/[\s_\-–—·]+$/g, "").trim();

  return baseName ? { baseName, type, originalSuffix: lastToken } : null;
}

/**
 * Find where the suffix token starts in the original name string.
 * Looks backwards past any bracket chars and separators so
 * "1 (sáng)" → baseName slice starts before the '('.
 */
function findSuffixPosition(name: string, suffixToken: string): number {
  const lower = stripDiacritics(name.toLocaleLowerCase("vi-VN"));
  const suffixLower = stripDiacritics(suffixToken.toLocaleLowerCase("vi-VN"));
  const suffixIdx = lower.lastIndexOf(suffixLower);
  if (suffixIdx < 0) return name.length - suffixToken.length;

  // Walk backwards from the suffix to consume brackets and separators
  let start = suffixIdx;
  while (start > 0) {
    const prev = name[start - 1];
    if (prev === " " || prev === "_" || prev === "-" || prev === "–" || prev === "—" || prev === "·" ||
        prev === "(" || prev === "[" || prev === ")" || prev === "]") {
      start--;
    } else {
      break;
    }
  }
  return start;
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

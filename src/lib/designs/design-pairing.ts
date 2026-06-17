export const LIGHT_SUFFIXES = ["sáng", "sang", "light"];
export const DARK_SUFFIXES = ["tối", "toi", "dark"];
export const SEPARATORS = /[\s_\-·]+/;

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
  unpaired: Array<{ id: string; name: string; reason: string }>;
}

function normalizeToken(value: string): string {
  return value.trim().toLocaleLowerCase("vi-VN");
}

export function parseDesignName(name: string): ParsedDesignName | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(SEPARATORS).filter(Boolean);
  if (parts.length < 2) return null;

  const suffix = parts[parts.length - 1];
  const normalizedSuffix = normalizeToken(suffix);
  const type = LIGHT_SUFFIXES.includes(normalizedSuffix)
    ? "LIGHT"
    : DARK_SUFFIXES.includes(normalizedSuffix)
      ? "DARK"
      : null;

  if (!type) return null;

  const baseName = trimmed
    .slice(0, trimmed.length - suffix.length)
    .replace(/[\s_\-·]+$/g, "")
    .trim();

  return baseName ? { baseName, type, originalSuffix: suffix } : null;
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
  const unpaired: PairingResult["unpaired"] = [];

  for (const design of designs) {
    const parsed = parseDesignName(design.name);
    if (!parsed) {
      unpaired.push({ id: design.id, name: design.name, reason: "missing_light_dark_suffix" });
      continue;
    }

    const key = normalizeToken(parsed.baseName);
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
  return { pairs, unpaired };
}

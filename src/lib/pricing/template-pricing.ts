export const FALLBACK_TEMPLATE_PRICE_USD = 24.99;

export type PriceMap = Record<string, number>;

function toNumberish(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return null;
}

export function normalizeMoneyValue(value: unknown): number | null {
  const parsed = toNumberish(value);
  if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function normalizePriceBySizeDefault(value: unknown): PriceMap | null {
  if (value == null) return null;
  if (Array.isArray(value) || typeof value !== "object") return null;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;

  const normalized: PriceMap = {};
  for (const [rawSize, rawPrice] of entries) {
    const size = rawSize.trim();
    if (!size) return null;
    const price = normalizeMoneyValue(rawPrice);
    if (price == null) return null;
    normalized[size] = price;
  }
  return normalized;
}

export function resolveBaseTemplatePrice(params: {
  templateBasePriceUsd: unknown;
  storeDefaultPriceUsd: unknown;
}): number {
  return (
    normalizeMoneyValue(params.templateBasePriceUsd) ??
    normalizeMoneyValue(params.storeDefaultPriceUsd) ??
    FALLBACK_TEMPLATE_PRICE_USD
  );
}

export function resolvePriceForSize(params: {
  size: string;
  draftPriceBySizeOverride: unknown;
  templatePriceBySizeDefault: unknown;
  templateBasePriceUsd: unknown;
  storeDefaultPriceUsd: unknown;
}): number {
  const draftMap = normalizePriceBySizeDefault(params.draftPriceBySizeOverride);
  const templateMap = normalizePriceBySizeDefault(params.templatePriceBySizeDefault);
  return (
    draftMap?.[params.size] ??
    templateMap?.[params.size] ??
    resolveBaseTemplatePrice({
      templateBasePriceUsd: params.templateBasePriceUsd,
      storeDefaultPriceUsd: params.storeDefaultPriceUsd,
    })
  );
}

export function mergeDraftAndTemplatePriceMaps(params: {
  draftPriceBySizeOverride: unknown;
  templatePriceBySizeDefault: unknown;
}): PriceMap | null {
  const templateMap = normalizePriceBySizeDefault(params.templatePriceBySizeDefault) ?? {};
  const draftMap = normalizePriceBySizeDefault(params.draftPriceBySizeOverride) ?? {};
  const merged = { ...templateMap, ...draftMap };
  return Object.keys(merged).length > 0 ? merged : null;
}

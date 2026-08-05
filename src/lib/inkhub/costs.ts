export type InkhubOrderItem = {
  id?: number;
  SKU?: string;
  sku?: string;
  productId?: string;
  variantId?: string;
  quantity?: number;
  printAreas?: Array<{ url?: string; mockupUrl?: string }>;
};

export type NormalizedLineCost = {
  fulfillmentCents: number | null;
  shippingCents: number | null;
  taxCents: number | null;
  otherCents: number | null;
  totalCents: number | null;
  status: "READY" | "PENDING";
};

export type NormalizedOrderCosts = {
  fulfillmentCents: number | null;
  shippingCents: number | null;
  taxCents: number | null;
  otherCents: number | null;
  totalCents: number | null;
  status: "READY" | "PENDING";
  lines: NormalizedLineCost[];
};

type CostCandidate = {
  sku: string | null;
  variantId: string | null;
  mockupUrl: string | null;
  designUrl: string | null;
  fulfillmentCents: number | null;
  shippingCents: number | null;
  taxCents: number | null;
  otherCents: number | null;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function first(value: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key];
  }
  return null;
}

/** Parse a provider's decimal USD value into integer cents. */
export function decimalToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/** Parse a Printify minor-unit amount into cents. */
function minorUnitsToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function toText(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function orderItems(order: JsonRecord): InkhubOrderItem[] {
  return Array.isArray(order.items) ? (order.items as InkhubOrderItem[]) : [];
}

function itemSku(item: InkhubOrderItem): string | null {
  return toText(item.SKU ?? item.sku);
}

function itemUrls(item: InkhubOrderItem): { mockupUrl: string | null; designUrl: string | null } {
  const area = Array.isArray(item.printAreas) ? item.printAreas[0] : undefined;
  return {
    mockupUrl: toText(area?.mockupUrl),
    designUrl: toText(area?.url),
  };
}

function printifyCandidates(metadata: JsonRecord): CostCandidate[] {
  const rows = Array.isArray(metadata.line_items) ? metadata.line_items : [];
  return rows.map((raw) => {
    const row = record(raw);
    return {
      sku: toText(first(row, "sku", "SKU")),
      variantId: toText(first(row, "variantId", "variant_id")),
      mockupUrl: toText(first(row, "mockup", "mockupUrl")),
      designUrl:
        toText(first(row, "frontDesignUrl", "front_design_url")) ??
        toText(record(Array.isArray(row.print_files) ? row.print_files[0] : null).url),
      // Printify metadata uses minor units, unlike the normalized API fields.
      fulfillmentCents: minorUnitsToCents(first(row, "cost", "total_cost")),
      shippingCents: minorUnitsToCents(first(row, "shipping_cost", "shippingCost")),
      taxCents: minorUnitsToCents(first(row, "tax", "tax_cost", "taxCost")),
      otherCents: minorUnitsToCents(first(row, "other_cost", "otherCost")),
    };
  });
}

function beefulCandidates(metadata: JsonRecord): CostCandidate[] {
  const response = record(metadata.response);
  const rows = Array.isArray(response.items) ? response.items : [];
  return rows.map((raw) => {
    const row = record(raw);
    return {
      sku: toText(first(row, "sku", "SKU")),
      variantId: toText(first(row, "variantId", "variant_id")),
      mockupUrl: toText(first(row, "mockupUrl", "mockup")),
      designUrl: toText(first(row, "frontDesignUrl", "front_design_url")),
      fulfillmentCents: decimalToCents(first(row, "cost", "fulfillmentCost")),
      shippingCents: decimalToCents(first(row, "shippingCost", "shipping_cost")),
      taxCents: decimalToCents(first(row, "taxCost", "tax_cost")),
      otherCents: decimalToCents(first(row, "otherCost", "other_cost")),
    };
  });
}

function candidatesFor(metadata: JsonRecord): CostCandidate[] {
  const source = String(metadata.source ?? "").toLowerCase();
  if (source === "printify") return printifyCandidates(metadata);
  const beeful = beefulCandidates(metadata);
  if (beeful.length > 0) return beeful;
  return printifyCandidates(metadata);
}

function candidateScore(item: InkhubOrderItem, candidate: CostCandidate): number {
  const sku = itemSku(item);
  const variantId = toText(item.variantId);
  const urls = itemUrls(item);
  let score = 0;
  if (sku && candidate.sku && sku.toLowerCase() === candidate.sku.toLowerCase()) score += 100;
  if (variantId && candidate.variantId && variantId === candidate.variantId) score += 50;
  if (urls.mockupUrl && candidate.mockupUrl && urls.mockupUrl === candidate.mockupUrl) score += 30;
  if (urls.designUrl && candidate.designUrl && urls.designUrl === candidate.designUrl) score += 30;
  return score;
}

function matchCandidates(
  items: InkhubOrderItem[],
  candidates: CostCandidate[],
): Array<CostCandidate | null> {
  const used = new Set<number>();
  return items.map((item) => {
    let bestIndex = -1;
    let bestScore = 0;
    candidates.forEach((candidate, index) => {
      if (used.has(index)) return;
      const score = candidateScore(item, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) return null;
    used.add(bestIndex);
    return candidates[bestIndex];
  });
}

function allocate(
  total: number | null,
  weights: number[],
  lastIndex: number,
): Array<number | null> {
  if (total === null || weights.length === 0) return weights.map(() => null);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0) return weights.map(() => null);
  const lastPositiveIndex = weights.reduce((last, value, index) => (value > 0 ? index : last), -1);
  const residualIndex = lastPositiveIndex >= 0 ? lastPositiveIndex : lastIndex;
  let allocated = 0;
  return weights.map((weight, index) => {
    if (weight <= 0) return null;
    if (index === residualIndex) return total - allocated;
    const value = Math.floor((total * weight) / weightTotal);
    allocated += value;
    return value;
  });
}

function normalizeComponents(order: JsonRecord, metadata: JsonRecord, candidates: CostCandidate[]) {
  const source = String(metadata.source ?? "").toLowerCase();
  const isPrintify = source === "printify";
  const fulfillment = decimalToCents(first(order, "fulfillmentCost", "fulfillment_cost"));
  const shipping = decimalToCents(first(order, "shippingCost", "shipping_cost"));
  const tax = decimalToCents(first(order, "taxCost", "tax_cost"));
  const other = decimalToCents(first(order, "otherCost", "other_cost"));

  const metadataResponse = record(metadata.response);
  const metadataFulfillment = isPrintify
    ? sumKnown(candidates.map((row) => row.fulfillmentCents))
    : decimalToCents(first(metadataResponse, "cost", "fulfillmentCost"));
  const metadataShipping = isPrintify
    ? minorUnitsToCents(first(metadata, "total_shipping", "shipping_cost", "shippingCost"))
    : decimalToCents(
        first(metadata, "chargeShippingFee", "shippingCost", "shipping_cost") ??
          first(metadataResponse, "chargeShippingFee", "shippingCost", "shipping_cost"),
      );
  const metadataTax = isPrintify
    ? minorUnitsToCents(first(metadata, "total_tax", "tax_cost", "taxCost"))
    : null;
  const metadataOther = isPrintify
    ? minorUnitsToCents(first(metadata, "total_other", "other_cost", "otherCost"))
    : null;

  return {
    fulfillment:
      fulfillment ?? metadataFulfillment ?? sumKnown(candidates.map((row) => row.fulfillmentCents)),
    shipping: shipping ?? metadataShipping ?? sumKnown(candidates.map((row) => row.shippingCents)),
    tax: tax ?? metadataTax ?? sumKnown(candidates.map((row) => row.taxCents)),
    other: other ?? metadataOther ?? sumKnown(candidates.map((row) => row.otherCents)),
  };
}

export function normalizeInkhubOrderCosts(rawOrder: unknown): NormalizedOrderCosts {
  const order = record(rawOrder);
  const metadata = record(order.fulfillmentCostMetadata);
  const items = orderItems(order);
  const transferredMetadata = record(order.transferredMetadata);
  const candidateMetadata = Array.isArray(metadata.line_items) ? metadata : transferredMetadata;
  const candidates = candidatesFor(candidateMetadata);
  const matched = matchCandidates(items, candidates);
  const components = normalizeComponents(order, metadata, candidates);

  const explicitTotal = decimalToCents(first(order, "totalCost", "total_cost"));
  const metadataTotal =
    String(metadata.source ?? "").toLowerCase() === "printify"
      ? minorUnitsToCents(first(metadata, "total_price", "total_cost", "totalCost"))
      : null;
  const total =
    explicitTotal ??
    metadataTotal ??
    sumKnown([components.fulfillment, components.shipping, components.tax, components.other]);

  const rawBaseWeights = matched.map((candidate, index) => {
    if (candidate?.fulfillmentCents !== null && candidate?.fulfillmentCents !== undefined) {
      return candidate.fulfillmentCents;
    }
    // A quantity fallback is safe only when the line matched a provider record,
    // or when the order has one unambiguous line. Unknown multi-line allocation
    // stays pending instead of inventing a per-line cost.
    if (candidate || items.length === 1) return items[index]?.quantity ?? 1;
    return 0;
  });
  const baseWeights = rawBaseWeights.map((weight) =>
    typeof weight === "number" && weight > 0 ? weight : 0,
  );
  const fulfillmentAllocations = allocate(
    components.fulfillment,
    baseWeights,
    Math.max(items.length - 1, 0),
  );
  const shippingAllocations = allocate(
    components.shipping,
    baseWeights,
    Math.max(items.length - 1, 0),
  );
  const taxAllocations = allocate(components.tax, baseWeights, Math.max(items.length - 1, 0));
  const otherAllocations = allocate(components.other, baseWeights, Math.max(items.length - 1, 0));

  const lines = items.map((_, index) => {
    const fulfillmentCents = fulfillmentAllocations[index];
    const shippingCents = shippingAllocations[index];
    const taxCents = taxAllocations[index];
    const otherCents = otherAllocations[index];
    const lineTotal = sumKnown([fulfillmentCents, shippingCents, taxCents, otherCents]);
    return {
      fulfillmentCents,
      shippingCents,
      taxCents,
      otherCents,
      totalCents: lineTotal,
      status: lineTotal === null ? "PENDING" : "READY",
    } satisfies NormalizedLineCost;
  });

  return {
    fulfillmentCents: components.fulfillment,
    shippingCents: components.shipping,
    taxCents: components.tax,
    otherCents: components.other,
    totalCents: total,
    status: total === null ? "PENDING" : "READY",
    lines,
  };
}

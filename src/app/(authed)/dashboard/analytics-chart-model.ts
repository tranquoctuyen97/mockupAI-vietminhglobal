import type { TripleWhaleAnalyticsResult } from "@/lib/triple-whale/analytics";

export const SHOP_CHART_COLORS = [
  "#54a9ed",
  "#9bd77b",
  "#f2b84b",
  "#f57835",
  "#818ce4",
  "#9fe870",
] as const;

export type ShopColorMap = Record<string, string>;

export interface PieSlice {
  shopId: string;
  label: string;
  value: number;
  magnitude: number;
  percent: number;
  color: string;
}

export function buildShopColorMap(
  distribution: TripleWhaleAnalyticsResult["analytics"]["distribution"],
): ShopColorMap {
  const labels = new Map<string, string>();
  Object.values(distribution).forEach((items) => {
    items.forEach((item) => {
      const currentLabel = labels.get(item.shopId);
      if (!currentLabel || item.label.localeCompare(currentLabel) < 0) {
        labels.set(item.shopId, item.label);
      }
    });
  });

  return Object.fromEntries(
    [...labels.entries()]
      .sort(([shopIdA, labelA], [shopIdB, labelB]) => {
        const byLabel = labelA.localeCompare(labelB);
        return byLabel || shopIdA.localeCompare(shopIdB);
      })
      .map(([shopId], index) => [shopId, SHOP_CHART_COLORS[index % SHOP_CHART_COLORS.length]]),
  );
}

export function buildPieSlices(
  items: Array<{ shopId: string; label: string; value: number }>,
  colorByShop: ShopColorMap,
): PieSlice[] {
  const magnitudes = items.map((item) => Math.abs(item.value));
  const totalMagnitude = magnitudes.reduce((sum, magnitude) => sum + magnitude, 0);

  return items.map((item, index) => ({
    shopId: item.shopId,
    label: item.label,
    value: item.value,
    magnitude: magnitudes[index],
    percent: totalMagnitude === 0 ? 0 : (magnitudes[index] / totalMagnitude) * 100,
    color: colorByShop[item.shopId] ?? SHOP_CHART_COLORS[0],
  }));
}

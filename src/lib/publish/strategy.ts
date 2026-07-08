export type PublishStrategy = "PRINTIFY_SHOPIFY_CHANNEL" | "EXISTING_SHOPIFY_DIRECT";

export type PublishStrategyStore = {
  printifyShop?: {
    salesChannel?: string | null;
    disconnected?: boolean | null;
  } | null;
};

export function resolvePublishStrategy(store: PublishStrategyStore): PublishStrategy {
  const salesChannel = store.printifyShop?.salesChannel?.trim().toLowerCase();
  if (salesChannel === "shopify" && store.printifyShop?.disconnected !== true) {
    return "PRINTIFY_SHOPIFY_CHANNEL";
  }
  return "EXISTING_SHOPIFY_DIRECT";
}

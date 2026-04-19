export interface ShopInfo {
  id: string;
  name: string;
  email: string;
  myshopifyDomain: string;
  plan: {
    displayName: string;
  };
  currencyCode: string;
}

export interface PrintifyShop {
  id: number;
  title: string;
  sales_channel: string;
}

export interface Blueprint {
  id: number;
  title: string;
  description: string;
  brand: string;
  model: string;
  images: string[];
}

export interface PrintProvider {
  id: number;
  title: string;
  location: {
    address1?: string;
    city?: string;
    country: string;
    region?: string;
    zip?: string;
  };
}

export interface Variant {
  id: number;
  title: string;
  options: Record<string, string>;
  placeholders: Placeholder[];
}

export interface Placeholder {
  position: string;
  height: number;
  width: number;
}

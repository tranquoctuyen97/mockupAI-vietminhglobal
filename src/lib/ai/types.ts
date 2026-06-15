export interface ContentInput {
  designName: string;
  productType: string;
  colors: string[];
  placement: string;
}

export interface ContentOutput {
  title: string;
  description: string;
  tags: string[];
  altText: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ContentGenerator {
  generate(input: ContentInput): Promise<ContentOutput>;
}

export interface ProductOrganizationInput {
  title: string;
  descriptionHtml: string;
  productType: string;
  canonicalProductType?: string | null;
  currentTags: string[];
  currentCollections: string[];
  selectedColors: string[];
  designContext?: string | null;
  niche?: string | null;
}

export interface ProductOrganizationOutput {
  tags: string[];
  collections: string[];
  tokensIn: number;
  tokensOut: number;
}

export interface ProductOrganizationOptimizer {
  optimizeProductOrganization(input: ProductOrganizationInput): Promise<ProductOrganizationOutput>;
}

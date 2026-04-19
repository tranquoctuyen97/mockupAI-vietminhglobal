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

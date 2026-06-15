import { mergeOptimizedTags, normalizeOrganizationCollections } from "@/lib/wizard/product-organization";
import type {
  ContentInput,
  ContentOutput,
  ProductOrganizationInput,
  ProductOrganizationOutput,
} from "../types";

export const POD_LISTING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      description: "Product title, max 60 characters.",
    },
    description: {
      type: "string",
      description: "HTML product description, 150-200 words.",
    },
    tags: {
      type: "array",
      description: "Exactly 15 distinct SEO tags.",
      items: { type: "string" },
    },
    altText: {
      type: "string",
      description: "Alt text for the primary product image, max 125 characters.",
    },
  },
  required: ["title", "description", "tags", "altText"],
} as const;

export const ORGANIZATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Max 15 short searchable Shopify tags.",
    },
    collections: {
      type: "array",
      items: { type: "string" },
      description: "Broad Shopify Manual Collection title or handle suggestions.",
    },
  },
  required: ["tags", "collections"],
} as const;

export function buildListingUserPrompt(input: ContentInput): string {
  return `Please generate content for the following product:
Design Name: ${input.designName}
Product Type: ${input.productType}
Placement: ${input.placement}
Colors: ${input.colors.join(", ")}

Return only JSON matching the required schema.`;
}

export function buildOrganizationUserPrompt(input: ProductOrganizationInput): string {
  return `Generate Shopify SEO tags and manual collection suggestions for this product.
Return strict JSON:
{
  "tags": string[],
  "collections": string[]
}

Rules:
- Max 15 tags.
- Tags must be short searchable Shopify tags.
- Collections should be broad store collection names, not too specific.
- Do not include duplicates.
- Do not include internal tags like mockupai or draft-preview.
- Prefer existing product type, audience, material, print method, niche, occasion.
- Prefer broad collection names such as T-Shirts, Hoodies, Sweatshirts, Patriotic, Gifts, New Arrivals, Men's Clothing, Women's Clothing.

Product:
Title: ${input.title}
Product Type: ${input.productType}
Canonical Product Type: ${input.canonicalProductType ?? ""}
Colors: ${input.selectedColors.join(", ")}
Current Tags: ${input.currentTags.join(", ")}
Current Collections: ${input.currentCollections.join(", ")}
Design Context: ${input.designContext ?? ""}
Niche: ${input.niche ?? ""}
Description HTML:
${input.descriptionHtml}`;
}

export function parseListingContentJson(
  resultText: string,
  usage: { tokensIn: number; tokensOut: number },
): ContentOutput {
  const parsed = JSON.parse(extractJsonObject(resultText));
  const tags: string[] = Array.isArray(parsed.tags)
    ? parsed.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean).slice(0, 15)
    : [];

  return {
    title: String(parsed.title ?? ""),
    description: String(parsed.description ?? ""),
    tags,
    altText: String(parsed.altText ?? ""),
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
  };
}

export function parseProductOrganizationJson(
  resultText: string,
  usage: { tokensIn: number; tokensOut: number },
): ProductOrganizationOutput {
  const parsed = JSON.parse(extractJsonObject(resultText));
  return {
    tags: mergeOptimizedTags(Array.isArray(parsed.tags) ? parsed.tags : [], []),
    collections: normalizeOrganizationCollections(
      Array.isArray(parsed.collections) ? parsed.collections : [],
    ),
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
  };
}

export function extractJsonObject(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

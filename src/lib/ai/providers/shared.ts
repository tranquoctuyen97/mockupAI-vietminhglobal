import type { ContentInput, ContentOutput } from "../types";

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

export function buildListingUserPrompt(input: ContentInput): string {
  return `Please generate content for the following product:
Design Name: ${input.designName}
Product Type: ${input.productType}
Placement: ${input.placement}
Colors: ${input.colors.join(", ")}

Return only JSON matching the required schema.`;
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

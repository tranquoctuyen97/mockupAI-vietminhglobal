import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { ContentInput, ContentOutput } from "./types";

const COST_PER_1M_TOKENS_IN = 0.3; // $0.30 per 1M input tokens (Gemini 2.5 Flash)
const COST_PER_1M_TOKENS_OUT = 2.5; // $2.50 per 1M output tokens (Gemini 2.5 Flash)

/**
 * Calculates deterministic cache key based on inputs and provider
 */
export function generateCacheKey(
  input: ContentInput,
  provider: string,
  model: string,
  promptVersion: number,
): string {
  const sortedColors = [...input.colors].sort().join(",");
  const raw = `${input.designName}|${input.productType}|${sortedColors}|${input.placement}|${provider}|${model}|${promptVersion}`;
  return createHash("sha256").update(raw).digest("hex");
}

export async function getCachedContent(cacheKey: string): Promise<ContentOutput | null> {
  const cached = await prisma.aiContentCache.findUnique({
    where: { cacheKey },
  });

  if (!cached) return null;

  if (cached.expiresAt < new Date()) {
    // Optional: Could delete expired cache here or let a background job handle it
    return null;
  }

  // The payload should be structured as ContentOutput
  // Cast JsonValue to structured type
  return cached.payload as unknown as ContentOutput;
}

export async function saveToCache(
  cacheKey: string,
  result: ContentOutput,
  provider: string,
  model: string,
  ttlDays: number = 7,
): Promise<void> {
  const costUsd =
    (result.tokensIn / 1_000_000) * COST_PER_1M_TOKENS_IN +
    (result.tokensOut / 1_000_000) * COST_PER_1M_TOKENS_OUT;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  const payload = {
    title: result.title,
    description: result.description,
    tags: result.tags,
    altText: result.altText,
  };

  await prisma.aiContentCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      payload,
      provider,
      model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd,
      expiresAt,
    },
    update: {
      payload,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd,
      expiresAt,
    },
  });
}

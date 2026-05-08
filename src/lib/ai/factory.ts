import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto/envelope";
import { ContentGenerator } from "./types";
import { GeminiProvider } from "./providers/gemini";
import { OpenAiProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import { SYSTEM_PROMPT_POD_LISTING } from "./prompts/pod-listing";
import {
  getProviderEnvKey,
  normalizeModel,
  normalizeProviderId,
  type AiProviderId,
} from "./catalog";

export interface AiConfig {
  provider: AiProviderId;
  model: string;
  systemPrompt: string;
  hasCustomPrompt: boolean;
  keySource: "db" | "env";
}

/**
 * Returns the configured AI provider for the given tenant
 */
export async function getAiProvider(
  tenantId: string,
): Promise<{ generator: ContentGenerator; config: AiConfig }> {
  // First, try to get settings from DB
  const settings = await prisma.aiSettings.findUnique({
    where: { tenantId },
  });

  const provider = normalizeProviderId(settings?.activeProvider);
  const providerSettings = await prisma.aiProviderSettings.findUnique({
    where: {
      tenantId_provider: {
        tenantId,
        provider,
      },
    },
  });
  const systemPrompt = getEffectiveSystemPrompt(settings?.systemPrompt);

  const config: AiConfig = {
    provider,
    model: normalizeModel(provider, providerSettings?.model),
    systemPrompt,
    hasCustomPrompt: Boolean(settings?.systemPrompt?.trim()),
    keySource: "env",
  };

  let apiKey = "";

  if (providerSettings?.apiKeyEncrypted) {
    try {
      apiKey = decrypt(providerSettings.apiKeyEncrypted);
      config.keySource = "db";
    } catch (e) {
      console.error(`[AI Base] Failed to decrypt saved ${provider} API key`, e);
    }
  }

  // Fallback to env var if not set in DB
  if (!apiKey) {
    apiKey = process.env[getProviderEnvKey(provider)] || "";
    config.keySource = "env";
  }

  if (!apiKey) {
    throw new Error(
      `${provider} API key not configured. Please configure it in AI Settings or set ${getProviderEnvKey(provider)}.`,
    );
  }

  const generator = createContentGenerator(config.provider, apiKey, config.model, config.systemPrompt);

  return { generator, config };
}

export function createContentGenerator(
  provider: AiProviderId,
  apiKey: string,
  model: string,
  systemPrompt: string,
): ContentGenerator {
  switch (provider) {
    case "gemini":
      return new GeminiProvider(apiKey, model, systemPrompt);
    case "openai":
      return new OpenAiProvider(apiKey, model, systemPrompt);
    case "anthropic":
      return new AnthropicProvider(apiKey, model, systemPrompt);
  }
}

export function getEffectiveSystemPrompt(systemPrompt: string | null | undefined): string {
  return systemPrompt?.trim() || SYSTEM_PROMPT_POD_LISTING;
}

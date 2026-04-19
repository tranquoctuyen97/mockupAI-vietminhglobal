import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto/envelope";
import { ContentGenerator } from "./types";
import { GeminiProvider } from "./providers/gemini";

export interface AiConfig {
  provider: string;
  model: string;
  promptVersion: number;
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

  const config: AiConfig = {
    provider: settings?.provider || "gemini",
    model: settings?.model || "gemini-2.5-flash",
    promptVersion: settings?.promptVersion || 1,
  };

  let apiKey = "";

  if (settings) {
    try {
      apiKey = decrypt(settings.apiKeyEncrypted);
    } catch (e) {
      console.error("[AI Base] Failed to decrypt saved API key", e);
    }
  }

  // Fallback to Env var if not set in DB
  if (!apiKey) {
    apiKey = process.env.GEMINI_API_KEY || "";
  }

  if (!apiKey) {
    throw new Error(
      "AI API Key not configured. Please configure in Settings or set GEMINI_API_KEY env var.",
    );
  }

  let generator: ContentGenerator;

  switch (config.provider) {
    case "gemini":
      generator = new GeminiProvider(apiKey, config.model);
      break;
    default:
      // Fallback to Gemini
      generator = new GeminiProvider(apiKey, config.model);
      break;
  }

  return { generator, config };
}

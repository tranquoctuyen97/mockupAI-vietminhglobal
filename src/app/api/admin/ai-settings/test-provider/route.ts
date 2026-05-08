import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto/envelope";
import {
  AI_PROVIDER_IDS,
  getProviderEnvKey,
  normalizeModel,
  type AiProviderId,
} from "@/lib/ai/catalog";
import { createContentGenerator, getEffectiveSystemPrompt } from "@/lib/ai/factory";
import { parseAIError } from "@/lib/ai/errors";

const TestProviderSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
});

export async function POST(request: Request) {
  const { session, response } = await requireFeature("ai_settings");
  if (response) return response;

  const parsed = TestProviderSchema.safeParse(await request.json());
  if (!parsed.success || !AI_PROVIDER_IDS.includes(parsed.data.provider as AiProviderId)) {
    return NextResponse.json({ error: "Provider không được hỗ trợ" }, { status: 400 });
  }

  const provider = parsed.data.provider as AiProviderId;
  const settings = await prisma.aiSettings.findUnique({
    where: { tenantId: session.tenantId },
  });
  const providerSettings = await prisma.aiProviderSettings.findUnique({
    where: {
      tenantId_provider: {
        tenantId: session.tenantId,
        provider,
      },
    },
  });

  const model = normalizeModel(provider, parsed.data.model ?? providerSettings?.model);
  const apiKey = parsed.data.apiKey?.trim() || decryptSavedKey(providerSettings?.apiKeyEncrypted) || process.env[getProviderEnvKey(provider)] || "";

  if (!apiKey) {
    return NextResponse.json({ error: "Cần API key để kiểm tra provider" }, { status: 400 });
  }

  try {
    const generator = createContentGenerator(
      provider,
      apiKey,
      model,
      getEffectiveSystemPrompt(settings?.systemPrompt),
    );
    const result = await generator.generate({
      designName: "Test Design",
      productType: "T-Shirt",
      colors: ["Black"],
      placement: "Front",
    });

    return NextResponse.json({
      ok: true,
      provider,
      model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
  } catch (error) {
    const parsedError = parseAIError(error);
    return NextResponse.json(
      {
        ok: false,
        error: parsedError.code,
        message: parsedError.userMessage,
      },
      { status: parsedError.retryable ? 503 : 400 },
    );
  }
}

function decryptSavedKey(encrypted: Uint8Array | Buffer | null | undefined): string {
  if (!encrypted) return "";
  try {
    return decrypt(encrypted);
  } catch {
    return "";
  }
}

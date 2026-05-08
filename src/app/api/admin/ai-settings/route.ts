import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto/envelope";
import {
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_IDS,
  getProviderEnvKey,
  normalizeModel,
  normalizeProviderId,
  type AiProviderId,
} from "@/lib/ai/catalog";
import { SYSTEM_PROMPT_POD_LISTING } from "@/lib/ai/prompts/pod-listing";
import { getAiUsageSummary } from "@/lib/ai/usage";
import { getProviderModelList } from "@/lib/ai/model-discovery";

const ProviderUpdateSchema = z.object({
  model: z.string().optional(),
  apiKey: z.string().optional(),
});

const SettingsUpdateSchema = z.object({
  activeProvider: z.string().optional(),
  providers: z.record(z.string(), ProviderUpdateSchema).optional(),
  systemPrompt: z.string().optional(),
  resetPrompt: z.boolean().optional(),
  // Backward-compatible fields from the old page.
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
});

/**
 * GET /api/admin/ai-settings — provider catalog, provider settings, prompt, usage.
 * PUT /api/admin/ai-settings — update active provider, provider settings, prompt.
 */
export async function GET() {
  const { session, response } = await requireFeature("ai_settings");
  if (response) return response;

  const settings = await prisma.aiSettings.findUnique({
    where: { tenantId: session.tenantId },
  });
  const providerSettings = await prisma.aiProviderSettings.findMany({
    where: { tenantId: session.tenantId },
  });
  const providerById = new Map(providerSettings.map((item) => [item.provider, item]));
  const activeProvider = normalizeProviderId(settings?.activeProvider);
  const usage = await getAiUsageSummary(session.tenantId);
  const customPrompt = settings?.systemPrompt?.trim() || "";
  const providers = await Promise.all(AI_PROVIDER_CATALOG.map(async (provider) => {
    const saved = providerById.get(provider.id);
    const envConfigured = Boolean(process.env[provider.envKeyName]);
    const dbConfigured = Boolean(saved?.apiKeyEncrypted);
    const model = normalizeModel(provider.id, saved?.model);
    const modelList = await getProviderModelList(session.tenantId, provider.id, model);

    return {
      id: provider.id,
      label: provider.label,
      shortLabel: provider.shortLabel,
      model,
      models: modelList.models,
      modelsFetchedAt: modelList.fetchedAt,
      modelsStale: modelList.stale,
      modelsError: modelList.errorMessage,
      defaultModel: provider.defaultModel,
      configured: dbConfigured || envConfigured,
      keySource: dbConfigured ? "db" : envConfigured ? "env" : "none",
      apiKeyMasked: dbConfigured
        ? maskEncryptedKey(saved!.apiKeyEncrypted)
        : envConfigured
          ? "ENV"
          : "",
      active: activeProvider === provider.id,
    };
  }));

  return NextResponse.json({
    catalog: AI_PROVIDER_CATALOG,
    settings: {
      activeProvider,
      systemPrompt: customPrompt || SYSTEM_PROMPT_POD_LISTING,
      defaultPrompt: SYSTEM_PROMPT_POD_LISTING,
      hasCustomPrompt: Boolean(customPrompt),
    },
    providers,
    usage,
  });
}

export async function PUT(request: Request) {
  const { session, response } = await requireFeature("ai_settings");
  if (response) return response;

  const parsed = SettingsUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dữ liệu không hợp lệ", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const existingSettings = await prisma.aiSettings.findUnique({
    where: { tenantId: session.tenantId },
  });
  const existingProviders = await prisma.aiProviderSettings.findMany({
    where: { tenantId: session.tenantId },
  });
  const existingProviderMap = new Map(existingProviders.map((item) => [item.provider, item]));

  const providerUpdates = normalizeProviderUpdates(body);
  const requestedActive = body.activeProvider ?? body.provider ?? existingSettings?.activeProvider ?? "gemini";
  if (!AI_PROVIDER_IDS.includes(requestedActive as AiProviderId)) {
    return NextResponse.json({ error: "Provider không được hỗ trợ" }, { status: 400 });
  }
  const activeProvider = requestedActive as AiProviderId;

  for (const [provider, update] of providerUpdates) {
    await upsertProviderSettings(session.tenantId, provider, update, existingProviderMap.get(provider));
  }

  const promptUpdate = resolvePromptUpdate(body);
  if (promptUpdate === "INVALID_PROMPT") {
    return NextResponse.json(
      { error: "Prompt tạo nội dung listing không được để trống" },
      { status: 400 },
    );
  }

  await prisma.aiSettings.upsert({
    where: { tenantId: session.tenantId },
    create: {
      tenantId: session.tenantId,
      activeProvider,
      ...(promptUpdate !== undefined ? { systemPrompt: promptUpdate } : {}),
    },
    update: {
      activeProvider,
      ...(promptUpdate !== undefined ? { systemPrompt: promptUpdate } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

function normalizeProviderUpdates(body: z.infer<typeof SettingsUpdateSchema>) {
  const updates = new Map<AiProviderId, { model?: string; apiKey?: string }>();

  for (const [provider, update] of Object.entries(body.providers ?? {})) {
    if (!AI_PROVIDER_IDS.includes(provider as AiProviderId)) continue;
    updates.set(provider as AiProviderId, update);
  }

  if (body.provider || body.model || body.apiKey) {
    const provider = normalizeProviderId(body.provider);
    updates.set(provider, {
      ...(updates.get(provider) ?? {}),
      ...(body.model ? { model: body.model } : {}),
      ...(body.apiKey ? { apiKey: body.apiKey } : {}),
    });
  }

  return updates;
}

function resolvePromptUpdate(
  body: z.infer<typeof SettingsUpdateSchema>,
): string | null | undefined | "INVALID_PROMPT" {
  if (body.resetPrompt) return null;
  if (body.systemPrompt === undefined) return undefined;

  const prompt = body.systemPrompt.trim();
  if (prompt.length < 20) return "INVALID_PROMPT";
  return prompt;
}

async function upsertProviderSettings(
  tenantId: string,
  provider: AiProviderId,
  update: { model?: string; apiKey?: string },
  existing?: { model: string; apiKeyEncrypted: Uint8Array | null; configured: boolean } | null,
) {
  const model = normalizeModel(provider, update.model ?? existing?.model);
  const apiKey = update.apiKey?.trim();
  const encrypted = apiKey ? encrypt(apiKey) : null;
  const configured = Boolean(apiKey || existing?.apiKeyEncrypted || process.env[getProviderEnvKey(provider)]);

  await prisma.aiProviderSettings.upsert({
    where: {
      tenantId_provider: {
        tenantId,
        provider,
      },
    },
    create: {
      tenantId,
      provider,
      model,
      configured,
      ...(encrypted
        ? { apiKeyEncrypted: encrypted.encrypted, encryptionKeyId: encrypted.keyId }
        : {}),
    },
    update: {
      model,
      configured,
      ...(encrypted
        ? { apiKeyEncrypted: encrypted.encrypted, encryptionKeyId: encrypted.keyId }
        : {}),
    },
  });
}

function maskEncryptedKey(encrypted: Uint8Array | Buffer | null): string {
  if (!encrypted) return "";
  try {
    const raw = decrypt(encrypted);
    return raw.length > 4 ? `••••${raw.slice(-4)}` : "••••";
  } catch {
    return "(lỗi giải mã)";
  }
}

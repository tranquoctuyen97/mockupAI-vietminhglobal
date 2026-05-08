import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto/envelope";
import {
  createModelLabel,
  getProviderEnvKey,
  getRecommendedModels,
  isSafeTextModel,
  normalizeProviderModelId,
  type AiModelOption,
  type AiProviderId,
} from "./catalog";

export const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type FetchLike = typeof fetch;

export interface ProviderModelList {
  provider: AiProviderId;
  models: AiModelOption[];
  fetchedAt: string | null;
  stale: boolean;
  errorMessage: string | null;
}

export async function getProviderModelList(
  tenantId: string,
  provider: AiProviderId,
  selectedModel?: string | null,
): Promise<ProviderModelList> {
  const cache = await prisma.aiProviderModelCache.findUnique({
    where: {
      tenantId_provider: {
        tenantId,
        provider,
      },
    },
  });

  const discovered = parseCachedModels(provider, cache?.modelsJson);
  return {
    provider,
    models: mergeProviderModels(provider, discovered, selectedModel),
    fetchedAt: cache?.fetchedAt.toISOString() ?? null,
    stale: cache ? Date.now() - cache.fetchedAt.getTime() > MODEL_CACHE_TTL_MS : true,
    errorMessage: cache?.errorMessage ?? null,
  };
}

export async function refreshProviderModelList({
  tenantId,
  provider,
  apiKey,
  selectedModel,
  fetchImpl = fetch,
}: {
  tenantId: string;
  provider: AiProviderId;
  apiKey?: string;
  selectedModel?: string | null;
  fetchImpl?: FetchLike;
}): Promise<ProviderModelList> {
  const resolvedKey = apiKey?.trim() || await resolveProviderApiKey(tenantId, provider);
  if (!resolvedKey) {
    throw new Error("Cần API key để làm mới model");
  }

  const existing = await prisma.aiProviderModelCache.findUnique({
    where: {
      tenantId_provider: {
        tenantId,
        provider,
      },
    },
  });

  try {
    const models = await discoverProviderModels(provider, resolvedKey, fetchImpl);
    const now = new Date();
    await prisma.aiProviderModelCache.upsert({
      where: {
        tenantId_provider: {
          tenantId,
          provider,
        },
      },
      create: {
        tenantId,
        provider,
        modelsJson: toCacheJson(models),
        fetchedAt: now,
        errorMessage: null,
      },
      update: {
        modelsJson: toCacheJson(models),
        fetchedAt: now,
        errorMessage: null,
      },
    });

    return {
      provider,
      models: mergeProviderModels(provider, models, selectedModel),
      fetchedAt: now.toISOString(),
      stale: false,
      errorMessage: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tải được model mới";
    if (existing) {
      await prisma.aiProviderModelCache.update({
        where: {
          tenantId_provider: {
            tenantId,
            provider,
          },
        },
        data: {
          errorMessage: message,
        },
      });
    } else {
      await prisma.aiProviderModelCache.create({
        data: {
          tenantId,
          provider,
          modelsJson: [],
          fetchedAt: new Date(),
          errorMessage: message,
        },
      });
    }
    throw new Error(message);
  }
}

export async function discoverProviderModels(
  provider: AiProviderId,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<AiModelOption[]> {
  switch (provider) {
    case "openai":
      return discoverOpenAiModels(apiKey, fetchImpl);
    case "anthropic":
      return discoverAnthropicModels(apiKey, fetchImpl);
    case "gemini":
      return discoverGeminiModels(apiKey, fetchImpl);
  }
}

export function mergeProviderModels(
  provider: AiProviderId,
  discoveredModels: AiModelOption[] = [],
  selectedModel?: string | null,
): AiModelOption[] {
  const seen = new Set<string>();
  const merged: AiModelOption[] = [];

  for (const model of getRecommendedModels(provider)) {
    const id = normalizeProviderModelId(provider, model.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({ ...model, id, source: "recommended", verified: true });
  }

  for (const model of discoveredModels) {
    const id = normalizeProviderModelId(provider, model.id);
    if (!isSafeTextModel(provider, id) || seen.has(id)) continue;
    seen.add(id);
    merged.push({
      id,
      label: model.label || createModelLabel(id),
      source: "discovered",
      verified: true,
      createdAt: model.createdAt ?? null,
    });
  }

  if (selectedModel) {
    const id = normalizeProviderModelId(provider, selectedModel);
    if (id && !seen.has(id)) {
      merged.push({
        id,
        label: createModelLabel(id),
        source: "saved",
        verified: false,
      });
    }
  }

  return merged;
}

export function filterOpenAiModelIds(ids: string[]): string[] {
  return ids
    .map((id) => normalizeProviderModelId("openai", id))
    .filter((id) => isSafeTextModel("openai", id));
}

export function mapClaudeModel(raw: any): AiModelOption | null {
  const id = typeof raw?.id === "string" ? raw.id : "";
  if (!isSafeTextModel("anthropic", id)) return null;
  return {
    id,
    label: typeof raw?.display_name === "string" ? raw.display_name : createModelLabel(id),
    source: "discovered",
    verified: true,
    createdAt: typeof raw?.created_at === "string" ? raw.created_at : null,
  };
}

export function mapGeminiModel(raw: any): AiModelOption | null {
  const actions = Array.isArray(raw?.supportedActions)
    ? raw.supportedActions
    : Array.isArray(raw?.supported_actions)
      ? raw.supported_actions
      : Array.isArray(raw?.supportedGenerationMethods)
        ? raw.supportedGenerationMethods
      : [];
  if (!actions.includes("generateContent")) return null;

  const rawName = typeof raw?.name === "string" ? raw.name : "";
  const id = normalizeProviderModelId("gemini", rawName);
  if (!isSafeTextModel("gemini", id)) return null;

  return {
    id,
    label: typeof raw?.displayName === "string" ? raw.displayName : createModelLabel(id),
    source: "discovered",
    verified: true,
  };
}

async function discoverOpenAiModels(apiKey: string, fetchImpl: FetchLike): Promise<AiModelOption[]> {
  const response = await fetchImpl("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const data = await response.json().catch(() => null) as any;
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI model list failed (${response.status})`);
  }

  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .filter((model: any) => typeof model?.id === "string")
    .map((model: any) => ({
      id: normalizeProviderModelId("openai", model.id),
      label: createModelLabel(model.id),
      source: "discovered" as const,
      verified: true,
      createdAt: typeof model?.created === "number" ? new Date(model.created * 1000).toISOString() : null,
    }))
    .filter((model: AiModelOption) => isSafeTextModel("openai", model.id))
    .sort(sortByCreatedAtDescThenId);
}

async function discoverAnthropicModels(apiKey: string, fetchImpl: FetchLike): Promise<AiModelOption[]> {
  const models: AiModelOption[] = [];
  let url = "https://api.anthropic.com/v1/models?limit=1000";
  for (let page = 0; page < 5 && url; page += 1) {
    const response = await fetchImpl(url, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    const data = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new Error(data?.error?.message || `Claude model list failed (${response.status})`);
    }

    for (const raw of Array.isArray(data?.data) ? data.data : []) {
      const mapped = mapClaudeModel(raw);
      if (mapped) models.push(mapped);
    }

    url = data?.has_more && typeof data?.last_id === "string"
      ? `https://api.anthropic.com/v1/models?limit=1000&after_id=${encodeURIComponent(data.last_id)}`
      : "";
  }

  return dedupeModels(models).sort(sortByCreatedAtDescThenId);
}

async function discoverGeminiModels(apiKey: string, fetchImpl: FetchLike): Promise<AiModelOption[]> {
  const models: AiModelOption[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ key: apiKey, pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?${params.toString()}`);
    const data = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new Error(data?.error?.message || `Gemini model list failed (${response.status})`);
    }

    for (const raw of Array.isArray(data?.models) ? data.models : []) {
      const mapped = mapGeminiModel(raw);
      if (mapped) models.push(mapped);
    }

    pageToken = typeof data?.nextPageToken === "string" ? data.nextPageToken : "";
    if (!pageToken) break;
  }

  return dedupeModels(models).sort((a, b) => a.id.localeCompare(b.id));
}

async function resolveProviderApiKey(tenantId: string, provider: AiProviderId): Promise<string> {
  const providerSettings = await prisma.aiProviderSettings.findUnique({
    where: {
      tenantId_provider: {
        tenantId,
        provider,
      },
    },
  });

  if (providerSettings?.apiKeyEncrypted) {
    try {
      return decrypt(providerSettings.apiKeyEncrypted);
    } catch {
      return "";
    }
  }

  return process.env[getProviderEnvKey(provider)] || "";
}

function parseCachedModels(provider: AiProviderId, value: unknown): AiModelOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => ({
      id: typeof item?.id === "string" ? normalizeProviderModelId(provider, item.id) : "",
      label: typeof item?.label === "string" ? item.label : "",
      source: "discovered" as const,
      verified: true,
      createdAt: typeof item?.createdAt === "string" ? item.createdAt : null,
    }))
    .filter((item) => isSafeTextModel(provider, item.id));
}

function toCacheJson(models: AiModelOption[]) {
  return models.map((model) => ({
    id: model.id,
    label: model.label,
    source: "discovered",
    verified: true,
    ...(model.createdAt ? { createdAt: model.createdAt } : {}),
  }));
}

function dedupeModels(models: AiModelOption[]): AiModelOption[] {
  const seen = new Set<string>();
  const result: AiModelOption[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    result.push(model);
  }
  return result;
}

function sortByCreatedAtDescThenId(a: AiModelOption, b: AiModelOption): number {
  const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
  const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
  if (aTime !== bTime) return bTime - aTime;
  return a.id.localeCompare(b.id);
}

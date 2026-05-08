export const AI_PROVIDER_IDS = ["gemini", "openai", "anthropic"] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiModelSource = "recommended" | "discovered" | "saved";

export interface AiModelOption {
  id: string;
  label: string;
  source?: AiModelSource;
  verified?: boolean;
  createdAt?: string | null;
}

export interface AiProviderCatalogItem {
  id: AiProviderId;
  label: string;
  shortLabel: string;
  defaultModel: string;
  envKeyName: string;
  models: AiModelOption[];
}

export const AI_PROVIDER_CATALOG: AiProviderCatalogItem[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    shortLabel: "Gemini",
    defaultModel: "gemini-2.5-flash",
    envKeyName: "GEMINI_API_KEY",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    shortLabel: "OpenAI",
    defaultModel: "gpt-5-mini",
    envKeyName: "OPENAI_API_KEY",
    models: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5.2", label: "GPT-5.2" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
      { id: "gpt-5-nano", label: "GPT-5 nano" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
  },
  {
    id: "anthropic",
    label: "Claude",
    shortLabel: "Claude",
    defaultModel: "claude-sonnet-4-20250514",
    envKeyName: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-opus-4-1-20250805", label: "Claude Opus 4.1" },
      { id: "claude-3-5-haiku-20241022", label: "Claude Haiku 3.5" },
    ],
  },
];

export function isAiProviderId(value: string | null | undefined): value is AiProviderId {
  return AI_PROVIDER_IDS.includes(value as AiProviderId);
}

export function getProviderCatalogItem(provider: string | null | undefined): AiProviderCatalogItem {
  if (isAiProviderId(provider)) {
    return AI_PROVIDER_CATALOG.find((item) => item.id === provider)!;
  }
  return AI_PROVIDER_CATALOG[0];
}

export function normalizeProviderId(value: string | null | undefined): AiProviderId {
  return getProviderCatalogItem(value).id;
}

export function normalizeModel(provider: string | null | undefined, model: string | null | undefined): string {
  const catalog = getProviderCatalogItem(provider);
  if (model && isSafeTextModel(catalog.id, model)) return normalizeProviderModelId(catalog.id, model);
  return catalog.defaultModel;
}

export function getProviderEnvKey(provider: AiProviderId): string {
  return getProviderCatalogItem(provider).envKeyName;
}

export function getRecommendedModels(provider: AiProviderId): AiModelOption[] {
  return getProviderCatalogItem(provider).models.map((model) => ({
    ...model,
    source: "recommended" as const,
    verified: true,
  }));
}

export function isRecommendedModel(provider: AiProviderId, model: string): boolean {
  return getProviderCatalogItem(provider).models.some((item) => item.id === model);
}

export function normalizeProviderModelId(provider: AiProviderId, model: string): string {
  const trimmed = model.trim();
  if (provider === "gemini" && trimmed.startsWith("models/")) {
    return trimmed.slice("models/".length);
  }
  return trimmed;
}

export function isSafeTextModel(provider: AiProviderId, model: string | null | undefined): model is string {
  if (!model) return false;
  const normalized = normalizeProviderModelId(provider, model).toLowerCase();
  if (!normalized || normalized.length > 160) return false;

  if (provider === "openai") {
    if (!normalized.startsWith("gpt-")) return false;
    return !/(image|audio|transcribe|tts|embed|embedding|moderation|dall-e|whisper|realtime|search|fine[-_:]?tune|ft:)/.test(normalized);
  }

  if (provider === "anthropic") {
    return normalized.startsWith("claude-");
  }

  if (provider === "gemini") {
    return normalized.startsWith("gemini-");
  }

  return false;
}

export function createModelLabel(modelId: string): string {
  return modelId
    .replace(/^models\//, "")
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      if (part.length <= 3) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

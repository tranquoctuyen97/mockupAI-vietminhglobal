import { resolveAppLocale, type AppLocale } from "@/lib/i18n/copy";

type RuntimeEnvKey =
  | "APP_LOCALE"
  | "NEXT_PUBLIC_APP_LOCALE"
  | "FEATURE_FLAG_DEBUG_UI"
  | "MOCKUP_FALLBACK_FORCE"
  | "NODE_ENV"
  | "PUBLISH_DRY_RUN";

type EnvLike = Partial<Record<RuntimeEnvKey, string | undefined>>;

export const PRODUCT_DEFAULTS = {
  mockup: {
    requireRealPrintifyMockups: true,
  },
  placement: {
    boundaryStrict: true,
  },
  cleanup: {
    retentionEnabled: true,
    printifyOrphanCleanupEnabled: true,
  },
} as const;

export function isPublishDryRun(env: EnvLike = process.env): boolean {
  return parseBooleanEnv(env.PUBLISH_DRY_RUN);
}

export function isMockupFallbackForcedForDev(env: EnvLike = process.env): boolean {
  return env.NODE_ENV !== "production" && parseBooleanEnv(env.MOCKUP_FALLBACK_FORCE);
}

export function isInternalControlsDebugEnabled(env: EnvLike = process.env): boolean {
  return env.NODE_ENV !== "production" && parseBooleanEnv(env.FEATURE_FLAG_DEBUG_UI);
}

export function getAppLocale(env: EnvLike = process.env): AppLocale {
  return resolveAppLocale(env.APP_LOCALE ?? env.NEXT_PUBLIC_APP_LOCALE);
}

export function parseBooleanEnv(value: string | null | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

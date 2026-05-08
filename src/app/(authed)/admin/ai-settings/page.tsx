"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { copy, resolveAppLocale } from "@/lib/i18n/copy";

type ProviderId = "gemini" | "openai" | "anthropic";

interface ModelOption {
  id: string;
  label: string;
  source?: "recommended" | "discovered" | "saved";
  verified?: boolean;
  createdAt?: string | null;
}

interface ProviderState {
  id: ProviderId;
  label: string;
  shortLabel: string;
  model: string;
  models: ModelOption[];
  modelsFetchedAt: string | null;
  modelsStale: boolean;
  modelsError: string | null;
  defaultModel: string;
  configured: boolean;
  keySource: "db" | "env" | "none";
  apiKeyMasked: string;
  active: boolean;
}

interface ProviderDraft {
  model: string;
  apiKey: string;
  showKey: boolean;
  testing: boolean;
  testOk: boolean | null;
  testMessage: string;
}

interface UsageBucket {
  requests: number;
  generated: number;
  cacheHits: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
}

interface UsageDay extends UsageBucket {
  date: string;
}

interface UsageProvider extends UsageBucket {
  provider: string;
}

interface UsageModel extends UsageBucket {
  provider: string;
  model: string;
}

interface UsageSummary {
  today: UsageBucket;
  sevenDays: UsageDay[];
  byProvider: UsageProvider[];
  byModel: UsageModel[];
}

interface SettingsResponse {
  settings: {
    activeProvider: ProviderId;
    systemPrompt: string;
    defaultPrompt: string;
    hasCustomPrompt: boolean;
  };
  providers: ProviderState[];
  usage: UsageSummary;
}

interface ModelListResponse {
  provider: ProviderId;
  models: ModelOption[];
  fetchedAt: string | null;
  stale: boolean;
  errorMessage: string | null;
}

const emptyUsage: UsageBucket = {
  requests: 0,
  generated: 0,
  cacheHits: 0,
  failed: 0,
  tokensIn: 0,
  tokensOut: 0,
};

export default function AiSettingsPage() {
  const locale = resolveAppLocale(process.env.NEXT_PUBLIC_APP_LOCALE);
  const t = copy[locale].aiSettings;
  const numberLocale = locale === "vi" ? "vi-VN" : "en-US";

  const [providers, setProviders] = useState<ProviderState[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [activeProvider, setActiveProvider] = useState<ProviderId>("gemini");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [savedSystemPrompt, setSavedSystemPrompt] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [hasCustomPrompt, setHasCustomPrompt] = useState(false);
  const [resetPrompt, setResetPrompt] = useState(false);
  const [switchingProvider, setSwitchingProvider] = useState<ProviderId | null>(null);
  const [refreshingModels, setRefreshingModels] = useState<ProviderId | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSettings() {
    setError("");
    try {
      const res = await fetch("/api/admin/ai-settings");
      const data = (await res.json()) as SettingsResponse | { error?: string };
      if (!res.ok) throw new Error("error" in data ? data.error : t.loadError);

      const payload = data as SettingsResponse;
      setProviders(payload.providers);
      setActiveProvider(payload.settings.activeProvider);
      setSystemPrompt(payload.settings.systemPrompt);
      setSavedSystemPrompt(payload.settings.systemPrompt);
      setDefaultPrompt(payload.settings.defaultPrompt);
      setHasCustomPrompt(payload.settings.hasCustomPrompt);
      setUsage(payload.usage);
      setResetPrompt(false);
      setDrafts(() => {
        const next: Record<string, ProviderDraft> = {};
        for (const provider of payload.providers) {
          next[provider.id] = {
            model: provider.model,
            apiKey: "",
            showKey: false,
            testing: false,
            testOk: null,
            testMessage: "",
          };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!isDirty) return;

    setSaving(true);
    setSaved(false);
    setError("");

    const providerPayload = Object.fromEntries(
      providers.map((provider) => {
        const draft = drafts[provider.id];
        return [
          provider.id,
          {
            model: draft?.model ?? provider.model,
            ...(draft?.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
          },
        ];
      }),
    );

    try {
      const res = await fetch("/api/admin/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeProvider,
          providers: providerPayload,
          ...(resetPrompt ? { resetPrompt: true } : { systemPrompt }),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t.saveError);

      setSaved(true);
      toast.success(t.saveSuccess);
      await loadSettings();
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(provider: ProviderState) {
    const draft = drafts[provider.id];
    const hasTypedKey = Boolean(draft?.apiKey.trim());
    const canTest = provider.configured || hasTypedKey;
    if (!canTest) {
      toast.error(t.providerNeedsKey);
      return;
    }

    updateDraft(provider.id, { testing: true, testOk: null, testMessage: "" });

    try {
      const res = await fetch("/api/admin/ai-settings/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          model: draft?.model ?? provider.model,
          ...(draft?.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || "Provider test failed");

      updateDraft(provider.id, {
        testing: false,
        testOk: true,
        testMessage: `OK · ${formatNumber((data?.tokensIn ?? 0) + (data?.tokensOut ?? 0), numberLocale)} tokens`,
      });
    } catch (err) {
      updateDraft(provider.id, {
        testing: false,
        testOk: false,
        testMessage: err instanceof Error ? err.message : "Provider test failed",
      });
    }
  }

  async function handleRefreshModels(provider: ProviderState) {
    const draft = drafts[provider.id];
    const hasTypedKey = Boolean(draft?.apiKey.trim());
    const canRefresh = provider.configured || hasTypedKey;
    if (!canRefresh) {
      toast.error(t.modelRefreshNeedsKey);
      return;
    }

    setRefreshingModels(provider.id);
    try {
      const res = await fetch("/api/admin/ai-settings/models/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          model: draft?.model ?? provider.model,
          ...(draft?.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as ModelListResponse | { error?: string } | null;
      if (!res.ok) {
        throw new Error((data && "error" in data ? data.error : "") || t.modelRefreshFailed);
      }

      applyModelList(provider.id, data as ModelListResponse);
      toast.success(t.modelRefreshSuccess);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.modelRefreshFailed);
      await loadCachedModels(provider.id);
    } finally {
      setRefreshingModels(null);
    }
  }

  async function loadCachedModels(providerId: ProviderId) {
    try {
      const res = await fetch(`/api/admin/ai-settings/models?provider=${providerId}`);
      const data = (await res.json().catch(() => null)) as ModelListResponse | null;
      if (res.ok && data) applyModelList(providerId, data);
    } catch {
      // Keep current in-memory model list; this is a non-blocking refresh helper.
    }
  }

  function applyModelList(providerId: ProviderId, payload: ModelListResponse) {
    setProviders((current) =>
      current.map((provider) => {
        if (provider.id !== providerId) return provider;
        return {
          ...provider,
          models: payload.models,
          modelsFetchedAt: payload.fetchedAt,
          modelsStale: payload.stale,
          modelsError: payload.errorMessage,
        };
      }),
    );

    setDrafts((current) => {
      const draft = current[providerId] ?? createEmptyProviderDraft();
      return {
        ...current,
        [providerId]: {
          ...draft,
          model: draft.model || payload.models[0]?.id || "",
        },
      };
    });
  }

  async function handleSwitchProvider(provider: ProviderState) {
    const draft = drafts[provider.id];
    const hasTypedKey = Boolean(draft?.apiKey.trim());
    const canSwitch = provider.configured || hasTypedKey;
    if (!canSwitch) {
      toast.error(t.providerNeedsKey);
      return;
    }

    const hadPromptDraft = promptDirty;
    const promptDraft = systemPrompt;
    const resetPromptDraft = resetPrompt;
    const hasCustomPromptDraft = hasCustomPrompt;
    const savedPromptBeforeSwitch = savedSystemPrompt;

    setSwitchingProvider(provider.id);
    setError("");

    try {
      const res = await fetch("/api/admin/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeProvider: provider.id,
          providers: {
            [provider.id]: {
              model: draft?.model ?? provider.model,
              ...(draft?.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
            },
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t.saveError);

      toast.success(`${t.switchSuccess} ${provider.label}`);
      await loadSettings();
      if (hadPromptDraft) {
        setSystemPrompt(promptDraft);
        setResetPrompt(resetPromptDraft);
        setHasCustomPrompt(hasCustomPromptDraft);
        setSavedSystemPrompt(savedPromptBeforeSwitch);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.saveError);
    } finally {
      setSwitchingProvider(null);
    }
  }

  function updateDraft(providerId: ProviderId, patch: Partial<ProviderDraft>) {
    setDrafts((current) => ({
      ...current,
      [providerId]: {
        ...(current[providerId] ?? createEmptyProviderDraft()),
        ...patch,
      },
    }));
  }

  function restoreDefaultPrompt() {
    if (systemPrompt.trim() === defaultPrompt.trim()) return;
    if (!window.confirm(t.resetConfirm)) return;
    setSystemPrompt(defaultPrompt);
    setHasCustomPrompt(false);
    setResetPrompt(true);
  }

  const configuredCount = useMemo(
    () => providers.filter((provider) => provider.configured).length,
    [providers],
  );
  const providerDirty = useMemo(
    () =>
      providers.some((provider) => {
        const draft = drafts[provider.id];
        return Boolean(draft?.apiKey.trim()) || Boolean(draft?.model && draft.model !== provider.model);
      }),
    [drafts, providers],
  );
  const promptDirty = resetPrompt || systemPrompt !== savedSystemPrompt;
  const isDirty = providerDirty || promptDirty;
  const today = usage?.today ?? emptyUsage;
  const totalRequests7Days = (usage?.sevenDays ?? []).reduce((sum, day) => sum + day.requests, 0);
  const maxDailyRequests = Math.max(1, ...(usage?.sevenDays ?? []).map((day) => day.requests));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1560, margin: "0 auto" }}>
      <div className="flex items-center justify-between" style={{ gap: 16, alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4, fontSize: "1.75rem", lineHeight: 1.15 }}>{t.title}</h1>
          <p className="page-subtitle" style={{ margin: 0, fontSize: "1rem", lineHeight: 1.45 }}>{t.subtitle}</p>
        </div>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving || loading || !isDirty}
          title={!isDirty ? "Chưa có thay đổi" : t.save}
          style={{ fontSize: "1rem", padding: "0.7rem 1.35rem" }}
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : saved ? <Check size={18} /> : <Save size={18} />}
          {saved ? t.saved : t.save}
        </button>
      </div>

      {error && (
        <div style={alertStyle}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center" style={{ padding: 80, opacity: 0.55 }}>
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 620px), 1fr))", gap: 20, alignItems: "start" }}>
            <section className="card" style={{ padding: 22, borderRadius: 22 }}>
              <SectionHeader icon={<Bot size={21} />} title={t.providerSection} />

              {configuredCount === 0 && (
                <div style={{ ...alertStyle, marginBottom: 16, borderColor: "rgba(214,128,0,0.25)", background: "rgba(214,128,0,0.07)", color: "#8a4b00" }}>
                  <AlertCircle size={18} />
                  <span>{t.emptyProvider}</span>
                </div>
              )}

              <div style={{ display: "grid", gap: 10 }}>
                {providers.map((provider) => {
                  const draft = drafts[provider.id];
                  const hasTypedKey = Boolean(draft?.apiKey.trim());
                  const usableForSwitch = provider.configured || hasTypedKey;
                  const canTest = provider.configured || hasTypedKey;
                  const isActive = activeProvider === provider.id;
                  const providerStatus = isActive ? "active" : usableForSwitch ? "ready" : "missing";
                  const keyLabel = provider.keySource === "env"
                    ? t.envKey
                    : hasTypedKey
                      ? t.pendingKey
                      : provider.configured
                      ? `${t.configured}${provider.apiKeyMasked ? ` · ${provider.apiKeyMasked}` : ""}`
                      : t.missingKey;
                  const keyPlaceholder = getApiKeyPlaceholder(provider, hasTypedKey, t);
                  const selectedModel = provider.models.find((model) => model.id === (draft?.model ?? provider.model));
                  const canRefreshModels = provider.configured || hasTypedKey;
                  const isRefreshingModels = refreshingModels === provider.id;

                  return (
                    <div
                      key={provider.id}
                      style={{
                        border: `1px solid ${isActive ? "rgba(117, 220, 76, 0.8)" : "var(--border-default)"}`,
                        borderRadius: 16,
                        padding: 14,
                        background: isActive ? "rgba(159,232,112,0.08)" : "var(--bg-surface)",
                        display: "grid",
                        gridTemplateColumns: "minmax(130px, 0.7fr) minmax(280px, 1.35fr) minmax(150px, auto)",
                        gap: 14,
                        alignItems: "center",
                      }}
                    >
                      <div className="flex items-start justify-between" style={{ gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: "1rem", lineHeight: 1.25 }}>{provider.label}</div>
                          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4, lineHeight: 1.3 }}>{keyLabel}</div>
                        </div>
                        <ProviderStatusBadge status={providerStatus} labels={t} />
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "minmax(190px, 0.95fr) minmax(220px, 1.05fr)", gap: 10, alignItems: "end" }}>
                        <div style={labelStyle}>
                          <div className="flex items-center justify-between" style={{ gap: 8 }}>
                            <span>{t.model}</span>
                            <button
                              type="button"
                              onClick={() => handleRefreshModels(provider)}
                              disabled={isRefreshingModels || !canRefreshModels}
                              title={!canRefreshModels ? t.modelRefreshNeedsKey : t.refreshModels}
                              style={{
                                ...miniLinkButtonStyle,
                                opacity: canRefreshModels ? 1 : 0.45,
                                cursor: canRefreshModels ? "pointer" : "not-allowed",
                              }}
                            >
                              {isRefreshingModels ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                              {isRefreshingModels ? t.refreshingModels : t.refreshModels}
                            </button>
                          </div>
                          <select
                            className="input"
                            value={draft?.model ?? provider.model}
                            onChange={(event) => updateDraft(provider.id, { model: event.target.value })}
                            style={{ marginTop: 6, height: 46, fontSize: "0.95rem" }}
                          >
                            <ModelOptions models={provider.models} labels={t} />
                          </select>
                          {selectedModel?.verified === false && (
                            <div style={modelHintStyle}>
                              <AlertCircle size={13} />
                              {t.modelUnverified}
                            </div>
                          )}
                          {provider.modelsError && (
                            <div style={{ ...modelHintStyle, color: "#8a4b00" }}>
                              <AlertCircle size={13} />
                              {t.modelListFallback}
                            </div>
                          )}
                        </div>

                        <label style={labelStyle}>
                          {t.apiKey}
                          <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
                            <input
                              className="input"
                              type={draft?.showKey ? "text" : "password"}
                              value={draft?.apiKey ?? ""}
                              onChange={(event) => updateDraft(provider.id, { apiKey: event.target.value, testOk: null, testMessage: "" })}
                              placeholder={keyPlaceholder}
                              style={{ height: 46, fontSize: "0.95rem" }}
                            />
                            {hasTypedKey && (
                              <button
                                type="button"
                                onClick={() => updateDraft(provider.id, { showKey: !draft?.showKey })}
                                style={{ ...iconButtonStyle, width: 46, height: 46, padding: 0, justifyContent: "center", alignItems: "center" }}
                                aria-label={draft?.showKey ? "Ẩn key" : "Hiện key"}
                              >
                                {draft?.showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                              </button>
                            )}
                          </div>
                        </label>
                        {!hasTypedKey && provider.configured && provider.keySource !== "none" && (
                          <div style={{ ...modelHintStyle, gridColumn: "2 / 3" }}>
                            <CheckCircle2 size={13} />
                            {provider.keySource === "env"
                              ? t.envKeyPlaceholder
                              : `${t.savedKeyPlaceholder}${provider.apiKeyMasked ? ` · ${provider.apiKeyMasked}` : ""}`}
                          </div>
                        )}
                      </div>

                      {draft?.testMessage && (
                        <div style={{ gridColumn: "2 / 3", fontSize: "0.78rem", fontWeight: 700, color: draft.testOk ? "var(--color-wise-dark-green)" : "var(--color-danger)" }}>
                          {draft.testMessage}
                        </div>
                      )}

                      <div className="flex gap-2" style={{ justifyContent: "flex-end", flexDirection: "column", alignItems: "stretch" }}>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => handleTest(provider)}
                          disabled={draft?.testing || !canTest}
                          title={!canTest ? t.providerNeedsKey : t.test}
                          style={{ ...actionButtonStyle, opacity: draft?.testing || canTest ? 1 : 0.45, cursor: canTest ? "pointer" : "not-allowed" }}
                        >
                          {draft?.testing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                          {draft?.testing ? t.testing : t.test}
                        </button>
                        {isActive ? (
                          <div style={activeProviderActionStyle}>
                            <CheckCircle2 size={15} />
                            {t.active}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => handleSwitchProvider(provider)}
                            disabled={!usableForSwitch || switchingProvider === provider.id}
                            title={!usableForSwitch ? t.providerNeedsKey : t.useProvider}
                            style={{ ...actionButtonStyle, opacity: usableForSwitch ? 1 : 0.45, cursor: usableForSwitch ? "pointer" : "not-allowed" }}
                          >
                            {switchingProvider === provider.id ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />}
                            {t.useProvider}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="card" style={{ padding: 22, borderRadius: 22 }}>
              <SectionHeader icon={<Activity size={21} />} title={t.usageSection} />
              {totalRequests7Days === 0 ? (
                <EmptyUsageState labels={t} />
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 18 }}>
                    <Metric label={t.requestsToday} value={today.requests} locale={numberLocale} />
                    <Metric label={t.generated} value={today.generated} locale={numberLocale} />
                    <Metric label={t.cacheHits} value={today.cacheHits} locale={numberLocale} />
                    <Metric label={t.failed} value={today.failed} locale={numberLocale} />
                    <Metric label={t.inputTokens} value={today.tokensIn} locale={numberLocale} />
                    <Metric label={t.outputTokens} value={today.tokensOut} locale={numberLocale} />
                  </div>

                  <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 18 }}>
                    <div style={{ fontWeight: 800, marginBottom: 12 }}>{t.last7Days}</div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {(usage?.sevenDays ?? []).map((day) => (
                        <div key={day.date} style={{ display: "grid", gridTemplateColumns: "54px 1fr 40px", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{day.date.slice(5)}</span>
                          <div style={{ height: 8, borderRadius: 99, background: "var(--bg-tertiary)", overflow: "hidden" }}>
                            <div style={{ width: day.requests > 0 ? `${(day.requests / maxDailyRequests) * 100}%` : 0, height: "100%", borderRadius: 99, background: "var(--color-wise-green)" }} />
                          </div>
                          <span style={{ fontSize: "0.78rem", fontWeight: 700, textAlign: "right" }}>{formatNumber(day.requests, numberLocale)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Breakdown title={t.providerBreakdown} rows={usage?.byProvider ?? []} locale={numberLocale} />
                  <Breakdown title={t.modelBreakdown} rows={usage?.byModel ?? []} locale={numberLocale} />
                </>
              )}
            </section>
          </div>

          <section className="card" style={{ padding: 22, borderRadius: 22 }}>
            <div className="flex items-start justify-between" style={{ gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
              <div>
                <SectionHeader icon={<Bot size={21} />} title={t.promptSection} />
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "6px 0 0" }}>{t.promptHelp}</p>
              </div>
              <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                <span style={promptBadgeStyle}>{hasCustomPrompt && !resetPrompt ? t.customPrompt : t.defaultPrompt}</span>
                <button type="button" className="btn-secondary btn-sm" onClick={restoreDefaultPrompt}>
                  <RotateCcw size={15} />
                  {t.restoreDefault}
                </button>
              </div>
            </div>

            <textarea
              className="input"
              value={systemPrompt}
              onChange={(event) => {
                setSystemPrompt(event.target.value);
                setResetPrompt(false);
                setHasCustomPrompt(event.target.value.trim() !== defaultPrompt.trim());
              }}
              rows={16}
              style={{
                width: "100%",
                minHeight: 320,
                resize: "vertical",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: "0.84rem",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}
            />
          </section>
        </>
      )}
    </div>
  );
}

function createEmptyProviderDraft(): ProviderDraft {
  return {
    model: "",
    apiKey: "",
    showKey: false,
    testing: false,
    testOk: null,
    testMessage: "",
  };
}

function getApiKeyPlaceholder(
  provider: ProviderState,
  hasTypedKey: boolean,
  labels: {
    apiKeyPlaceholder: string;
    savedKeyPlaceholder: string;
    envKeyPlaceholder: string;
  },
): string {
  if (hasTypedKey) return labels.apiKeyPlaceholder;
  if (provider.keySource === "env") return labels.envKeyPlaceholder;
  if (provider.apiKeyMasked) return `${labels.savedKeyPlaceholder} ${provider.apiKeyMasked}`;
  return labels.apiKeyPlaceholder;
}

function SectionHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2" style={{ marginBottom: 18 }}>
      <span style={{ opacity: 0.55, display: "flex" }}>{icon}</span>
      <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>{title}</h2>
    </div>
  );
}

function ProviderStatusBadge({
  status,
  labels,
}: {
  status: "active" | "ready" | "missing";
  labels: {
    active: string;
    ready: string;
    needsApiKey: string;
  };
}) {
  const isActive = status === "active";
  const isReady = status === "ready";
  const label = isActive ? labels.active : isReady ? labels.ready : labels.needsApiKey;
  const background = isActive
    ? "rgba(159,232,112,0.22)"
    : isReady
      ? "rgba(17,24,39,0.06)"
      : "rgba(214,128,0,0.12)";
  const color = isActive
    ? "var(--color-wise-dark-green)"
    : isReady
      ? "var(--text-primary)"
      : "#8a4b00";
  const Icon = isActive || isReady ? CheckCircle2 : AlertCircle;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 9px", borderRadius: 999, background, color, fontSize: "0.72rem", fontWeight: 900, whiteSpace: "nowrap" }}>
      <Icon size={13} />
      {label}
    </span>
  );
}

function ModelOptions({
  models,
  labels,
}: {
  models: ModelOption[];
  labels: {
    recommendedModels: string;
    discoveredModels: string;
    savedModels: string;
    modelUnverified: string;
  };
}) {
  const recommended = models.filter((model) => model.source === "recommended" || !model.source);
  const discovered = models.filter((model) => model.source === "discovered");
  const saved = models.filter((model) => model.source === "saved");

  return (
    <>
      {recommended.length > 0 && (
        <optgroup label={labels.recommendedModels}>
          {recommended.map((model) => (
            <option key={model.id} value={model.id}>{model.label}</option>
          ))}
        </optgroup>
      )}
      {discovered.length > 0 && (
        <optgroup label={labels.discoveredModels}>
          {discovered.map((model) => (
            <option key={model.id} value={model.id}>{model.label}</option>
          ))}
        </optgroup>
      )}
      {saved.length > 0 && (
        <optgroup label={labels.savedModels}>
          {saved.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · {labels.modelUnverified}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

function Metric({ label, value, locale }: { label: string; value: number; locale: string }) {
  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: 16, padding: "14px 16px", minHeight: 82 }}>
      <div style={{ fontSize: "0.76rem", color: "var(--text-muted)", fontWeight: 700, marginBottom: 7 }}>{label}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 900 }}>{formatNumber(value, locale)}</div>
    </div>
  );
}

function EmptyUsageState({
  labels,
}: {
  labels: {
    noAiActivityTitle: string;
    noAiActivityDescription: string;
    createListing: string;
  };
}) {
  return (
    <div style={{ minHeight: 360, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed var(--border-default)", borderRadius: 18, background: "rgba(17,24,39,0.02)" }}>
      <div style={{ textAlign: "center", maxWidth: 330, padding: 24 }}>
        <div style={{ width: 52, height: 52, borderRadius: 18, background: "rgba(159,232,112,0.18)", color: "var(--color-wise-dark-green)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
          <Activity size={24} />
        </div>
        <div style={{ fontWeight: 900, fontSize: "1.05rem", marginBottom: 6 }}>{labels.noAiActivityTitle}</div>
        <p style={{ margin: "0 0 16px", color: "var(--text-muted)", lineHeight: 1.45 }}>{labels.noAiActivityDescription}</p>
        <a href="/wizard" className="btn-secondary btn-sm" style={{ display: "inline-flex", textDecoration: "none" }}>
          {labels.createListing}
        </a>
      </div>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  locale,
}: {
  title: string;
  rows: Array<{ provider: string; model?: string; requests: number; tokensIn: number; tokensOut: number }>;
  locale: string;
}) {
  if (rows.length === 0) return null;

  return (
    <div style={{ borderTop: "1px solid var(--border-default)", marginTop: 18, paddingTop: 18 }}>
      <div style={{ fontWeight: 800, marginBottom: 10 }}>{title}</div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((row) => (
          <div
            key={`${row.provider}:${row.model ?? "all"}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 12,
              alignItems: "center",
              fontSize: "0.82rem",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.model ? `${row.provider} · ${row.model}` : row.provider}
            </span>
            <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>
              {formatNumber(row.requests, locale)} req · {formatNumber(row.tokensIn + row.tokensOut, locale)} tok
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatNumber(value: number, locale: string): string {
  return value.toLocaleString(locale);
}

const labelStyle: CSSProperties = {
  display: "block",
  fontWeight: 700,
  fontSize: "0.82rem",
};

const iconButtonStyle: CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: 10,
  padding: 12,
  cursor: "pointer",
  display: "flex",
  color: "inherit",
};

const actionButtonStyle: CSSProperties = {
  minHeight: 42,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const activeProviderActionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 42,
  padding: "0.375rem 0.75rem",
  borderRadius: "var(--radius-pill)",
  background: "rgba(159,232,112,0.22)",
  color: "var(--color-wise-dark-green)",
  fontSize: "0.8125rem",
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const miniLinkButtonStyle: CSSProperties = {
  border: 0,
  background: "transparent",
  color: "var(--text-muted)",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: 0,
  fontSize: "0.72rem",
  fontWeight: 800,
};

const modelHintStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  marginTop: 6,
  color: "var(--text-muted)",
  fontSize: "0.72rem",
  fontWeight: 800,
};

const alertStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  border: "1px solid rgba(208,50,56,0.22)",
  background: "rgba(208,50,56,0.06)",
  color: "var(--color-danger)",
  borderRadius: 16,
  padding: "12px 14px",
  fontWeight: 700,
  fontSize: "0.9rem",
};

const promptBadgeStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 999,
  background: "rgba(159,232,112,0.16)",
  color: "var(--color-wise-dark-green)",
  fontSize: "0.78rem",
  fontWeight: 800,
  whiteSpace: "nowrap",
};

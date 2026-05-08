export const SUPPORTED_LOCALES = ["vi", "en"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "vi";

export function resolveAppLocale(value: string | null | undefined): AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale)
    ? (value as AppLocale)
    : DEFAULT_LOCALE;
}

export const copy = {
  vi: {
    nav: {
      internalControls: "Điều khiển nội bộ",
    },
    controls: {
      title: "Điều khiển nội bộ",
      description: "Chỉ dùng cho debug nội bộ. Seller/admin vận hành hằng ngày không cần màn này.",
      dryRun: "Chế độ test publish",
      dryRunWarning: "Đang bật test mode, sản phẩm sẽ không publish thật.",
      noFlags: "Không có control nội bộ nào.",
      hidden: "Màn này đang bị ẩn trong cấu hình hiện tại.",
    },
    aiSettings: {
      title: "Cài đặt AI Content",
      subtitle: "Cấu hình provider và prompt tạo nội dung listing.",
      providerSection: "Provider AI",
      usageSection: "Sử dụng AI",
      promptSection: "Prompt tạo nội dung listing",
      save: "Lưu",
      saved: "Đã lưu",
      active: "Đang dùng",
      configured: "Đã cấu hình",
      envKey: "Dùng key từ ENV",
      missingKey: "Chưa có key",
      pendingKey: "Key mới, chưa lưu",
      ready: "Sẵn sàng",
      needsApiKey: "Cần API key",
      useProvider: "Chuyển sang",
      test: "Kiểm tra",
      testing: "Đang kiểm tra",
      model: "Model",
      recommendedModels: "Recommended",
      discoveredModels: "Discovered",
      savedModels: "Đã lưu",
      refreshModels: "Làm mới model",
      refreshingModels: "Đang làm mới",
      modelUnverified: "Chưa xác minh",
      modelRefreshNeedsKey: "Cần API key để làm mới model.",
      modelRefreshSuccess: "Đã cập nhật danh sách model.",
      modelRefreshFailed: "Không tải được model mới, đang dùng danh sách mặc định.",
      modelListFallback: "Không tải được model mới, đang dùng danh sách mặc định.",
      apiKey: "API Key",
      apiKeyPlaceholder: "Paste API key tại đây",
      savedKeyPlaceholder: "Đã lưu key",
      envKeyPlaceholder: "Đang dùng key từ ENV",
      encryptedHelp: "Key được mã hóa AES-256-GCM trước khi lưu vào DB.",
      promptHelp: "Prompt này áp dụng cho toàn bộ nội dung listing AI của tenant hiện tại.",
      restoreDefault: "Khôi phục prompt mặc định",
      resetConfirm: "Khôi phục prompt mặc định? Nội dung prompt đang chỉnh sẽ bị thay thế.",
      customPrompt: "Đang dùng prompt tùy chỉnh",
      defaultPrompt: "Đang dùng prompt mặc định",
      requestsToday: "Requests hôm nay",
      generated: "Generated",
      cacheHits: "Cache hits",
      failed: "Lỗi",
      inputTokens: "Input tokens",
      outputTokens: "Output tokens",
      last7Days: "7 ngày gần đây",
      providerBreakdown: "Theo provider",
      modelBreakdown: "Theo model",
      emptyProvider: "Cấu hình ít nhất một provider để tạo nội dung AI.",
      noUsage: "Chưa có dữ liệu sử dụng.",
      noAiActivityTitle: "Chưa có hoạt động AI",
      noAiActivityDescription: "Stats sẽ xuất hiện sau khi tạo nội dung listing đầu tiên.",
      createListing: "Tạo listing",
      providerNeedsKey: "Cần nhập API key trước khi kiểm tra hoặc chuyển provider.",
      saveSuccess: "Đã lưu cài đặt AI.",
      switchSuccess: "Đã chuyển provider.",
      loadError: "Không tải được cấu hình AI.",
      saveError: "Không lưu được cấu hình AI.",
    },
  },
  en: {
    nav: {
      internalControls: "Internal Controls",
    },
    controls: {
      title: "Internal Controls",
      description: "For internal debugging only. Day-to-day seller/admin operations do not need this screen.",
      dryRun: "Publish test mode",
      dryRunWarning: "Test mode is enabled. Products will not be published for real.",
      noFlags: "No internal controls available.",
      hidden: "This screen is hidden in the current configuration.",
    },
    aiSettings: {
      title: "AI Content Settings",
      subtitle: "Configure the provider and listing content prompt.",
      providerSection: "AI Providers",
      usageSection: "AI Usage",
      promptSection: "Listing content prompt",
      save: "Save",
      saved: "Saved",
      active: "Active",
      configured: "Configured",
      envKey: "Using ENV key",
      missingKey: "Missing key",
      pendingKey: "New key, not saved yet",
      ready: "Ready",
      needsApiKey: "Needs API key",
      useProvider: "Switch to",
      test: "Test",
      testing: "Testing",
      model: "Model",
      recommendedModels: "Recommended",
      discoveredModels: "Discovered",
      savedModels: "Saved",
      refreshModels: "Refresh models",
      refreshingModels: "Refreshing",
      modelUnverified: "Unverified",
      modelRefreshNeedsKey: "API key is required to refresh models.",
      modelRefreshSuccess: "Model list updated.",
      modelRefreshFailed: "Could not load new models. Using the default list.",
      modelListFallback: "Could not load new models. Using the default list.",
      apiKey: "API Key",
      apiKeyPlaceholder: "Paste API key here",
      savedKeyPlaceholder: "Saved key",
      envKeyPlaceholder: "Using ENV key",
      encryptedHelp: "Keys are encrypted with AES-256-GCM before being stored.",
      promptHelp: "This prompt applies to all AI listing content for the current tenant.",
      restoreDefault: "Restore default prompt",
      resetConfirm: "Restore the default prompt? Your current edits will be replaced.",
      customPrompt: "Using custom prompt",
      defaultPrompt: "Using default prompt",
      requestsToday: "Requests today",
      generated: "Generated",
      cacheHits: "Cache hits",
      failed: "Failed",
      inputTokens: "Input tokens",
      outputTokens: "Output tokens",
      last7Days: "Last 7 days",
      providerBreakdown: "By provider",
      modelBreakdown: "By model",
      emptyProvider: "Configure at least one provider to generate AI content.",
      noUsage: "No usage data yet.",
      noAiActivityTitle: "No AI activity yet",
      noAiActivityDescription: "Stats will appear after the first listing content generation.",
      createListing: "Create listing",
      providerNeedsKey: "Enter an API key before testing or switching provider.",
      saveSuccess: "AI settings saved.",
      switchSuccess: "Provider switched.",
      loadError: "Unable to load AI settings.",
      saveError: "Unable to save AI settings.",
    },
  },
} satisfies Record<
  AppLocale,
  {
    nav: {
      internalControls: string;
    };
    controls: {
      title: string;
      description: string;
      dryRun: string;
      dryRunWarning: string;
      noFlags: string;
      hidden: string;
    };
    aiSettings: {
      title: string;
      subtitle: string;
      providerSection: string;
      usageSection: string;
      promptSection: string;
      save: string;
      saved: string;
      active: string;
      configured: string;
      envKey: string;
      missingKey: string;
      pendingKey: string;
      ready: string;
      needsApiKey: string;
      useProvider: string;
      test: string;
      testing: string;
      model: string;
      recommendedModels: string;
      discoveredModels: string;
      savedModels: string;
      refreshModels: string;
      refreshingModels: string;
      modelUnverified: string;
      modelRefreshNeedsKey: string;
      modelRefreshSuccess: string;
      modelRefreshFailed: string;
      modelListFallback: string;
      apiKey: string;
      apiKeyPlaceholder: string;
      savedKeyPlaceholder: string;
      envKeyPlaceholder: string;
      encryptedHelp: string;
      promptHelp: string;
      restoreDefault: string;
      resetConfirm: string;
      customPrompt: string;
      defaultPrompt: string;
      requestsToday: string;
      generated: string;
      cacheHits: string;
      failed: string;
      inputTokens: string;
      outputTokens: string;
      last7Days: string;
      providerBreakdown: string;
      modelBreakdown: string;
      emptyProvider: string;
      noUsage: string;
      noAiActivityTitle: string;
      noAiActivityDescription: string;
      createListing: string;
      providerNeedsKey: string;
      saveSuccess: string;
      switchSuccess: string;
      loadError: string;
      saveError: string;
    };
  }
>;

export type ControlsCopy = (typeof copy)[AppLocale]["controls"];
export type AiSettingsCopy = (typeof copy)[AppLocale]["aiSettings"];

export function getCopy(locale: AppLocale) {
  return copy[locale];
}

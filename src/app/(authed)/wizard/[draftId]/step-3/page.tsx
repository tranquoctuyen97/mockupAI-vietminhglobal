"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { resolveColorGroups, type EffectiveColorGroup } from "@/lib/designs/color-classifier";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import { useAuthedUser } from "@/lib/auth/user-context";

import { isTerminalMockupJobStatus } from "@/lib/mockup/job-sync";
import { MOCKUP_JOB_SOFT_WAIT_MS } from "@/lib/mockup/job-timeout";
import { shouldShowInOfficialGallery } from "@/lib/mockup/official-gallery";
import {
  getActiveDraftDesignId,
  getLatestJobByDraftDesignId,
  hasActiveOrCompletedJobsForAllDesigns,
} from "@/lib/mockup/multi-design";
import { MockupGallery } from "@/components/mockup/MockupGallery";
import { WizardMockupSourcePanel } from "@/components/mockup/WizardMockupSourcePanel";
import { ColorMockupCardGrid } from "@/components/mockup/ColorMockupCardGrid";
import { LivePreview } from "@/components/mockup/LivePreview";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  Image as ImageIcon,
  ArrowUpCircle,
  ArrowRight,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  CanvasPlacementEditor,
} from "@/components/placement/CanvasPlacementEditor";
import type { Placement, PlacementData, ViewKey } from "@/lib/placement/types";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";
import {
  formatPlacementViewCount,
  formatPlacementViewDetails,
  getEnabledViews,
  getPlacementForView,
  normalizePlacementData,
  setPlacementForView,
} from "@/lib/placement/views";
import {
  generateShirtSvg,
  PRINT_AREA_CENTER_X,
  PRINT_AREA_CENTER_Y,
  PRINT_AREA_SVG_HEIGHT,
  SVG_VIEWBOX_H,
  SVG_VIEWBOX_W,
} from "@/lib/mockup/svg-utils";

// Extracted step-3 sub-components
import { TemplateSelector } from "@/components/wizard/step3/TemplateSelector";
import { ColorPicker } from "@/components/wizard/step3/ColorPicker";
import { SizePicker } from "@/components/wizard/step3/SizePicker";
import { PlacementPanel } from "@/components/wizard/step3/PlacementPanel";
import { DesignProgressCard } from "@/components/wizard/step3/DesignProgressCard";
import { PlacementEditorModal } from "@/components/wizard/step3/PlacementEditorModal";
import type { CanvasRegionPx } from "@/components/placement/CanvasPlacementEditor";

type TemplateReadinessLabel = "DEFAULT" | "DEFAULT INCOMPLETE" | "READY" | "INCOMPLETE";
type StoreColorGroup = "auto" | EffectiveColorGroup;

type WizardTemplateOption = {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  printifyBlueprintId: number | null;
  blueprintTitle: string;
  printProviderTitle: string;
  defaultMockupSource: "PRINTIFY" | "CUSTOM";
  enabledVariantIds: number[];
  enabledSizes: string[];
  // Per-color sizes: { colorName → string[] } | null
  enabledSizesByColor: Record<string, string[]> | null;
  defaultPlacement: unknown | null;
  readiness: {
    ready: boolean;
    missing: string[];
    label: TemplateReadinessLabel;
  };
  colors: Array<{
    id: string;
    name: string;
    hex: string;
    enabled: boolean;
    colorGroup?: StoreColorGroup | null;
    sortOrder: number;
    customMockupCount?: number;
    hasCustomMockup?: boolean;
  }>;
};

type DraftDesignEntry = {
  id: string;
  designId: string;
  sortOrder: number;
  design?: {
    id: string;
    name?: string | null;
    previewPath?: string | null;
  } | null;
  jobs?: Array<{
    id: string;
    draftDesignId?: string | null;
    designId?: string | null;
    createdAt?: string | Date | null;
    status?: string | null;
    completedImages?: number | null;
    totalImages?: number | null;
    failedImages?: number | null;
    errorMessage?: string | null;
    images?: any[];
  }>;
};

type DesignJobState = {
  jobId: string;
  draftDesignId: string;
  designId: string;
  designName: string;
  status: string;
  completed: number;
  total: number;
  failed: number;
  images: any[];
  errorMessage: string | null;
};

const FALLBACK_PRINT_AREA = { ...DEFAULT_PRINT_AREA, safeMarginMm: 12.7 };

export default function Step3PreviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const router = useRouter();
  const { draft, updateDraft, saveDraftImmediately, loadDraft } = useWizardStore();

  const [loading, setLoading] = useState(true);
  const [storeColors, setStoreColors] = useState<any[]>([]);
  const [templates, setTemplates] = useState<WizardTemplateOption[]>([]);
  const [template, setTemplate] = useState<WizardTemplateOption | null>(null);
  const [templateWarning, setTemplateWarning] = useState("");
  const [presetStatus, setPresetStatus] = useState<any>(null);
  const [designPreviewUrlsById, setDesignPreviewUrlsById] = useState<Record<string, string | null>>({});
  const [previewColorIdx, setPreviewColorIdx] = useState(0);
  const [livePreviewView, setLivePreviewView] = useState<ViewKey>("front");

  // Dynamic print area from Printify (fetched per blueprint)
  const [dynamicPrintArea, setDynamicPrintArea] = useState<{ widthMm: number; heightMm: number; safeMarginMm: number } | null>(null);
  const WIZARD_PRINT_AREA = dynamicPrintArea ?? FALLBACK_PRINT_AREA;

  // Local state for UI
  const [selectedColorIds, setSelectedColorIds] = useState<Set<string>>(new Set());
  const [placementOverride, setPlacementOverride] = useState<PlacementData | null>(null);
  const [isPlacementEditorOpen, setIsPlacementEditorOpen] = useState(false);
  const [activeDraftDesignId, setActiveDraftDesignId] = useState<string | null>(null);
  const [mockupJobsByDesign, setMockupJobsByDesign] = useState<Map<string, DesignJobState>>(new Map());

  // Generating state
  const [generating, setGenerating] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [showSlowMockupWarning, setShowSlowMockupWarning] = useState(false);
  const [hasTriggeredBatchRender, setHasTriggeredBatchRender] = useState(false);

  // Per-color size selection: colorId → Set<size>
  const [storeSizes, setStoreSizes] = useState<Array<{ size: string; costDeltaCents: number; isAvailable: boolean }>>([]);
  const [sizesByColorId, setSizesByColorId] = useState<Map<string, Set<string>>>(new Map());
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const authedUser = useAuthedUser();
  const userRole = authedUser?.role ?? null;
  // Ref guard to prevent re-computation of design previews
  const designPreviewRef = useRef<string | null>(null);
  const selectedTemplate = template;
  const selectedTemplateReady = Boolean(selectedTemplate?.readiness.ready);
  const isCustomTemplateDefault = selectedTemplate?.defaultMockupSource === "CUSTOM";
  const showFullLivePreview = !isCustomTemplateDefault;
  const livePreviewTitle = isCustomTemplateDefault ? "Vị trí design trên template" : "Live Preview";
  const livePreviewDescription = isCustomTemplateDefault
    ? "Vị trí design trên template — dùng để kiểm tra vị trí in. Ảnh listing cuối sẽ dùng mockup custom bên dưới."
    : "Mockup tham khảo từ Printify. Bạn có thể chỉnh vị trí design trước khi tạo mockup.";
  const resultsSectionTitle = "Kết quả mockup";
  const resultsEmptyState =
    'Khi sẵn sàng, nhấn "Tạo Mockups" để render ảnh listing cho từng design.';
  const customAvailabilityByColorId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const color of selectedTemplate?.colors ?? []) {
      map.set(color.id, Boolean(color.hasCustomMockup || (color.customMockupCount ?? 0) > 0));
    }
    return map;
  }, [selectedTemplate]);
  const effectiveColorGroups = useMemo(
    () =>
      resolveColorGroups(
        storeColors.map((color) => ({
          id: color.id,
          hex: color.hex,
          colorGroup: color.colorGroup ?? "auto",
        })),
      ),
    [storeColors],
  );
  const groupedColorNames = useMemo(() => {
    const groups: Record<EffectiveColorGroup, string[]> = { light: [], dark: [] };
    for (const color of storeColors) {
      groups[effectiveColorGroups.get(color.id) ?? "dark"].push(color.name);
    }
    return groups;
  }, [effectiveColorGroups, storeColors]);
  const selectedMissingCustomColors = useMemo(() => {
    if (!isCustomTemplateDefault) return [];
    return storeColors.filter(
      (color) => selectedColorIds.has(color.id) && !customAvailabilityByColorId.get(color.id),
    );
  }, [customAvailabilityByColorId, isCustomTemplateDefault, selectedColorIds, storeColors]);
  const hasSelectedMissingCustomColors = selectedMissingCustomColors.length > 0;
  const draftEnabledColorKey = (draft?.enabledColorIds ?? []).join("|");
  const draftPlacementOverrideKey = useMemo(
    () => JSON.stringify(draft?.placementOverride ?? null),
    [draft?.placementOverride],
  );
  const isAdmin = userRole === "ADMIN" || userRole === "SUPER_ADMIN";
  const PRESET_MISSING_LABELS: Record<string, string> = {
    blueprint: "Blueprint",
    provider: "Provider",
    variants: "Variants",
    colors: "Colors",
    placement: "Placement đã lưu",
    template: "Template",
  };

  // userRole is now provided via AuthedUserProvider context from layout — no /api/auth/me fetch needed

  useEffect(() => {
    if (!draftId) {
      setError("Không tìm thấy draft.");
      setLoading(false);
      return;
    }
    if (draft?.id === draftId) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    loadDraft(draftId)
      .then(() => {
        if (cancelled) return;
        const loadedDraft = useWizardStore.getState().draft;
        if (loadedDraft?.id !== draftId) {
          setError("Không tải được draft. Vui lòng thử lại.");
          setLoading(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("Không tải được draft. Vui lòng thử lại.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [draftId, draft?.id, loadDraft]);

  useEffect(() => {
    if (!draft) return;
    const nextSelectedColorIds = new Set(draft.enabledColorIds ?? []);
    setSelectedColorIds((current) => {
      if (
        current.size === nextSelectedColorIds.size &&
        Array.from(current).every((id) => nextSelectedColorIds.has(id))
      ) {
        return current;
      }
      return nextSelectedColorIds;
    });
  }, [draft?.id, draftEnabledColorKey]);

  useEffect(() => {
    if (!draft) return;
    setPlacementOverride((draft.placementOverride as PlacementData | null) ?? null);
  }, [draft?.id, draftPlacementOverrideKey]);

  // Combined wizard-config + parallel sizes fetch — eliminates sequential waterfall
  // AbortController prevents processing stale responses (e.g. when deps change mid-flight).
  // In React StrictMode dev, the first invocation's response is discarded via signal.aborted
  // check, and only the second (real) invocation's response is applied to state.
  useEffect(() => {
    if (!draft || draft.id !== draftId) return;
    if (!draft.storeId) {
      setError("Chưa chọn Store ở bước 1.");
      setLoading(false);
      return;
    }

    const storeId = draft.storeId;

    setLoading(true);
    const controller = new AbortController();

    // Fire wizard-config + sizes in parallel (not sequential)
    Promise.all([
      fetch(`/api/stores/${storeId}/wizard-config`, { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch wizard config");
        return r.json();
      }),
      fetch(`/api/stores/${storeId}/sizes`, { signal: controller.signal }).then((r) => {
        if (!r.ok) return null;
        return r.json();
      }).catch((err) => {
        if (err?.name === "AbortError") throw err;
        return null;
      }),
    ])
      .then(([config, sizeData]) => {
        if (controller.signal.aborted) return;

        const nextTemplates: WizardTemplateOption[] = Array.isArray(config.templates)
          ? config.templates
          : [];
        const activeTemplate =
          nextTemplates.find((candidate) => candidate.id === draft.templateId) ??
          nextTemplates.find((candidate) => candidate.isDefault) ??
          nextTemplates[0] ??
          null;

        setTemplates(nextTemplates);
        setTemplate(activeTemplate);
        setTemplateWarning("");

        // Auto-save default template to draft in DB if null
        if (!draft.templateId && activeTemplate) {
          updateDraft({ templateId: activeTemplate.id });
          void saveDraftImmediately();
        }

        const enabledColors = (activeTemplate?.colors ?? []).filter((color) => color.enabled !== false);
        setStoreColors(enabledColors);
        setPresetStatus(activeTemplate?.readiness ?? { ready: false, missing: ["template"] });

        // Apply template size filter to fetched size data
        const templateEnabledSizes: string[] = activeTemplate?.enabledSizes ?? [];
        const sizesByColor: Record<string, string[]> | null =
          (activeTemplate?.enabledSizesByColor ?? null) as Record<string, string[]> | null;
        const availableSizes = ((sizeData?.sizes ?? [])).filter((s: any) =>
          templateEnabledSizes.length === 0 || templateEnabledSizes.includes(s.size),
        );
        setStoreSizes(availableSizes);

        // Init per-color sizes from draft or template
        const draftSizesByColor = (draft as any)?.enabledSizesByColor as Record<string, string[]> | null;
        const draftFlatSizes: string[] = (draft as any)?.enabledSizes ?? [];

        const initSizesByColorId = new Map<string, Set<string>>();
        for (const color of enabledColors) {
          let sizesForColor: string[];
          if (draftSizesByColor?.[color.name]) {
            // Per-color from draft
            sizesForColor = draftSizesByColor[color.name].filter((s) =>
              templateEnabledSizes.length === 0 || templateEnabledSizes.includes(s),
            );
          } else if (sizesByColor?.[color.name]) {
            // Per-color from template
            sizesForColor = sizesByColor[color.name];
          } else if (draftFlatSizes.length > 0) {
            // Legacy flat fallback from draft
            sizesForColor = draftFlatSizes.filter((s) =>
              templateEnabledSizes.length === 0 || templateEnabledSizes.includes(s),
            );
          } else {
            // Template global fallback
            sizesForColor = templateEnabledSizes;
          }
          initSizesByColorId.set(color.id, new Set(sizesForColor));
        }
        setSizesByColorId(initSizesByColorId);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        console.error(err);
        setError("Không tải được cấu hình wizard. Vui lòng thử lại.");
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  // draft?.templateId intentionally excluded from deps — handleTemplateChange uses
  // retryNonce to force a refetch after template switch. Including templateId causes
  // a double-run that races with saveDraftImmediately and can revert the selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.storeId, draftId, retryNonce]);

  // Fetch dynamic print area when template changes
  useEffect(() => {
    const bpId = template?.printifyBlueprintId;
    if (!bpId) { setDynamicPrintArea(null); return; }
    let cancelled = false;
    fetch(`/api/blueprint/${bpId}/print-area?position=${livePreviewView.toUpperCase()}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.printArea) return;
        setDynamicPrintArea({
          widthMm: data.printArea.widthMm,
          heightMm: data.printArea.heightMm,
          safeMarginMm: data.printArea.safeMarginMm ?? 12.7,
        });
      })
      .catch(() => { /* fallback to FALLBACK_PRINT_AREA */ });
    return () => { cancelled = true; };
  }, [template?.printifyBlueprintId, livePreviewView]);

  const selectedDraftDesigns = useMemo<DraftDesignEntry[]>(() => {
    const childRows = (draft?.draftDesigns ?? []) as DraftDesignEntry[];
    if (childRows.length > 0) {
      return [...childRows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }

    if (!draft?.designId) return [];

    const legacyDesign = (draft as any)?.design ?? null;
    return [
      {
        id: "legacy",
        designId: draft.designId,
        sortOrder: 0,
        design: legacyDesign
          ? {
              id: legacyDesign.id ?? draft.designId,
              name: legacyDesign.name ?? "Design",
              previewPath: legacyDesign.previewPath ?? null,
            }
          : { id: draft.designId, name: "Design", previewPath: null },
        jobs: (draft.mockupJobs ?? []) as DraftDesignEntry["jobs"],
      },
    ];
  }, [draft?.designId, draft?.draftDesigns, draft?.mockupJobs]);

  const selectedDraftDesignIds = useMemo(
    () => selectedDraftDesigns.map((entry) => entry.id),
    [selectedDraftDesigns],
  );

  const selectedDesignJobs = useMemo(() => {
    return selectedDraftDesigns.flatMap((entry) =>
      (entry.jobs ?? []).map((job) => ({
        ...job,
        draftDesignId: job.draftDesignId ?? entry.id,
        designId: job.designId ?? entry.designId,
      })),
    );
  }, [selectedDraftDesigns]);

  const latestMockupJobByDesign = useMemo(
    () => getLatestJobByDraftDesignId(selectedDesignJobs),
    [selectedDesignJobs],
  );

  const primarySelectedDesignId = selectedDraftDesigns[0]?.designId ?? draft?.designId ?? null;
  const primarySelectedDesign = selectedDraftDesigns[0] ?? null;

  useEffect(() => {
    setActiveDraftDesignId((current) => getActiveDraftDesignId(selectedDraftDesignIds, current));
  }, [selectedDraftDesignIds]);

  // Compute design preview URLs from draft data — no extra /api/designs/ fetches needed.
  // The getDraft() response already includes design.previewPath for each draftDesign.
  // URL pattern: /api/files/{previewPath} (from LocalDiskStorage.getPublicUrl)
  useEffect(() => {
    if (selectedDraftDesignIds.length === 0) {
      setDesignPreviewUrlsById({});
      return;
    }

    // Stable key to prevent re-computation on every render
    const key = selectedDraftDesignIds.join(",");
    if (designPreviewRef.current === key) return;
    designPreviewRef.current = key;

    const entries: Array<[string, string | null]> = selectedDraftDesigns.map((entry) => {
      const previewPath = entry.design?.previewPath;
      const designData = (entry as any).design;
      const storagePath = designData?.storagePath;
      // Prefer previewPath (WebP thumbnail), fallback to storagePath (original)
      const url = previewPath
        ? `/api/files/${previewPath}`
        : storagePath
          ? `/api/files/${storagePath}`
          : null;
      return [entry.designId, url];
    });

    setDesignPreviewUrlsById(Object.fromEntries(entries));
  }, [selectedDraftDesignIds, selectedDraftDesigns]);

  useEffect(() => {
    if (selectedDraftDesigns.length === 0) {
      setMockupJobsByDesign(new Map());
      return;
    }

    const next = new Map<string, DesignJobState>();

    selectedDraftDesigns.forEach((entry, index) => {
      const latestJob = latestMockupJobByDesign.get(entry.id);
      if (!latestJob) return;

      const images = latestJob.images ?? [];
      next.set(entry.id, {
        jobId: latestJob.id,
        draftDesignId: entry.id,
        designId: latestJob.designId ?? entry.designId,
        designName: entry.design?.name ?? `Design ${index + 1}`,
        status: latestJob.status ?? "pending",
        completed:
          latestJob.completedImages ?? images.filter((img: any) => img.compositeStatus === "completed").length,
        total: latestJob.totalImages ?? images.length,
        failed:
          latestJob.failedImages ?? images.filter((img: any) => img.compositeStatus === "failed").length,
        images,
        errorMessage: latestJob.errorMessage ?? null,
      });
    });

    setMockupJobsByDesign(next);
  }, [latestMockupJobByDesign, selectedDraftDesigns]);

  const overallJobProgress = useMemo(() => {
    let completed = 0;
    let total = 0;
    let failed = 0;

    for (const job of mockupJobsByDesign.values()) {
      completed += job.completed ?? 0;
      total += job.total ?? 0;
      failed += job.failed ?? 0;
    }

    return { completed, total, failed };
  }, [mockupJobsByDesign]);

  const activeDesignJob = useMemo(() => {
    if (!activeDraftDesignId) return null;
    return mockupJobsByDesign.get(activeDraftDesignId) ?? null;
  }, [activeDraftDesignId, mockupJobsByDesign]);

  const activeMockupImages = activeDesignJob?.images ?? [];

  // Gộp mockup images từ tất cả design jobs để hiện cùng lúc trong gallery
  const allMockupImages = useMemo(() => {
    const images: typeof activeMockupImages = [];
    for (const job of mockupJobsByDesign.values()) {
      images.push(...(job.images ?? []));
    }
    return images;
  }, [mockupJobsByDesign]);

  const activeDesignProgress = activeDesignJob ?? {
    jobId: "",
    draftDesignId: activeDraftDesignId ?? "",
    designId: primarySelectedDesignId ?? "",
    designName: primarySelectedDesign?.design?.name ?? "Design",
    status: "pending",
    completed: 0,
    total: 0,
    failed: 0,
    images: [],
    errorMessage: null,
  };
  const hasActiveMockupJobs = useMemo(
    () =>
      Array.from(mockupJobsByDesign.values()).some(
        (job) => !isTerminalMockupJobStatus(job.status) || (job.total > 0 && job.completed + job.failed < job.total),
      ),
    [mockupJobsByDesign],
  );
  const progressFinished =
    overallJobProgress.total > 0 &&
    overallJobProgress.completed + overallJobProgress.failed >= overallJobProgress.total;
  const isGenerating = generating || hasActiveMockupJobs;
  const generateButtonLabel = isGenerating
    ? progressFinished
      ? "Đang đồng bộ kết quả..."
      : `Đang tạo... (${selectedDraftDesignIds.length} designs)`
    : "Tạo Mockups";

  const handleGenerate = useCallback(async () => {
    if (selectedColorIds.size === 0) {
      setError("Vui lòng chọn ít nhất 1 màu");
      return;
    }
    if (!selectedTemplate?.readiness.ready) {
      setError("Template đang chọn chưa sẵn sàng. Vui lòng chọn template READY hoặc hoàn tất preset.");
      return;
    }
    if (selectedMissingCustomColors.length > 0) {
      const missingColorNames = selectedMissingCustomColors.map((color) => color.name).join(", ");
      setError(
        `Template đang dùng Custom nhưng ${missingColorNames} chưa có mockup custom. Màu này sẽ chưa thể tạo mockup cho tới khi bạn upload mockup custom hoặc bỏ màu này khỏi listing.`,
      );
      return;
    }

    setGenerating(true);
    setGenerationStartedAt(Date.now());
    setShowSlowMockupWarning(false);
    setHasTriggeredBatchRender(true);
    setError("");
    setMockupJobsByDesign(new Map());

    const enabledColorIds = Array.from(selectedColorIds);

    // Build enabledSizesByColor (colorName → string[]) from sizesByColorId (colorId → Set<size>)
    const enabledSizesByColor: Record<string, string[]> = {};
    for (const color of storeColors) {
      if (selectedColorIds.has(color.id)) {
        enabledSizesByColor[color.name] = Array.from(sizesByColorId.get(color.id) ?? []);
      }
    }
    // Union of all sizes for legacy enabledSizes field
    const allEnabledSizes = Array.from(
      new Set(Object.values(enabledSizesByColor).flat()),
    );

    await updateDraft({
      templateId: selectedTemplate.id,
      enabledColorIds,
      enabledSizes: allEnabledSizes,
      enabledSizesByColor,
      placementOverride: placementOverride || undefined,
    });
    await saveDraftImmediately();

    try {
      const res = await fetch(`/api/mockup-jobs/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "No enabled variants") {
          setError("Store chưa chọn variants. Vui lòng cập nhật Blueprint trong Store Settings.");
        } else {
          setError(data.error || "Không thể tạo mockup");
        }
        setGenerating(false);
        setGenerationStartedAt(null);
        setShowSlowMockupWarning(false);
        return;
      }

      const next = new Map<string, DesignJobState>();
      for (const job of data.jobs ?? []) {
        next.set(job.draftDesignId, {
          jobId: job.jobId,
          draftDesignId: job.draftDesignId,
          designId: job.designId,
          designName: job.designName,
          status: job.status ?? "pending",
          completed: 0,
          total: 0,
          failed: 0,
          images: [],
          errorMessage: null,
        });
      }

      for (const failure of data.failures ?? []) {
        next.set(failure.draftDesignId, {
          jobId: failure.draftDesignId,
          draftDesignId: failure.draftDesignId,
          designId: failure.designId,
          designName: failure.designName,
          status: "failed",
          completed: 0,
          total: 0,
          failed: 1,
          images: [],
          errorMessage: failure.error,
        });
      }

      setMockupJobsByDesign(next);
      const hasQueuedJobs = (data.jobs ?? []).length > 0;
      setGenerating(hasQueuedJobs);
      if (!hasQueuedJobs) {
        setGenerationStartedAt(null);
        setShowSlowMockupWarning(false);
      }
    } catch {
      setError("Lỗi kết nối");
      setGenerating(false);
      setGenerationStartedAt(null);
      setShowSlowMockupWarning(false);
    }
  }, [
    draftId,
    placementOverride,
    saveDraftImmediately,
    selectedColorIds,
    selectedMissingCustomColors,
    sizesByColorId,
    storeColors,
    selectedTemplate,
    updateDraft,
  ]);

  useEffect(() => {
    if (!draft || loading) return;
    if (selectedDraftDesigns.length === 0) return;
    if (selectedColorIds.size === 0 || !selectedTemplateReady || hasSelectedMissingCustomColors) return;

    // When mockups are stale (placement/color/design changed), regenerate regardless
    // of hasTriggeredBatchRender guard. Only check isGenerating to prevent double-fire.
    if (draft.mockupsStale) {
      if (!isGenerating) void handleGenerate();
      return;
    }

    if (hasTriggeredBatchRender) return;

    if (!draft.mockupsStale && hasActiveOrCompletedJobsForAllDesigns(selectedDraftDesignIds, selectedDesignJobs)) {
      return;
    }

    void handleGenerate();
  }, [
    draft?.id,
    draft?.mockupsStale,
    handleGenerate,
    hasSelectedMissingCustomColors,
    hasTriggeredBatchRender,
    isGenerating,
    loading,
    selectedColorIds.size,
    selectedDesignJobs,
    selectedDraftDesignIds,
    selectedDraftDesigns.length,
    selectedTemplateReady,
  ]);

  useEffect(() => {
    if (!isGenerating || !generationStartedAt || overallJobProgress.total > 0) {
      setShowSlowMockupWarning(false);
      return;
    }

    const remaining = MOCKUP_JOB_SOFT_WAIT_MS - (Date.now() - generationStartedAt);
    if (remaining <= 0) {
      setShowSlowMockupWarning(true);
      return;
    }

    const timeout = setTimeout(() => setShowSlowMockupWarning(true), remaining);
    return () => clearTimeout(timeout);
  }, [generationStartedAt, isGenerating, overallJobProgress.total]);

  // SSE-based progress listener with periodic poll fallback.
  // SSE delivers real-time events when worker runs in the same process as Next.js server.
  // Periodic poll (every 5s) catches updates from standalone worker processes where
  // in-memory sseChannels.emit() cannot cross process boundaries.
  useEffect(() => {
    if (!isGenerating || !draftId) return;

    let es: EventSource | null = null;
    let pollFallbackId: NodeJS.Timeout | null = null;
    let periodicPollId: NodeJS.Timeout | null = null;
    let closed = false;

    const refreshJobFromApi = async (jobId: string, draftDesignId: string | null) => {
      try {
        const res = await fetch(`/api/mockup-jobs/${jobId}`);
        if (!res.ok) return;
        const job = await res.json();
        const images = job.images ?? [];
        setMockupJobsByDesign((current) => {
          const next = new Map(current);
          const key = draftDesignId ?? jobId;
          const prev = current.get(key);
          if (prev) {
            next.set(key, {
              ...prev,
              status: job.status ?? prev.status,
              completed: job.completedImages ?? images.filter((img: any) => img.compositeStatus === "completed").length,
              total: job.totalImages ?? images.length,
              failed: job.failedImages ?? images.filter((img: any) => img.compositeStatus === "failed").length,
              images,
              errorMessage: job.errorMessage ?? null,
            });
          }
          return next;
        });
      } catch { /* ignore */ }
    };

    // Uses functional updater to read current state — avoids stale closure.
    // Side effects (setGenerating, toast, loadDraft) are deferred via queueMicrotask
    // to avoid React error: "Cannot update a component while rendering a different component".
    const checkAllDone = () => {
      setMockupJobsByDesign((current) => {
        const jobs = Array.from(current.values());
        const stillRunning = jobs.some(
          (job) => !isTerminalMockupJobStatus(job.status) ||
            !(job.total > 0 && job.completed + job.failed >= job.total),
        );

        // Schedule side effects outside the render cycle.
        // NOTE: Do NOT call loadDraft() here — it overwrites the entire draft state
        // (including templateId) and causes race conditions with concurrent user actions
        // like switching templates. Individual job updates via refreshJobFromApi are sufficient.
        queueMicrotask(() => {
          setGenerating(stillRunning);
          if (!stillRunning) {
            setGenerationStartedAt(null);
            setShowSlowMockupWarning(false);
            const doneCount = jobs.filter(
              (job) => isTerminalMockupJobStatus(job.status) || (job.total > 0 && job.completed + job.failed >= job.total),
            ).length;
            if (doneCount > 0) {
              toast.success(`Đã tạo mockups cho ${doneCount} designs`);
              // Manually sync local draft state since the backend worker already cleared the stale flag,
              // and we avoid loadDraft() to prevent race conditions with user actions.
              useWizardStore.setState((s) => ({
                draft: s.draft ? { ...s.draft, mockupsStale: false, mockupsStaleReason: null } : null,
              }));
            }
          }
        });

        return current; // read-only — no state mutation
      });
    };

    // Periodic fallback poll — catches updates from standalone worker processes
    // where in-memory SSE events cannot cross process boundaries.
    const startPeriodicPoll = () => {
      periodicPollId = setInterval(() => {
        if (closed) return;
        setMockupJobsByDesign((current) => {
          const activeJobs = Array.from(current.values()).filter(
            (job) => job.jobId && !isTerminalMockupJobStatus(job.status),
          );
          if (activeJobs.length > 0) {
            void Promise.all(
              activeJobs.map((j) => refreshJobFromApi(j.jobId, j.draftDesignId ?? null)),
            ).then(checkAllDone);
          } else {
            // All jobs already terminal — ensure we exit generating state
            checkAllDone();
          }
          return current; // read-only — no state mutation
        });
      }, 5000);
    };

    try {
      es = new EventSource(`/api/wizard/drafts/${draftId}/events`);

      es.onmessage = (ev) => {
        if (closed) return;
        try {
          const event = JSON.parse(ev.data) as { type: string; data?: any };
          if (event.type === "mockup.progress" || event.type === "mockup.job.created") {
            const d = event.data ?? {};
            const key = d.draftDesignId ?? d.jobId;
            setMockupJobsByDesign((current) => {
              const next = new Map(current);
              const prev = current.get(key);
              if (prev) {
                next.set(key, {
                  ...prev,
                  status: d.status ?? prev.status,
                  completed: d.completedImages ?? prev.completed,
                  total: d.totalImages ?? prev.total,
                });
              }
              return next;
            });
            // Fetch full state to get images array
            if (d.jobId) void refreshJobFromApi(d.jobId, d.draftDesignId ?? null);
          } else if (event.type === "mockup.failed") {
            const d = event.data ?? {};
            const key = d.draftDesignId ?? d.mockupJobId;
            setMockupJobsByDesign((current) => {
              const next = new Map(current);
              const prev = current.get(key);
              if (prev) next.set(key, { ...prev, status: "failed", errorMessage: d.errorMessage ?? null });
              return next;
            });
            checkAllDone();
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        // SSE connection error — trigger immediate poll for all active jobs
        if (!closed) {
          pollFallbackId = setTimeout(() => {
            setMockupJobsByDesign((current) => {
              const activeJobs = Array.from(current.values()).filter(
                (job) => job.jobId && !isTerminalMockupJobStatus(job.status),
              );
              void Promise.all(activeJobs.map((j) => refreshJobFromApi(j.jobId, j.draftDesignId ?? null)))
                .then(checkAllDone);
              return current;
            });
          }, 1000);
        }
      };

      startPeriodicPoll();
    } catch {
      // EventSource not available — rely solely on periodic poll
      startPeriodicPoll();
    }

    return () => {
      closed = true;
      es?.close();
      if (pollFallbackId) clearTimeout(pollFallbackId);
      if (periodicPollId) clearInterval(periodicPollId);
    };
  }, [draftId, isGenerating]);

  const toggleColor = (id: string) => {
    if (isCustomTemplateDefault && !customAvailabilityByColorId.get(id)) {
      toast.info("Màu này chưa có mockup custom.");
      return;
    }
    const next = new Set(selectedColorIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedColorIds(next);
    updateDraft({ enabledColorIds: Array.from(next) });
  };

  const updateColorGroup = async (colorId: string, colorGroup: StoreColorGroup) => {
    if (!draft?.storeId) return;
    const previousStoreColors = storeColors;
    const applyColorGroup = <T extends { id: string; colorGroup?: StoreColorGroup | null }>(
      colors: T[],
    ) =>
      colors.map((color) =>
        color.id === colorId ? { ...color, colorGroup } : color,
      );

    setStoreColors((current) => applyColorGroup(current));
    setTemplate((current) =>
      current ? { ...current, colors: applyColorGroup(current.colors) } : current,
    );
    setTemplates((current) =>
      current.map((candidate) => ({
        ...candidate,
        colors: applyColorGroup(candidate.colors),
      })),
    );

    try {
      const res = await fetch(`/api/stores/${draft.storeId}/colors/${colorId}/group`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorGroup }),
      });
      if (!res.ok) throw new Error("Failed to update color group");
    } catch {
      setStoreColors(previousStoreColors);
      toast.error("Không thể cập nhật nhóm màu");
    }
  };

  const selectAllColors = () => {
    const next = new Set<string>();
    storeColors.forEach((color) => {
      if (!isCustomTemplateDefault || customAvailabilityByColorId.get(color.id)) {
        next.add(color.id);
      }
    });
    setSelectedColorIds(next);
    updateDraft({ enabledColorIds: Array.from(next) });
  };

  const deselectAllColors = () => {
    setSelectedColorIds(new Set());
    updateDraft({ enabledColorIds: [] });
  };

  const toggleSize = (colorId: string, size: string) => {
    setSizesByColorId((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(colorId) ?? []);
      if (current.has(size)) current.delete(size);
      else current.add(size);
      next.set(colorId, current);
      return next;
    });
  };

  const selectAllSizes = (colorId: string) => {
    setSizesByColorId((prev) => {
      const next = new Map(prev);
      next.set(colorId, new Set(storeSizes.filter((s) => s.isAvailable).map((s) => s.size)));
      return next;
    });
  };

  const clearAllSizes = (colorId: string) => {
    setSizesByColorId((prev) => {
      const next = new Map(prev);
      next.set(colorId, new Set());
      return next;
    });
  };

  const handleTemplateChange = async (templateId: string) => {
    const nextTemplate = templates.find((candidate) => candidate.id === templateId);
    if (!nextTemplate) return;
    if (!nextTemplate.readiness.ready) {
      setTemplateWarning("Template này chưa sẵn sàng. Hãy hoàn tất preset trước khi tạo mockup.");
      return;
    }

    const nextColorIds = nextTemplate.colors
      .filter((color) => {
        if (color.enabled === false) return false;
        if (nextTemplate.defaultMockupSource !== "CUSTOM") return true;
        return Boolean(color.hasCustomMockup || (color.customMockupCount ?? 0) > 0);
      })
      .map((color) => color.id);
    const globalFallbackSizes = nextTemplate.enabledSizes ?? [];

    const nextSizes: Record<string, string[]> = {};
    const nextSizesByColorId = new Map<string, Set<string>>();
    for (const colorId of nextColorIds) {
      const colorObj = nextTemplate.colors.find((c) => c.id === colorId);
      if (colorObj) {
        const colorSizes =
          (nextTemplate.enabledSizesByColor as Record<string, string[]> | null)?.[colorObj.name]
          ?? globalFallbackSizes;
        nextSizesByColorId.set(colorId, new Set(colorSizes));
        nextSizes[colorObj.name] = colorSizes;
      }
    }
    // Compute global flat list for legacy enabledSizes field
    const nextGlobalSizes = Array.from(new Set(Object.values(nextSizes).flat()));

    setTemplate(nextTemplate);
    setTemplateWarning("");
    setStoreColors(nextTemplate.colors.filter((color) => color.enabled !== false));
    setSelectedColorIds(new Set(nextColorIds));
    setSizesByColorId(nextSizesByColorId);
    setPlacementOverride(null);
    setPreviewColorIdx(0);
    setLivePreviewView("front");
    setMockupJobsByDesign(new Map());
    setGenerating(false);
    setGenerationStartedAt(null);
    setShowSlowMockupWarning(false);
    setHasTriggeredBatchRender(false);
    setError("");

    await updateDraft({
      templateId: nextTemplate.id,
      enabledColorIds: nextColorIds,
      enabledSizes: nextGlobalSizes,
      enabledSizesByColor: nextSizes,
      enabledVariantIdsOverride: [],
      placementOverride: null,
    });
    await saveDraftImmediately();
    setRetryNonce((value) => value + 1);
  };

  const removeColorFromListing = async (colorId: string) => {
    const next = new Set(selectedColorIds);
    next.delete(colorId);
    setSelectedColorIds(next);
    await updateDraft({ enabledColorIds: Array.from(next) });
  };

  const switchSelectedTemplateToPrintify = async () => {
    if (!draft?.storeId || !selectedTemplate) return;
    try {
      const res = await fetch(`/api/stores/${draft.storeId}/mockup-templates/${selectedTemplate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultMockupSource: "PRINTIFY" }),
      });
      if (!res.ok) throw new Error("Failed to switch template source");
      setTemplate((current) =>
        current?.id === selectedTemplate.id
          ? { ...current, defaultMockupSource: "PRINTIFY" }
          : current,
      );
      setTemplates((current) =>
        current.map((candidate) =>
          candidate.id === selectedTemplate.id
            ? { ...candidate, defaultMockupSource: "PRINTIFY" }
            : candidate,
        ),
      );
      toast.success("Đã đổi nguồn ảnh mặc định sang Printify");
    } catch {
      toast.error("Không thể đổi nguồn ảnh mặc định sang Printify");
    }
  };

  const retryPageData = async () => {
    setError("");
    setLoading(true);
    if (!draft || draft.id !== draftId) {
      await loadDraft(draftId);
      const loadedDraft = useWizardStore.getState().draft;
      if (loadedDraft?.id !== draftId) {
        setError("Không tải được draft. Vui lòng thử lại.");
        setLoading(false);
      }
      return;
    }
    setRetryNonce((value) => value + 1);
  };

  // Print area pixel bounds (SVG coords) — drives the teal frame in CanvasPlacementEditor
  // Must be before early returns to satisfy React hooks ordering rules.
  // Dynamic: compute SVG dimensions from mm using reference scale (280px ↔ 406.4mm baseline)
  const printAreaPxForEditor = useMemo(() => {
    const REF_MM_TO_SVG = PRINT_AREA_SVG_HEIGHT / DEFAULT_PRINT_AREA.heightMm; // ≈ 0.689
    const paH = Math.round(Math.min(WIZARD_PRINT_AREA.heightMm * REF_MM_TO_SVG, SVG_VIEWBOX_H * 0.65));
    const paW = Math.round(Math.min(WIZARD_PRINT_AREA.widthMm * REF_MM_TO_SVG, SVG_VIEWBOX_W * 0.65));
    return {
      x: Math.round(PRINT_AREA_CENTER_X - paW / 2),
      y: Math.round(PRINT_AREA_CENTER_Y - paH / 2),
      width: paW,
      height: paH,
    };
  }, [WIZARD_PRINT_AREA.widthMm, WIZARD_PRINT_AREA.heightMm]);

  if (loading) {
    return (
      <div>
        <div style={{ height: 20, width: 180, borderRadius: 6, backgroundColor: "var(--bg-tertiary)", marginBottom: 8 }} className="animate-pulse" />
        <div style={{ height: 14, width: 320, borderRadius: 4, backgroundColor: "var(--bg-tertiary)", marginBottom: 20 }} className="animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card animate-pulse" style={{ height: 280, padding: 16 }} />
            <div className="card animate-pulse" style={{ height: 180, padding: 16 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card animate-pulse" style={{ height: 460, padding: 20 }} />
            <div className="card animate-pulse" style={{ height: 200, padding: 20 }} />
          </div>
        </div>
      </div>
    );
  }

  // Determine active placement (override or default)
  const activePlacement = normalizePlacementData(placementOverride || template?.defaultPlacement, true);
  const savedPlacementViews = getEnabledViews(normalizePlacementData(placementOverride || template?.defaultPlacement, false));
  const placementCountLabel = formatPlacementViewCount(activePlacement);
  const placementDetailLabel = formatPlacementViewDetails(activePlacement);
  const enabledPlacementViews = getEnabledViews(activePlacement);
  const previewPlacementView = enabledPlacementViews.includes(livePreviewView)
    ? livePreviewView
    : enabledPlacementViews[0] ?? "front";
  const placementSourceLabel = placementOverride
    ? "Đang áp dụng cho toàn bộ designs"
    : "Dùng preset của store cho toàn bộ designs";
  const bgColor = storeColors.find((color) => color.enabled !== false)?.hex ?? "#EEEEEE";
  const selectedPreviewColors = storeColors.filter((color) => selectedColorIds.has(color.id));
  const previewColors = selectedPreviewColors;
  const previewColor = previewColors[Math.min(previewColorIdx, Math.max(0, previewColors.length - 1))];
  const livePreviewViews = enabledPlacementViews.filter(
    (view): view is Exclude<ViewKey, "hem"> => view !== "hem",
  );
  const selectedLivePreviewView = livePreviewViews.includes(previewPlacementView as Exclude<ViewKey, "hem">)
    ? (previewPlacementView as Exclude<ViewKey, "hem">)
    : livePreviewViews[0] ?? "front";
  const placementsByView = Object.fromEntries(
    livePreviewViews.map((view) => [view, getPlacementForView(activePlacement, view)]),
  ) as Partial<Record<Exclude<ViewKey, "hem">, ReturnType<typeof getPlacementForView>>>;
  const currentPreviewPlacement = getPlacementForView(activePlacement, selectedLivePreviewView)
    ?? getPlacementForView(activePlacement, "front");
  const canvasEditorMode =
    selectedTemplate?.defaultMockupSource === "CUSTOM"
      ? "CUSTOM_COMPOSITE"
      : "PRINTIFY_PLACEMENT";
  const canvasBackgroundImageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    generateShirtSvg(selectedLivePreviewView, previewColor?.hex ?? bgColor),
  )}`;


  const updatePlacementOverride = (next: PlacementData | null) => {
    const normalized = next ? normalizePlacementData(next, false) : null;
    setPlacementOverride(normalized);
    updateDraft({ placementOverride: normalized });
  };

  const primaryDesignPreviewUrl = primarySelectedDesignId
    ? designPreviewUrlsById[primarySelectedDesignId] ?? null
    : null;
  const activeDesignTab =
    (activeDraftDesignId
      ? selectedDraftDesigns.find((entry) => entry.id === activeDraftDesignId) ?? null
      : null) ?? selectedDraftDesigns[0] ?? null;
  // Lấy preview URL theo design tab đang active (sửa bug: trước đây luôn dùng design đầu tiên)
  const activeDesignPreviewUrl = activeDesignTab?.designId
    ? designPreviewUrlsById[activeDesignTab.designId] ?? null
    : primaryDesignPreviewUrl;
  const activeDesignTabIndex = activeDesignTab
    ? selectedDraftDesigns.findIndex((entry) => entry.id === activeDesignTab.id)
    : -1;
  const activeDesignTabLabel = activeDesignTab
    ? activeDesignTab.design?.name ?? `Design ${activeDesignTabIndex + 1}`
    : "Design";
  const canGenerateMockups =
    selectedDraftDesigns.length > 0 &&
    selectedColorIds.size > 0 &&
    selectedTemplateReady &&
    !hasSelectedMissingCustomColors &&
    !isGenerating;

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Preview & Colors
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 20px" }}>
        Chọn màu sắc và tùy chỉnh vị trí in (nếu cần) trước khi tạo mockup.
      </p>

      {presetStatus && !presetStatus.ready && (
        <div className="alert" style={{ marginBottom: 16, backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
          <div className="flex-1">
            <p style={{ margin: 0, fontWeight: 500 }}>⚠️ Preset chưa hoàn thiện</p>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>
              Template đang chọn chưa sẵn sàng. Còn thiếu:{" "}
              {(presetStatus.missing as string[])
                .map((key) => PRESET_MISSING_LABELS[key] ?? key)
                .join(", ")}
              .
            </p>
          </div>
          {isAdmin ? (
            <button
              className="btn btn-secondary"
              style={{ fontSize: "0.8rem", padding: "6px 12px" }}
              onClick={() => router.push(`/stores/${draft?.storeId}/config`)}
            >
              Đi tới Store Settings →
            </button>
          ) : (
            <span style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.65 }}>
              Store chưa sẵn sàng. Liên hệ Admin để hoàn thiện preset.
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <span className="flex-1">{error}</span>
          {(!draft || !template) && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={retryPageData}
              style={{ padding: "5px 10px", fontSize: "0.78rem" }}
            >
              <RefreshCw size={14} /> Thử lại
            </button>
          )}
        </div>
      )}

      {isCustomTemplateDefault && selectedMissingCustomColors.length > 0 && (
        <div
          className="alert"
          style={{
            marginBottom: 16,
            backgroundColor: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.28)",
            alignItems: "flex-start",
          }}
        >
          <AlertTriangle size={16} style={{ color: "#b45309", marginTop: 2 }} />
          <div className="flex-1">
            <p style={{ margin: 0, fontWeight: 800 }}>
              Template đang dùng Custom nhưng {selectedMissingCustomColors.map((color) => color.name).join(", ")} chưa có mockup custom.
            </p>
            <p style={{ margin: "4px 0 10px", fontSize: "0.82rem", opacity: 0.72, lineHeight: 1.45 }}>
              Màu này sẽ chưa thể tạo mockup cho tới khi bạn upload mockup custom hoặc bỏ màu này khỏi listing.
            </p>
            <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => router.push(`/stores/${draft?.storeId}/config`)}
              >
                Mở Store Settings
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void removeColorFromListing(selectedMissingCustomColors[0].id)}
              >
                Bỏ màu {selectedMissingCustomColors[0].name}
              </button>
              <button type="button" className="btn btn-secondary" onClick={switchSelectedTemplateToPrintify}>
                Đổi nguồn ảnh mặc định sang Printify
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedDraftDesigns.length === 0 && (
        <div className="alert" style={{ marginBottom: 16, backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
          <div className="flex-1">
            <p style={{ margin: 0, fontWeight: 500 }}>Chưa có Design</p>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>Bạn cần chọn ít nhất 1 design ở bước trước để tạo mockup.</p>
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
            onClick={() => document.getElementById('step-nav-2')?.click() || window.history.back()}
          >
            ← Quay lại Design
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">

        {/* LEFT PANEL: COLORS & PLACEMENT */}
        <div className="space-y-6">
          <div id="mockup-template-selector">
            <div className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Mockup template</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                  Chọn template cho wizard này
                </p>
              </div>
              {selectedTemplate && (
                <span
                  className={`badge ${selectedTemplate.readiness.ready ? "badge-success" : "badge-warning"}`}
                  style={{ flexShrink: 0, fontSize: "0.65rem" }}
                >
                  {selectedTemplate.readiness.label}
                </span>
              )}
            </div>

            {templates.length > 1 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {templates.map((candidate) => {
                  const active = selectedTemplate?.id === candidate.id;
                  const disabled = !candidate.readiness.ready;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => handleTemplateChange(candidate.id)}
                      disabled={disabled}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: active ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                        backgroundColor: active ? "rgba(146, 198, 72, 0.06)" : "transparent",
                        opacity: disabled ? 0.5 : 1,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span style={{ fontWeight: 800, fontSize: "0.82rem", overflowWrap: "anywhere" }}>
                          {candidate.name}
                        </span>
                        <span style={{ fontSize: "0.65rem", fontWeight: 800, opacity: 0.65, flexShrink: 0 }}>
                          {candidate.readiness.label}
                        </span>
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: "0.72rem", opacity: 0.6, lineHeight: 1.3 }}>
                        {candidate.blueprintTitle || "Chưa có blueprint"} · {candidate.colors.length} màu · {candidate.enabledSizes.length} sizes
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : selectedTemplate ? (
              <div style={{ fontSize: "0.8rem", lineHeight: 1.4 }}>
                <strong>{selectedTemplate.name}</strong>
                <p style={{ margin: "4px 0 0", opacity: 0.6 }}>
                  {selectedTemplate.blueprintTitle || "Chưa có blueprint"} · {selectedTemplate.colors.length} màu · {selectedTemplate.enabledSizes.length} sizes
                </p>
              </div>
            ) : (
              <p style={{ margin: 0, opacity: 0.6, fontSize: "0.8rem" }}>
                Store chưa có template.
              </p>
            )}

            {templateWarning && (
              <p style={{ margin: "10px 0 0", color: "var(--color-warning)", fontSize: "0.75rem", lineHeight: 1.35 }}>
                {templateWarning}
              </p>
            )}
          </div>

          <ColorPicker
            colors={storeColors}
            selectedIds={selectedColorIds}
            onToggle={toggleColor}
            onSelectAll={selectAllColors}
            onDeselectAll={deselectAllColors}
            customAvailabilityByColorId={customAvailabilityByColorId}
            isCustomTemplate={isCustomTemplateDefault}
          />

          <div className="card" style={{ padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>Nhóm màu sáng/tối</h3>
              <p style={{ margin: "3px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                Sáng: {groupedColorNames.light.join(", ") || "—"}
              </p>
              <p style={{ margin: "3px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                Tối: {groupedColorNames.dark.join(", ") || "—"}
              </p>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {storeColors.map((color) => {
                const effectiveGroup = effectiveColorGroups.get(color.id) ?? "dark";
                return (
                  <div
                    key={color.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 112px",
                      gap: 10,
                      alignItems: "center",
                      padding: "8px 10px",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          backgroundColor: color.hex,
                          border: "1px solid var(--border-default)",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <p
                          style={{
                            margin: 0,
                            fontWeight: 800,
                            fontSize: "0.78rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {color.name}
                        </p>
                        <p style={{ margin: "2px 0 0", fontSize: "0.68rem", opacity: 0.5 }}>
                          {effectiveGroup === "light" ? "Sáng" : "Tối"}
                        </p>
                      </div>
                    </div>
                    <select
                      className="input"
                      value={color.colorGroup ?? "auto"}
                      onChange={(event) => {
                        void updateColorGroup(color.id, event.target.value as StoreColorGroup);
                      }}
                      style={{ height: 34, fontSize: "0.75rem", padding: "0 8px" }}
                    >
                      <option value="auto">Auto</option>
                      <option value="light">Sáng</option>
                      <option value="dark">Tối</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>


          <SizePicker
            sizes={storeSizes}
            selectedColors={storeColors
              .filter((c) => selectedColorIds.has(c.id))
              .map((c) => ({ id: c.id, name: c.name, hex: c.hex }))}
            sizesByColorId={sizesByColorId}
            onToggle={toggleSize}
            onSelectAll={selectAllSizes}
            onClearAll={clearAllSizes}
          />

          {!isCustomTemplateDefault && (
          <div className="card" style={{ padding: 16 }}>
            <div className="flex justify-between items-start gap-3" style={{ marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>Vị trí in</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                  {placementSourceLabel}
                </p>
              </div>
              <span
                className="badge badge-success"
                style={{
                  flexShrink: 0,
                  maxWidth: 86,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={placementDetailLabel}
              >
                {placementCountLabel}
              </span>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 5 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: "0.95rem", lineHeight: 1.25 }}>
                  {placementCountLabel}
                </p>
                <p
                  style={{
                    margin: 0,
                    opacity: 0.62,
                    fontSize: "0.75rem",
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}
                  title={placementDetailLabel}
                >
                  {placementDetailLabel}
                </p>
                <p style={{ margin: 0, opacity: 0.5, fontSize: "0.72rem", lineHeight: 1.35 }}>
                  {placementOverride
                    ? "Đang áp dụng cho toàn bộ designs trong wizard."
                    : savedPlacementViews.length > 0
                      ? "Đang dùng placement đã lưu trong template đang chọn."
                      : "Preview có thể dùng fallback để xem nhanh, nhưng template vẫn cần placement đã lưu."}
                </p>
              </div>

              <button
                className="btn btn-secondary"
                onClick={() => setIsPlacementEditorOpen(true)}
                style={{
                  width: "100%",
                  fontSize: "0.78rem",
                  padding: "7px 10px",
                  minHeight: 44,
                  whiteSpace: "normal",
                  lineHeight: 1.2,
                }}
              >
                <SlidersHorizontal size={14} /> Chỉnh vị trí design
              </button>

              {isAdmin ? (
                <button
                  className="btn btn-secondary"
                  onClick={() => router.push(`/stores/${draft?.storeId}/config?step=placement`)}
                  style={{
                    width: "100%",
                    fontSize: "0.78rem",
                    padding: "7px 10px",
                    minHeight: 44,
                    whiteSpace: "normal",
                    lineHeight: 1.2,
                  }}
                >
                  Mở preset store
                </button>
              ) : (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-default)",
                    fontSize: "0.75rem",
                    lineHeight: 1.35,
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 800 }}>Preset store do Admin quản lý</p>
                  <p style={{ margin: "3px 0 0", opacity: 0.6 }}>
                    Nếu preset sai, liên hệ Admin để cập nhật.
                  </p>
                </div>
              )}

              {placementOverride && (
                <button
                  onClick={() => updatePlacementOverride(null)}
                  style={{
                    width: "100%",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    color: "var(--color-wise-green)",
                    fontWeight: 600,
                  }}
                >
                  Khôi phục preset store
                </button>
              )}
            </div>
          </div>
          )}
        </div>

        {/* RIGHT PANEL: LIVE PREVIEW + MOCKUP GALLERY */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <DesignProgressCard
            designs={selectedDraftDesigns}
            jobsByDesignId={mockupJobsByDesign}
            activeDraftDesignId={activeDraftDesignId}
            onSelectDesign={setActiveDraftDesignId}
            designPreviewUrls={designPreviewUrlsById}
            generationStartedAt={generationStartedAt}
            isCustomTemplate={isCustomTemplateDefault}
          />

          {isCustomTemplateDefault ? (
            draft?.storeId && selectedTemplate ? (
              <>
              <ColorMockupCardGrid
                draftId={draftId as string}
                templateId={selectedTemplate.id}
                selectedColors={storeColors.filter((c) => selectedColorIds.has(c.id))}
                designImageUrl={activeDesignPreviewUrl}
                mockupImages={activeMockupImages}
                onGenerate={handleGenerate}
                isGenerating={isGenerating}
                generateButtonLabel={generateButtonLabel}
                hasRenderedMockups={selectedDraftDesigns.length > 0 && selectedDraftDesigns.every((entry) => (mockupJobsByDesign.get(entry.id)?.images ?? []).length > 0)}
                onNextStep={async () => {
                  if (draft) {
                    const store = useWizardStore.getState();
                    store.updateDraft({
                      currentStep: Math.max(draft.currentStep, 4),
                    });
                    await store.saveDraftImmediately();
                  }
                  router.push(`/wizard/${draftId}/step-4`);
                }}
                onDeselectColor={(colorId) => toggleColor(colorId)}
                onMockupsStale={() => {
                  void loadDraft(draftId);
                }}
                printAreaMm={isCustomTemplateDefault ? { widthMm: WIZARD_PRINT_AREA.widthMm, heightMm: WIZARD_PRINT_AREA.heightMm } : null}
              />

              {/* Kết quả mockup — gallery grid gộp tất cả designs */}
              {(hasTriggeredBatchRender || isGenerating || allMockupImages.length > 0) && (
                <div className="card" style={{ padding: 20, minHeight: 200 }}>
                  <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
                    <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>
                      {resultsSectionTitle}
                    </h3>
                  </div>
                  <MockupGallery
                    draftId={draftId as string}
                    images={allMockupImages.filter((img) => {
                      const normalizedColorName = img.colorName.trim().toLowerCase();
                      return shouldShowInOfficialGallery(
                        img,
                        selectedTemplate?.defaultMockupSource ?? "PRINTIFY",
                      ) && storeColors.some(
                        (c) =>
                          selectedColorIds.has(c.id) &&
                          c.name.trim().toLowerCase() === normalizedColorName,
                      );
                    })}
                    isPolling={isGenerating}
                    progress={activeDesignProgress}
                  />
                </div>
              )}
              </>
            ) : null
          ) : (
            <>
              {showFullLivePreview ? (
                <div className="card" style={{ padding: 20 }}>
                  <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>{livePreviewTitle}</h3>
                      <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55 }}>
                        {livePreviewDescription}
                      </p>
                    </div>
                    {previewColors.length > 1 && (
                      <div className="flex items-center gap-1" style={{ flexWrap: "wrap" }}>
                        {previewColors.map((c, idx) => (
                          <button
                            key={c.id}
                            onClick={() => setPreviewColorIdx(idx)}
                            aria-label={`Xem màu ${c.name}`}
                            title={c.name}
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              backgroundColor: c.hex,
                              border:
                                idx === Math.min(previewColorIdx, previewColors.length - 1)
                                  ? "2px solid var(--text-primary, #2a2a2a)"
                                  : "1px solid var(--border-default)",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsPlacementEditorOpen(true)}
                    disabled={!previewColor || !currentPreviewPlacement}
                    style={{
                      marginBottom: 12,
                      minHeight: 40,
                      opacity: !previewColor || !currentPreviewPlacement ? 0.5 : 1,
                      cursor: !previewColor || !currentPreviewPlacement ? "not-allowed" : "pointer",
                    }}
                  >
                    <SlidersHorizontal size={14} />
                    Chỉnh vị trí design
                  </button>

                  {previewColor && currentPreviewPlacement ? (
                    <LivePreview
                      colorHex={previewColor.hex}
                      designUrl={activeDesignPreviewUrl}
                      placement={currentPreviewPlacement}
                      placementsByView={placementsByView}
                      availableViews={livePreviewViews}
                      selectedView={selectedLivePreviewView}
                      onViewChange={(view) => setLivePreviewView(view)}
                      printArea={WIZARD_PRINT_AREA}
                      height={420}
                    />
                  ) : (
                    <div style={{ padding: 40, textAlign: "center", opacity: 0.5 }}>
                      {selectedDraftDesigns.length === 0 ? (
                        <>
                          <ArrowUpCircle size={32} style={{ marginBottom: 8 }} />
                          <p style={{ fontSize: "0.85rem", margin: 0 }}>Chọn design ở bước trước.</p>
                        </>
                      ) : selectedColorIds.size === 0 && storeColors.length === 0 ? (
                        <p style={{ fontSize: "0.85rem", margin: 0 }}>Cấu hình màu ở Store Settings trước.</p>
                      ) : (
                        <p style={{ fontSize: "0.85rem", margin: 0 }}>Chọn màu và bật ít nhất 1 vị trí in để xem preview.</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="card"
                  style={{
                    padding: 14,
                    display: "grid",
                    gap: 10,
                    border: "1px solid var(--border-default)",
                    background: "var(--bg-primary)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>{livePreviewTitle}</h3>
                      <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                        {livePreviewDescription}
                      </p>
                    </div>
                    {previewColors.length > 1 && (
                      <div className="flex items-center gap-1" style={{ flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {previewColors.map((c, idx) => (
                          <button
                            key={c.id}
                            onClick={() => setPreviewColorIdx(idx)}
                            aria-label={`Xem màu ${c.name}`}
                            title={c.name}
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: "50%",
                              backgroundColor: c.hex,
                              border:
                                idx === Math.min(previewColorIdx, previewColors.length - 1)
                                  ? "2px solid var(--text-primary, #2a2a2a)"
                                  : "1px solid var(--border-default)",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: "var(--bg-inset, #f7f7f4)",
                      border: "1px solid var(--border-default)",
                      fontSize: "0.78rem",
                      lineHeight: 1.45,
                      color: "var(--text-muted)",
                    }}
                  >
                    Preview lớn và nút <strong>Chỉnh vị trí</strong> nằm ở khối mockup bên dưới, bám theo mockup đang chọn.
                  </div>
                </div>
              )}

              {isCustomTemplateDefault && draft?.storeId && selectedTemplate && (
                <WizardMockupSourcePanel
                  draftId={draftId as string}
                  storeId={draft.storeId}
                  templateId={selectedTemplate.id}
                  enabledColorIds={Array.from(selectedColorIds)}
                  storeColors={storeColors}
                  designImageUrl={activeDesignPreviewUrl}
                  onRegenerate={handleGenerate}
                  onRemoveColor={removeColorFromListing}
                  onMockupsStale={() => {
                    void loadDraft(draftId);
                  }}
                  printAreaMm={
                    isCustomTemplateDefault
                      ? { widthMm: WIZARD_PRINT_AREA.widthMm, heightMm: WIZARD_PRINT_AREA.heightMm }
                      : null
                  }
                />
              )}

              <div className="card" style={{ padding: 20, minHeight: 200 }}>
                <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
                  <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>
                    {resultsSectionTitle}
                    {selectedDraftDesigns.length > 1 ? ` · ${activeDesignTabLabel}` : ""}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      data-generate-mockups
                      className={`btn flex items-center gap-2 px-4 py-2 rounded font-medium ${allMockupImages.length > 0 ? "btn-secondary" : canGenerateMockups ? "btn-primary" : ""}`}
                      onClick={handleGenerate}
                      disabled={!canGenerateMockups}
                      style={!canGenerateMockups ? { backgroundColor: "var(--bg-tertiary)", color: "var(--color-text)", opacity: 0.5, cursor: "not-allowed" } : {}}
                    >
                      {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      {generateButtonLabel}
                    </button>
                    {allMockupImages.length > 0 && !isGenerating && (
                      <button
                        className="btn btn-primary flex items-center gap-2"
                        onClick={async () => {
                          if (draft) {
                            const store = useWizardStore.getState();
                            store.updateDraft({ currentStep: Math.max(draft.currentStep, 4) });
                            await store.saveDraftImmediately();
                          }
                          router.push(`/wizard/${draftId}/step-4`);
                        }}
                      >
                        Tiếp theo
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </div>


                {showSlowMockupWarning && isGenerating && overallJobProgress.total === 0 && (
                  <div
                    className="alert"
                    style={{
                      marginBottom: 12,
                      backgroundColor: "rgba(234, 179, 8, 0.06)",
                      border: "1px solid rgba(234, 179, 8, 0.25)",
                    }}
                  >
                    <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
                    <span style={{ fontSize: "0.82rem" }}>
                      {isCustomTemplateDefault
                        ? "Custom đang chuẩn bị mockup từ thư viện hoặc mockup riêng. Hệ thống vẫn đang kiểm tra và sẽ hiện lỗi nếu job bị kẹt."
                        : "Printify đang render lâu hơn bình thường. Hệ thống vẫn đang kiểm tra và sẽ hiện lỗi nếu job bị kẹt."}
                    </span>
                  </div>
                )}

                {draft?.mockupsStale && activeMockupImages.length > 0 && !isGenerating && (
                  <div
                    className="alert"
                    style={{
                      marginBottom: 12,
                      backgroundColor: "rgba(234, 179, 8, 0.06)",
                      border: "1px solid rgba(234, 179, 8, 0.25)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <AlertTriangle size={16} style={{ color: "var(--color-warning)", flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: "0.82rem" }}>
                      Mockup cũ không khớp placement/màu hiện tại.
                    </span>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "4px 10px", flexShrink: 0 }}
                      onClick={handleGenerate}
                      disabled={isGenerating}
                    >
                      Tạo lại mockup →
                    </button>
                  </div>
                )}

                {!(hasTriggeredBatchRender || isGenerating || activeMockupImages.length > 0) ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 0.5, padding: 24 }}>
                    <ImageIcon size={32} style={{ marginBottom: 8 }} />
                    <p style={{ fontSize: "0.85rem", margin: 0, textAlign: "center" }}>
                      {resultsEmptyState}
                    </p>
                  </div>
                ) : (
                  <MockupGallery
                    draftId={draftId as string}
                    images={activeMockupImages.filter((img) => {
                      const normalizedColorName = img.colorName.trim().toLowerCase();
                      return shouldShowInOfficialGallery(
                        img,
                        selectedTemplate?.defaultMockupSource ?? "PRINTIFY",
                      ) && storeColors.some(
                        (c) =>
                          selectedColorIds.has(c.id) &&
                          c.name.trim().toLowerCase() === normalizedColorName,
                      );
                    })}
                    isPolling={isGenerating}
                    progress={activeDesignProgress}
                    onSelectionChange={async () => {
                      if (!activeDesignJob?.jobId) return;
                      try {
                        const res = await fetch(`/api/mockup-jobs/${activeDesignJob.jobId}`);
                        if (res.ok) {
                          const job = await res.json();
                          setMockupJobsByDesign((current) => {
                            const next = new Map(current);
                            const images = job.images ?? [];
                            next.set(activeDesignJob.draftDesignId, {
                              ...activeDesignJob,
                              status: job.status ?? activeDesignJob.status,
                              completed:
                                job.completedImages ?? images.filter((img: any) => img.compositeStatus === "completed").length,
                              total: job.totalImages ?? images.length,
                              failed:
                                job.failedImages ?? images.filter((img: any) => img.compositeStatus === "failed").length,
                              images,
                              errorMessage: job.errorMessage ?? null,
                            });
                            return next;
                          });
                        }
                      } catch {
                        // gallery already shows optimistic state
                      }
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {isPlacementEditorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            className="card"
            style={{
              width: "min(1240px, 96vw)",
              maxHeight: "92vh",
              overflow: "auto",
              padding: 20,
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800 }}>Chỉnh vị trí design</h3>
                <p style={{ margin: "3px 0 0", opacity: 0.55, fontSize: "0.85rem" }}>
                  Thay đổi tại đây sẽ áp dụng cho toàn bộ designs trong wizard.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setIsPlacementEditorOpen(false)}
                aria-label="Đóng editor vị trí"
              >
                <X size={16} /> Đóng
              </button>
            </div>
            <div className="flex items-center gap-2" style={{ marginBottom: 12, flexWrap: "wrap" }}>
              {livePreviewViews.map((view) => (
                <button
                  key={view}
                  type="button"
                  className={selectedLivePreviewView === view ? "btn btn-primary" : "btn btn-secondary"}
                  onClick={() => setLivePreviewView(view)}
                  style={{ minHeight: 36 }}
                >
                  {view === "front" ? "Mặt trước" : view === "back" ? "Mặt sau" : view}
                </button>
              ))}
            </div>
            {currentPreviewPlacement ? (
              <CanvasPlacementEditor
                backgroundImageUrl={canvasBackgroundImageUrl}
                designImageUrl={activeDesignPreviewUrl}
                imageWidth={SVG_VIEWBOX_W}
                imageHeight={SVG_VIEWBOX_H}
                mode={canvasEditorMode}
                printAreaPx={printAreaPxForEditor}
                initialRegionPx={placementToCanvasRegionPx(
                  currentPreviewPlacement,
                  WIZARD_PRINT_AREA,
                )}
                onSave={(regionPx: CanvasRegionPx) => {
                  const nextPlacement = canvasRegionPxToPlacement(
                    regionPx,
                    currentPreviewPlacement,
                    WIZARD_PRINT_AREA,
                  );
                  updatePlacementOverride(
                    setPlacementForView(activePlacement, selectedLivePreviewView, nextPlacement),
                  );
                  toast.success(
                    canvasEditorMode === "CUSTOM_COMPOSITE"
                      ? "Đã lưu vùng ghép cho toàn bộ designs trong wizard"
                      : "Đã lưu vị trí design cho toàn bộ designs trong wizard",
                  );
                  setIsPlacementEditorOpen(false);
                }}
              />
            ) : (
              <div className="alert" style={{ marginBottom: 12 }}>
                <AlertTriangle size={16} />
                <span>Chưa có vị trí in để chỉnh. Hãy bật ít nhất một placement cho template.</span>
              </div>
            )}
            {placementOverride && (
              <button
                className="btn btn-secondary"
                onClick={() => updatePlacementOverride(null)}
                style={{ marginTop: 14 }}
              >
                Khôi phục toàn bộ preset store
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function placementToCanvasRegionPx(
  placement: Placement,
  printArea: { widthMm: number; heightMm: number; safeMarginMm: number },
): CanvasRegionPx {
  const { paSvgX, paSvgY, mmToSvg } = getPrintAreaSvgMetrics(printArea);
  return {
    x: roundOne(paSvgX + placement.xMm * mmToSvg),
    y: roundOne(paSvgY + placement.yMm * mmToSvg),
    width: roundOne(placement.widthMm * mmToSvg),
    height: roundOne(placement.heightMm * mmToSvg),
    rotationDeg: roundOne(placement.rotationDeg ?? 0),
    imageWidth: SVG_VIEWBOX_W,
    imageHeight: SVG_VIEWBOX_H,
  };
}

function canvasRegionPxToPlacement(
  regionPx: CanvasRegionPx,
  basePlacement: Placement,
  printArea: { widthMm: number; heightMm: number; safeMarginMm: number },
): Placement {
  const { paSvgX, paSvgY, mmToSvg } = getPrintAreaSvgMetrics(printArea);
  return {
    ...basePlacement,
    xMm: roundOne((regionPx.x - paSvgX) / mmToSvg),
    yMm: roundOne((regionPx.y - paSvgY) / mmToSvg),
    widthMm: roundOne(regionPx.width / mmToSvg),
    heightMm: roundOne(regionPx.height / mmToSvg),
    rotationDeg: roundOne(regionPx.rotationDeg),
  };
}

function getPrintAreaSvgMetrics(printArea: { widthMm: number; heightMm: number; safeMarginMm: number }) {
  // Dynamic: compute SVG dimensions from mm using reference scale
  const REF_MM_TO_SVG = PRINT_AREA_SVG_HEIGHT / DEFAULT_PRINT_AREA.heightMm;
  const paSvgH = Math.min(printArea.heightMm * REF_MM_TO_SVG, SVG_VIEWBOX_H * 0.65);
  const paSvgW = Math.min(printArea.widthMm * REF_MM_TO_SVG, SVG_VIEWBOX_W * 0.65);
  const paSvgX = PRINT_AREA_CENTER_X - paSvgW / 2;
  const paSvgY = PRINT_AREA_CENTER_Y - paSvgH / 2;
  const mmToSvg = paSvgH / printArea.heightMm;
  return { paSvgX, paSvgY, mmToSvg };
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";

import { pickLatestMockupJobId } from "@/lib/mockup/latest-job";
import { isTerminalMockupJobStatus, shouldSyncFinishedMockupJob } from "@/lib/mockup/job-sync";
import { MOCKUP_JOB_SOFT_WAIT_MS } from "@/lib/mockup/job-timeout";
import { shouldShowInOfficialGallery } from "@/lib/mockup/official-gallery";
import { MockupGallery } from "@/components/mockup/MockupGallery";
import { WizardMockupSourcePanel } from "@/components/mockup/WizardMockupSourcePanel";
import { ColorMockupCardGrid } from "@/components/mockup/ColorMockupCardGrid";
import {
  CanvasPlacementEditor,
  type CanvasRegionPx,
} from "@/components/placement/CanvasPlacementEditor";
import { LivePreview } from "@/components/mockup/LivePreview";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  Image as ImageIcon,
  CheckSquare,
  Square,
  ArrowUpCircle,
  SlidersHorizontal,
  X,
  Ruler,
} from "lucide-react";
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

type TemplateReadinessLabel = "DEFAULT" | "DEFAULT INCOMPLETE" | "READY" | "INCOMPLETE";

type WizardTemplateOption = {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  blueprintTitle: string;
  printProviderTitle: string;
  defaultMockupSource: "PRINTIFY" | "CUSTOM";
  enabledVariantIds: number[];
  enabledSizes: string[];
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
    sortOrder: number;
    customMockupCount?: number;
    hasCustomMockup?: boolean;
  }>;
};

const WIZARD_PRINT_AREA = { ...DEFAULT_PRINT_AREA, safeMarginMm: 12.7 };

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
  const [designPreviewUrl, setDesignPreviewUrl] = useState<string | null>(null);
  const [previewColorIdx, setPreviewColorIdx] = useState(0);
  const [livePreviewView, setLivePreviewView] = useState<ViewKey>("front");

  // Local state for UI
  const [selectedColorIds, setSelectedColorIds] = useState<Set<string>>(new Set());
  const [placementOverride, setPlacementOverride] = useState<PlacementData | null>(null);
  const [isPlacementEditorOpen, setIsPlacementEditorOpen] = useState(false);

  // Generating state
  const [generating, setGenerating] = useState(false);
  const [mockupJobId, setMockupJobId] = useState<string | null>(null);
  const [mockupImages, setMockupImages] = useState<any[]>([]);
  const [jobProgress, setJobProgress] = useState({ completed: 0, total: 0, failed: 0 });
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [showSlowMockupWarning, setShowSlowMockupWarning] = useState(false);
  const [hasTriggeredMockupRender, setHasTriggeredMockupRender] = useState(false);

  // Size selection state
  const [storeSizes, setStoreSizes] = useState<Array<{ size: string; costDeltaCents: number; isAvailable: boolean }>>([]);
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [userRole, setUserRole] = useState<string | null>(null);
  const syncedJobIdsRef = useRef<Set<string>>(new Set());
  const progressFinished =
    jobProgress.total > 0 &&
    jobProgress.completed + jobProgress.failed >= jobProgress.total;
  const isGenerating =
    generating ||
    (jobStatus ? !isTerminalMockupJobStatus(jobStatus) && !progressFinished : false);
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
    'Khi sẵn sàng, nhấn "Tạo Mockups" để render ảnh listing.';
  const customAvailabilityByColorId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const color of selectedTemplate?.colors ?? []) {
      map.set(color.id, Boolean(color.hasCustomMockup || (color.customMockupCount ?? 0) > 0));
    }
    return map;
  }, [selectedTemplate]);
  const selectedMissingCustomColors = useMemo(() => {
    if (!isCustomTemplateDefault) return [];
    return storeColors.filter(
      (color) => selectedColorIds.has(color.id) && !customAvailabilityByColorId.get(color.id),
    );
  }, [customAvailabilityByColorId, isCustomTemplateDefault, selectedColorIds, storeColors]);
  const hasSelectedMissingCustomColors = selectedMissingCustomColors.length > 0;
  const generateButtonLabel = isGenerating
    ? progressFinished
      ? "Đang đồng bộ kết quả..."
      : `Đang tạo... (${jobProgress.completed}/${jobProgress.total || "..."})`
    : "Tạo Mockups";
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

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setUserRole(data?.role ?? null))
      .catch(() => setUserRole(null));
  }, []);

  useEffect(() => {
    if (!isGenerating || !generationStartedAt || jobProgress.total > 0) {
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
  }, [generationStartedAt, isGenerating, jobProgress.total]);

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

  useEffect(() => {
    if (!draft || draft.id !== draftId) return; // Wait for direct route draft hydration
    if (!draft.storeId) {
      setError("Chưa chọn Store ở bước 1.");
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/stores/${draft.storeId}/mockup-templates`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Failed to fetch templates");
        return r.json();
      })
      .then((tData) => {
        const nextTemplates: WizardTemplateOption[] = Array.isArray(tData.templates)
          ? tData.templates
          : [];
        const activeTemplate =
          nextTemplates.find((candidate) => candidate.id === draft.templateId) ??
          nextTemplates.find((candidate) => candidate.isDefault) ??
          nextTemplates[0] ??
          null;

        setTemplates(nextTemplates);
        setTemplate(activeTemplate);
        setTemplateWarning("");

        const enabledColors = (activeTemplate?.colors ?? []).filter((color) => color.enabled !== false);
        setStoreColors(enabledColors);
        setPresetStatus(activeTemplate?.readiness ?? { ready: false, missing: ["template"] });

        if (!activeTemplate || !draft.storeId) {
          setStoreSizes([]);
          setSelectedSizes(new Set());
          setLoading(false);
          return;
        }

        const sizeUrl = `/api/stores/${draft.storeId}/sizes?templateId=${activeTemplate.id}`;
        fetch(sizeUrl)
          .then(async (r) => {
            if (!r.ok) return;
            const sData = await r.json();
            const templateEnabledSizes: string[] =
              activeTemplate.enabledSizes?.length
                ? activeTemplate.enabledSizes
                : sData.enabledSizes ?? sData.sizes?.map((s: any) => s.size) ?? [];
            const availableSizes = (sData.sizes ?? []).filter((s: any) =>
              templateEnabledSizes.includes(s.size),
            );
            setStoreSizes(availableSizes);
            const draftSizes: string[] = ((draft as any)?.enabledSizes ?? []).filter((size: string) =>
              templateEnabledSizes.includes(size),
            );
            setSelectedSizes(new Set(draftSizes.length > 0 ? draftSizes : templateEnabledSizes));
          })
          .catch(() => {})
          .finally(() => setLoading(false));
      })
      .catch((err) => {
        console.error(err);
        setError("Không tải được preset store. Vui lòng thử lại.");
        setLoading(false);
      });
  }, [draft?.id, draft?.storeId, draft?.templateId, draftId, retryNonce]);

  // Load existing mockups if available
  useEffect(() => {
    if (draft?.mockupJobs && draft.mockupJobs.length > 0) {
      if (mockupJobId && !draft.mockupJobs.some((job) => job.id === mockupJobId)) {
        return;
      }
      const latestJobId = pickLatestMockupJobId(draft.mockupJobs, mockupJobId);
      const latestJob = [...draft.mockupJobs].sort(
        (a: any, b: any) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      )[0] as any;
      if (latestJob?.images?.length) {
        setMockupImages(latestJob.images);
        setJobStatus(latestJob.status);
        setJobProgress({
          completed: latestJob.completedImages ?? latestJob.images.filter((img: any) => img.compositeStatus === "completed").length,
          total: latestJob.totalImages ?? latestJob.images.length,
          failed: latestJob.failedImages ?? latestJob.images.filter((img: any) => img.compositeStatus === "failed").length,
        });
        const latestJobFinished =
          (latestJob.totalImages ?? latestJob.images.length) > 0 &&
          (latestJob.completedImages ?? 0) + (latestJob.failedImages ?? 0) >=
            (latestJob.totalImages ?? latestJob.images.length);
        if (isTerminalMockupJobStatus(latestJob.status) || latestJobFinished) {
          setGenerating(false);
          setHasTriggeredMockupRender(false);
        } else {
          setHasTriggeredMockupRender(true);
        }
      }
      if (latestJobId) setMockupJobId(latestJobId);
    }
  }, [draft?.mockupJobs, mockupJobId]);

  // Fetch design preview URL for LivePreview
  useEffect(() => {
    if (!draft?.designId) {
      setDesignPreviewUrl(null);
      return;
    }
    fetch(`/api/designs/${draft.designId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setDesignPreviewUrl(d?.previewUrl ?? d?.originalUrl ?? null))
      .catch(() => setDesignPreviewUrl(null));
  }, [draft?.designId]);

  // Polling mockup job status
  useEffect(() => {
    if (!mockupJobId) return;

    let timeoutId: NodeJS.Timeout;

    const pollJob = async () => {
      try {
        const res = await fetch(`/api/mockup-jobs/${mockupJobId}`);
        if (!res.ok) throw new Error("Failed to fetch job");
        const job = await res.json();
        const finishedByProgress =
          job.totalImages > 0 &&
          job.completedImages + job.failedImages >= job.totalImages;

        setJobStatus(job.status);
        setJobProgress({
          completed: job.completedImages,
          total: job.totalImages,
          failed: job.failedImages
        });

        setMockupImages(job.images || []);

        if ((job.status === "running" || job.status === "pending") && !finishedByProgress) {
          setGenerating(true);
          timeoutId = setTimeout(pollJob, 2000);
        } else {
          setGenerating(false);
          setGenerationStartedAt(null);
          setShowSlowMockupWarning(false);
          if (job.status === "completed" && job.images?.length > 0) {
            toast.success(`Đã tạo ${job.images.length} mockups`);
          } else if (job.status === "failed") {
            setError(job.errorMessage || "Printify tạo mockup lỗi. Vui lòng thử lại.");
          }
          const draftJobStatus = useWizardStore
            .getState()
            .draft?.mockupJobs?.find((draftJob) => draftJob.id === mockupJobId)
            ?.status;
          const alreadySynced = syncedJobIdsRef.current.has(mockupJobId);
          if (
            shouldSyncFinishedMockupJob({
              jobStatus: job.status,
              draftJobStatus,
              alreadySynced,
            })
          ) {
            syncedJobIdsRef.current.add(mockupJobId);
            useWizardStore.getState().loadDraft(draftId as string);
          } else if (!alreadySynced) {
            syncedJobIdsRef.current.add(mockupJobId);
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
        setGenerating(false);
        setGenerationStartedAt(null);
        setShowSlowMockupWarning(false);
      }
    };

    pollJob();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [mockupJobId, draftId]);

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

  const toggleSize = (size: string) => {
    const next = new Set(selectedSizes);
    if (next.has(size)) next.delete(size);
    else next.add(size);
    setSelectedSizes(next);
    updateDraft({ enabledSizes: Array.from(next) });
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
    const nextSizes = nextTemplate.enabledSizes ?? [];

    setTemplate(nextTemplate);
    setTemplateWarning("");
    setStoreColors(nextTemplate.colors.filter((color) => color.enabled !== false));
    setSelectedColorIds(new Set(nextColorIds));
    setSelectedSizes(new Set(nextSizes));
    setPlacementOverride(null);
    setPreviewColorIdx(0);
    setLivePreviewView("front");
    setMockupJobId(null);
    setMockupImages([]);
    setJobStatus(null);
    setJobProgress({ completed: 0, total: 0, failed: 0 });
    setGenerating(false);
    setGenerationStartedAt(null);
    setShowSlowMockupWarning(false);
    setHasTriggeredMockupRender(false);
    setError("");

    await updateDraft({
      templateId: nextTemplate.id,
      enabledColorIds: nextColorIds,
      enabledSizes: nextSizes,
      enabledVariantIdsOverride: [],
      placementOverride: null,
    });
    await saveDraftImmediately();
    setRetryNonce((value) => value + 1);
  };

  const handleGenerate = async () => {
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
    setJobStatus("pending");
    setJobProgress({ completed: 0, total: 0, failed: 0 });
    setMockupImages([]);
    setGenerationStartedAt(Date.now());
    setShowSlowMockupWarning(false);
    setHasTriggeredMockupRender(true);
    setError("");

    // 1. Save state to draft
    const enabledColorIds = Array.from(selectedColorIds);
    await updateDraft({
      templateId: selectedTemplate.id,
      enabledColorIds,
      enabledSizes: Array.from(selectedSizes),
      placementOverride: placementOverride || undefined,
    });
    await saveDraftImmediately();

    // 2. Trigger Mockup Generation Job
    try {
      const res = await fetch(`/api/mockup-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId })
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
      } else {
        setMockupJobId(data.jobId);
        setJobStatus(data.status ?? "pending");
      }
    } catch (e) {
      setError("Lỗi kết nối");
      setGenerating(false);
      setGenerationStartedAt(null);
      setShowSlowMockupWarning(false);
    }
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
  const placementSourceLabel = placementOverride ? "Đã override cho design này" : "Dùng preset của store";
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
                onClick={() => router.push(`/stores/${draft?.storeId}/mockup-library?templateId=${selectedTemplate?.id}`)}
              >
                Mở Thư viện mockup
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

      {!draft?.designId && (
        <div className="alert" style={{ marginBottom: 16, backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
          <div className="flex-1">
            <p style={{ margin: 0, fontWeight: 500 }}>Chưa có Design</p>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>Bạn cần chọn design ở bước trước để tạo mockup.</p>
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
          <div id="mockup-template-selector" className="card" style={{ padding: 16 }}>
            <div className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Mockup template</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                  Chọn template cho listing hiện tại
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

          <div className="card" style={{ padding: 16 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
              <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Màu sắc</h3>
              <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>{selectedColorIds.size}/{storeColors.length}</span>
            </div>

            <div className="flex gap-2 mb-4">
              <button className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: "0.75rem", flex: 1 }} onClick={selectAllColors}>Chọn hết</button>
              <button className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: "0.75rem", flex: 1 }} onClick={deselectAllColors}>Bỏ chọn</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
              {storeColors.map(color => {
                const selected = selectedColorIds.has(color.id);
                const missingCustomMockup =
                  isCustomTemplateDefault && !customAvailabilityByColorId.get(color.id);
                return (
                  <div
                    key={color.id}
                    onClick={() => toggleColor(color.id)}
                    title={missingCustomMockup ? "Màu này chưa có mockup custom." : color.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 12px",
                      borderRadius: "var(--radius-md)",
                      border: selected ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                      backgroundColor: selected ? "rgba(146, 198, 72, 0.05)" : "transparent",
                      cursor: missingCustomMockup ? "not-allowed" : "pointer",
                      opacity: missingCustomMockup ? 0.48 : 1,
                    }}
                  >
                    {selected ? (
                      <CheckSquare size={18} color="var(--color-wise-green)" />
                    ) : (
                      <Square size={18} opacity={0.3} />
                    )}
                    <div style={{ width: 16, height: 16, borderRadius: "50%", backgroundColor: color.hex, border: "1px solid rgba(0,0,0,0.1)" }} />
                    <span style={{ fontSize: "0.85rem", fontWeight: 500, flex: 1 }}>{color.name}</span>
                    {missingCustomMockup && (
                      <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#92400e" }}>
                        Thiếu mockup
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* SIZES PANEL */}
          {storeSizes.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>
                  <Ruler size={14} style={{ display: "inline", marginRight: 6, opacity: 0.5 }} />
                  Kích thước
                </h3>
                <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>{selectedSizes.size}/{storeSizes.length}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {storeSizes.map(s => {
                  const on = selectedSizes.has(s.size);
                  const disabled = !s.isAvailable;
                  return (
                    <button
                      key={s.size}
                      type="button"
                      onClick={() => !disabled && toggleSize(s.size)}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 8,
                        border: on ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                        backgroundColor: disabled ? "rgba(148,163,184,0.08)" : on ? "rgba(159,232,112,0.08)" : "transparent",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.4 : 1,
                        fontSize: "0.8rem",
                        fontWeight: on ? 600 : 400,
                        transition: "all 0.12s",
                      }}
                    >
                      {s.size}
                      {s.costDeltaCents > 0 && (
                        <span style={{ fontSize: "0.65rem", color: "#f59e0b", marginLeft: 3 }}>+${(s.costDeltaCents / 100).toFixed(2)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
                    ? "Chỉ áp dụng cho listing hiện tại."
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
          {isCustomTemplateDefault ? (
            draft?.storeId && selectedTemplate ? (
              <ColorMockupCardGrid
                draftId={draftId as string}
                templateId={selectedTemplate.id}
                selectedColors={storeColors.filter((c) => selectedColorIds.has(c.id))}
                designImageUrl={designPreviewUrl}
                mockupImages={mockupImages}
                onGenerate={handleGenerate}
                isGenerating={isGenerating}
                generateButtonLabel={generateButtonLabel}
              />
            ) : null
          ) : (
            <>
          {/* Live preview / placement editor */}
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
                          width: 24, height: 24, borderRadius: "50%",
                          backgroundColor: c.hex,
                          border: idx === Math.min(previewColorIdx, previewColors.length - 1)
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
                  designUrl={designPreviewUrl}
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
                  {!draft?.designId ? (
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
                          border: idx === Math.min(previewColorIdx, previewColors.length - 1)
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

          {/* Generate button + Real Mockup Gallery */}
          {/* MOCKUP SOURCE PANEL */}
          {draft?.storeId && (
            <WizardMockupSourcePanel
              draftId={draftId as string}
              storeId={draft.storeId}
              templateId={selectedTemplate?.id ?? null}
              enabledColorIds={Array.from(selectedColorIds)}
              storeColors={storeColors}
              designImageUrl={designPreviewUrl}
              onRegenerate={handleGenerate}
              onRemoveColor={removeColorFromListing}
            />
          )}

          <div className="card" style={{ padding: 20, minHeight: 200 }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 16 }}>
              <h3 style={{ fontWeight: 600, margin: 0, fontSize: "0.95rem" }}>{resultsSectionTitle}</h3>
              <button
                data-generate-mockups
                className={`btn flex items-center gap-2 px-4 py-2 rounded font-medium ${draft?.designId && !isGenerating && selectedTemplateReady && !hasSelectedMissingCustomColors ? 'btn-primary' : ''}`}
                onClick={handleGenerate}
                disabled={isGenerating || !draft?.designId || selectedColorIds.size === 0 || !selectedTemplateReady || hasSelectedMissingCustomColors}
                style={(!draft?.designId || isGenerating || selectedColorIds.size === 0 || !selectedTemplateReady || hasSelectedMissingCustomColors) ? { backgroundColor: "var(--bg-tertiary)", color: "var(--color-text)", opacity: 0.5, cursor: "not-allowed" } : {}}
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {generateButtonLabel}
              </button>
            </div>

            {showSlowMockupWarning && isGenerating && jobProgress.total === 0 && (
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

            {/* Outdated mockup banner */}
            {draft?.mockupsStale && mockupImages.length > 0 && !isGenerating && (
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

            {!(hasTriggeredMockupRender || isGenerating || mockupImages.length > 0) ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 0.5, padding: 24 }}>
                <ImageIcon size={32} style={{ marginBottom: 8 }} />
                <p style={{ fontSize: "0.85rem", margin: 0, textAlign: "center" }}>
                  {resultsEmptyState}
                </p>
              </div>
            ) : (
              <MockupGallery
                draftId={draftId as string}
                images={mockupImages.filter((img) => {
                  const normalizedColorName = img.colorName.trim().toLowerCase();
                  return shouldShowInOfficialGallery(
                    img,
                    selectedTemplate?.defaultMockupSource ?? "PRINTIFY",
                  ) && storeColors.some(
                    (c) =>
                      selectedColorIds.has(c.id) &&
                      c.name.trim().toLowerCase() === normalizedColorName
                  );
                })}
                isPolling={isGenerating}
                progress={jobProgress}
                onSelectionChange={async () => {
                  // Refetch mockup images so parent state stays in sync
                  if (!mockupJobId) return;
                  try {
                    const res = await fetch(`/api/mockup-jobs/${mockupJobId}`);
                    if (res.ok) {
                      const job = await res.json();
                      setJobStatus(job.status);
                      setJobProgress({
                        completed: job.completedImages,
                        total: job.totalImages,
                        failed: job.failedImages,
                      });
                      setMockupImages(job.images || []);
                    }
                  } catch { /* gallery already shows optimistic state */ }
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
                  Thay đổi tại đây chỉ áp dụng cho listing hiện tại.
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
                designImageUrl={designPreviewUrl}
                imageWidth={SVG_VIEWBOX_W}
                imageHeight={SVG_VIEWBOX_H}
                mode={canvasEditorMode}
                initialRegionPx={placementToCanvasRegionPx(
                  currentPreviewPlacement,
                  WIZARD_PRINT_AREA,
                )}
                onSave={(regionPx) => {
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
                      ? "Đã lưu vùng ghép cho listing hiện tại"
                      : "Đã lưu vị trí design cho listing hiện tại",
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
  printArea: typeof WIZARD_PRINT_AREA,
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
  printArea: typeof WIZARD_PRINT_AREA,
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

function getPrintAreaSvgMetrics(printArea: typeof WIZARD_PRINT_AREA) {
  const printAreaAspect = printArea.widthMm / printArea.heightMm;
  const paSvgH = PRINT_AREA_SVG_HEIGHT;
  const paSvgW = paSvgH * printAreaAspect;
  const paSvgX = PRINT_AREA_CENTER_X - paSvgW / 2;
  const paSvgY = PRINT_AREA_CENTER_Y - paSvgH / 2;
  const mmToSvg = paSvgH / printArea.heightMm;
  return { paSvgX, paSvgY, mmToSvg };
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

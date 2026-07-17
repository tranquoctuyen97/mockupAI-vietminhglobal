"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import {
  getActiveDraftDesignId,
  getLatestJobByDraftDesignId,
} from "@/lib/mockup/multi-design";
import { isRealPrintifyMockupMedia } from "@/lib/mockup/real-printify-media";
import { viewLabel } from "@/lib/placement/views";
import {
  mergeDraftAndTemplatePriceMaps,
  normalizePriceBySizeDefault,
  resolveBaseTemplatePrice,
  resolvePriceForSize,
} from "@/lib/pricing/template-pricing";
import { getPublishPhaseLabel } from "@/lib/publish/phases";
import {
  formatContentChecklistLabel,
  formatListingSummaryLabel,
  getIndependentDraftDesigns,
  getPairedDraftDesignIds,
} from "@/lib/wizard/publish-units";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageOff,
  Loader2,
  Play,
  Check,
  XCircle,
} from "lucide-react";

interface AiContent {
  title: string;
  description: string;
  tags: string[];
  altText: string;
}

interface SizeOption {
  size: string;
  costCents: number;
  costDeltaCents: number;
}

interface Checklist {
  mockupsMatchColors: boolean;
  contentComplete: boolean;
  placementValid: boolean;
  mockupsNotStale: boolean;
  colorGroupsBalanced?: boolean;
  readyToPublish: boolean;
}

interface MockupImage {
  id: string;
  printifyMockupId?: string;
  colorName: string;
  viewPosition: string;
  sourceUrl: string;
  compositeUrl: string | null;
  compositeStatus: string;
  included: boolean;
  isDefault?: boolean;
  cameraLabel?: string | null;
  mockupType?: string | null;
  sortOrder?: number;
}

interface MockupJob {
  id: string;
  draftDesignId?: string | null;
  designId?: string | null;
  status: string;
  totalImages?: number;
  completedImages?: number;
  failedImages?: number;
  images?: MockupImage[];
}

interface DraftDesignEntry {
  id: string;
  designId: string;
  sortOrder: number;
  aiContent?: unknown | null;
  design?: {
    id: string;
    name?: string | null;
    previewPath?: string | null;
  } | null;
  jobs?: MockupJob[];
}

interface StoreColor {
  id: string;
  name: string;
  hex: string;
}

interface PublishLog {
  stage: string;
  message: string;
  status: "pending" | "success" | "error";
}

interface PublishDesignState {
  listingId: string | null;
  status: "IDLE" | "PUBLISHING" | "SUCCESS" | "ERROR";
  logs: PublishLog[];
  alreadyPublished?: boolean;
}

interface PublishResponseEntry {
  listingId: string;
  designPairId?: string | null;
  draftDesignId: string | null;
  designId: string;
  designName: string;
  status: string;
  alreadyPublished: boolean;
}

interface PersistedPublishJob {
  stage: string;
  status: string;
  phase?: string | null;
  progressMessage?: string | null;
  lastError?: string | null;
}

interface PersistedPublishListing {
  id: string;
  status: string;
  wizardDraftDesignId?: string | null;
  wizardDraftDesignPairId?: string | null;
  designId?: string | null;
  publishJobs?: PersistedPublishJob[];
}

interface PublishDisplayEntry {
  id: string;
  publishKey: string;
  title: string;
  publish: PublishDesignState;
}

function formatPriceDisplay(raw: string): string {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return raw;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        color: "var(--color-wise-green)",
        fontSize: "0.78rem",
        marginLeft: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        textDecoration: "none",
        opacity: 0.85,
      }}
    >
      {children} <ExternalLink size={10} />
    </a>
  );
}

function toPublicUrl(storagePathOrUrl: string | null | undefined): string | null {
  if (!storagePathOrUrl || storagePathOrUrl.startsWith("mockup://")) {
    return null;
  }

  if (
    storagePathOrUrl.startsWith("/") ||
    storagePathOrUrl.startsWith("http://") ||
    storagePathOrUrl.startsWith("https://") ||
    storagePathOrUrl.startsWith("data:")
  ) {
    return storagePathOrUrl;
  }

  return `/api/files/${storagePathOrUrl.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeColorName(value: string): string {
  return value.trim().toLowerCase();
}

function isUsableMockupImage(image: MockupImage): boolean {
  const isCustomSource =
    image.sourceUrl?.startsWith("mockup://custom/") ||
    image.sourceUrl?.startsWith("mockup://custom-") ||
    image.sourceUrl?.startsWith("mockup://library/");
  const isPrintifySource = isRealPrintifyMockupMedia(image);
  return image.included && (isCustomSource || isPrintifySource);
}

function defaultPublishState(): PublishDesignState {
  return { listingId: null, status: "IDLE", logs: [] };
}

function compactPublishLogs(state: PublishDesignState): PublishLog[] {
  const latestByStage = new Map<string, PublishLog>();

  for (const log of state.logs) {
    latestByStage.set(log.stage, log);
  }

  const logs = Array.from(latestByStage.values());

  if (state.status === "SUCCESS") {
    const successLogs = logs.filter((log) => log.status === "success");
    return successLogs.length > 0 ? successLogs : logs;
  }

  return logs;
}

function jobToPublishLog(job: PersistedPublishJob): PublishLog | null {
  const stage = job.stage.toUpperCase();
  const status = job.status.toUpperCase();

  if (stage === "PRINTIFY") {
    if (status === "SUCCEEDED") {
      return { stage: "PRINTIFY", message: "Đã publish lên Printify", status: "success" };
    }
    if (status === "FAILED") {
      return {
        stage: "PRINTIFY",
        message: job.lastError || "Publish lên Printify bị lỗi",
        status: "error",
      };
    }
    return { stage: "PRINTIFY", message: "Đang publish lên Printify...", status: "pending" };
  }

  if (stage === "SHOPIFY") {
    if (status === "SUCCEEDED") {
      return { stage: "SHOPIFY", message: "Đã publish lên Shopify", status: "success" };
    }
    if (status === "FAILED") {
      return {
        stage: "SHOPIFY",
        message: job.lastError || "Publish lên Shopify bị lỗi",
        status: "error",
      };
    }
    if (job.progressMessage) {
      const phaseMessage = getPublishPhaseLabel(job.phase) ?? job.progressMessage;
      return {
        stage: job.phase || "SHOPIFY",
        message: phaseMessage,
        status: "pending",
      };
    }
    return { stage: "SHOPIFY", message: "Đang publish lên Shopify...", status: "pending" };
  }

  return null;
}

function publishStateFromPersistedListing(listing: PersistedPublishListing): PublishDesignState {
  const jobs = listing.publishJobs ?? [];
  const hasRunningJob = jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING");
  const hasFailedJob = jobs.some((job) => job.status === "FAILED");
  const logs = jobs.map(jobToPublishLog).filter((log): log is PublishLog => Boolean(log));

  if (listing.status === "ACTIVE") {
    return {
      listingId: listing.id,
      status: "SUCCESS",
      alreadyPublished: true,
      logs: logs.length > 0 ? logs : [{ stage: "DONE", message: "Publish hoàn tất!", status: "success" }],
    };
  }

  if (hasRunningJob || listing.status === "PUBLISHING") {
    return {
      listingId: listing.id,
      status: "PUBLISHING",
      alreadyPublished: true,
      logs: logs.length > 0 ? logs : [{ stage: "INIT", message: "Đang publish...", status: "pending" }],
    };
  }

  if (hasFailedJob || listing.status === "FAILED" || listing.status === "PARTIAL_FAILURE") {
    const failedJob = jobs.find((job) => job.status === "FAILED");
    return {
      listingId: listing.id,
      status: "ERROR",
      alreadyPublished: true,
      logs:
        logs.length > 0
          ? logs
          : [
              {
                stage: "ERROR",
                message: failedJob?.lastError || "Publish trước đó bị lỗi.",
                status: "error",
              },
            ],
    };
  }

  return {
    listingId: listing.id,
    status: "IDLE",
    alreadyPublished: true,
    logs: [],
  };
}

function initialLogsFromPublishResponse(listing: PublishResponseEntry): PublishLog[] {
  if (listing.status === "ACTIVE") {
    return [{ stage: "DONE", message: "Publish hoàn tất!", status: "success" }];
  }

  if (listing.status === "PARTIAL_FAILURE" || listing.status === "FAILED") {
    return [{ stage: "ERROR", message: "Publish trước đó bị lỗi.", status: "error" }];
  }

  if (listing.status === "PUBLISHING") {
    return [{ stage: "INIT", message: "Đang publish...", status: "pending" }];
  }

  if (listing.alreadyPublished) {
    return [{ stage: "DONE", message: "Listing đã tồn tại.", status: "success" }];
  }

  return [{ stage: "INIT", message: "Đang publish...", status: "pending" }];
}

export default function Step5ReviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const { draft, checklist: storeChecklist } = useWizardStore();

  // Derive loading from zustand — layout already loads the draft
  const loading = !draft || draft.id !== draftId;
  const [price, setPrice] = useState("24.99");
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  // Use checklist from zustand store (loaded by layout's loadDraft)
  const localChecklist = (storeChecklist as Checklist | null) ?? null;
  const [activeDesignId, setActiveDesignId] = useState<string | null>(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [publishStateByDesignId, setPublishStateByDesignId] = useState<Record<string, PublishDesignState>>({});

  // Per-size price override state
  const [priceBySizeOverride, setPriceBySizeOverride] = useState<Record<string, string>>({});
  const [savedPriceOverride, setSavedPriceOverride] = useState<Record<string, number> | null>(null);
  const [priceOverrideDirty, setPriceOverrideDirty] = useState(false);
  const [savingPriceOverride, setSavingPriceOverride] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const listingIdToDesignIdRef = useRef<Map<string, string>>(new Map());

  const designPairs = useMemo(() => {
    return (draft?.designPairs ?? []) as Array<{
      id: string;
      baseName: string;
      lightDraftDesignId: string;
      darkDraftDesignId: string;
      lightDesign?: any;
      darkDesign?: any;
      aiContent?: any;
    }>;
  }, [draft?.designPairs]);

  const persistedPublishListings = useMemo(
    () => ((draft as { listings?: PersistedPublishListing[] } | null)?.listings ?? []),
    [draft],
  );

  const hasPairs = designPairs.length > 0;
  const storeColors = (draft?.store?.colors ?? []) as StoreColor[];
  const selectedColorIds = new Set(draft?.enabledColorIds ?? []);
  const colors = storeColors.filter((color) => selectedColorIds.has(color.id));
  const colorHexLookup = useMemo(
    () => new Map(colors.map((color) => [color.name.toLowerCase(), color.hex])),
    [colors],
  );

  const selectedDraftDesigns = useMemo<DraftDesignEntry[]>(() => {
    const childRows = (draft?.draftDesigns ?? []) as DraftDesignEntry[];
    if (childRows.length > 0) {
      return [...childRows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }

    if (!draft?.designId) return [];

    return [
      {
        id: draft.designId,
        designId: draft.designId,
        sortOrder: 0,
        design: draft.design
          ? {
              id: draft.design.id ?? draft.designId,
              name: draft.design.name ?? "Design",
              previewPath: draft.design.previewPath ?? null,
            }
          : { id: draft.designId, name: "Design", previewPath: null },
        jobs: (draft.mockupJobs ?? []) as MockupJob[],
      },
    ];
  }, [draft?.design, draft?.designId, draft?.draftDesigns, draft?.mockupJobs]);

  const pairedDraftDesignIds = useMemo(
    () => getPairedDraftDesignIds(designPairs),
    [designPairs],
  );

  const independentDesigns = useMemo(
    () => getIndependentDraftDesigns(selectedDraftDesigns, designPairs),
    [selectedDraftDesigns, designPairs],
  );

  const independentCount = independentDesigns.length;

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

  const selectedDraftDesignIds = useMemo(
    () => selectedDraftDesigns.map((entry) => entry.id),
    [selectedDraftDesigns],
  );

  // Draft + checklist are loaded by layout's loadDraft → no re-fetch needed here.
  // Sync checklist to zustand if present.
  // (Removed: independent fetch(drafts/${id}) that caused 3× duplicate calls)

  // Checklist is already in zustand store from layout loadDraft — no sync needed.

  useEffect(() => {
    setActiveDesignId((current) => getActiveDraftDesignId(selectedDraftDesignIds, current));
  }, [selectedDraftDesignIds]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Stable scalar deps to avoid cascade re-fetches when draft object reference changes.
  const stableStoreId = draft?.storeId ?? null;
  const stableTemplateId = draft?.templateId ?? null;
  const templatePricingSource =
    draft?.template ??
    draft?.store?.template ??
    draft?.store?.templates?.find((template) => template.isDefault) ??
    null;
  const templateBasePriceUsd = templatePricingSource?.basePriceUsd ?? null;
  const templatePriceBySizeDefault = templatePricingSource?.priceBySizeDefault ?? null;
  const storeDefaultPriceUsd = draft?.store?.defaultPriceUsd ?? null;

  // Try to use bundled data from ?expand=sizes (set by layout for step-5)
  const { expandedSizes } = useWizardStore();

  useEffect(() => {
    if (!stableStoreId || !draftId || loading) return;

    setPrice(resolveBaseTemplatePrice({
      templateBasePriceUsd,
      storeDefaultPriceUsd,
    }).toFixed(2));
  }, [draftId, stableStoreId, templateBasePriceUsd, storeDefaultPriceUsd, loading]);

  useEffect(() => {
    if (!stableStoreId || !draftId || loading) return;

    // If sizes were bundled by layout, use them directly — no API call needed
    if (expandedSizes && expandedSizes.length > 0) {
      setSizes(expandedSizes as SizeOption[]);
      return;
    }

    // Fallback: fetch sizes separately
    const controller = new AbortController();
    fetch(`/api/stores/${stableStoreId}/sizes`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.sizes) setSizes(data.sizes);
      })
      .catch(() => {});

    return () => controller.abort();
  }, [draftId, stableStoreId, stableTemplateId, expandedSizes, loading]);

  // Initialize per-size price override from draft (only when draft is loaded)
  const stablePriceBySizeOverride = draft?.priceBySizeOverride as Record<string, number> | null;
  const effectivePriceBySizeDefault = useMemo(
    () => mergeDraftAndTemplatePriceMaps({
      draftPriceBySizeOverride: stablePriceBySizeOverride,
      templatePriceBySizeDefault,
    }),
    [stablePriceBySizeOverride, templatePriceBySizeDefault],
  );
  useEffect(() => {
    if (!stablePriceBySizeOverride || Object.keys(stablePriceBySizeOverride).length === 0) {
      setPriceBySizeOverride({});
      setSavedPriceOverride(null);
      setPriceOverrideDirty(false);
      return;
    }
    const asStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(stablePriceBySizeOverride)) {
      asStrings[k] = v.toFixed(2);
    }
    setPriceBySizeOverride(asStrings);
    setSavedPriceOverride(stablePriceBySizeOverride);
  }, [stablePriceBySizeOverride]);

  const activeDesign = useMemo(() => {
    return (
      (activeDesignId
        ? selectedDraftDesigns.find((entry) => entry.id === activeDesignId)
        : null) ?? selectedDraftDesigns[0] ?? null
    );
  }, [activeDesignId, selectedDraftDesigns]);

  const activePair = useMemo(() => {
    if (!activeDesign) return null;
    return (
      designPairs.find(
        (pair) =>
          pair.lightDraftDesignId === activeDesign.id ||
          pair.darkDraftDesignId === activeDesign.id,
      ) ?? null
    );
  }, [activeDesign, designPairs]);

  const activeIndependentDesign = useMemo(() => {
    if (!activeDesign || pairedDraftDesignIds.has(activeDesign.id)) return null;
    return independentDesigns.find((draftDesign) => draftDesign.id === activeDesign.id) ?? null;
  }, [activeDesign, independentDesigns, pairedDraftDesignIds]);

  const aiContent = useMemo(() => {
    if (activePair) return (activePair.aiContent as AiContent | null) || null;
    if (activeIndependentDesign) {
      return (activeIndependentDesign?.aiContent as AiContent | null) || null;
    }
    return null;
  }, [activePair, activeIndependentDesign]);

  const activeMockupJob = useMemo(() => {
    if (!activeDesign) return null;
    return latestMockupJobByDesign.get(activeDesign.id) ?? null;
  }, [activeDesign, latestMockupJobByDesign]);

  const activeMockups = useMemo(() => {
    return (activeMockupJob?.images ?? []).filter((image) => {
      if (!isUsableMockupImage(image)) return false;
      return colorHexLookup.has(normalizeColorName(image.colorName));
    });
  }, [activeMockupJob, colorHexLookup]);

  useEffect(() => {
    if (carouselIdx >= activeMockups.length) {
      setCarouselIdx(0);
    }
  }, [activeMockups.length, carouselIdx]);

  const activeMockup = activeMockups[carouselIdx] ?? null;
  const activeMockupUrl = activeMockup ? toPublicUrl(activeMockup.compositeUrl) : null;
  const activeMockupColorHex = activeMockup
    ? colorHexLookup.get(normalizeColorName(activeMockup.colorName)) ?? "var(--bg-tertiary)"
    : "var(--bg-tertiary)";

  const designPublishEntries = useMemo(() => {
    const pairEntries = designPairs.map((pair) => ({
      id: pair.id,
      publishKey: pair.id,
      title: pair.baseName,
      publish: publishStateByDesignId[pair.id] ?? defaultPublishState(),
    }));

    const independentEntries = independentDesigns.map((entry) => ({
      id: entry.id,
      publishKey: entry.id,
      title: entry.design?.name ?? `Design ${entry.sortOrder + 1}`,
      publish: publishStateByDesignId[entry.id] ?? defaultPublishState(),
    }));

    return [...pairEntries, ...independentEntries] satisfies PublishDisplayEntry[];
  }, [publishStateByDesignId, selectedDraftDesigns, designPairs]);

  useEffect(() => {
    if (persistedPublishListings.length === 0) return;

    const nextMapping = new Map<string, string>();
    const nextState: Record<string, PublishDesignState> = {};

    for (const listing of persistedPublishListings) {
      const designKey = listing.wizardDraftDesignPairId ?? listing.wizardDraftDesignId ?? listing.designId;
      if (!designKey) continue;

      nextMapping.set(listing.id, designKey);
      nextState[designKey] = publishStateFromPersistedListing(listing);
    }

    if (Object.keys(nextState).length === 0) return;

    listingIdToDesignIdRef.current = nextMapping;
    setPublishStateByDesignId(nextState);
    setPublishing(Object.values(nextState).some((state) => state.status === "PUBLISHING"));
  }, [persistedPublishListings]);

  const overallPublishStatus = useMemo(() => {
    const states = designPublishEntries.map((entry) => entry.publish.status);
    if (states.some((status) => status === "ERROR")) return "ERROR";
    if (states.some((status) => status === "PUBLISHING")) return "PUBLISHING";
    if (states.length > 0 && states.every((status) => status === "SUCCESS")) return "SUCCESS";
    return "IDLE";
  }, [designPublishEntries]);

  useEffect(() => {
    if (!publishing) return;
    const states = designPublishEntries.map((entry) => entry.publish.status);
    if (states.length === 0) return;
    if (states.every((status) => status !== "PUBLISHING" && status !== "IDLE")) {
      setPublishing(false);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    }
  }, [designPublishEntries, publishing]);

  const selectedTemplateBlueprint = draft?.template?.blueprintTitle ?? draft?.store?.template?.blueprintTitle ?? draft?.productType;
  const selectedSizesCount = draft?.enabledSizes?.length ?? 0;
  const summaryListingsCount = designPairs.length + independentCount;
  const selectedMockupColorCount = useMemo(() => {
    const allMockupImages: MockupImage[] = [];
    for (const entry of selectedDraftDesigns) {
      const job = latestMockupJobByDesign.get(entry.id);
      if (job && job.status.toLowerCase() === "completed") {
        for (const img of job.images ?? []) {
          if (isUsableMockupImage(img)) {
            allMockupImages.push(img);
          }
        }
      }
    }
    return colors.filter((color) =>
      allMockupImages.some((image) => normalizeColorName(image.colorName) === normalizeColorName(color.name)),
    ).length;
  }, [colors, selectedDraftDesigns, latestMockupJobByDesign]);

  const isLoadingPage = loading || !draft;
  const allListingsPublished = overallPublishStatus === "SUCCESS";
  const hasPublishingListings = publishing || overallPublishStatus === "PUBLISHING";
  const canPublish = Boolean(localChecklist?.readyToPublish && selectedDraftDesigns.length > 0 && !hasPublishingListings && !allListingsPublished);
  const publishButtonLabel = hasPublishingListings
    ? "Đang publish..."
    : allListingsPublished
      ? `Đã publish ${summaryListingsCount} listings`
      : `Publish ${summaryListingsCount} listings`;

  function updatePublishStateByListingId(
    listingId: string | null | undefined,
    fallbackDesignKey: string | null,
    updater: (current: PublishDesignState) => PublishDesignState,
  ) {
    const designKey = (listingId ? listingIdToDesignIdRef.current.get(listingId) : null) ?? fallbackDesignKey;
    if (!designKey) return;

    setPublishStateByDesignId((current) => {
      const next = { ...current };
      const currentState = current[designKey] ?? defaultPublishState();
      next[designKey] = updater(currentState);
      return next;
    });
  }

  function appendPublishLog(current: PublishDesignState, log: PublishLog): PublishDesignState {
    const nextLogs = [...current.logs];
    const existingIndex = nextLogs.findIndex((item) => item.stage === log.stage);
    if (existingIndex >= 0) {
      nextLogs[existingIndex] = log;
    } else {
      nextLogs.push(log);
    }

    return {
      ...current,
      logs: nextLogs,
    };
  }

  async function handlePublish() {
    if (!localChecklist?.readyToPublish || selectedDraftDesigns.length === 0) return;

    const trimmedPrice = price.trim();
    const priceValue = trimmedPrice ? Number(trimmedPrice) : Number.NaN;
    const requestPrice = Number.isFinite(priceValue) ? priceValue : null;

    setPublishing(true);
    setPublishStateByDesignId(
      Object.fromEntries(
        designPublishEntries.map((entry) => [
          entry.publishKey,
          {
            listingId: null,
            status: "PUBLISHING" as const,
            logs: [{ stage: "INIT", message: "Đang khởi tạo publish...", status: "pending" as const }],
            alreadyPublished: false,
          },
        ]),
      ),
    );

    listingIdToDesignIdRef.current = new Map();
    eventSourceRef.current?.close();

    const eventSource = new EventSource(`/api/wizard/drafts/${draftId}/events`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          type?: string;
          data?: {
            listingId?: string;
            draftDesignId?: string;
            designId?: string;
            status?: string;
            reason?: string;
            error?: string;
            phase?: string;
            message?: string;
          };
        };
        const listingId = data.data?.listingId;
        const designKeyFallback = data.data?.draftDesignId ?? data.data?.designId ?? null;
        if (!listingId && !designKeyFallback) return;

        updatePublishStateByListingId(listingId, designKeyFallback, (current) => {
          const next = { ...current };
          const eventType = data.type ?? "";

          if (eventType === "publish.shopify.start") {
            return appendPublishLog(next, {
              stage: "SHOPIFY",
              message: "Đang publish lên Shopify...",
              status: "pending",
            });
          }

          if (eventType === "publish.progress") {
            const phase = data.data?.phase ?? null;
            const message = getPublishPhaseLabel(phase) ?? data.data?.message ?? "Đang xử lý publish...";
            return appendPublishLog(next, {
              stage: phase || "SHOPIFY",
              message,
              status: "pending",
            });
          }

          if (eventType === "publish.shopify.done") {
            return appendPublishLog(next, {
              stage: "SHOPIFY",
              message: "Đã publish lên Shopify",
              status: "success",
            });
          }

          if (eventType === "publish.printify.start") {
            return appendPublishLog(next, {
              stage: "PRINTIFY",
              message: "Đang publish lên Printify...",
              status: "pending",
            });
          }

          if (eventType === "publish.printify.done") {
            return appendPublishLog(next, {
              stage: "PRINTIFY",
              message: "Đã publish lên Printify",
              status: "success",
            });
          }

          if (eventType === "publish.complete") {
            if (data.data?.status === "ACTIVE") {
              return {
                ...appendPublishLog(next, {
                  stage: "DONE",
                  message: "Publish hoàn tất!",
                  status: "success",
                }),
                status: "SUCCESS",
              };
            }

            return {
              ...appendPublishLog(next, {
                stage: "ERROR",
                message: data.data?.reason || "Có lỗi xảy ra",
                status: "error",
              }),
              status: "ERROR",
            };
          }

          if (eventType === "publish.failed") {
            return {
              ...appendPublishLog(next, {
                stage: "ERROR",
                message: data.data?.error || "Có lỗi xảy ra khi publish",
                status: "error",
              }),
              status: "ERROR",
            };
          }

          return next;
        });
      } catch {
        // ignore malformed event payloads
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
      setPublishing(false);
      toast.error("Mất kết nối server");
    };

    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceUsd: requestPrice }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Không thể khởi tạo tiến trình publish");
      }

      const nextMapping = new Map<string, string>();
      const nextState: Record<string, PublishDesignState> = {};
      for (const listing of (data.listings ?? []) as PublishResponseEntry[]) {
        const designKey = listing.designPairId ?? listing.draftDesignId ?? listing.designId;
        nextMapping.set(listing.listingId, designKey);

        const baseLogs = initialLogsFromPublishResponse(listing);

        nextState[designKey] = {
          listingId: listing.listingId,
          status:
            listing.status === "ACTIVE"
              ? "SUCCESS"
              : listing.status === "PARTIAL_FAILURE" || listing.status === "FAILED"
                ? "ERROR"
                : "PUBLISHING",
          alreadyPublished: listing.alreadyPublished,
          logs: baseLogs,
        };
      }

      listingIdToDesignIdRef.current = nextMapping;
      setPublishStateByDesignId(nextState);

      if (Object.values(nextState).every((state) => state.status !== "PUBLISHING")) {
        setPublishing(false);
        eventSource.close();
        eventSourceRef.current = null;
      }
    } catch (error: any) {
      eventSource.close();
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
      setPublishing(false);
      toast.error(error.message || "Không thể khởi tạo tiến trình publish");
    }
  }

  if (isLoadingPage) {
    return (
      <div>
        <div style={{ height: 20, width: 180, borderRadius: 6, backgroundColor: "var(--bg-tertiary)", marginBottom: 8 }} className="animate-pulse" />
        <div style={{ height: 14, width: 320, borderRadius: 4, backgroundColor: "var(--bg-tertiary)", marginBottom: 20 }} className="animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card animate-pulse" style={{ height: 360, padding: 16 }} />
            <div className="card animate-pulse" style={{ height: 220, padding: 16 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card animate-pulse" style={{ height: 260, padding: 16 }} />
            <div className="card animate-pulse" style={{ height: 280, padding: 16 }} />
          </div>
        </div>
      </div>
    );
  }

  const activeDesignMockupColorHex = activeMockup
    ? colorHexLookup.get(normalizeColorName(activeMockup.colorName)) ?? "var(--bg-tertiary)"
    : "var(--bg-tertiary)";
  const activeDesignStatus = activeMockupJob?.status ?? "pending";
  const activeDesignName = activeDesign?.design?.name ?? `Design ${selectedDraftDesigns.findIndex((entry) => entry.id === activeDesign?.id) + 1}`;
  const previewPlacementLabel = activeMockup
    ? `${activeMockup.colorName} · ${viewLabel(activeMockup.viewPosition)}`
    : activeDesignStatus === "running" || activeDesignStatus === "pending"
      ? "Đang render mockup..."
      : "Chưa có mockup";
  const listingsCount = designPairs.length + independentCount;
  const overallSummaryLabel = formatListingSummaryLabel(designPairs.length, independentCount);
  const contentChecklistLabel = formatContentChecklistLabel(designPairs.length, independentCount);

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>Review</h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 24px" }}>
        {overallSummaryLabel}. Tất cả listings dùng chung template, màu sắc và placement.
      </p>

      {selectedDraftDesigns.length === 0 && (
        <div className="alert" style={{ marginBottom: 16, backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
          <div className="flex-1">
            <p style={{ margin: 0, fontWeight: 500 }}>Chưa có Design</p>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>Bạn cần chọn ít nhất 1 design ở bước trước để tạo listing.</p>
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
            onClick={() => document.getElementById("step-nav-2")?.click() || window.history.back()}
          >
            ← Quay lại Design
          </button>
        </div>
      )}

      {selectedDraftDesigns.length > 0 && localChecklist && (
        <div className="card" style={{ padding: "12px 16px", fontSize: "0.82rem", marginBottom: 16 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <ClipboardCheck size={14} style={{ opacity: 0.5 }} />
            <span style={{ fontWeight: 600 }}>Kiểm tra trước khi Publish</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {hasPairs && localChecklist.colorGroupsBalanced !== undefined && (
              <ChecklistItem
                ok={localChecklist.colorGroupsBalanced}
                label="Có ít nhất 1 màu sáng và 1 màu tối"
                linkLabel="Fix ở Mockups"
                linkHref={`/wizard/${draftId}/step-3`}
              />
            )}
            <ChecklistItem
              ok={localChecklist.mockupsMatchColors}
              label={`Mockup khớp số màu của design đang chọn (${selectedMockupColorCount}/${colors.length})`}
              linkLabel="Fix ở Mockups"
              linkHref={`/wizard/${draftId}/step-3`}
            />
            <ChecklistItem
              ok={localChecklist.contentComplete}
              label={contentChecklistLabel}
              linkLabel="Fix ở Content"
              linkHref={`/wizard/${draftId}/step-4`}
            />
            <ChecklistItem
              ok={localChecklist.placementValid}
              label="Placement hợp lệ"
              linkLabel="Fix ở Placement"
              linkHref={`/wizard/${draftId}/step-3`}
            />
            <ChecklistItem
              ok={localChecklist.mockupsNotStale}
              label="Mockup cập nhật (không bị outdated)"
              linkLabel="Tạo lại"
              linkHref={`/wizard/${draftId}/step-3`}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <div className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Mockup preview</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                  Chọn design để xem mockup đã render cho design đó
                </p>
              </div>
              <span className="badge badge-success" style={{ flexShrink: 0, fontSize: "0.65rem" }}>
                {selectedDraftDesigns.length} designs
              </span>
            </div>

            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 12 }}>
              {selectedDraftDesigns.map((design) => {
                const active = design.id === activeDesign?.id;
                const job = latestMockupJobByDesign.get(design.id) ?? null;
                const statusLabel = job?.status ?? "pending";
                return (
                  <button
                    key={design.id}
                    type="button"
                    onClick={() => {
                      setActiveDesignId(design.id);
                      setCarouselIdx(0);
                    }}
                    style={{
                      minWidth: 160,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: active ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                      backgroundColor: active ? "rgba(146, 198, 72, 0.06)" : "transparent",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ fontWeight: 800, fontSize: "0.82rem", overflowWrap: "anywhere" }}>
                        {design.design?.name ?? `Design ${design.sortOrder + 1}`}
                      </span>
                      {active ? <Check size={14} color="var(--color-wise-green)" /> : null}
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: "0.7rem", opacity: 0.65, lineHeight: 1.3 }}>
                      {statusLabel === "completed" ? "Ready" : statusLabel === "running" ? "Rendering" : "Pending"}
                    </p>
                  </button>
                );
              })}
            </div>

            <div
              className="card"
              style={{
                aspectRatio: "1/1",
                backgroundColor: activeDesignMockupColorHex,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                overflow: "hidden",
                maxHeight: 420,
              }}
            >
              {activeMockup && activeMockupUrl ? (
                <img
                  src={activeMockupUrl}
                  alt={`${activeMockup.colorName} - ${viewLabel(activeMockup.viewPosition)}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  loading="lazy"
                />
              ) : (activeDesignStatus === "running" || activeDesignStatus === "pending") ? (
                <div style={{ textAlign: "center", padding: "0 24px" }}>
                  <Loader2 size={36} className="animate-spin" style={{ opacity: 0.45, marginBottom: 12 }} />
                  <p style={{ fontSize: "0.82rem", opacity: 0.55, margin: 0 }}>
                    Đang render mockup cho {activeDesignName}
                    <br />
                    Quay lại bước Mockups để theo dõi tiến trình nếu cần.
                  </p>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "0 24px" }}>
                  <ImageOff size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
                  <p style={{ fontSize: "0.82rem", opacity: 0.55, margin: 0 }}>
                    Chưa có mockup cho {activeDesignName}
                    <br />
                    Trở lại bước Mockups để tạo lại.
                  </p>
                </div>
              )}

              {activeMockup && (
                <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.55)", color: "white", fontSize: "0.72rem", padding: "4px 10px", borderRadius: 999 }}>
                  {activeDesignName} · {previewPlacementLabel}
                </div>
              )}

              {activeMockups.length > 1 && (
                <>
                  <button
                    onClick={() => setCarouselIdx((i) => (i === 0 ? activeMockups.length - 1 : i - 1))}
                    style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "white" }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setCarouselIdx((i) => (i === activeMockups.length - 1 ? 0 : i + 1))}
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "white" }}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)", color: "white", fontSize: "0.7rem", padding: "3px 10px", borderRadius: 12 }}>
                    {carouselIdx + 1} / {activeMockups.length}
                  </div>
                </>
              )}
            </div>

            {activeMockups.length > 1 && (
              <div className="flex gap-2" style={{ marginTop: 8, overflowX: "auto" }}>
                {activeMockups.map((mockup, idx) => {
                  const thumbnailUrl = toPublicUrl(mockup.compositeUrl);
                  const thumbnailColorHex = colorHexLookup.get(normalizeColorName(mockup.colorName)) ?? "var(--bg-tertiary)";
                  return (
                    <div
                      key={mockup.id}
                      onClick={() => setCarouselIdx(idx)}
                      title={`${mockup.colorName} · ${viewLabel(mockup.viewPosition)}`}
                      style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", backgroundColor: thumbnailColorHex, border: idx === carouselIdx ? "2px solid var(--color-wise-green)" : "1px solid var(--border-default)", cursor: "pointer", overflow: "hidden", flexShrink: 0 }}
                    >
                      {thumbnailUrl && (
                        <img src={thumbnailUrl} alt={`${mockup.colorName} ${viewLabel(mockup.viewPosition)}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Mockup groups</h3>
              <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>{selectedDraftDesigns.length} tabs</span>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {selectedDraftDesigns.map((design) => {
                const job = latestMockupJobByDesign.get(design.id) ?? null;
                const progressText = job
                  ? `${job.completedImages ?? 0}/${job.totalImages ?? (job.images?.length ?? 0)} ảnh`
                  : "Chưa có job";
                const statusClass =
                  job?.status === "completed"
                    ? "badge-success"
                    : job?.status === "failed"
                      ? "badge-danger"
                      : "badge-warning";
                return (
                  <div
                    key={design.id}
                    className="flex items-center justify-between gap-3"
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-default)", backgroundColor: "var(--bg-tertiary)" }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.84rem", overflowWrap: "anywhere" }}>
                        {design.design?.name ?? `Design ${design.sortOrder + 1}`}
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: "0.72rem", opacity: 0.65 }}>
                        {progressText}
                      </p>
                    </div>
                    <span className={`badge ${statusClass}`} style={{ flexShrink: 0, fontSize: "0.65rem" }}>
                      {job?.status ?? "pending"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <div className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Content & pricing</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                  Shared across all listings in this wizard run
                </p>
              </div>
              <span className="badge badge-success" style={{ flexShrink: 0, fontSize: "0.65rem" }}>
                {selectedTemplateBlueprint || "T-Shirt"}
              </span>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.5, display: "block", marginBottom: 4 }}>
                  Tiêu đề
                </label>
                {aiContent?.title ? (
                  <p style={{ fontWeight: 700, fontSize: "1rem", margin: 0 }}>{aiContent.title}</p>
                ) : (
                  <p style={{ opacity: 0.35, fontSize: "0.85rem", margin: 0 }}>
                    Chưa tạo nội dung
                    <InlineLink href={`/wizard/${draftId}/step-4`}>Sửa ở AI Content</InlineLink>
                  </p>
                )}
              </div>

              <div>
                <label style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.5, display: "block", marginBottom: 4 }}>
                  Mô tả
                </label>
                {aiContent?.description ? (
                  <div
                    style={{ fontSize: "0.85rem", lineHeight: 1.5, maxHeight: 120, overflow: "auto", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)" }}
                    dangerouslySetInnerHTML={{ __html: aiContent.description }}
                  />
                ) : (
                  <p style={{ opacity: 0.35, fontSize: "0.85rem", margin: 0 }}>
                    Chưa có description
                    <InlineLink href={`/wizard/${draftId}/step-4`}>Sửa</InlineLink>
                  </p>
                )}
              </div>

              <div>
                <label style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.5, display: "block", marginBottom: 4 }}>
                  Tags
                </label>
                {aiContent?.tags && aiContent.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {aiContent.tags.map((tag) => (
                      <span key={tag} style={{ padding: "3px 8px", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-tertiary)", fontSize: "0.75rem" }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p style={{ opacity: 0.35, fontSize: "0.85rem", margin: 0 }}>
                    Chưa có tags
                    <InlineLink href={`/wizard/${draftId}/step-4`}>Thêm tags</InlineLink>
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center gap-4 mb-3">
                  <div>
                    <label style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.5, display: "block", marginBottom: 4 }}>
                      Base Price (USD)
                    </label>
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "0.85rem", opacity: 0.6 }}>$</span>
                      <input
                        type="text"
                        className="input"
                        value={price}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (/^\d*\.?\d{0,2}$/.test(next)) setPrice(next);
                        }}
                        placeholder="24.99"
                        style={{ maxWidth: 100 }}
                      />
                    </div>
                  </div>
                </div>

                {sizes.length > 0 && draft?.enabledSizes && draft.enabledSizes.length > 0 && (() => {
                  const enabledSizeList = sizes.filter((s) => draft.enabledSizes?.includes(s.size));
                  const hasOverrides = Object.keys(priceBySizeOverride).length > 0;

                  const handleSavePriceOverride = async () => {
                    if (!draftId) return;
                    setSavingPriceOverride(true);
                    try {
                      const override: Record<string, number> = {};
                      for (const [k, v] of Object.entries(priceBySizeOverride)) {
                        const parsed = parseFloat(v);
                        if (Number.isFinite(parsed) && parsed >= 1) override[k] = parsed;
                      }
                      const res = await fetch(`/api/wizard/drafts/${draftId}/price-override`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ priceBySizeOverride: Object.keys(override).length > 0 ? override : null }),
                      });
                      if (res.ok) {
                        setSavedPriceOverride(Object.keys(override).length > 0 ? override : null);
                        setPriceOverrideDirty(false);
                      }
                    } catch { /* ignore */ }
                    setSavingPriceOverride(false);
                  };

                  const handleResetPriceOverride = async () => {
                    if (!draftId) return;
                    setPriceBySizeOverride({});
                    setSavingPriceOverride(true);
                    try {
                      const res = await fetch(`/api/wizard/drafts/${draftId}/price-override`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ priceBySizeOverride: null }),
                      });
                      if (res.ok) {
                        setSavedPriceOverride(null);
                        setPriceOverrideDirty(false);
                      }
                    } catch { /* ignore */ }
                    setSavingPriceOverride(false);
                  };

                  return (
                    <div style={{ backgroundColor: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border-default)" }}>
                      <table style={{ width: "100%", fontSize: "0.8rem", textAlign: "left", borderCollapse: "collapse" }}>
                        <thead style={{ backgroundColor: "rgba(0,0,0,0.02)", borderBottom: "1px solid var(--border-default)" }}>
                          <tr>
                            <th style={{ padding: "8px 12px", fontWeight: 600, opacity: 0.6 }}>Size</th>
                            <th style={{ padding: "8px 12px", fontWeight: 600, opacity: 0.6 }}>Cost</th>
                            <th style={{ padding: "8px 12px", fontWeight: 600, opacity: 0.6 }}>Retail Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {enabledSizeList.map((size, index) => {
                            const baseVal = parseFloat(price) || 0;
                            const overrideVal = priceBySizeOverride[size.size];
                            const templateDefaultVal = effectivePriceBySizeDefault?.[size.size] ?? null;
                            const effectiveRetail = resolvePriceForSize({
                              size: size.size,
                              draftPriceBySizeOverride: normalizePriceBySizeDefault(
                                Object.fromEntries(
                                  Object.entries(priceBySizeOverride)
                                    .filter(([, value]) => value.trim() !== "")
                                    .map(([key, value]) => [key, Number(value)]),
                                ),
                              ),
                              templatePriceBySizeDefault,
                              templateBasePriceUsd: baseVal,
                              storeDefaultPriceUsd,
                            });
                            const displayVal = overrideVal ?? templateDefaultVal?.toFixed(2) ?? effectiveRetail.toFixed(2);
                            const isOverridden = overrideVal != null;
                            const isTemplateDefault = !isOverridden && templateDefaultVal != null;
                            return (
                              <tr key={size.size} style={{ borderBottom: index === enabledSizeList.length - 1 ? "none" : "1px solid var(--border-default)" }}>
                                <td style={{ padding: "8px 12px", fontWeight: 500 }}>{size.size}</td>
                                <td style={{ padding: "8px 12px", opacity: 0.7 }}>${(size.costCents / 100).toFixed(2)}</td>
                                <td style={{ padding: "4px 8px" }}>
                                  <div className="flex items-center gap-1">
                                    <span style={{ opacity: 0.5, fontSize: "0.75rem" }}>$</span>
                                    <input
                                      type="text"
                                      className="input"
                                      value={displayVal}
                                      onChange={(e) => {
                                        const next = e.target.value;
                                        if (/^\d*\.?\d{0,2}$/.test(next)) {
                                          setPriceBySizeOverride((prev) => ({ ...prev, [size.size]: next }));
                                          setPriceOverrideDirty(true);
                                        }
                                      }}
                                      style={{
                                        maxWidth: 80,
                                        padding: "4px 6px",
                                        fontSize: "0.8rem",
                                        fontWeight: isOverridden || isTemplateDefault ? 700 : 400,
                                        borderColor: isOverridden ? "var(--color-accent)" : undefined,
                                      }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="flex items-center gap-2" style={{ padding: "8px 12px", borderTop: "1px solid var(--border-default)", justifyContent: "flex-end" }}>
                        {hasOverrides && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={handleResetPriceOverride}
                            disabled={savingPriceOverride}
                            style={{ fontSize: "0.75rem" }}
                          >
                            ↺ Reset
                          </button>
                        )}
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={handleSavePriceOverride}
                          disabled={!priceOverrideDirty || savingPriceOverride}
                          style={{ fontSize: "0.75rem" }}
                        >
                          {savingPriceOverride ? "Đang lưu..." : "Lưu giá"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: "12px 16px", backgroundColor: "var(--bg-tertiary)", fontSize: "0.8rem" }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <ClipboardCheck size={16} style={{ color: "var(--color-wise-green)" }} />
              <strong>Tổng hợp</strong>
            </div>
            <div style={{ lineHeight: 1.8 }}>
              • Product: {selectedTemplateBlueprint || "—"}
              <br />• Colors: {colors.length} màu
              <br />• Sizes: {selectedSizesCount} size
              <br />• Mockups: {activeMockups.length} ảnh cho design đang chọn
              <br />• Base Price: ${formatPriceDisplay(price)}
              {savedPriceOverride && Object.keys(savedPriceOverride).length > 0 && (() => {
                const vals = Object.values(savedPriceOverride);
                const minP = Math.min(...vals);
                const maxP = Math.max(...vals);
                return minP !== maxP
                  ? <><br />• Price range: ${minP.toFixed(2)} – ${maxP.toFixed(2)}</>
                  : null;
              })()}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div className="flex items-center justify-between gap-3" style={{ marginBottom: 10 }}>
              <div>
                <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Publish progress</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.35 }}>
                  Theo dõi từng listing theo design
                </p>
              </div>
              <span className={`badge ${overallPublishStatus === "SUCCESS" ? "badge-success" : overallPublishStatus === "ERROR" ? "badge-danger" : overallPublishStatus === "PUBLISHING" ? "badge-warning" : "badge-info"}`} style={{ flexShrink: 0, fontSize: "0.65rem" }}>
                {overallPublishStatus}
              </span>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {designPublishEntries.map((entry) => {
                const displayLogs = compactPublishLogs(entry.publish);
                const statusClass =
                  entry.publish.status === "SUCCESS"
                    ? "badge-success"
                    : entry.publish.status === "ERROR"
                      ? "badge-danger"
                      : entry.publish.status === "PUBLISHING"
                        ? "badge-warning"
                        : "badge-info";

                return (
                  <div
                    key={entry.id}
                    style={{
                      border: "1px solid var(--border-default)",
                      borderRadius: 10,
                      padding: 12,
                      backgroundColor: "var(--bg-tertiary)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3" style={{ marginBottom: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "0.85rem", overflowWrap: "anywhere" }}>
                          {entry.title}
                        </div>
                        <p style={{ margin: "3px 0 0", fontSize: "0.72rem", opacity: 0.65 }}>
                          {entry.publish.listingId ? `Listing ${entry.publish.listingId.slice(-6)}` : "Chưa tạo listing"}
                        </p>
                      </div>
                      <span className={`badge ${statusClass}`} style={{ flexShrink: 0, fontSize: "0.65rem" }}>
                        {entry.publish.status}
                      </span>
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      {displayLogs.map((log, index) => (
                        <div key={`${entry.publishKey}-${index}`} className="flex items-center gap-2" style={{ fontSize: "0.82rem" }}>
                          {log.status === "pending" ? (
                            <Loader2 size={14} className="animate-spin text-amber-500" />
                          ) : log.status === "error" ? (
                            <XCircle size={14} style={{ color: "var(--color-error)" }} />
                          ) : (
                            <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)" }} />
                          )}
                          <span style={{ opacity: log.status === "pending" ? 0.8 : 1 }}>{log.message}</span>
                        </div>
                      ))}
                    </div>

                    {entry.publish.status === "SUCCESS" && entry.publish.listingId && (
                      <div style={{ marginTop: 10 }}>
                        <Link
                          href={`/listings/${entry.publish.listingId}`}
                          className="btn btn-secondary"
                          style={{ textDecoration: "none", width: "100%", justifyContent: "center" }}
                        >
                          Xem listing
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              className="btn btn-primary"
              onClick={handlePublish}
              disabled={!canPublish}
              title={localChecklist && !localChecklist.readyToPublish ? "Hoàn tất checklist để Publish" : undefined}
              style={{
                fontSize: "0.9rem",
                padding: "12px 24px",
                width: "100%",
                marginTop: 14,
                opacity: !canPublish ? 0.65 : 1,
                cursor: !canPublish ? "not-allowed" : "pointer",
              }}
            >
              {hasPublishingListings ? <Loader2 size={16} className="animate-spin" /> : allListingsPublished ? <Check size={16} /> : <Play size={16} />}
              {publishButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({
  ok,
  label,
  linkLabel,
  linkHref,
}: {
  ok: boolean;
  label: string;
  linkLabel: string;
  linkHref: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)", flexShrink: 0 }} />
      ) : (
        <AlertTriangle size={14} style={{ color: "var(--color-error)", flexShrink: 0 }} />
      )}
      <span style={{ flex: 1, opacity: ok ? 0.8 : 1 }}>{label}</span>
      {!ok && (
        <a href={linkHref} style={{ fontSize: "0.75rem", color: "var(--color-wise-green)", textDecoration: "none", whiteSpace: "nowrap" }}>
          {linkLabel} →
        </a>
      )}
    </div>
  );
}

import { type Job, Worker } from "bullmq";
import { prisma } from "../db";
import { getClientForStore } from "../printify/account";
import { type ParsedPrintifyMockupImage, pollPrintifyMockups } from "../printify/product";
import { isFinalBullMqAttempt } from "./progress";
import type { PrintifyMockupPollPayload } from "./queue";
import { getMockupCompositeQueue } from "./queue";
import { cacheRemoteMockupImage } from "./remote-media";
// custom-source-selection and resolveEffectiveCompositeRegion removed — now using wizard picks
import { buildCustomMockupSourceUrl, buildLibraryMockupUrl, type MockupSourceType } from "./source-url";
import { sseChannels } from "../sse/channel";
import { redisConnection } from "@/lib/queue/queue";

const concurrency = parseInt(process.env.PRINTIFY_MOCKUP_WORKER_CONCURRENCY || "2", 10);
const PRINTIFY_MOCKUP_QUEUE_NAME = "printify-mockup-poll-queue";

// HMR-safe singleton — survives Turbopack module re-evaluation
const globalForPrintifyPollWorker = globalThis as unknown as {
  printifyPollWorker?: Worker<PrintifyMockupPollPayload>;
};

export function startPrintifyMockupPollWorker(): Worker<PrintifyMockupPollPayload> {
  if (globalForPrintifyPollWorker.printifyPollWorker) return globalForPrintifyPollWorker.printifyPollWorker;

  const worker = new Worker<PrintifyMockupPollPayload>(
    PRINTIFY_MOCKUP_QUEUE_NAME,
    processPrintifyMockupPollJob,
    {
      connection: redisConnection,
      concurrency,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`Printify mockup poll job ${job?.id} failed with ${err.message}`);
  });

  worker.on("completed", (job) => {
    console.log(`Printify mockup poll job ${job.id} completed successfully`);
  });

  globalForPrintifyPollWorker.printifyPollWorker = worker;
  return worker;
}

export async function processPrintifyMockupPollJob(
  job: Job<PrintifyMockupPollPayload>,
): Promise<{ success: true; imageCount: number }> {
  const { mockupJobId, draftId, storeId, productId } = job.data;

  try {
    await prisma.mockupJob.updateMany({
      where: { id: mockupJobId, status: { in: ["pending", "running"] } },
      data: { status: "running", errorMessage: null },
    });

    const mockupJobFilter = await prisma.mockupJob.findUnique({
      where: { id: mockupJobId },
      select: { colorFilterIds: true, colorGroup: true },
    });
    const colorFilterIds = coerceStringArray(mockupJobFilter?.colorFilterIds);
    const allowedColorNames =
      colorFilterIds.length > 0
        ? await resolveColorNamesForFilter(draftId, colorFilterIds)
        : null;

    const { client, externalShopId } = await getClientForStore(storeId);
    const mockups = await pollPrintifyMockups({
      client,
      shopId: externalShopId,
      productId,
      maxWaitMs: 90_000,
      intervalMs: 3_000,
    });

    const variantColorLookup = await buildVariantColorLookup({
      storeId,
      draftId,
      client,
      externalShopId,
    });
    const printifyRows = (await buildMockupImageRows({ mockups, variantColorLookup })).filter(
      (row) => !allowedColorNames || allowedColorNames.has(normalizeColorKey(row.colorName)),
    );
    const { draftRows, templateRows, mode } = await buildCustomRowsForDraft({
      draftId,
      storeId,
      variantColorLookup,
      colorFilterIds,
    });

    // Determine which bucket gets default inclusion
    const bucket = chooseIncludedSourceBucket({
      mode,
      hasDraftRows: draftRows.length > 0,
      hasTemplateRows: templateRows.length > 0,
    });

    const draftColorKeys = new Set(draftRows.map((row) => normalizeColorKey(row.colorName)));
    let rows: MockupImageRow[] = [];

    if (mode === "CUSTOM") {
      if (bucket === "none") {
        throw new Error(
          "Template is set to Custom but no custom mockup images exist for the selected colors",
        );
      }

      for (const row of draftRows) row.included = true;
      for (const row of templateRows) {
        row.included = !draftColorKeys.has(normalizeColorKey(row.colorName));
      }
      rows = [...draftRows, ...templateRows.filter((row) => row.included)];
    } else {
      for (const row of draftRows) row.included = true;
      rows =
        draftRows.length > 0
          ? [
              ...draftRows,
              ...printifyRows.filter(
                (row) => !draftColorKeys.has(normalizeColorKey(row.colorName)),
              ),
            ]
          : printifyRows;
    }

    const completedImageCount = rows.filter((row) => row.compositeStatus === "completed").length;
    const hasPendingImages = completedImageCount < rows.length;

    if (rows.length === 0) {
      throw new Error(
        "Printify returned no mockup images for the selected colors and enabled variants",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.mockupImage.deleteMany({ where: { mockupJobId } });
      if (rows.length > 0) {
        await tx.mockupImage.createMany({
          data: rows.map((row) => ({
            mockupJobId,
            ...row,
          })),
        });
      }
      await tx.mockupJob.update({
        where: { id: mockupJobId },
        data: {
          status: hasPendingImages ? "running" : "completed",
          totalImages: rows.length,
          completedImages: completedImageCount,
          failedImages: 0,
          errorMessage: null,
        },
      });
      await tx.wizardDraft.update({
        where: { id: draftId },
        data: {
          mockupsStale: false,
          mockupsStaleReason: null,
        },
      });
    });

    const pendingCustomImages = await prisma.mockupImage.findMany({
      where: {
        mockupJobId,
        compositeStatus: "pending",
        OR: [
          { sourceUrl: { contains: "/composite/" } },
          { sourceUrl: { startsWith: "mockup://custom-composite/" } },
        ],
      },
      select: { id: true, sourceUrl: true },
    });
    const jobRecord = await prisma.mockupJob.findUnique({
      where: { id: mockupJobId },
      include: {
        design: { select: { storagePath: true } },
        draftDesign: {
          include: {
            design: { select: { storagePath: true } },
          },
        },
        draft: {
          include: {
            design: { select: { storagePath: true } },
          },
        },
      },
    });
    const designStoragePath = jobRecord
      ? jobRecord.draftDesign?.design?.storagePath ??
        jobRecord.design?.storagePath ??
        jobRecord.draft.design?.storagePath ??
        null
      : null;

    if (designStoragePath && pendingCustomImages.length > 0) {
      const queue = getMockupCompositeQueue();
      for (const image of pendingCustomImages) {
        await queue.add("composite-custom-mockup", {
          mockupImageId: image.id,
          sourceUrl: image.sourceUrl,
          designStoragePath,
          placementData: {},
        });
      }
    }

    // Emit SSE progress so frontend gets real-time update without polling
    sseChannels.emit(draftId, {
      type: "mockup.progress",
      data: {
        mockupJobId,
        draftDesignId: job.data.draftDesignId ?? null,
        totalImages: rows.length,
        completedImages: completedImageCount,
        status: hasPendingImages ? "running" : "completed",
        source: "printify",
      },
    });

    return { success: true, imageCount: rows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (isFinalBullMqAttempt(job.attemptsMade, job.opts.attempts)) {
      await prisma.mockupJob.updateMany({
        where: { id: mockupJobId },
        data: {
          status: "failed",
          errorMessage: message,
        },
      });
      // Emit SSE failure so frontend stops waiting
      sseChannels.emit(draftId, {
        type: "mockup.failed",
        data: { mockupJobId, draftDesignId: job.data.draftDesignId ?? null, errorMessage: message },
      });
    } else {
      await prisma.mockupJob.updateMany({
        where: { id: mockupJobId },
        data: { errorMessage: message },
      });
    }
    throw error;
  }
}

type CustomSourceInput = {
  id: string;
  colorId: string;
  label: string | null;
  view: string;
  sceneType: string;
  renderMode: "FINAL" | "COMPOSITE";
  outputPath: string | null;
  isPrimary: boolean;
  sortOrder: number;
  templateMockupItemId?: string;
};

type CustomColorInput = {
  name: string;
};

type MockupImageRow = {
  printifyMockupId: string;
  variantId: number;
  colorName: string;
  viewPosition: string;
  sourceUrl: string;
  compositeUrl: string | null;
  compositeStatus: "pending" | "completed";
  mockupType: string;
  isDefault: boolean;
  cameraLabel: string | null;
  included: boolean;
  sortOrder: number;
};

export function buildCustomMockupImageRows(input: {
  sources: CustomSourceInput[];
  colorsById: Map<string, CustomColorInput>;
  variantColorLookup: Map<number, { colorName: string }>;
  scope: "TEMPLATE" | "DRAFT";
  sortOffset?: number;
}): MockupImageRow[] {
  const rows: MockupImageRow[] = [];
  const sortOffset = input.sortOffset ?? 0;
  // Deduplicate: skip subsequent sources for the same (colorId, view) pair.
  // This prevents double renders when a user accidentally uploaded multiple
  // mockup sources for the same color+view slot.
  const seen = new Set<string>();

  for (const source of [...input.sources].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const color = input.colorsById.get(source.colorId);
    if (!color) continue;

    const dedupeKey = `${source.colorId}|${source.view}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    rows.push({
      printifyMockupId: `custom:${source.id}`,
      variantId: firstMatchingVariantId(color.name, input.variantColorLookup),
      colorName: color.name,
      viewPosition: source.view,
      sourceUrl: source.templateMockupItemId
        ? buildLibraryMockupUrl(source.templateMockupItemId, source.colorId)
        : buildCustomMockupSourceUrl(source.id, input.scope, source.renderMode),
      compositeUrl: null,
      compositeStatus: "pending",
      mockupType: source.sceneType,
      isDefault: source.isPrimary,
      cameraLabel: source.label,
      included: true,
      sortOrder: sortOffset + source.sortOrder,
    });
  }

  return rows;
}

export function markPrintifyRowsExcludedForCustomColors<
  T extends {
    colorName: string;
    included: boolean;
    sortOrder?: number;
  },
>(rows: T[], customColorKeys: Set<string>): void {
  for (const row of rows) {
    if (customColorKeys.has(normalizeColorKey(row.colorName))) {
      row.included = false;
      if (typeof row.sortOrder === "number") {
        row.sortOrder += 20000;
      }
    }
  }
}

/**
 * Determines which bucket of rows should be "included" by default.
 * Driven by template.defaultMockupSource:
 *   CUSTOM: prefer draft > template; never silently falls back to Printify
 *   PRINTIFY: always use printify
 */
export function chooseIncludedSourceBucket(input: {
  mode: "PRINTIFY" | "CUSTOM";
  hasDraftRows: boolean;
  hasTemplateRows: boolean;
}): "draft" | "template" | "printify" | "none" {
  if (input.mode === "CUSTOM") {
    if (input.hasDraftRows) return "draft";
    if (input.hasTemplateRows) return "template";
    return "none";
  }

  return "printify";
}

async function buildCustomRowsForDraft(input: {
  draftId: string;
  storeId: string;
  variantColorLookup: Map<number, { colorName: string }>;
  colorFilterIds?: string[];
}): Promise<{ draftRows: MockupImageRow[]; templateRows: MockupImageRow[]; mode: "PRINTIFY" | "CUSTOM" }> {
  const draft = await prisma.wizardDraft.findUnique({
    where: { id: input.draftId },
    include: {
      template: true,
      store: {
        include: { colors: true },
      },
      mockupLibraryPicks: { select: { templateMockupItemId: true, compositeRegionPx: true, colorId: true } },
    },
  });
  if (!draft) return { draftRows: [], templateRows: [], mode: "PRINTIFY" };

  let template = draft.template;
  if (!template) {
    template = await prisma.storeMockupTemplate.findFirst({
      where: { storeId: input.storeId, isDefault: true },
    });
  }
  if (!template) return { draftRows: [], templateRows: [], mode: "PRINTIFY" };

  const defaultMockupSource = template.defaultMockupSource ?? "PRINTIFY";

  const enabledColorSet = new Set(
    input.colorFilterIds && input.colorFilterIds.length > 0
      ? input.colorFilterIds
      : draft.enabledColorIds,
  );
  const colorsById = new Map(
    (draft.store?.colors ?? [])
      .filter((color) => enabledColorSet.has(color.id))
      .map((color) => [color.id, { name: color.name }]),
  );
  if (colorsById.size === 0) return { draftRows: [], templateRows: [], mode: defaultMockupSource };

  const colorIds = [...colorsById.keys()];

  // Load picks for the draft (these cover both draft-specific and template-attached mockups)
  const picks = await prisma.wizardDraftMockupLibraryPick.findMany({
    where: {
      draftId: input.draftId,
      colorId: { in: colorIds },
    },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      templateMockupItem: {
        include: { mockup: true },
      },
    },
  });

  // Map picks to source-like entries for the row builder
  const mapPick = (pick: typeof picks[number]) => ({
    id: pick.id,
    colorId: pick.colorId,
    label: pick.templateMockupItem.mockup.name,
    view: pick.templateMockupItem.mockup.view,
    sceneType: pick.templateMockupItem.mockup.sceneType,
    renderMode: pick.templateMockupItem.mockup.renderMode as "COMPOSITE",
    outputPath: null as string | null,
    isPrimary: pick.isPrimary,
    sortOrder: pick.sortOrder,
    templateMockupItemId: pick.templateMockupItemId,
  });
  const isRenderablePick = (pick: typeof picks[number]) => {
    // COMPOSITE picks need a valid region (on pick or on the library item)
    if (pick.templateMockupItem.mockup.renderMode !== "COMPOSITE") return true;
    const effective = pick.compositeRegionPx ?? pick.templateMockupItem.mockup.compositeRegionPx;
    return effective !== null;
  };

  const renderablePicks = picks.filter(isRenderablePick).map(mapPick);

  const draftRows = buildCustomMockupImageRows({
    sources: renderablePicks,
    colorsById,
    variantColorLookup: input.variantColorLookup,
    scope: "DRAFT",
    sortOffset: 0,
  });

  const templateRows: ReturnType<typeof buildCustomMockupImageRows> = [];

  return { draftRows, templateRows, mode: defaultMockupSource };
}

function firstMatchingVariantId(
  colorName: string,
  variantColorLookup: Map<number, { colorName: string }>,
): number {
  const target = normalizeColorKey(colorName);
  for (const [variantId, color] of variantColorLookup) {
    if (normalizeColorKey(color.colorName) === target) return variantId;
  }
  return 0;
}

export async function buildMockupImageRows(input: {
  mockups: ParsedPrintifyMockupImage[];
  variantColorLookup: Map<number, { colorName: string }>;
  cacheImage?: (url: string, keySeed: string) => Promise<string>;
}): Promise<
  Array<{
    printifyMockupId: string;
    variantId: number;
    colorName: string;
    viewPosition: string;
    sourceUrl: string;
    compositeUrl: string;
    compositeStatus: "completed";
    mockupType: string;
    isDefault: boolean;
    cameraLabel: string | null;
    included: boolean;
    sortOrder: number;
  }>
> {
  const cacheImage = input.cacheImage ?? cacheRemoteMockupImage;
  const rows: Array<{
    printifyMockupId: string;
    variantId: number;
    colorName: string;
    viewPosition: string;
    sourceUrl: string;
    compositeUrl: string;
    compositeStatus: "completed";
    mockupType: string;
    isDefault: boolean;
    cameraLabel: string | null;
    included: boolean;
    sortOrder: number;
  }> = [];
  const seen = new Set<string>();

  for (const mockup of input.mockups) {
    const variantIds =
      mockup.variantIds.length > 0
        ? mockup.variantIds
        : Array.from(input.variantColorLookup.keys());
    const representativeVariantByColor = new Map<
      string,
      { variantId: number; colorName: string }
    >();

    for (const variantId of variantIds) {
      const color = input.variantColorLookup.get(variantId);
      if (!color) continue;

      const colorKey = normalizeColorKey(color.colorName);
      if (!representativeVariantByColor.has(colorKey)) {
        representativeVariantByColor.set(colorKey, {
          variantId,
          colorName: color.colorName,
        });
      }
    }

    for (const [colorKey, representative] of representativeVariantByColor) {
      const mockupKey = mockup.printifyMockupId || mockup.mockupType;
      const dedupeKey = `${colorKey}|${mockupKey}|${mockup.viewPosition}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const keySeed = `${mockup.printifyMockupId || mockup.mockupType}_${representative.variantId}_${mockup.viewPosition}`;
      let compositeUrl = mockup.sourceUrl;
      try {
        compositeUrl = await cacheImage(mockup.sourceUrl, keySeed);
      } catch (error) {
        console.warn(
          "[PrintifyMockupPoll] Failed to cache Printify mockup image, keeping remote URL",
          error,
        );
      }

      rows.push({
        printifyMockupId: mockup.printifyMockupId,
        variantId: representative.variantId,
        colorName: representative.colorName,
        viewPosition: mockup.viewPosition,
        sourceUrl: mockup.sourceUrl,
        compositeUrl,
        compositeStatus: "completed",
        mockupType: mockup.mockupType,
        isDefault: mockup.isDefault,
        cameraLabel: mockup.cameraLabel,
        included: false,
        sortOrder: rows.length,
      });
    }
  }

  const firstRowByColor = new Map<string, number>();
  const firstDefaultRowByColor = new Map<string, number>();
  for (const [index, row] of rows.entries()) {
    const colorKey = normalizeColorKey(row.colorName);
    if (!firstRowByColor.has(colorKey)) {
      firstRowByColor.set(colorKey, index);
    }
    if (row.isDefault && !firstDefaultRowByColor.has(colorKey)) {
      firstDefaultRowByColor.set(colorKey, index);
    }
  }

  for (const [colorKey, fallbackIndex] of firstRowByColor) {
    const indexToInclude = firstDefaultRowByColor.get(colorKey) ?? fallbackIndex;
    rows[indexToInclude].included = true;
  }

  return rows;
}

export async function buildVariantColorLookup(input: {
  storeId: string;
  draftId: string;
  client: Awaited<ReturnType<typeof getClientForStore>>["client"];
  externalShopId: number;
}): Promise<Map<number, { colorName: string }>> {
  const draft = await prisma.wizardDraft.findUnique({
    where: { id: input.draftId },
    include: {
      template: true,
      store: {
        include: {
          colors: true,
        },
      },
    },
  });

  const lookup = new Map<number, { colorName: string }>();
  if (!draft) return lookup;

  let template = draft.template;
  if (!template && draft.storeId) {
    template = await prisma.storeMockupTemplate.findFirst({
      where: { storeId: draft.storeId, isDefault: true },
    });
  }
  if (!template) return lookup;

  const enabledVariantIds =
    draft.enabledVariantIdsOverride.length > 0
      ? draft.enabledVariantIdsOverride
      : template.enabledVariantIds;
  const enabledVariantSet = new Set(enabledVariantIds);
  const selectedColorSet = new Set(draft.enabledColorIds);
  const selectedColors =
    draft.store?.colors.filter((color) => selectedColorSet.has(color.id)) ?? [];

  const variantResponse = await input.client.getBlueprintVariants(
    template.printifyBlueprintId,
    template.printifyPrintProviderId,
  );

  for (const variant of variantResponse.variants) {
    if (!enabledVariantSet.has(variant.id)) continue;
    const color = selectedColors.find((candidate) =>
      variantMatchesColor(variant, {
        name: candidate.name,
        printifyColorId: candidate.printifyColorId,
      }),
    );
    if (color) lookup.set(variant.id, { colorName: color.name });
  }

  return lookup;
}

function variantMatchesColor(
  variant: { title: string; options?: Record<string, string | undefined> | null },
  color: { name: string; printifyColorId?: string | null },
): boolean {
  const titleParts = variant.title.split(/[/,|]/g);
  const variantKeys = new Set(
    [
      variant.options?.color ?? "",
      ...Object.values(variant.options ?? {}),
      variant.title,
      ...titleParts,
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizeColorKey),
  );

  return [color.printifyColorId, color.name].some(
    (value) => value && variantKeys.has(normalizeColorKey(value)),
  );
}

function normalizeColorKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

async function resolveColorNamesForFilter(
  draftId: string,
  colorFilterIds: string[],
): Promise<Set<string>> {
  const draft = await prisma.wizardDraft.findUnique({
    where: { id: draftId },
    include: { store: { include: { colors: true } } },
  });
  const colorIdSet = new Set(colorFilterIds);
  return new Set(
    (draft?.store?.colors ?? [])
      .filter((color) => colorIdSet.has(color.id))
      .map((color) => normalizeColorKey(color.name)),
  );
}

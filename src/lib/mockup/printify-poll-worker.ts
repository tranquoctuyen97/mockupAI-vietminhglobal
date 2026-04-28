import { Worker, type Job } from "bullmq";
import { prisma } from "../db";
import type { PrintifyMockupPollPayload } from "./queue";
import { getClientForStore } from "../printify/account";
import {
  pollPrintifyMockups,
  type ParsedPrintifyMockupImage,
} from "../printify/product";
import { isFinalBullMqAttempt } from "./progress";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const concurrency = parseInt(process.env.PRINTIFY_MOCKUP_WORKER_CONCURRENCY || "2", 10);
const PRINTIFY_MOCKUP_QUEUE_NAME = "printify-mockup-poll-queue";

const connection = {
  url: redisUrl,
};

let worker: Worker<PrintifyMockupPollPayload> | null = null;

export function startPrintifyMockupPollWorker(): Worker<PrintifyMockupPollPayload> {
  if (worker) return worker;

  worker = new Worker<PrintifyMockupPollPayload>(
    PRINTIFY_MOCKUP_QUEUE_NAME,
    processPrintifyMockupPollJob,
    {
      connection,
      concurrency,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`Printify mockup poll job ${job?.id} failed with ${err.message}`);
  });

  worker.on("completed", (job) => {
    console.log(`Printify mockup poll job ${job.id} completed successfully`);
  });

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
    const rows = buildMockupImageRows({ mockups, variantColorLookup });

    if (rows.length === 0) {
      throw new Error("Printify returned no mockup images for the selected colors and enabled variants");
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
          status: "completed",
          totalImages: rows.length,
          completedImages: rows.length,
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
    } else {
      await prisma.mockupJob.updateMany({
        where: { id: mockupJobId },
        data: { errorMessage: message },
      });
    }
    throw error;
  }
}

export function buildMockupImageRows(input: {
  mockups: ParsedPrintifyMockupImage[];
  variantColorLookup: Map<number, { colorName: string }>;
}): Array<{
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
}> {
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
    const variantIds = mockup.variantIds.length > 0
      ? mockup.variantIds
      : Array.from(input.variantColorLookup.keys());
    const representativeVariantByColor = new Map<string, { variantId: number; colorName: string }>();

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

      rows.push({
        printifyMockupId: mockup.printifyMockupId,
        variantId: representative.variantId,
        colorName: representative.colorName,
        viewPosition: mockup.viewPosition,
        sourceUrl: mockup.sourceUrl,
        compositeUrl: mockup.sourceUrl,
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
      store: {
        include: {
          colors: true,
          template: true,
        },
      },
    },
  });

  const lookup = new Map<number, { colorName: string }>();
  if (!draft?.store?.template) return lookup;

  const enabledVariantIds = draft.enabledVariantIdsOverride.length > 0
    ? draft.enabledVariantIdsOverride
    : draft.store.template.enabledVariantIds;
  const enabledVariantSet = new Set(enabledVariantIds);
  const selectedColorSet = new Set(draft.enabledColorIds);
  const selectedColors = draft.store.colors.filter((color) => selectedColorSet.has(color.id));

  const variantResponse = await input.client.getBlueprintVariants(
    draft.store.template.printifyBlueprintId,
    draft.store.template.printifyPrintProviderId,
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
  const titleParts = variant.title.split(/[\/,|]/g);
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

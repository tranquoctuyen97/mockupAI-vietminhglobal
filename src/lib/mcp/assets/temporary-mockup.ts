import { randomUUID } from "node:crypto";

import type { MockupLibraryItem, MockupLibraryView, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  type CompositeRegionPx,
  normalizeCompositeRegionPx,
  parseCompositeRegionPx,
} from "@/lib/mockup/custom-library";
import { materializeSmartFitPlacement } from "@/lib/mockup/placement-region";
import { getStorage } from "@/lib/storage/local-disk";
import {
  resolveCustomMockupColorRefs,
  type SerializedDraftMockupSource,
  summarizeCustomMockupCoverage,
  type WizardCustomMockupInput,
} from "@/lib/wizard/custom-mockup-contracts";
import { createMcpAssetTransfer, fetchMcpImage, redactSourceUrl } from "./fetch-image";

type MaterializedSource = SerializedDraftMockupSource & {
  sourceUrlRedacted: string | null;
  transferId: string | null;
};

const DEFAULT_PRINT_AREA_MM = { widthMm: 340, heightMm: 420 };
const MAX_CUSTOM_MOCKUPS = 20;

function sourceId(): string {
  return `mockup_source_${randomUUID().replaceAll("-", "")}`;
}

function fallbackName(rawUrl: string, index: number): string {
  try {
    const basename = new URL(rawUrl).pathname.split("/").filter(Boolean).at(-1);
    if (!basename) return `Custom mockup ${index + 1}`;
    try {
      return decodeURIComponent(basename).replace(/\.[^.]+$/, "");
    } catch {
      return basename.replace(/\.[^.]+$/, "");
    }
  } catch {
    return `Custom mockup ${index + 1}`;
  }
}

function normalizeOrSmartFit(input: {
  explicit: CompositeRegionPx | undefined;
  imageWidth: number;
  imageHeight: number;
  designWidth: number;
  designHeight: number;
}): CompositeRegionPx {
  if (input.explicit) {
    const explicit = parseCompositeRegionPx({
      ...input.explicit,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
    });
    if (!explicit) throw new Error("compositeRegionPx is invalid for the mockup image");
    return explicit;
  }

  const smartFit = materializeSmartFitPlacement({
    printAreaMm: DEFAULT_PRINT_AREA_MM,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    designWidth: input.designWidth,
    designHeight: input.designHeight,
  });
  if (!smartFit) throw new Error("Unable to compute Smart Fit for custom mockup");
  return smartFit;
}

function serializeLibrarySource(input: {
  id: string;
  item: MockupLibraryItem;
  name?: string;
  view: MockupLibraryView;
  colorIds: string[];
  appliesToAll: boolean;
  region: CompositeRegionPx;
  isPrimary: boolean;
  sortOrder: number;
}): MaterializedSource {
  return {
    id: input.id,
    name: input.name?.trim() || input.item.name,
    view: input.view,
    storagePath: null,
    sourceUrlRedacted: null,
    mockupLibraryItemId: input.item.id,
    appliesToColorIds: input.colorIds,
    appliesToAll: input.appliesToAll,
    compositeRegionPx: input.region,
    width: input.item.width,
    height: input.item.height,
    mimeType: input.item.mimeType,
    fileSizeBytes: input.item.fileSizeBytes,
    isPrimary: input.isPrimary,
    sortOrder: input.sortOrder,
    expiresAt: null,
    transferId: null,
  };
}

export async function setWizardCustomMockups(input: {
  tenantId: string;
  profileId: string;
  draftId: string;
  mockups: WizardCustomMockupInput[];
}): Promise<{
  sources: SerializedDraftMockupSource[];
  coveredColorIds: string[];
  missingColorIds: string[];
}> {
  if (input.mockups.length > MAX_CUSTOM_MOCKUPS) {
    throw new Error(`At most ${MAX_CUSTOM_MOCKUPS} custom mockups are allowed`);
  }

  const draft = await prisma.wizardDraft.findFirst({
    where: { id: input.draftId, tenantId: input.tenantId },
    include: {
      store: { include: { colors: true } },
      template: true,
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        include: { design: { select: { width: true, height: true } } },
      },
      design: { select: { width: true, height: true } },
      mockupSources: { select: { storagePath: true } },
    },
  });
  if (!draft) throw new Error("Draft not found in tenant");
  if (!draft.storeId || !draft.store) throw new Error("Draft must have a selected store");

  const template =
    draft.template ??
    (await prisma.storeMockupTemplate.findFirst({
      where: { storeId: draft.storeId, isDefault: true },
    }));
  if (!template) throw new Error("Draft store has no mockup template");
  if ((template.defaultMockupSource ?? "PRINTIFY") !== "CUSTOM") {
    throw new Error("Custom mockups require a CUSTOM template");
  }

  const design = draft.draftDesigns[0]?.design ?? draft.design;
  if (!design) throw new Error("Attach a design before configuring custom mockups");

  const libraryIds = input.mockups.flatMap((mockup) =>
    "mockupLibraryItemId" in mockup.source ? [mockup.source.mockupLibraryItemId] : [],
  );
  const libraryItems =
    libraryIds.length > 0
      ? await prisma.mockupLibraryItem.findMany({
          where: {
            id: { in: libraryIds },
            tenantId: input.tenantId,
            storeId: draft.storeId,
            isActive: true,
            deletedAt: null,
            renderMode: "COMPOSITE",
          },
        })
      : [];
  const libraryById = new Map(libraryItems.map((item) => [item.id, item]));
  if (libraryById.size !== new Set(libraryIds).size) {
    throw new Error("Mockup Library item not found for the draft store");
  }

  const materialized: MaterializedSource[] = [];
  const newStorageKeys: string[] = [];
  const transferIds: string[] = [];

  try {
    for (const [index, mockup] of input.mockups.entries()) {
      const colors = resolveCustomMockupColorRefs({
        refs: mockup.appliesToColorRefs,
        selectedColorIds: draft.enabledColorIds,
        storeColors: draft.store.colors,
      });
      const id = sourceId();
      const isPrimary = mockup.isPrimary ?? index === 0;
      const sortOrder = mockup.sortOrder ?? index;

      if ("mockupLibraryItemId" in mockup.source) {
        const item = libraryById.get(mockup.source.mockupLibraryItemId);
        if (!item) throw new Error("Mockup Library item not found for the draft store");
        const storedRegion =
          normalizeCompositeRegionPx(item.compositeRegionPx) ??
          parseCompositeRegionPx(item.compositeRegionPx) ??
          undefined;
        const region = normalizeOrSmartFit({
          explicit: mockup.compositeRegionPx ?? storedRegion,
          imageWidth: item.width,
          imageHeight: item.height,
          designWidth: design.width,
          designHeight: design.height,
        });
        materialized.push(
          serializeLibrarySource({
            id,
            item,
            name: mockup.name,
            view: mockup.view,
            colorIds: colors.colorIds,
            appliesToAll: colors.appliesToAll,
            region,
            isPrimary,
            sortOrder,
          }),
        );
        continue;
      }

      const transfer = await createMcpAssetTransfer({
        tenantId: input.tenantId,
        profileId: input.profileId,
        draftId: input.draftId,
        kind: "MOCKUP",
        sourceUrlRedacted: redactSourceUrl(mockup.source.url),
      });
      transferIds.push(transfer.id);
      const imported = await fetchMcpImage(mockup.source.url);
      const storagePath =
        `temporary/mcp/${input.tenantId}/${input.draftId}/mockups/` + `${id}.${imported.extension}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const buffer = imported.normalizedBuffer ?? imported.buffer;
      await getStorage().putBuffer(storagePath, buffer, imported.mimeType);
      newStorageKeys.push(storagePath);
      await prisma.mcpAssetTransfer.update({
        where: { id: transfer.id },
        data: {
          status: "READY",
          storagePath,
          sourceUrlRedacted: imported.redactedSourceUrl,
        },
      });

      materialized.push({
        id,
        name: mockup.name?.trim() || fallbackName(imported.redactedSourceUrl, index),
        view: mockup.view,
        storagePath,
        sourceUrlRedacted: imported.redactedSourceUrl,
        mockupLibraryItemId: null,
        appliesToColorIds: colors.colorIds,
        appliesToAll: colors.appliesToAll,
        compositeRegionPx: normalizeOrSmartFit({
          explicit: mockup.compositeRegionPx,
          imageWidth: imported.width,
          imageHeight: imported.height,
          designWidth: design.width,
          designHeight: design.height,
        }),
        width: imported.width,
        height: imported.height,
        mimeType: imported.mimeType,
        fileSizeBytes: imported.fileSizeBytes,
        isPrimary,
        sortOrder,
        expiresAt,
        transferId: transfer.id,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.wizardDraftMockupSource.deleteMany({
        where: { draftId: input.draftId },
      });
      for (const source of materialized) {
        await tx.wizardDraftMockupSource.create({
          data: {
            id: source.id,
            draftId: input.draftId,
            name: source.name,
            storagePath: source.storagePath,
            sourceUrlRedacted: source.sourceUrlRedacted,
            mockupLibraryItemId: source.mockupLibraryItemId,
            view: source.view,
            appliesToColorIds: source.appliesToColorIds,
            appliesToAll: source.appliesToAll,
            compositeRegionPx: source.compositeRegionPx as unknown as Prisma.InputJsonValue,
            width: source.width,
            height: source.height,
            mimeType: source.mimeType,
            fileSizeBytes: source.fileSizeBytes,
            isPrimary: source.isPrimary,
            sortOrder: source.sortOrder,
            expiresAt: source.expiresAt,
          },
        });
        if (source.transferId) {
          await tx.mcpAssetTransfer.update({
            where: { id: source.transferId },
            data: {
              status: "ATTACHED",
              attachedResourceId: source.id,
              expiresAt: source.expiresAt ?? undefined,
            },
          });
        }
      }
      await tx.wizardDraft.update({
        where: { id: input.draftId },
        data: {
          mockupsStale: true,
          mockupsStaleReason: "custom_mockups_changed",
        },
      });
    });

    const activePaths = new Set(
      materialized.flatMap((source) => (source.storagePath ? [source.storagePath] : [])),
    );
    for (const old of draft.mockupSources) {
      if (old.storagePath && !activePaths.has(old.storagePath)) {
        await getStorage()
          .delete(old.storagePath)
          .catch(() => undefined);
      }
    }

    const coverage = summarizeCustomMockupCoverage({
      selectedColorIds: draft.enabledColorIds,
      sourceColorIds: materialized.map((source) => source.appliesToColorIds),
    });
    return {
      sources: materialized.map(({ transferId: _transferId, ...source }) => source),
      ...coverage,
    };
  } catch (error) {
    for (const storagePath of newStorageKeys.reverse()) {
      await getStorage()
        .delete(storagePath)
        .catch(() => undefined);
    }
    if (transferIds.length > 0) {
      await prisma.mcpAssetTransfer
        .updateMany({
          where: { id: { in: transferIds }, status: { not: "ATTACHED" } },
          data: { status: "FAILED", storagePath: null, previewPath: null },
        })
        .catch(() => undefined);
    }
    throw error;
  }
}

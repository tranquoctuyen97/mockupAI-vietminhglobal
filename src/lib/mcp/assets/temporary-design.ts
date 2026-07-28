import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import { syncDraftDesignPairs } from "@/lib/wizard/state";
import {
  createMcpAssetTransfer,
  fetchMcpImage,
  type ImportedImage,
  redactSourceUrl,
} from "./fetch-image";

type DraftForTemporaryDesign = {
  id: string;
  storeId: string | null;
  currentStep: number;
};

type PersistTemporaryDesignInput = {
  tenantId: string;
  ownerUserId: string;
  draftId: string;
  transferId: string;
  designId: string;
  storeId: string;
  name: string;
  originalFilename: string;
  storagePath: string;
  previewPath: string;
  width: number;
  height: number;
  dpi: number | null;
  fileSizeBytes: number;
  mimeType: "image/png" | "image/jpeg";
  scope: "TEMPORARY_MCP";
  expiresAt: Date;
  sourceUrlRedacted: string;
  pairingMode: "AUTO" | "NONE";
  nextCurrentStep: number;
  mockupsStaleReason: "designs_changed";
};

type PersistTemporaryDesignResult = {
  draftDesignId: string;
  pairs: Array<{ id: string; baseName: string }>;
};

export type TemporaryDesignDependencies = {
  findDraft(input: { tenantId: string; draftId: string }): Promise<DraftForTemporaryDesign | null>;
  createTransfer: typeof createMcpAssetTransfer;
  fetchImage(url: string): Promise<ImportedImage>;
  putBuffer(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  deleteStorage(key: string): Promise<void>;
  markTransferReady(input: {
    transferId: string;
    storagePath: string;
    previewPath: string;
  }): Promise<void>;
  markTransferFailed(transferId: string): Promise<void>;
  persistAttachment(input: PersistTemporaryDesignInput): Promise<PersistTemporaryDesignResult>;
  createId(): string;
  now(): Date;
};

async function findDraft(input: {
  tenantId: string;
  draftId: string;
}): Promise<DraftForTemporaryDesign | null> {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: input.draftId, tenantId: input.tenantId },
    select: {
      id: true,
      storeId: true,
      currentStep: true,
      store: { select: { status: true } },
    },
  });
  if (!draft) return null;
  return {
    id: draft.id,
    storeId: draft.store?.status === "ACTIVE" ? draft.storeId : null,
    currentStep: draft.currentStep,
  };
}

async function persistAttachment(
  input: PersistTemporaryDesignInput,
): Promise<PersistTemporaryDesignResult> {
  return prisma.$transaction(async (tx) => {
    await tx.design.create({
      data: {
        id: input.designId,
        tenantId: input.tenantId,
        storeId: input.storeId,
        ownerUserId: input.ownerUserId,
        name: input.name,
        originalFilename: input.originalFilename,
        storagePath: input.storagePath,
        previewPath: input.previewPath,
        width: input.width,
        height: input.height,
        dpi: input.dpi,
        fileSizeBytes: input.fileSizeBytes,
        mimeType: input.mimeType,
        scope: input.scope,
        expiresAt: input.expiresAt,
        sourceUrlRedacted: input.sourceUrlRedacted,
      },
    });

    const draftDesign = await tx.wizardDraftDesign.create({
      data: {
        draftId: input.draftId,
        designId: input.designId,
        sortOrder: await tx.wizardDraftDesign.count({
          where: { draftId: input.draftId },
        }),
      },
      select: { id: true },
    });

    await tx.wizardDraft.update({
      where: { id: input.draftId },
      data: {
        designId: input.designId,
        currentStep: input.nextCurrentStep,
        mockupsStale: true,
        mockupsStaleReason: input.mockupsStaleReason,
      },
    });

    await tx.mcpAssetTransfer.update({
      where: { id: input.transferId },
      data: {
        status: "ATTACHED",
        attachedResourceId: input.designId,
        expiresAt: input.expiresAt,
      },
    });

    if (input.pairingMode === "AUTO") {
      await syncDraftDesignPairs(tx as Prisma.TransactionClient, input.draftId);
    } else {
      await tx.wizardDraftDesignPair.deleteMany({
        where: { draftId: input.draftId },
      });
    }

    const pairs = await tx.wizardDraftDesignPair.findMany({
      where: { draftId: input.draftId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, baseName: true },
    });
    return { draftDesignId: draftDesign.id, pairs };
  });
}

const defaultDependencies: TemporaryDesignDependencies = {
  findDraft,
  createTransfer: createMcpAssetTransfer,
  fetchImage: fetchMcpImage,
  putBuffer: (key, buffer, mimeType) => getStorage().putBuffer(key, buffer, mimeType),
  deleteStorage: (key) => getStorage().delete(key),
  markTransferReady: async ({ transferId, storagePath, previewPath }) => {
    await prisma.mcpAssetTransfer.update({
      where: { id: transferId },
      data: { status: "READY", storagePath, previewPath },
    });
  },
  markTransferFailed: async (transferId) => {
    await prisma.mcpAssetTransfer.update({
      where: { id: transferId },
      data: { status: "FAILED", storagePath: null, previewPath: null },
    });
  },
  persistAttachment,
  createId: () => `design_${randomUUID().replaceAll("-", "")}`,
  now: () => new Date(),
};

function fallbackNameFromUrl(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname;
    const basename = pathname.split("/").filter(Boolean).at(-1) ?? "Untitled";
    let decoded: string;
    try {
      decoded = decodeURIComponent(basename);
    } catch {
      decoded = basename;
    }
    return decoded.replace(/\.[^.]+$/, "").trim() || "Untitled";
  } catch {
    return "Untitled";
  }
}

export async function attachTemporaryDesignUrl(
  input: {
    tenantId: string;
    profileId: string;
    ownerUserId: string;
    draftId: string;
    url: string;
    name?: string;
    pairingMode: "AUTO" | "NONE";
  },
  dependencies: TemporaryDesignDependencies = defaultDependencies,
): Promise<{
  draftDesignId: string;
  designId: string;
  name: string;
  expiresAt: Date;
  pairs: Array<{ id: string; baseName: string }>;
}> {
  const draft = await dependencies.findDraft({
    tenantId: input.tenantId,
    draftId: input.draftId,
  });
  if (!draft) throw new Error("Draft not found in tenant");
  if (!draft.storeId) throw new Error("Draft must have a selected store");

  const transfer = await dependencies.createTransfer({
    tenantId: input.tenantId,
    profileId: input.profileId,
    draftId: input.draftId,
    kind: "DESIGN",
    sourceUrlRedacted: redactSourceUrl(input.url),
  });
  const storedKeys: string[] = [];

  try {
    const imported = await dependencies.fetchImage(input.url);
    const designId = dependencies.createId();
    const name = input.name?.trim() || fallbackNameFromUrl(imported.redactedSourceUrl);
    const expiresAt = new Date(dependencies.now().getTime() + 30 * 24 * 60 * 60 * 1000);
    const storagePath =
      `temporary/mcp/${input.tenantId}/${input.draftId}/designs/` +
      `${designId}.${imported.extension}`;
    const previewPath =
      `temporary/mcp/${input.tenantId}/${input.draftId}/previews/` + `${designId}.webp`;
    const storedImage = imported.normalizedBuffer ?? imported.buffer;

    await dependencies.putBuffer(storagePath, storedImage, imported.mimeType);
    storedKeys.push(storagePath);
    await dependencies.putBuffer(previewPath, imported.previewBuffer, "image/webp");
    storedKeys.push(previewPath);
    await dependencies.markTransferReady({
      transferId: transfer.id,
      storagePath,
      previewPath,
    });

    const persisted = await dependencies.persistAttachment({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      draftId: input.draftId,
      transferId: transfer.id,
      designId,
      storeId: draft.storeId,
      name,
      originalFilename: `${name}.${imported.extension}`,
      storagePath,
      previewPath,
      width: imported.width,
      height: imported.height,
      dpi: imported.dpi,
      fileSizeBytes: imported.fileSizeBytes,
      mimeType: imported.mimeType,
      scope: "TEMPORARY_MCP",
      expiresAt,
      sourceUrlRedacted: imported.redactedSourceUrl,
      pairingMode: input.pairingMode,
      nextCurrentStep: Math.max(draft.currentStep, 2),
      mockupsStaleReason: "designs_changed",
    });

    return {
      draftDesignId: persisted.draftDesignId,
      designId,
      name,
      expiresAt,
      pairs: persisted.pairs,
    };
  } catch (error) {
    for (const key of storedKeys.reverse()) {
      await dependencies.deleteStorage(key).catch(() => undefined);
    }
    await dependencies.markTransferFailed(transfer.id).catch(() => undefined);
    throw error;
  }
}

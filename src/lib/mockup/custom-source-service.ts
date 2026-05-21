import sharp from "sharp";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface NormalizeUploadInput {
  rawBuffer: Buffer;
  contentType: string;
  storagePath: string;
  outputPath?: string;
  renderMode: "FINAL" | "COMPOSITE";
}

export interface NormalizeUploadResult {
  storagePath: string;
  outputPath: string | null;
  width: number;
  height: number;
}

/**
 * Validate, normalize, and save a custom mockup upload.
 * Shared for both TEMPLATE and DRAFT scopes.
 */
export async function normalizeCustomMockupUpload(
  input: NormalizeUploadInput,
): Promise<NormalizeUploadResult> {
  if (!ALLOWED_TYPES.has(input.contentType)) {
    throw new ValidationError("Only JPEG, PNG, and WebP images are supported");
  }
  if (input.rawBuffer.length > MAX_UPLOAD_BYTES) {
    throw new ValidationError("File must be 10MB or smaller");
  }

  // Normalize: auto-rotate, strip metadata, convert to JPEG
  const normalizedBuffer = await sharp(input.rawBuffer)
    .rotate()
    .jpeg({ quality: 90 })
    .toBuffer();

  const metadata = await sharp(normalizedBuffer).metadata();
  const storage = getStorage();

  // Write normalized source
  await storage.putBuffer(input.storagePath, normalizedBuffer, "image/jpeg");

  // Write output only for FINAL mode
  const outputPath = input.renderMode === "FINAL" && input.outputPath ? input.outputPath : null;
  if (outputPath) {
    await storage.putBuffer(outputPath, normalizedBuffer, "image/jpeg");
  }

  return {
    storagePath: input.storagePath,
    outputPath,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

/**
 * Validate that a template source target (store/template/color) is valid for the tenant.
 */
export async function assertTemplateSourceTarget(input: {
  tenantId: string;
  storeId: string;
  templateId: string;
  colorId: string;
}): Promise<void> {
  const template = await prisma.storeMockupTemplate.findFirst({
    where: {
      id: input.templateId,
      storeId: input.storeId,
      store: { tenantId: input.tenantId, deletedAt: null },
      colors: { some: { colorId: input.colorId } },
    },
    select: { id: true },
  });

  if (!template) {
    throw new ValidationError("Template/color combination not found for this store");
  }
}

/**
 * Validate that a draft source target (draft/color) is valid for the tenant.
 * Returns the draft's storeId and templateId for convenience.
 */
export async function assertDraftSourceTarget(input: {
  tenantId: string;
  draftId: string;
  colorId: string;
}): Promise<{ storeId: string; templateId: string | null }> {
  const draft = await prisma.wizardDraft.findFirst({
    where: {
      id: input.draftId,
      tenantId: input.tenantId,
    },
    select: {
      storeId: true,
      templateId: true,
      enabledColorIds: true,
      store: {
        select: {
          colors: { select: { id: true } },
        },
      },
      template: {
        select: {
          colors: { select: { colorId: true } },
        },
      },
    },
  });

  if (!draft) {
    throw new ValidationError("Draft not found");
  }
  if (!draft.storeId) {
    throw new ValidationError("Draft has no store selected");
  }

  // Validate color belongs to the store
  const storeColorIds = new Set(draft.store?.colors.map((c) => c.id) ?? []);
  if (!storeColorIds.has(input.colorId)) {
    throw new ValidationError("Color not found in draft's store");
  }

  // If template is selected, also validate color belongs to template
  if (draft.template) {
    const templateColorIds = new Set(draft.template.colors.map((c) => c.colorId));
    if (!templateColorIds.has(input.colorId)) {
      throw new ValidationError("Color not found in draft's selected template");
    }
  }

  return {
    storeId: draft.storeId,
    templateId: draft.templateId,
  };
}

/**
 * Enforce isPrimary uniqueness within a scope group.
 * If isPrimary=true, unsets other active sources in the same group.
 */
export async function setCustomSourcePrimary(input: {
  sourceId: string;
  scope: "TEMPLATE" | "DRAFT";
  templateId: string | null;
  draftId: string | null;
  colorId: string;
  isPrimary: boolean;
}): Promise<void> {
  if (!input.isPrimary) return;

  const where =
    input.scope === "TEMPLATE"
      ? {
          scope: "TEMPLATE" as const,
          templateId: input.templateId,
          colorId: input.colorId,
          id: { not: input.sourceId },
          isActive: true,
          deletedAt: null,
        }
      : {
          scope: "DRAFT" as const,
          draftId: input.draftId,
          colorId: input.colorId,
          id: { not: input.sourceId },
          isActive: true,
          deletedAt: null,
        };

  await prisma.customMockupSource.updateMany({
    where,
    data: { isPrimary: false },
  });
}

/**
 * Generate storage paths for custom mockup uploads.
 */
export function buildStoragePaths(input: {
  scope: "TEMPLATE" | "DRAFT";
  storeId: string;
  templateId?: string | null;
  draftId?: string | null;
  colorId: string;
  sourceId: string;
  renderMode: "FINAL" | "COMPOSITE";
}): { storagePath: string; outputPath: string | null } {
  const baseKey =
    input.scope === "TEMPLATE"
      ? `custom-mockups/templates/${input.storeId}/${input.templateId}/${input.colorId}/${input.sourceId}`
      : `custom-mockups/drafts/${input.draftId}/${input.colorId}/${input.sourceId}`;

  return {
    storagePath: `${baseKey}-source.jpg`,
    outputPath: input.renderMode === "FINAL" ? `${baseKey}-output.jpg` : null,
  };
}

export class ValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
  }
}

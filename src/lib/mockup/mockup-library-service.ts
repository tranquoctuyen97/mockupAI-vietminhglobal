import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildSmartFitCompositeRegion,
  normalizeCompositeRenderMode,
  normalizeMockupLibraryScene,
  normalizeMockupLibraryView,
} from "@/lib/mockup/global-library";
import { normalizeCompositeRegionPx } from "@/lib/mockup/custom-library";
import { getStorage } from "@/lib/storage/local-disk";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export class MockupLibraryValidationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "MockupLibraryValidationError";
  }
}

export async function createMockupLibraryItemFromUpload(input: {
  tenantId: string;
  storeId: string;
  uploadedById: string;
  file: File;
  name: string;
  view: unknown;
  sceneType: unknown;
  renderMode: unknown;
  compositeRegionPx: unknown;
}) {
  const renderMode = normalizeCompositeRenderMode(input.renderMode);
  if (renderMode !== "COMPOSITE") throw new MockupLibraryValidationError("renderMode must be COMPOSITE");
  const view = normalizeMockupLibraryView(input.view);
  if (!view) throw new MockupLibraryValidationError("view is invalid");
  const sceneType = normalizeMockupLibraryScene(input.sceneType);
  if (!sceneType) throw new MockupLibraryValidationError("sceneType is invalid");
  if (!ALLOWED_TYPES.has(input.file.type)) throw new MockupLibraryValidationError("Only JPEG, PNG, and WebP images are supported");
  if (input.file.size > MAX_UPLOAD_BYTES) throw new MockupLibraryValidationError("File must be 100MB or smaller");

  const rawBuffer = Buffer.from(await input.file.arrayBuffer());
  const normalized = await sharp(rawBuffer).rotate().jpeg({ quality: 90 }).toBuffer();
  const metadata = await sharp(normalized).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) throw new MockupLibraryValidationError("Could not read image dimensions");

  const id = randomUUID();
  const storagePath = `mockups/library/${input.tenantId}/${id}-source.jpg`;
  await getStorage().putBuffer(storagePath, normalized, "image/jpeg");

  const region =
    normalizeCompositeRegionPx(parseMultipartJson(input.compositeRegionPx, "compositeRegionPx")) ??
    buildSmartFitCompositeRegion(width, height);

  return prisma.mockupLibraryItem.create({
    data: {
      id,
      tenantId: input.tenantId,
      storeId: input.storeId,
      name: input.name.trim() || "Untitled mockup",
      storagePath,
      previewPath: null,
      width,
      height,
      view,
      sceneType,
      renderMode,
      compositeRegionPx: region as unknown as Prisma.InputJsonValue,
      uploadedById: input.uploadedById,
      mimeType: input.file.type,
      fileSizeBytes: input.file.size,
    },
  });
}

export async function deleteMockupStorageObjects(item: { storagePath: string; previewPath: string | null }) {
  const storage = getStorage();
  await deleteStorageObjectIfExists(storage, item.storagePath);
  if (item.previewPath) {
    await deleteStorageObjectIfExists(storage, item.previewPath);
  }
}

export function parseMultipartJson(value: unknown, fieldName: string): unknown {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new MockupLibraryValidationError(`${fieldName} must be valid JSON`);
  }
}

async function deleteStorageObjectIfExists(storage: ReturnType<typeof getStorage>, key: string) {
  try {
    await storage.delete(key);
  } catch (error) {
    if (isMissingStorageObjectError(error)) return;
    throw error;
  }
}

function isMissingStorageObjectError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "ENOENT" || code === "NoSuchKey" || /not found/i.test(message);
}

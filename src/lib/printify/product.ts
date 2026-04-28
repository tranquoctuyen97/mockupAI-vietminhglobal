import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { DEFAULT_PRINT_AREA, type Placement, type PlacementData } from "../placement/types";
import { resolvePlacement } from "../placement/resolver";
import { getStorage } from "../storage/local-disk";
import { resolvePlacementViews } from "../mockup/plan";
import {
  PrintifyClient,
  type PrintifyProductImage,
} from "./client";

export interface ParsedPrintifyMockupImage {
  printifyMockupId: string;
  variantIds: number[];
  viewPosition: string;
  sourceUrl: string;
  mockupType: string;
  isDefault: boolean;
  cameraLabel: string | null;
}

export interface EnsurePrintifyImageInput {
  client: PrintifyClient;
  designStoragePath: string;
  cachedImageId?: string | null;
  storage?: ReturnType<typeof getStorage>;
}

export class PrintifyMockupTimeoutError extends Error {
  constructor(productId: string, maxWaitMs: number) {
    super(`Timed out waiting for Printify mockups for product ${productId} after ${maxWaitMs}ms`);
    this.name = "PrintifyMockupTimeoutError";
  }
}

export async function ensurePrintifyImage(input: EnsurePrintifyImageInput): Promise<string> {
  if (input.cachedImageId) return input.cachedImageId;

  const storage = input.storage ?? getStorage();
  const absolutePath = storage.resolvePath(input.designStoragePath);
  const fileBuffer = await readFile(absolutePath);
  const uploaded = await input.client.uploadImageBase64({
    fileName: `design_${basename(input.designStoragePath)}`,
    contentsBase64: fileBuffer.toString("base64"),
  });

  return uploaded.id;
}

export function buildPrintifyProductPayload(input: {
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
  variants?: Array<{ id: number; price: number; is_enabled: boolean; sku?: string; is_default?: boolean }>;
  imageId: string;
  placementData: PlacementData;
  tags?: string[];
}): Record<string, unknown> {
  const placeholders = resolvePlacementViews(input.placementData).map((view) => {
    const placement = resolvePlacement(input.placementData, view);
    return {
      position: view,
      images: [
        {
          id: input.imageId,
          ...mmToPrintifyCoords(placement ?? undefined),
        },
      ],
    };
  });

  // When explicit variants are provided, print_areas must reference ALL their IDs
  // (Printify requires every variant in `variants[]` to appear in `print_areas[].variant_ids`)
  const effectiveVariantIds = input.variants
    ? input.variants.map(v => v.id)
    : input.variantIds;

  return {
    title: input.title,
    description: input.description,
    blueprint_id: input.blueprintId,
    print_provider_id: input.printProviderId,
    variants: input.variants ?? input.variantIds.map((id) => ({
      id,
      price: 2000,
      is_enabled: true,
    })),
    print_areas: [
      {
        variant_ids: effectiveVariantIds,
        placeholders,
      },
    ],
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
  };
}

export async function createOrUpdatePrintifyProduct(input: {
  client: PrintifyClient;
  shopId: number;
  productId?: string | null;
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
  variants?: Array<{ id: number; price: number; is_enabled: boolean; sku?: string; is_default?: boolean }>;
  imageId: string;
  placementData: PlacementData;
  title: string;
  description: string;
  tags?: string[];
}): Promise<{ productId: string; images: ParsedPrintifyMockupImage[] }> {
  const payload = buildPrintifyProductPayload(input);
  const product = input.productId
    ? await input.client.updateProduct(input.shopId, input.productId, payload)
    : await input.client.createProduct(input.shopId, payload);

  return {
    productId: product.id,
    images: parsePrintifyMockupImages(product.id, product.images ?? []),
  };
}

export async function pollPrintifyMockups(input: {
  client: PrintifyClient;
  shopId: number;
  productId: string;
  maxWaitMs: number;
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ParsedPrintifyMockupImage[]> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const start = now();

  while (now() - start <= input.maxWaitMs) {
    const product = await input.client.getProduct(input.shopId, input.productId);
    const images = parsePrintifyMockupImages(product.id, product.images ?? []);
    if (images.length > 0) return images;
    await sleep(input.intervalMs);
  }

  throw new PrintifyMockupTimeoutError(input.productId, input.maxWaitMs);
}

export function parsePrintifyMockupImages(
  productId: string,
  images: PrintifyProductImage[],
): ParsedPrintifyMockupImage[] {
  return images
    .filter((image) => Boolean(image.src))
    .map((image, index) => {
      const mockupType = inferMockupType(image, index);
      return {
        printifyMockupId: image.id ?? `${productId}-${mockupType}-${index}`,
        variantIds: image.variant_ids ?? [],
        viewPosition: image.position ?? mockupType,
        sourceUrl: image.src,
        mockupType,
        isDefault: image.is_default ?? index === 0,
        cameraLabel: toCameraLabel(mockupType),
      };
    });
}

function mmToPrintifyCoords(
  placement?: Placement,
  printArea: { widthMm: number; heightMm: number } = DEFAULT_PRINT_AREA,
): { x: number; y: number; scale: number; angle: number } {
  if (!placement) {
    return { x: 0.5, y: 0.5, scale: 1, angle: 0 };
  }

  const centerXMm = placement.xMm + placement.widthMm / 2;
  const centerYMm = placement.yMm + placement.heightMm / 2;

  return {
    x: round3(centerXMm / printArea.widthMm),
    y: round3(centerYMm / printArea.heightMm),
    scale: round3(placement.widthMm / printArea.widthMm),
    angle: placement.rotationDeg,
  };
}

function inferMockupType(image: PrintifyProductImage, index: number): string {
  const position = normalizeType(image.position);
  if (position) return position;

  const source = `${image.id ?? ""} ${image.src}`.toLowerCase();
  if (source.includes("person")) return `person_${index + 1}`;
  if (source.includes("hanging")) return "hanging";
  if (source.includes("folded")) return "folded";
  if (source.includes("closeup") || source.includes("close-up")) return "closeup";
  return "front";
}

function normalizeType(value: string | undefined): string | null {
  if (!value) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || null;
}

function toCameraLabel(mockupType: string): string | null {
  return mockupType
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

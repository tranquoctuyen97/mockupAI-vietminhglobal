import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { DEFAULT_PRINT_AREA, type Placement, type PlacementData } from "../placement/types";
import { resolvePlacement } from "../placement/resolver";
import { getStorage } from "../storage/local-disk";
import { resolvePlacementViews } from "../mockup/plan";
import {
  PrintifyClient,
  PrintifyNotFoundError,
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
  publicBaseUrl?: string | null;
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
  const fileName = `design_${basename(input.designStoragePath)}`;
  const publicUrl = resolvePrintifyUploadUrl({
    storagePath: input.designStoragePath,
    publicBaseUrl: input.publicBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL,
  });

  if (publicUrl) {
    try {
      const uploaded = await input.client.uploadImageUrl({
        fileName,
        url: publicUrl,
      });
      return uploaded.id;
    } catch (err) {
      console.warn("[Printify] URL image upload failed, falling back to base64:", {
        storagePath: input.designStoragePath,
        publicUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const absolutePath = storage.resolvePath(input.designStoragePath);
  const fileBuffer = await readFile(absolutePath);
  const uploaded = await input.client.uploadImageBase64({
    fileName,
    contentsBase64: fileBuffer.toString("base64"),
  });

  return uploaded.id;
}

export function resolvePrintifyUploadUrl(input: {
  storagePath: string;
  publicBaseUrl?: string | null;
}): string | null {
  const baseUrl = input.publicBaseUrl?.trim();
  if (!baseUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (isLocalOrPrivateHost(parsed.hostname)) return null;

  const encodedPath = input.storagePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/api/files/${encodedPath}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host === "::1") return true;
  if (host.endsWith(".localhost")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
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
  salesChannelCollections?: string[];
  imageGroups?: Array<{ imageId: string; variantIds: number[] }>;
}): Record<string, unknown> {
  function buildPlaceholders(imageId: string): Array<Record<string, unknown>> {
    return resolvePlacementViews(input.placementData).map((view) => {
      const placement = resolvePlacement(input.placementData, view);
      return {
        position: view,
        images: [
          {
            id: imageId,
            ...mmToPrintifyCoords(placement ?? undefined),
          },
        ],
      };
    });
  }

  // When explicit variants are provided, print_areas must reference ALL their IDs
  // (Printify requires every variant in `variants[]` to appear in `print_areas[].variant_ids`)
  const effectiveVariantIds = input.variants
    ? input.variants.map(v => v.id)
    : input.variantIds;

  // When imageGroups is provided (dual-design pair publish), create one print_area
  // per group with its own image. Otherwise, single print_area for all variants.
  const printAreas = input.imageGroups?.length
    ? input.imageGroups.map((group) => ({
        variant_ids: group.variantIds,
        placeholders: buildPlaceholders(group.imageId),
      }))
    : [{
        variant_ids: effectiveVariantIds,
        placeholders: buildPlaceholders(input.imageId),
      }];

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
    print_areas: printAreas,
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(input.salesChannelCollections && input.salesChannelCollections.length > 0
      ? { sales_channel_properties: { collections: input.salesChannelCollections } }
      : {}),
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
  salesChannelCollections?: string[];
  imageGroups?: Array<{ imageId: string; variantIds: number[] }>;
}): Promise<{ productId: string; images: ParsedPrintifyMockupImage[] }> {
  // Fetch full catalog variants for this blueprint+provider.
  // Printify requires ALL variants to be present in the payload (especially for PUT).
  // Selected variants → is_enabled: true, rest → is_enabled: false.
  // For PUT updates, ALWAYS fetch full catalog even if input.variants is provided,
  // because the local cost cache may be stale/incomplete vs the live Printify catalog.
  let fullVariants: Array<{ id: number; price: number; is_enabled: boolean; sku?: string; is_default?: boolean }> | undefined;

  if (!input.variants || input.productId) {
    try {
      const { variants: catalogVariants } = await input.client.getBlueprintVariants(
        input.blueprintId,
        input.printProviderId,
      );
      const enabledSet = new Set(input.variantIds);
      // Merge provided variant prices/SKUs with the full catalog
      const providedMap = new Map(
        (input.variants ?? []).map(v => [v.id, v]),
      );
      fullVariants = catalogVariants.map((v) => {
        const provided = providedMap.get(v.id);
        return {
          id: v.id,
          price: provided?.price ?? 2000,
          is_enabled: provided?.is_enabled ?? enabledSet.has(v.id),
          ...(provided?.sku ? { sku: provided.sku } : {}),
          ...(provided?.is_default ? { is_default: true } : {}),
        };
      });
    } catch (err) {
      console.warn("[Printify] Failed to fetch catalog variants for full payload, falling back to subset:", err);
      // Fallback: use only the selected variant IDs (may fail on PUT)
    }
  }

  const payloadInput = fullVariants
    ? { ...input, variants: fullVariants }
    : input;

  const payload = buildPrintifyProductPayload(payloadInput) as Record<string, any>;

  if (input.productId) {
    try {
      const existingProduct = await input.client.getProduct(input.shopId, input.productId);
      const existingMockupIds = (existingProduct.images ?? [])
        .map((img: any) => img.mockup_id)
        .filter(Boolean);
      if (existingMockupIds.length > 0) {
        payload.visible_mockups = existingMockupIds;
      }
    } catch (err) {
      console.warn(`[Printify] Failed to fetch existing product ${input.productId} for visible_mockups:`, err);
    }
  }

  // Debug log — dump payload summary before sending to Printify
  const payloadVariants = (payload.variants as Array<{ id: number; is_enabled: boolean }>) ?? [];
  const printAreas = (payload.print_areas as Array<{ variant_ids: number[] }>) ?? [];
  const enabledCount = payloadVariants.filter(v => v.is_enabled).length;
  const disabledCount = payloadVariants.length - enabledCount;
  const printAreaVariantIds = printAreas.flatMap(pa => pa.variant_ids);
  const variantIdsNotInPrintArea = payloadVariants.map(v => v.id).filter(id => !printAreaVariantIds.includes(id));
  const printAreaIdsNotInVariants = printAreaVariantIds.filter(id => !payloadVariants.some(v => v.id === id));

  console.log(`[Printify] ${input.productId ? "PUT" : "POST"} payload debug:`, JSON.stringify({
    shopId: input.shopId,
    productId: input.productId ?? "NEW",
    blueprintId: payload.blueprint_id,
    printProviderId: payload.print_provider_id,
    totalVariants: payloadVariants.length,
    enabledVariants: enabledCount,
    disabledVariants: disabledCount,
    printAreaVariantIdCount: printAreaVariantIds.length,
    variantIdsNotInPrintArea,
    printAreaIdsNotInVariants,
    placeholders: printAreas.map(pa => (pa as any).placeholders?.map((ph: any) => ph.position)),
    visibleMockupCount: payload.visible_mockups?.length ?? 0,
  }, null, 2));

  // Defensive cap: Printify hard limit is 100 enabled variants per product.
  // If more are enabled (e.g. due to large catalog merge), disable overflow.
  const MAX_ENABLED_PER_PRODUCT = 100;
  if (enabledCount > MAX_ENABLED_PER_PRODUCT) {
    console.warn(
      `[Printify] Capping enabled variants from ${enabledCount} to ${MAX_ENABLED_PER_PRODUCT}`,
    );
    let seen = 0;
    for (const v of payloadVariants) {
      if (v.is_enabled) {
        seen++;
        if (seen > MAX_ENABLED_PER_PRODUCT) {
          (v as any).is_enabled = false;
        }
      }
    }
  }

  let product;
  if (input.productId) {
    const existing = await input.client.getProduct(input.shopId, input.productId).catch((err) => {
      if (err instanceof PrintifyNotFoundError) return null;
      throw err;
    });

    const existingBlueprintId = Number(existing?.blueprint_id);
    const existingProviderId = Number(existing?.print_provider_id);
    const payloadBlueprintId = Number(payload.blueprint_id);
    const payloadProviderId = Number(payload.print_provider_id);

    const existingVariantsCount = existing?.variants?.length ?? 0;
    const payloadVariantsCount = payloadVariants.length;

    let hasVariantMismatch = existingVariantsCount !== payloadVariantsCount;
    if (!hasVariantMismatch && existing?.variants) {
      const existingIds = existing.variants.map((v) => Number(v.id)).sort();
      const payloadIds = payloadVariants.map((v) => Number(v.id)).sort();
      for (let i = 0; i < existingIds.length; i++) {
        if (existingIds[i] !== payloadIds[i]) {
          hasVariantMismatch = true;
          break;
        }
      }
    }

    const isMismatch =
      !existing ||
      existingBlueprintId !== payloadBlueprintId ||
      existingProviderId !== payloadProviderId ||
      hasVariantMismatch;

    if (isMismatch) {
      console.warn("[Printify] Draft product mismatch or not found. Bypassing PUT and creating new draft product.", {
        oldProductId: input.productId,
        existingBlueprintId: existing?.blueprint_id,
        existingPrintProviderId: existing?.print_provider_id,
        payloadBlueprintId: payload.blueprint_id,
        payloadPrintProviderId: payload.print_provider_id,
        existingVariantsCount,
        payloadVariantsCount,
        hasVariantMismatch,
        shopId: input.shopId,
      });
      product = await input.client.createProduct(input.shopId, payload);
    } else {
      product = await input.client.updateProduct(input.shopId, input.productId, payload);
    }
  } else {
    product = await input.client.createProduct(input.shopId, payload);
  }

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
  let attempts = 0;

  while (now() - start <= input.maxWaitMs) {
    const product = await input.client.getProduct(input.shopId, input.productId);
    const images = parsePrintifyMockupImages(product.id, product.images ?? []);
    if (images.length > 0) return images;

    attempts++;
    // Adaptive backoff: base intervalMs + 1.5s per retry, capped at 12s.
    // e.g. 3s → 4.5s → 6s → 7.5s → 9s → 10.5s → 12s → 12s ...
    const delay = Math.min(input.intervalMs + (attempts - 1) * 1500, 12000);
    await sleep(delay);
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
        printifyMockupId: image.mockup_id ?? image.id ?? `${productId}-${mockupType}-${index}`,
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

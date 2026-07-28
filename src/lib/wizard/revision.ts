import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/db";

export type WizardRevisionPayload = {
  version: 1;
  tenantId: string;
  draftId: string;
  stateHash: string;
  reviewedAt: string;
};

type WizardRevisionDependencies = {
  loadSnapshot(tenantId: string, draftId: string): Promise<unknown | null>;
  getSecret(): string;
  now(): Date;
};

export class WizardRevisionError extends Error {
  constructor(
    public readonly code: "REVISION_CONFLICT" | "RESOURCE_NOT_FOUND" | "REVISION_CONFIG_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "WizardRevisionError";
  }
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    if ("toJSON" in value && typeof value.toJSON === "function") {
      return canonicalize(value.toJSON());
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function hashWizardRevisionSnapshot(snapshot: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest("hex");
}

export function validateMcpRevisionSecret(secret = process.env.MCP_REVISION_SECRET): string {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new WizardRevisionError(
      "REVISION_CONFIG_INVALID",
      "MCP_REVISION_SECRET must contain at least 32 bytes",
    );
  }
  return secret;
}

async function loadRevisionSnapshot(tenantId: string, draftId: string) {
  return prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId },
    select: {
      id: true,
      tenantId: true,
      updatedAt: true,
      storeId: true,
      templateId: true,
      currentStep: true,
      status: true,
      enabledColorIds: true,
      enabledSizes: true,
      enabledSizesByColor: true,
      enabledVariantIdsOverride: true,
      placementOverride: true,
      priceBySizeOverride: true,
      mockupsStale: true,
      mockupsStaleReason: true,
      store: {
        select: {
          defaultPriceUsd: true,
          publishMode: true,
          updatedAt: true,
        },
      },
      template: {
        select: {
          defaultMockupSource: true,
          basePriceUsd: true,
          priceBySizeDefault: true,
          defaultPlacement: true,
          defaultTags: true,
          defaultCollections: true,
        },
      },
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          designId: true,
          sortOrder: true,
          aiContent: true,
          updatedAt: true,
          design: {
            select: {
              name: true,
              storagePath: true,
              previewPath: true,
              width: true,
              height: true,
              dpi: true,
              updatedAt: true,
            },
          },
        },
      },
      designPairs: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          baseName: true,
          lightDraftDesignId: true,
          darkDraftDesignId: true,
          sortOrder: true,
          aiContent: true,
          updatedAt: true,
        },
      },
      mockupSources: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          storagePath: true,
          mockupLibraryItemId: true,
          view: true,
          appliesToColorIds: true,
          appliesToAll: true,
          compositeRegionPx: true,
          width: true,
          height: true,
          isPrimary: true,
          sortOrder: true,
          expiresAt: true,
          mockupLibraryItem: {
            select: {
              updatedAt: true,
              storagePath: true,
              compositeRegionPx: true,
            },
          },
        },
      },
      mockupJobs: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          draftDesignId: true,
          designId: true,
          status: true,
          totalImages: true,
          completedImages: true,
          failedImages: true,
          placementSnapshot: true,
          colorFilterIds: true,
          colorGroup: true,
          updatedAt: true,
          images: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              id: true,
              variantId: true,
              colorName: true,
              viewPosition: true,
              sourceUrl: true,
              compositeUrl: true,
              compositeStatus: true,
              included: true,
              isDefault: true,
              sortOrder: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });
}

export function createWizardRevisionService(dependencies: WizardRevisionDependencies) {
  async function createWizardRevisionToken(
    tenantId: string,
    draftId: string,
  ): Promise<{ token: string; payload: WizardRevisionPayload }> {
    const snapshot = await dependencies.loadSnapshot(tenantId, draftId);
    if (!snapshot) {
      throw new WizardRevisionError("RESOURCE_NOT_FOUND", "Draft not found");
    }
    const payload: WizardRevisionPayload = {
      version: 1,
      tenantId,
      draftId,
      stateHash: hashWizardRevisionSnapshot(snapshot),
      reviewedAt: dependencies.now().toISOString(),
    };
    const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", dependencies.getSecret())
      .update(payloadPart)
      .digest("base64url");
    return { token: `v1.${payloadPart}.${signature}`, payload };
  }

  async function assertWizardRevisionToken(
    token: string,
    tenantId: string,
    draftId: string,
  ): Promise<void> {
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== "v1") throw new Error("format");
      const [, payloadPart, signaturePart] = parts;
      const expectedSignature = createHmac("sha256", dependencies.getSecret())
        .update(payloadPart)
        .digest();
      const actualSignature = Buffer.from(signaturePart, "base64url");
      if (
        actualSignature.length !== expectedSignature.length ||
        !timingSafeEqual(actualSignature, expectedSignature)
      ) {
        throw new Error("signature");
      }
      const payload = JSON.parse(
        Buffer.from(payloadPart, "base64url").toString("utf8"),
      ) as WizardRevisionPayload;
      if (payload.version !== 1 || payload.tenantId !== tenantId || payload.draftId !== draftId) {
        throw new Error("identity");
      }
      const current = await dependencies.loadSnapshot(tenantId, draftId);
      if (!current || hashWizardRevisionSnapshot(current) !== payload.stateHash) {
        throw new Error("state");
      }
    } catch (error) {
      if (error instanceof WizardRevisionError && error.code === "REVISION_CONFIG_INVALID") {
        throw error;
      }
      throw new WizardRevisionError(
        "REVISION_CONFLICT",
        "Wizard changed after review; review it again before publishing",
      );
    }
  }

  return { createWizardRevisionToken, assertWizardRevisionToken };
}

const revisionService = createWizardRevisionService({
  loadSnapshot: loadRevisionSnapshot,
  getSecret: () => validateMcpRevisionSecret(),
  now: () => new Date(),
});

export const createWizardRevisionToken = revisionService.createWizardRevisionToken;
export const assertWizardRevisionToken = revisionService.assertWizardRevisionToken;

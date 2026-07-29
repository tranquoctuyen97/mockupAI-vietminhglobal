import { prisma } from "@/lib/db";
import { attachTemporaryDesignUrl } from "@/lib/mcp/assets/temporary-design";
import { setWizardCustomMockups } from "@/lib/mcp/assets/temporary-mockup";
import type { WizardCustomMockupInput } from "@/lib/wizard/custom-mockup-contracts";
import {
  createWizardDraft,
  generateWizardAssets,
  setWizardContent,
  setWizardDesigns,
  setWizardProductConfig,
} from "@/lib/wizard/mutations";
import {
  getNormalizedWizard,
  resolveMockupRef,
  resolveStoreRef,
} from "@/lib/wizard/query";
import type { McpAuthContext } from "../contracts";
import { assertMcpToolAccess } from "../permission-service";
import type { McpToolPayload } from "./discovery";

type RawCustomMockup = {
  source: { url: string } | { mockupRef: { id: string } | { name: string } };
  name?: string;
  view: WizardCustomMockupInput["view"];
  appliesToColorRefs: string[];
  compositeRegionPx?: WizardCustomMockupInput["compositeRegionPx"];
  isPrimary?: boolean;
  sortOrder?: number;
};

async function resolveCustomMockups(input: {
  tenantId: string;
  storeId: string;
  mockups: RawCustomMockup[];
}): Promise<WizardCustomMockupInput[]> {
  const resolved: WizardCustomMockupInput[] = [];
  for (const mockup of input.mockups) {
    if ("url" in mockup.source) {
      resolved.push({
        ...mockup,
        source: { url: mockup.source.url },
      });
      continue;
    }
    const item = await resolveMockupRef({
      tenantId: input.tenantId,
      storeId: input.storeId,
      mockupRef: mockup.source.mockupRef,
    });
    resolved.push({
      ...mockup,
      source: { mockupLibraryItemId: item.id },
    });
  }
  return resolved;
}

async function loadDraftStore(tenantId: string, draftId: string): Promise<string> {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId },
    select: { storeId: true },
  });
  if (!draft?.storeId) throw new Error("Draft not found or store is not selected");
  return draft.storeId;
}

export async function executeWizardTool(
  name: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
): Promise<McpToolPayload | null> {
  if (name === "create_listing_wizard") {
    if (Array.isArray(args.designRefs) && args.designRefs.length > 0) {
      await assertMcpToolAccess(auth, "design_library");
    }
    const store = await resolveStoreRef({
      tenantId: auth.tenantId,
      storeRef: args.storeRef as never,
    });
    const rawCustom = (args.customMockups ?? []) as RawCustomMockup[];
    if (rawCustom.some((mockup) => "mockupRef" in mockup.source)) {
      await assertMcpToolAccess(auth, "mockup_library");
    }
    const customMockups = await resolveCustomMockups({
      tenantId: auth.tenantId,
      storeId: store.id,
      mockups: rawCustom,
    });
    const wizard = await createWizardDraft({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      profileId: auth.profileId,
      storeRef: args.storeRef as never,
      designRefs: args.designRefs as never,
      designUrls: args.designUrls as never,
      templateRef: args.templateRef as never,
      productConfig: args.productConfig as never,
      customMockups,
      contentSeed: args.contentSeed as never,
      pairingMode: args.pairingMode as "AUTO" | "NONE",
    });
    return {
      data: wizard,
      warnings: wizard.warnings,
      nextActions: ["set_wizard_product_config", "generate_wizard_assets"],
    };
  }

  if (name === "attach_wizard_design_url") {
    const attached = await attachTemporaryDesignUrl({
      tenantId: auth.tenantId,
      profileId: auth.profileId,
      ownerUserId: auth.userId,
      draftId: String(args.draftId),
      url: String(args.url),
      name: args.name as string | undefined,
      pairingMode: args.pairingMode as "AUTO" | "NONE",
    });
    const wizard = await getNormalizedWizard({
      tenantId: auth.tenantId,
      draftId: String(args.draftId),
    });
    return {
      data: {
        draftId: args.draftId,
        draftDesign: attached,
        designPairs: attached.pairs,
        mockupsStale: wizard.draft.mockupsStale,
        expiresAt: attached.expiresAt.toISOString(),
      },
      warnings: wizard.warnings,
      nextActions: ["set_wizard_designs", "set_wizard_product_config"],
    };
  }

  if (name === "set_wizard_designs") {
    const selections = args.designs as Array<
      { designRef: { id: string } | { name: string } } | { draftDesignId: string }
    >;
    if (selections.some((selection) => "designRef" in selection)) {
      await assertMcpToolAccess(auth, "design_library");
    }
    const wizard = await setWizardDesigns({
      tenantId: auth.tenantId,
      draftId: String(args.draftId),
      designs: selections,
      pairingMode: args.pairingMode as "AUTO" | "NONE",
    });
    return {
      data: {
        designs: wizard.designs,
        designPairs: wizard.designPairs,
        mockupsStale: wizard.draft.mockupsStale,
      },
      warnings: wizard.warnings,
      nextActions: ["set_wizard_product_config"],
    };
  }

  if (name === "set_wizard_custom_mockups") {
    const rawMockups = args.mockups as RawCustomMockup[];
    if (rawMockups.some((mockup) => "mockupRef" in mockup.source)) {
      await assertMcpToolAccess(auth, "mockup_library");
    }
    const draftId = String(args.draftId);
    const storeId = await loadDraftStore(auth.tenantId, draftId);
    const result = await setWizardCustomMockups({
      tenantId: auth.tenantId,
      profileId: auth.profileId,
      draftId,
      mockups: await resolveCustomMockups({
        tenantId: auth.tenantId,
        storeId,
        mockups: rawMockups,
      }),
    });
    return {
      data: {
        customMockups: result.sources,
        coverage: {
          coveredColorIds: result.coveredColorIds,
          missingColorIds: result.missingColorIds,
        },
        computedRegions: result.sources.map((source) => ({
          sourceId: source.id,
          compositeRegionPx: source.compositeRegionPx,
        })),
        mockupsStale: true,
      },
      warnings:
        result.missingColorIds.length > 0
          ? [`Missing custom mockup coverage: ${result.missingColorIds.join(", ")}`]
          : [],
      nextActions: ["generate_wizard_assets"],
    };
  }

  if (name === "set_wizard_product_config") {
    const wizard = await setWizardProductConfig({
      tenantId: auth.tenantId,
      draftId: String(args.draftId),
      templateRef: args.templateRef as never,
      enabledColorIds: args.enabledColorIds as string[] | undefined,
      enabledSizes: args.enabledSizes as string[] | undefined,
      enabledSizesByColor: args.enabledSizesByColor as Record<string, string[]> | undefined,
      enabledVariantIdsOverride: args.enabledVariantIdsOverride as number[] | undefined,
      priceBySizeOverride: args.priceBySizeOverride as Record<string, number> | undefined,
      placementOverride: args.placementOverride as Record<string, unknown> | undefined,
    });
    return {
      data: {
        productConfig: wizard.draft,
        mockupsStale: wizard.draft.mockupsStale,
      },
      warnings: wizard.warnings,
      nextActions: ["set_wizard_custom_mockups", "generate_wizard_assets"],
    };
  }

  if (name === "set_wizard_content") {
    const wizard = await setWizardContent({
      tenantId: auth.tenantId,
      draftId: String(args.draftId),
      target: args.target as never,
      content: args.content as never,
    });
    return {
      data: {
        target: args.target,
        contentSummary: args.content,
      },
      warnings: wizard.warnings,
      nextActions: ["get_wizard_status", "review_wizard"],
    };
  }

  if (name === "generate_wizard_assets") {
    const jobs = await generateWizardAssets({
      tenantId: auth.tenantId,
      draftId: String(args.draftId),
      assetTypes: args.assetTypes as Array<"MOCKUPS" | "CONTENT">,
    });
    return {
      data: { jobs, status: "started" },
      warnings: [],
      nextActions: ["get_wizard_status"],
    };
  }

  return null;
}

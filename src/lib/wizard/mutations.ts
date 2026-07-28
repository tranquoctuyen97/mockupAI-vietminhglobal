import { generateCacheKey, getCachedContent, saveToCache } from "@/lib/ai/cache";
import { getAiProvider } from "@/lib/ai/factory";
import { withRetry } from "@/lib/ai/retry";
import { recordAiUsageEvent } from "@/lib/ai/usage";
import { prisma } from "@/lib/db";
import { attachTemporaryDesignUrl } from "@/lib/mcp/assets/temporary-design";
import { setWizardCustomMockups } from "@/lib/mcp/assets/temporary-mockup";
import {
  type BatchMockupJobFailure,
  createCustomMockupJobForDraftDesign,
  createMockupJobForDraftDesign,
  loadMockupGenerationContext,
  prepareMockupGeneration,
} from "@/lib/mockup/generation";
import type {
  CreateWizardInput,
  GenerateAssetsInput,
  NormalizedWizard,
  SetContentInput,
  SetProductConfigInput,
  SetWizardDesignsInput,
  WizardJobSummary,
} from "./contracts";
import { WizardResourceError } from "./contracts";
import { mergeOptimizedTags, normalizeOrganizationCollections } from "./product-organization";
import { getIndependentDraftDesigns } from "./publish-units";
import {
  getNormalizedWizard,
  resolveDesignRef,
  resolveStoreRef,
  resolveTemplateRef,
} from "./query";
import { createDraft, updateDraft } from "./state";

export function normalizeManualWizardContent(content: SetContentInput["content"]) {
  return {
    title: String(content.title ?? "").trim(),
    description: String(content.description ?? "").trim(),
    tags: mergeOptimizedTags([], content.tags ?? []),
    collections: normalizeOrganizationCollections(content.organizationCollections ?? []),
    altText: "",
    source: "manual",
  };
}

export function normalizeWizardAssetTypes(
  assetTypes: GenerateAssetsInput["assetTypes"],
): Array<"MOCKUPS" | "CONTENT"> {
  const unique = [...new Set(assetTypes)];
  if (unique.length === 0) {
    throw new WizardResourceError("VALIDATION_FAILED", "At least one asset type is required");
  }
  return unique;
}

export async function setWizardDesigns(input: SetWizardDesignsInput): Promise<NormalizedWizard> {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: input.draftId, tenantId: input.tenantId },
    select: { id: true, storeId: true },
  });
  if (!draft) {
    throw new WizardResourceError("RESOURCE_NOT_FOUND", "Draft not found");
  }
  if (!draft.storeId) {
    throw new WizardResourceError("VALIDATION_FAILED", "Select a store before selecting designs");
  }

  const designIds: string[] = [];
  for (const selection of input.designs) {
    if ("designRef" in selection) {
      const design = await resolveDesignRef({
        tenantId: input.tenantId,
        storeId: draft.storeId,
        designRef: selection.designRef,
      });
      designIds.push(design.id);
      continue;
    }
    const attached = await prisma.wizardDraftDesign.findFirst({
      where: {
        id: selection.draftDesignId,
        draftId: input.draftId,
        draft: { tenantId: input.tenantId },
      },
      select: { designId: true },
    });
    if (!attached) {
      throw new WizardResourceError("RESOURCE_NOT_FOUND", "Attached draft design not found");
    }
    designIds.push(attached.designId);
  }

  await updateDraft(input.draftId, input.tenantId, {
    designIds: [...new Set(designIds)],
  });
  if (input.pairingMode === "NONE") {
    await prisma.wizardDraftDesignPair.deleteMany({
      where: { draftId: input.draftId },
    });
  }
  return getNormalizedWizard(input);
}

export async function setWizardProductConfig(
  input: SetProductConfigInput,
): Promise<NormalizedWizard> {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: input.draftId, tenantId: input.tenantId },
    select: {
      id: true,
      storeId: true,
      store: { select: { colors: { select: { id: true } } } },
    },
  });
  if (!draft) {
    throw new WizardResourceError("RESOURCE_NOT_FOUND", "Draft not found");
  }
  if (!draft.storeId) {
    throw new WizardResourceError("VALIDATION_FAILED", "Draft has no selected store");
  }

  const selectedColorIds = input.enabledColorIds;
  if (selectedColorIds) {
    const allowed = new Set(draft.store?.colors.map((color) => color.id) ?? []);
    if (selectedColorIds.some((id) => !allowed.has(id))) {
      throw new WizardResourceError(
        "VALIDATION_FAILED",
        "One or more colors do not belong to the draft store",
      );
    }
  }

  const templateId = input.templateRef
    ? (
        await resolveTemplateRef({
          tenantId: input.tenantId,
          storeId: draft.storeId,
          templateRef: input.templateRef,
        })
      ).id
    : undefined;

  await updateDraft(input.draftId, input.tenantId, {
    templateId,
    enabledColorIds: input.enabledColorIds,
    enabledSizes: input.enabledSizes,
    enabledSizesByColor: input.enabledSizesByColor,
    enabledVariantIdsOverride: input.enabledVariantIdsOverride,
    priceBySizeOverride: input.priceBySizeOverride,
    placementOverride: input.placementOverride,
  });
  return getNormalizedWizard(input);
}

export async function setWizardContent(input: SetContentInput): Promise<NormalizedWizard> {
  const aiContent = normalizeManualWizardContent(input.content);
  if (input.target.type === "DESIGN") {
    const target = await prisma.wizardDraftDesign.findFirst({
      where: {
        id: input.target.draftDesignId,
        draftId: input.draftId,
        draft: { tenantId: input.tenantId },
      },
      select: { id: true },
    });
    if (!target) {
      throw new WizardResourceError("RESOURCE_NOT_FOUND", "Draft design not found");
    }
    await prisma.wizardDraftDesign.update({
      where: { id: target.id },
      data: { aiContent },
    });
  } else {
    const target = await prisma.wizardDraftDesignPair.findFirst({
      where: {
        id: input.target.pairId,
        draftId: input.draftId,
        draft: { tenantId: input.tenantId },
      },
      select: { id: true },
    });
    if (!target) {
      throw new WizardResourceError("RESOURCE_NOT_FOUND", "Design pair not found");
    }
    await prisma.wizardDraftDesignPair.update({
      where: { id: target.id },
      data: { aiContent },
    });
  }
  return getNormalizedWizard(input);
}

async function generateMockupAssets(input: GenerateAssetsInput): Promise<WizardJobSummary[]> {
  const context = await loadMockupGenerationContext(input.draftId, input.tenantId);
  const prepared = await prepareMockupGeneration(context);
  if (context.draft.draftDesigns.length === 0) {
    throw new WizardResourceError("VALIDATION_FAILED", "No designs attached to draft");
  }
  const jobs: WizardJobSummary[] = [];
  const failures: BatchMockupJobFailure[] = [];
  for (const draftDesign of context.draft.draftDesigns) {
    try {
      const result = prepared.isCustom
        ? await createCustomMockupJobForDraftDesign(context, prepared, draftDesign)
        : await createMockupJobForDraftDesign(context, prepared, draftDesign);
      jobs.push({ id: result.jobId, type: "MOCKUPS", status: result.status });
    } catch (error) {
      failures.push({
        draftDesignId: draftDesign.id,
        designId: draftDesign.designId,
        designName: draftDesign.design.name,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  if (jobs.length === 0 && failures.length > 0) {
    throw new Error(failures.map((failure) => failure.error).join("; "));
  }
  return jobs;
}

async function generateContentAssets(input: GenerateAssetsInput): Promise<WizardJobSummary[]> {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: input.draftId, tenantId: input.tenantId },
    include: {
      design: true,
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        include: { design: true },
      },
      designPairs: {
        orderBy: { sortOrder: "asc" },
        include: {
          lightDesign: { include: { design: true } },
          darkDesign: { include: { design: true } },
        },
      },
      store: { include: { colors: true } },
      template: true,
    },
  });
  if (!draft) {
    throw new WizardResourceError("RESOURCE_NOT_FOUND", "Draft not found");
  }
  const independent = getIndependentDraftDesigns(draft.draftDesigns, draft.designPairs);
  if (independent.length === 0 && draft.designPairs.length === 0) {
    throw new WizardResourceError("VALIDATION_FAILED", "No content targets exist");
  }

  const { generator, config } = await getAiProvider(input.tenantId);
  const colors = draft.store?.colors
    .filter((color) => draft.enabledColorIds.includes(color.id))
    .map((color) => color.name);
  const productType = draft.template?.blueprintTitle ?? draft.store?.name ?? "T-Shirt";
  const placement = (draft.placementOverride as { position?: string } | null)?.position ?? "Front";

  const generate = async (designName: string) => {
    const generationInput = {
      designName,
      productType,
      colors: colors?.length ? colors : ["Default"],
      placement,
    };
    const cacheKey = generateCacheKey(
      generationInput,
      config.provider,
      config.model,
      config.systemPrompt,
    );
    const cached = await getCachedContent(cacheKey);
    const content =
      cached ??
      (await Promise.race([
        withRetry(() => generator.generate(generationInput), {
          maxAttempts: 2,
        }),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("AI provider timeout (45s)")), 45_000),
        ),
      ]));
    if (!cached) {
      await saveToCache(cacheKey, content, config.provider, config.model);
    }
    await recordAiUsageEvent({
      tenantId: input.tenantId,
      provider: config.provider,
      model: config.model,
      draftId: input.draftId,
      status: "success",
      cacheHit: Boolean(cached),
      tokensIn: cached ? undefined : content.tokensIn,
      tokensOut: cached ? undefined : content.tokensOut,
    });
    return {
      title: content.title,
      description: content.description,
      tags: content.tags,
      collections: [],
      altText: content.altText,
      source: "ai",
    };
  };

  for (const pair of draft.designPairs) {
    const content = await generate(
      `${pair.baseName} | Light: ${pair.lightDesign.design.name} | Dark: ${pair.darkDesign.design.name}`,
    );
    await prisma.wizardDraftDesignPair.update({
      where: { id: pair.id },
      data: { aiContent: content },
    });
  }
  for (const draftDesign of independent) {
    const content = await generate(draftDesign.design.name);
    await prisma.wizardDraftDesign.update({
      where: { id: draftDesign.id },
      data: { aiContent: content },
    });
  }
  return [
    {
      id: `content:${input.draftId}:${Date.now()}`,
      type: "CONTENT",
      status: "completed",
    },
  ];
}

export async function generateWizardAssets(
  input: GenerateAssetsInput,
): Promise<WizardJobSummary[]> {
  const assetTypes = normalizeWizardAssetTypes(input.assetTypes);
  const jobs: WizardJobSummary[] = [];
  if (assetTypes.includes("MOCKUPS")) {
    jobs.push(...(await generateMockupAssets(input)));
  }
  if (assetTypes.includes("CONTENT")) {
    jobs.push(...(await generateContentAssets(input)));
  }
  return jobs;
}

async function applyContentSeed(
  input: Pick<CreateWizardInput, "tenantId" | "contentSeed"> & {
    draftId: string;
  },
): Promise<void> {
  if (!input.contentSeed) return;
  const wizard = await getNormalizedWizard({
    tenantId: input.tenantId,
    draftId: input.draftId,
  });
  for (const seed of input.contentSeed.targets) {
    const candidates =
      seed.target.type === "DESIGN_NAME"
        ? wizard.designs.filter(
            (design) =>
              String(design.name).toLocaleLowerCase("en-US") ===
              seed.target.value.trim().toLocaleLowerCase("en-US"),
          )
        : wizard.designPairs.filter(
            (pair) =>
              String(pair.baseName).toLocaleLowerCase("en-US") ===
              seed.target.value.trim().toLocaleLowerCase("en-US"),
          );
    if (candidates.length !== 1) {
      throw new WizardResourceError(
        candidates.length === 0 ? "RESOURCE_NOT_FOUND" : "AMBIGUOUS_REFERENCE",
        "Content seed target could not be resolved uniquely",
      );
    }
    await setWizardContent({
      tenantId: input.tenantId,
      draftId: input.draftId,
      target:
        seed.target.type === "DESIGN_NAME"
          ? {
              type: "DESIGN",
              draftDesignId: String(candidates[0].draftDesignId),
            }
          : { type: "PAIR", pairId: String(candidates[0].id) },
      content: seed.content,
    });
  }
}

export async function createWizardDraft(input: CreateWizardInput): Promise<NormalizedWizard> {
  const store = await resolveStoreRef({
    tenantId: input.tenantId,
    storeRef: input.storeRef,
  });
  const draft = await createDraft(input.tenantId);
  try {
    await updateDraft(draft.id, input.tenantId, {
      storeId: store.id,
      currentStep: 1,
    });

    if (input.designRefs?.length) {
      await setWizardDesigns({
        tenantId: input.tenantId,
        draftId: draft.id,
        designs: input.designRefs.map((designRef) => ({ designRef })),
        pairingMode: input.pairingMode,
      });
    }
    if (input.designUrls?.length) {
      if (!input.profileId) {
        throw new WizardResourceError(
          "VALIDATION_FAILED",
          "MCP profile is required for URL assets",
        );
      }
      for (const design of input.designUrls) {
        await attachTemporaryDesignUrl({
          tenantId: input.tenantId,
          profileId: input.profileId,
          ownerUserId: input.actorUserId,
          draftId: draft.id,
          url: design.url,
          name: design.name,
          pairingMode: input.pairingMode,
        });
      }
    }
    if (input.templateRef || input.productConfig) {
      await setWizardProductConfig({
        tenantId: input.tenantId,
        draftId: draft.id,
        ...input.productConfig,
        templateRef: input.templateRef ?? input.productConfig?.templateRef,
      });
    }
    if (input.customMockups?.length) {
      if (!input.profileId) {
        throw new WizardResourceError(
          "VALIDATION_FAILED",
          "MCP profile is required for URL assets",
        );
      }
      await setWizardCustomMockups({
        tenantId: input.tenantId,
        profileId: input.profileId,
        draftId: draft.id,
        mockups: input.customMockups,
      });
    }
    await applyContentSeed({
      tenantId: input.tenantId,
      draftId: draft.id,
      contentSeed: input.contentSeed,
    });
    return getNormalizedWizard({
      tenantId: input.tenantId,
      draftId: draft.id,
    });
  } catch (error) {
    await prisma.wizardDraft
      .update({
        where: { id: draft.id },
        data: { status: "ABANDONED" },
      })
      .catch(() => undefined);
    throw error;
  }
}

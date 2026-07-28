import { prisma } from "@/lib/db";
import { buildChecklist } from "./checklist";
import type {
  DesignSummary,
  MockupSummary,
  NormalizedWizard,
  ResourceRef,
  SearchDesignInput,
  SearchMockupInput,
  StoreFilter,
  StoreSummary,
  StoreWizardConfig,
  TenantDraftRef,
  TenantStoreRef,
} from "./contracts";
import { WizardResourceError } from "./contracts";
import { getDraft } from "./state";

type ResolvableRow = { id: string; name: string };

export async function resolveTenantResource<T extends ResolvableRow>(input: {
  tenantId: string;
  ref: ResourceRef;
  load(filter: { tenantId: string; id?: string; name?: string }): Promise<T[]>;
}): Promise<T> {
  const id = "id" in input.ref ? input.ref.id.trim() : undefined;
  const name = "name" in input.ref ? input.ref.name.trim() : undefined;
  if (!id && !name) {
    throw new WizardResourceError("VALIDATION_FAILED", "Resource reference cannot be empty");
  }
  const matches = await input.load({
    tenantId: input.tenantId,
    id,
    name,
  });
  if (matches.length === 0) {
    throw new WizardResourceError("RESOURCE_NOT_FOUND", "Resource not found");
  }
  if (id) return matches[0];

  const exact = matches.filter(
    (row) => row.name.trim().toLocaleLowerCase("en-US") === name?.toLocaleLowerCase("en-US"),
  );
  if (exact.length === 1) return exact[0];
  const candidates = exact.length > 1 ? exact : matches;
  if (candidates.length !== 1) {
    throw new WizardResourceError(
      "AMBIGUOUS_REFERENCE",
      "Resource name is ambiguous",
      candidates.slice(0, 10).map(({ id: candidateId, name: candidateName }) => ({
        id: candidateId,
        name: candidateName,
      })),
    );
  }
  return candidates[0];
}

export async function resolveStoreRef(input: TenantStoreRef) {
  return resolveTenantResource({
    tenantId: input.tenantId,
    ref: input.storeRef,
    load: ({ tenantId, id, name }) =>
      prisma.store.findMany({
        where: {
          tenantId,
          ...(id ? { id } : {}),
          ...(name ? { name: { contains: name, mode: "insensitive" } } : {}),
        },
        orderBy: { name: "asc" },
        take: 11,
      }),
  });
}

export async function resolveDesignRef(input: {
  tenantId: string;
  storeId: string;
  designRef: ResourceRef;
}) {
  return resolveTenantResource({
    tenantId: input.tenantId,
    ref: input.designRef,
    load: ({ tenantId, id, name }) =>
      prisma.design.findMany({
        where: {
          tenantId,
          storeId: input.storeId,
          scope: "LIBRARY",
          status: "ACTIVE",
          deletedAt: null,
          ...(id ? { id } : {}),
          ...(name ? { name: { contains: name, mode: "insensitive" } } : {}),
        },
        orderBy: { name: "asc" },
        take: 11,
      }),
  });
}

export async function resolveMockupRef(input: {
  tenantId: string;
  storeId: string;
  mockupRef: ResourceRef;
}) {
  return resolveTenantResource({
    tenantId: input.tenantId,
    ref: input.mockupRef,
    load: ({ tenantId, id, name }) =>
      prisma.mockupLibraryItem.findMany({
        where: {
          tenantId,
          storeId: input.storeId,
          isActive: true,
          deletedAt: null,
          ...(id ? { id } : {}),
          ...(name ? { name: { contains: name, mode: "insensitive" } } : {}),
        },
        orderBy: { name: "asc" },
        take: 11,
      }),
  });
}

export async function resolveTemplateRef(input: {
  tenantId: string;
  storeId: string;
  templateRef: ResourceRef;
}) {
  return resolveTenantResource({
    tenantId: input.tenantId,
    ref: input.templateRef,
    load: ({ tenantId, id, name }) =>
      prisma.storeMockupTemplate.findMany({
        where: {
          storeId: input.storeId,
          store: { tenantId },
          ...(id ? { id } : {}),
          ...(name ? { name: { contains: name, mode: "insensitive" } } : {}),
        },
        orderBy: { name: "asc" },
        take: 11,
      }),
  });
}

export async function listTenantStores(
  tenantId: string,
  filter: StoreFilter,
): Promise<StoreSummary[]> {
  const status = filter.status ?? "ACTIVE";
  const stores = await prisma.store.findMany({
    where: {
      tenantId,
      ...(status !== "ANY" ? { status } : {}),
      ...(filter.query
        ? {
            OR: [
              {
                name: {
                  contains: filter.query,
                  mode: "insensitive",
                },
              },
              {
                shopifyDomain: {
                  contains: filter.query,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: Math.min(100, Math.max(1, filter.limit)),
    select: {
      id: true,
      name: true,
      shopifyDomain: true,
      status: true,
    },
  });
  return stores.map((store) => ({
    ...store,
    shopifyDomain: store.shopifyDomain ?? "",
  }));
}

export async function searchLibraryDesigns(input: SearchDesignInput): Promise<DesignSummary[]> {
  const store = await resolveStoreRef(input);
  return prisma.design.findMany({
    where: {
      tenantId: input.tenantId,
      storeId: store.id,
      scope: "LIBRARY",
      status: "ACTIVE",
      deletedAt: null,
      ...(input.query
        ? {
            name: {
              contains: input.query,
              mode: "insensitive",
            },
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: Math.min(100, Math.max(1, input.limit)),
    select: {
      id: true,
      name: true,
      width: true,
      height: true,
      dpi: true,
    },
  });
}

export async function searchLibraryMockups(input: SearchMockupInput): Promise<MockupSummary[]> {
  const store = await resolveStoreRef(input);
  const mockups = await prisma.mockupLibraryItem.findMany({
    where: {
      tenantId: input.tenantId,
      storeId: store.id,
      isActive: true,
      deletedAt: null,
      ...(input.query
        ? {
            name: {
              contains: input.query,
              mode: "insensitive",
            },
          }
        : {}),
      ...(input.view ? { view: input.view as never } : {}),
    },
    orderBy: { name: "asc" },
    take: Math.min(100, Math.max(1, input.limit)),
    select: {
      id: true,
      name: true,
      view: true,
      width: true,
      height: true,
      compositeRegionPx: true,
    },
  });
  return mockups.map(({ compositeRegionPx, ...mockup }) => ({
    ...mockup,
    hasCompositeRegion: compositeRegionPx !== null,
  }));
}

export async function getStoreWizardConfig(input: TenantStoreRef): Promise<StoreWizardConfig> {
  const store = await resolveStoreRef(input);
  const config = await prisma.store.findFirstOrThrow({
    where: { id: store.id, tenantId: input.tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      shopifyDomain: true,
      publishMode: true,
      defaultPriceUsd: true,
      colors: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          hex: true,
          colorGroup: true,
          sortOrder: true,
        },
      },
      templates: {
        orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
        select: {
          id: true,
          name: true,
          isDefault: true,
          defaultMockupSource: true,
          enabledVariantIds: true,
          defaultPlacement: true,
          blueprintTitle: true,
          blueprintBrand: true,
        },
      },
    },
  });
  return config as unknown as StoreWizardConfig;
}

export async function getNormalizedWizard(input: TenantDraftRef): Promise<NormalizedWizard> {
  const draft = await getDraft(input.draftId, input.tenantId);
  if (!draft) {
    throw new WizardResourceError("RESOURCE_NOT_FOUND", "Draft not found");
  }
  const customMockups = await prisma.wizardDraftMockupSource.findMany({
    where: {
      draftId: input.draftId,
      draft: { tenantId: input.tenantId },
    },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
  });
  const checklist = await buildChecklist(draft);
  const designs = draft.draftDesigns.map((entry) => ({
    draftDesignId: entry.id,
    designId: entry.designId,
    name: entry.design.name,
    scope: entry.design.scope,
    width: entry.design.width,
    height: entry.design.height,
    aiContent: entry.aiContent,
  }));
  const designPairs = draft.designPairs.map((pair) => ({
    id: pair.id,
    baseName: pair.baseName,
    lightDraftDesignId: pair.lightDraftDesignId,
    darkDraftDesignId: pair.darkDraftDesignId,
    aiContent: pair.aiContent,
  }));
  const jobs = draft.mockupJobs.map((job) => ({
    id: job.id,
    type: "MOCKUPS",
    status: job.status,
    draftDesignId: job.draftDesignId,
    completedImages: job.completedImages,
    totalImages: job.totalImages,
    errorMessage: job.errorMessage,
  }));
  const warnings = [
    ...(!draft.storeId ? ["Store is not selected"] : []),
    ...(designs.length === 0 ? ["No design is attached"] : []),
    ...(draft.mockupsStale ? ["Mockups are stale"] : []),
    ...(!checklist.readyToPublish ? ["Wizard is not ready to publish"] : []),
  ];

  return {
    draft: {
      id: draft.id,
      storeId: draft.storeId,
      templateId: draft.templateId,
      status: draft.status,
      currentStep: draft.currentStep,
      enabledColorIds: draft.enabledColorIds,
      enabledSizes: draft.enabledSizes,
      enabledSizesByColor: draft.enabledSizesByColor,
      enabledVariantIdsOverride: draft.enabledVariantIdsOverride,
      placementOverride: draft.placementOverride,
      priceBySizeOverride: draft.priceBySizeOverride,
      mockupsStale: draft.mockupsStale,
      mockupsStaleReason: draft.mockupsStaleReason,
    },
    designs,
    designPairs,
    customMockups: customMockups.map((source) => ({
      id: source.id,
      name: source.name,
      view: source.view,
      mockupLibraryItemId: source.mockupLibraryItemId,
      appliesToColorIds: source.appliesToColorIds,
      appliesToAll: source.appliesToAll,
      compositeRegionPx: source.compositeRegionPx,
      width: source.width,
      height: source.height,
      isPrimary: source.isPrimary,
      sortOrder: source.sortOrder,
      expiresAt: source.expiresAt?.toISOString() ?? null,
    })),
    checklist,
    jobs,
    warnings,
  };
}

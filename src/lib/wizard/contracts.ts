import type { StoreStatus } from "@prisma/client";
import type { WizardChecklist } from "./checklist";
import type { WizardCustomMockupInput } from "./custom-mockup-contracts";

export type ResourceRef = { id: string } | { name: string };
export type StoreFilter = {
  query?: string;
  status?: StoreStatus | "ANY";
  limit: number;
};
export type TenantStoreRef = { tenantId: string; storeRef: ResourceRef };
export type TenantDraftRef = { tenantId: string; draftId: string };
export type SearchDesignInput = TenantStoreRef & {
  query?: string;
  limit: number;
};
export type SearchMockupInput = TenantStoreRef & {
  query?: string;
  view?: string;
  limit: number;
};
export type StoreSummary = {
  id: string;
  name: string;
  shopifyDomain: string;
  status: string;
};
export type DesignSummary = {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number | null;
};
export type MockupSummary = {
  id: string;
  name: string;
  view: string;
  width: number;
  height: number;
  hasCompositeRegion: boolean;
};
export type NormalizedWizard = {
  draft: Record<string, unknown>;
  designs: Array<Record<string, unknown>>;
  designPairs: Array<Record<string, unknown>>;
  customMockups: Array<Record<string, unknown>>;
  checklist: WizardChecklist;
  jobs: Array<Record<string, unknown>>;
  warnings: string[];
};
export type SetProductConfigInput = TenantDraftRef & {
  templateRef?: ResourceRef;
  enabledColorIds?: string[];
  enabledSizes?: string[];
  enabledSizesByColor?: Record<string, string[]>;
  enabledVariantIdsOverride?: number[];
  priceBySizeOverride?: Record<string, number>;
  placementOverride?: Record<string, unknown>;
};
export type SetContentInput = TenantDraftRef & {
  target: { type: "DESIGN"; draftDesignId: string } | { type: "PAIR"; pairId: string };
  content: {
    title?: string;
    description?: string;
    tags?: string[];
    organizationCollections?: string[];
  };
};
export type CreateWizardInput = {
  tenantId: string;
  actorUserId: string;
  profileId?: string;
  storeRef: ResourceRef;
  designRefs?: ResourceRef[];
  designUrls?: Array<{ url: string; name?: string }>;
  templateRef?: ResourceRef;
  productConfig?: Omit<SetProductConfigInput, "tenantId" | "draftId">;
  customMockups?: WizardCustomMockupInput[];
  contentSeed?: {
    targets: Array<{
      target: { type: "DESIGN_NAME"; value: string } | { type: "PAIR_BASE_NAME"; value: string };
      content: SetContentInput["content"];
    }>;
  };
  pairingMode: "AUTO" | "NONE";
};
export type SetWizardDesignsInput = TenantDraftRef & {
  designs: Array<{ designRef: ResourceRef } | { draftDesignId: string }>;
  pairingMode: "AUTO" | "NONE";
};
export type GenerateAssetsInput = TenantDraftRef & {
  assetTypes: Array<"MOCKUPS" | "CONTENT">;
};
export type WizardJobSummary = {
  id: string;
  type: "MOCKUPS" | "CONTENT";
  status: string;
};
export type StoreWizardConfig = Record<string, unknown>;

export class WizardResourceError extends Error {
  constructor(
    public readonly code: "RESOURCE_NOT_FOUND" | "AMBIGUOUS_REFERENCE" | "VALIDATION_FAILED",
    message: string,
    public readonly candidates: Array<{ id: string; name: string }> = [],
  ) {
    super(message);
    this.name = "WizardResourceError";
  }
}

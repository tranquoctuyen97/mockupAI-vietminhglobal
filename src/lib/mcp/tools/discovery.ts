import {
  getNormalizedWizard,
  getStoreWizardConfig,
  listTenantStores,
  searchLibraryDesigns,
  searchLibraryMockups,
} from "@/lib/wizard/query";
import type { StoreStatus } from "@prisma/client";
import type { McpAuthContext } from "../contracts";

export type McpToolPayload = {
  data: Record<string, unknown>;
  warnings: string[];
  nextActions: string[];
};

export async function executeDiscoveryTool(
  name: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
): Promise<McpToolPayload | null> {
  if (name === "list_stores") {
    const stores = await listTenantStores(auth.tenantId, {
      query: args.query as string | undefined,
      status: args.status as StoreStatus | "ANY",
      limit: args.limit as number,
    });
    return {
      data: { stores },
      warnings: [],
      nextActions: ["get_store_wizard_config", "create_listing_wizard"],
    };
  }
  if (name === "search_designs") {
    const designs = await searchLibraryDesigns({
      tenantId: auth.tenantId,
      storeRef: args.storeRef as never,
      query: args.query as string | undefined,
      limit: args.limit as number,
    });
    return {
      data: { designs },
      warnings: [],
      nextActions: ["set_wizard_designs", "create_listing_wizard"],
    };
  }
  if (name === "search_mockups") {
    const mockups = await searchLibraryMockups({
      tenantId: auth.tenantId,
      storeRef: args.storeRef as never,
      query: args.query as string | undefined,
      view: args.view as string | undefined,
      limit: args.limit as number,
    });
    return {
      data: { mockups },
      warnings: [],
      nextActions: ["set_wizard_custom_mockups"],
    };
  }
  if (name === "get_store_wizard_config") {
    const config = await getStoreWizardConfig({
      tenantId: auth.tenantId,
      storeRef: args.storeRef as never,
    });
    return {
      data: { config },
      warnings: [],
      nextActions: ["create_listing_wizard"],
    };
  }
  if (name === "get_listing_wizard" || name === "get_wizard_status") {
    const wizard = await getNormalizedWizard({
      tenantId: auth.tenantId,
      draftId: String(args.draftId),
    });
    const includeJobs = args.includeJobs !== false;
    const includeWarnings = args.includeWarnings !== false;
    return {
      data:
        name === "get_wizard_status"
          ? {
              draftId: wizard.draft.id,
              status: wizard.draft.status,
              readyForReview: wizard.checklist.readyToPublish,
              checklist: wizard.checklist,
              jobs: includeJobs ? wizard.jobs : [],
            }
          : {
              ...wizard,
              jobs: includeJobs ? wizard.jobs : [],
            },
      warnings: includeWarnings ? wizard.warnings : [],
      nextActions: wizard.checklist.readyToPublish
        ? ["review_wizard"]
        : ["set_wizard_product_config", "generate_wizard_assets", "set_wizard_content"],
    };
  }
  return null;
}

import { z } from "zod";

import type { McpToolGroup } from "../contracts";
import type { McpRateClass } from "../rate-limit";

const describedString = (description: string) =>
  z.string().trim().min(1).describe(description);
const idempotencyKey = describedString(
  "Caller-generated unique key used to replay this exact mutation safely for 24 hours.",
);

export const ResourceRefSchema = z
  .union([
    z
      .object({
        id: describedString("Opaque resource ID returned by another MCP tool."),
      })
      .strict(),
    z
      .object({
        name: describedString(
          "Exact or unambiguous partial resource name resolved inside the authenticated tenant.",
        ),
      })
      .strict(),
  ])
  .describe("Tenant-bound resource reference by ID or unambiguous name.");

export const StoreRefSchema = ResourceRefSchema.describe(
  "Tenant store reference by ID or unambiguous name.",
);
export const DesignRefSchema = ResourceRefSchema.describe(
  "Reusable Design Library reference by ID or unambiguous name.",
);
export const MockupRefSchema = ResourceRefSchema.describe(
  "Reusable Mockup Library reference by ID or unambiguous name.",
);
export const TemplateRefSchema = ResourceRefSchema.describe(
  "Store template reference by ID or unambiguous name.",
);

const viewSchema = z
  .enum([
    "front",
    "back",
    "sleeve_left",
    "sleeve_right",
    "detail",
    "lifestyle",
  ])
  .describe("Camera or garment view represented by this custom mockup.");
const compositeRegionSchema = z
  .object({
    x: z.number().describe("Left edge of the artwork region in source-image pixels."),
    y: z.number().describe("Top edge of the artwork region in source-image pixels."),
    width: z.number().positive().describe("Artwork region width in pixels."),
    height: z.number().positive().describe("Artwork region height in pixels."),
    rotationDeg: z
      .number()
      .min(-360)
      .max(360)
      .default(0)
      .describe("Clockwise artwork rotation in degrees."),
    imageWidth: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Source image width used when the region was measured."),
    imageHeight: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Source image height used when the region was measured."),
  })
  .strict()
  .describe("Optional artwork placement frame; Smart Fit is computed when omitted.");
const contentSchema = z
  .object({
    title: z.string().optional().describe("Customer-facing product title."),
    description: z
      .string()
      .optional()
      .describe("Customer-facing product description."),
    tags: z
      .array(z.string())
      .max(15)
      .optional()
      .describe("Shopify product tags; duplicates are normalized."),
    organizationCollections: z
      .array(z.string())
      .max(10)
      .optional()
      .describe("Collections used for Shopify product organization."),
  })
  .strict()
  .describe("Content fields saved for one independent design or light/dark pair.");
const productConfigSchema = z
  .object({
    templateRef: TemplateRefSchema.optional().describe(
      "Template controlling blueprint, provider, and PRINTIFY versus CUSTOM source mode.",
    ),
    enabledColorIds: z
      .array(z.string())
      .optional()
      .describe("Selected store color IDs."),
    enabledSizes: z
      .array(z.string())
      .optional()
      .describe("Selected size names used as the default for every color."),
    enabledSizesByColor: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .describe("Per-color size overrides keyed by color name."),
    enabledVariantIdsOverride: z
      .array(z.number().int())
      .optional()
      .describe("Explicit Printify variant IDs, or omit to use template defaults."),
    priceBySizeOverride: z
      .record(z.string(), z.number().positive())
      .optional()
      .describe("Retail USD price overrides keyed by size name."),
    placementOverride: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Current wizard placement object using the existing placement schema."),
  })
  .strict()
  .describe("Preview-step product configuration.");
const customMockupSchema = z
  .object({
    source: z
      .union([
        z
          .object({
            url: z
              .url()
              .describe("HTTP or HTTPS URL returning raw PNG or JPEG bytes."),
          })
          .strict(),
        z
          .object({ mockupRef: MockupRefSchema })
          .strict()
          .describe("Reusable Mockup Library reference."),
      ])
      .describe("Exactly one URL or reusable Mockup Library source."),
    name: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Display name; URL basename is used when omitted."),
    view: viewSchema,
    appliesToColorRefs: z
      .array(describedString('Selected color ID/name, or the single value "all".'))
      .min(1)
      .describe("Selected colors covered by this source, or [\"all\"]."),
    compositeRegionPx: compositeRegionSchema.optional(),
    isPrimary: z
      .boolean()
      .optional()
      .describe("Whether this source is the primary image for its colors."),
    sortOrder: z
      .number()
      .int()
      .optional()
      .describe("Stable display order; array order is used when omitted."),
  })
  .strict()
  .describe("One draft-scoped custom COMPOSITE mockup source.");

export const McpToolResponseSchema = z
  .object({
    ok: z.literal(true).describe("True when the tool completed successfully."),
    data: z
      .record(z.string(), z.unknown())
      .describe("Tool-specific machine-readable result."),
    warnings: z
      .array(z.string())
      .describe("Non-blocking issues the client should show to the ADMIN."),
    nextActions: z
      .array(z.string())
      .describe("Recommended next MCP tool calls."),
  })
  .strict()
  .describe("Standard successful MockupAI MCP tool response.");

type ToolInputSchema = z.ZodObject<z.ZodRawShape>;

export type McpToolCatalogEntry = {
  name: string;
  title: string;
  description: string;
  requiredToolGroup: McpToolGroup;
  rateClass: McpRateClass;
  inputSchema: ToolInputSchema;
  outputSchema: typeof McpToolResponseSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: true;
  };
};

function tool(
  entry: Omit<McpToolCatalogEntry, "outputSchema">,
): McpToolCatalogEntry {
  return { ...entry, outputSchema: McpToolResponseSchema };
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;
const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
} as const;
const destructiveMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
} as const;
const draftId = describedString("Wizard draft ID returned by create_listing_wizard.");

export const MCP_TOOL_CATALOG: McpToolCatalogEntry[] = [
  tool({
    name: "list_stores",
    title: "List tenant stores",
    description:
      "List every store in the authenticated ADMIN's tenant. Use before creating a wizard or resolving a store name.",
    requiredToolGroup: "store_discovery",
    rateClass: "discovery",
    annotations: readAnnotations,
    inputSchema: z
      .object({
        query: z.string().optional().describe("Optional store name or Shopify domain search."),
        status: z
          .enum(["ACTIVE", "TOKEN_EXPIRED", "ERROR", "ANY"])
          .default("ACTIVE")
          .describe("Store connection status filter."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum stores returned."),
      })
      .strict()
      .describe("Filters for tenant store discovery."),
  }),
  tool({
    name: "search_designs",
    title: "Search Design Library",
    description:
      "Search reusable, non-temporary Design Library items for one tenant store. Temporary URL assets are excluded.",
    requiredToolGroup: "design_library",
    rateClass: "discovery",
    annotations: readAnnotations,
    inputSchema: z
      .object({
        storeRef: StoreRefSchema,
        query: z.string().optional().describe("Optional design name search."),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum designs returned."),
      })
      .strict()
      .describe("Tenant-bound Design Library search."),
  }),
  tool({
    name: "search_mockups",
    title: "Search Mockup Library",
    description:
      "Search reusable COMPOSITE mockup backgrounds for a CUSTOM template. Temporary URL assets are excluded.",
    requiredToolGroup: "mockup_library",
    rateClass: "discovery",
    annotations: readAnnotations,
    inputSchema: z
      .object({
        storeRef: StoreRefSchema,
        query: z.string().optional().describe("Optional mockup name search."),
        view: viewSchema.optional(),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum mockups returned."),
      })
      .strict()
      .describe("Tenant-bound Mockup Library search."),
  }),
  tool({
    name: "get_store_wizard_config",
    title: "Get store wizard config",
    description:
      "Read safe store defaults, templates, colors, pricing, placement, and template-owned mockup source mode.",
    requiredToolGroup: "wizard",
    rateClass: "discovery",
    annotations: readAnnotations,
    inputSchema: z
      .object({ storeRef: StoreRefSchema })
      .strict()
      .describe("Store whose wizard configuration should be returned."),
  }),
  tool({
    name: "get_listing_wizard",
    title: "Get listing wizard",
    description:
      "Read one normalized wizard with designs, pairs, configuration, temporary mockups, jobs, warnings, and readiness.",
    requiredToolGroup: "wizard",
    rateClass: "discovery",
    annotations: readAnnotations,
    inputSchema: z
      .object({
        draftId,
        includeJobs: z.boolean().default(true).describe("Include current generation jobs."),
        includePreview: z.boolean().default(false).describe("Reserved preview detail switch."),
      })
      .strict()
      .describe("Normalized wizard read request."),
  }),
  tool({
    name: "create_listing_wizard",
    title: "Create listing wizard",
    description:
      "Create a tenant-store wizard and optionally seed designs, temporary URLs, product config, custom mockups, and content. Never publishes.",
    requiredToolGroup: "wizard",
    rateClass: "wizard_mutation",
    annotations: mutationAnnotations,
    inputSchema: z
      .object({
        storeRef: StoreRefSchema,
        idempotencyKey,
        designRefs: z.array(DesignRefSchema).optional().describe("Reusable Design Library inputs."),
        designUrls: z
          .array(
            z
              .object({
                url: z.url().describe("HTTP or HTTPS URL returning PNG or JPEG bytes."),
                name: z.string().optional().describe("Optional design name."),
              })
              .strict(),
          )
          .optional()
          .describe("Temporary draft design URLs."),
        templateRef: TemplateRefSchema.optional(),
        productConfig: productConfigSchema.optional(),
        customMockups: z.array(customMockupSchema).optional(),
        contentSeed: z
          .object({
            targets: z
              .array(
                z
                  .object({
                    target: z.union([
                      z
                        .object({
                          type: z.literal("DESIGN_NAME"),
                          value: describedString("Exact normalized independent design name."),
                        })
                        .strict(),
                      z
                        .object({
                          type: z.literal("PAIR_BASE_NAME"),
                          value: describedString("Exact normalized light/dark pair base name."),
                        })
                        .strict(),
                    ]),
                    content: contentSchema,
                  })
                  .strict(),
              )
              .describe("Exact content seeds for publish units."),
          })
          .strict()
          .optional()
          .describe("Optional manual content seeds."),
        pairingMode: z.enum(["AUTO", "NONE"]).default("AUTO").describe("Light/dark name pairing mode."),
      })
      .strict()
      .describe("Hybrid wizard creation request."),
  }),
  tool({
    name: "attach_wizard_design_url",
    title: "Attach temporary design URL",
    description:
      "Fetch one bounded PNG/JPEG URL, copy it to private draft storage, and attach Design-compatible metadata without adding it to Design Library.",
    requiredToolGroup: "wizard",
    rateClass: "url_import",
    annotations: mutationAnnotations,
    inputSchema: z
      .object({
        draftId,
        url: z.url().describe("HTTP or HTTPS URL returning raw PNG or JPEG bytes."),
        idempotencyKey,
        name: z.string().optional().describe("Optional design name; URL basename is fallback."),
        pairingMode: z.enum(["AUTO", "NONE"]).default("AUTO").describe("Light/dark name pairing mode."),
      })
      .strict()
      .describe("Temporary design URL attachment request."),
  }),
  tool({
    name: "set_wizard_designs",
    title: "Set wizard designs",
    description:
      "Replace selected designs using reusable Library references and/or already attached draft-design IDs.",
    requiredToolGroup: "wizard",
    rateClass: "wizard_mutation",
    annotations: mutationAnnotations,
    inputSchema: z
      .object({
        draftId,
        designs: z
          .array(
            z.union([
              z.object({ designRef: DesignRefSchema }).strict(),
              z.object({ draftDesignId: describedString("Already attached draft-design ID.") }).strict(),
            ]),
          )
          .min(1)
          .describe("Ordered replacement design selection."),
        idempotencyKey,
        pairingMode: z.enum(["AUTO", "NONE"]).default("AUTO").describe("Light/dark name pairing mode."),
      })
      .strict()
      .describe("Wizard design replacement request."),
  }),
  tool({
    name: "set_wizard_custom_mockups",
    title: "Set custom composite mockups",
    description:
      "Replace draft custom COMPOSITE backgrounds using bounded URLs or reusable Mockup Library references for a CUSTOM template.",
    requiredToolGroup: "wizard",
    rateClass: "url_import",
    annotations: mutationAnnotations,
    inputSchema: z
      .object({
        draftId,
        mockups: z.array(customMockupSchema).max(20).describe("Complete replacement custom mockup list."),
        idempotencyKey,
      })
      .strict()
      .describe("Custom COMPOSITE mockup replacement request."),
  }),
  tool({
    name: "set_wizard_product_config",
    title: "Set wizard product config",
    description:
      "Update template, colors, sizes, variants, prices, and placement using the current Preview-step fields.",
    requiredToolGroup: "wizard",
    rateClass: "wizard_mutation",
    annotations: mutationAnnotations,
    inputSchema: productConfigSchema
      .extend({ draftId, idempotencyKey })
      .strict()
      .describe("Wizard product configuration mutation."),
  }),
  tool({
    name: "set_wizard_content",
    title: "Set wizard content",
    description:
      "Save title, description, tags, and collections for one independent design or one light/dark pair.",
    requiredToolGroup: "wizard",
    rateClass: "wizard_mutation",
    annotations: mutationAnnotations,
    inputSchema: z
      .object({
        draftId,
        target: z
          .union([
            z
              .object({
                type: z.literal("DESIGN"),
                draftDesignId: describedString("Independent draft-design target ID."),
              })
              .strict(),
            z
              .object({
                type: z.literal("PAIR"),
                pairId: describedString("Light/dark pair target ID."),
              })
              .strict(),
          ])
          .describe("Exactly one content target."),
        content: contentSchema,
        idempotencyKey,
      })
      .strict()
      .describe("Manual wizard content mutation."),
  }),
  tool({
    name: "generate_wizard_assets",
    title: "Generate wizard assets",
    description:
      "Start the existing mockup/composite jobs and optionally current AI content generation without creating another worker pipeline.",
    requiredToolGroup: "wizard",
    rateClass: "generation",
    annotations: mutationAnnotations,
    inputSchema: z
      .object({
        draftId,
        assetTypes: z
          .array(z.enum(["MOCKUPS", "CONTENT"]))
          .min(1)
          .describe("Asset categories to generate."),
        idempotencyKey,
        force: z.boolean().default(false).describe("Regenerate even when completed assets exist."),
      })
      .strict()
      .describe("Wizard asset generation request."),
  }),
  tool({
    name: "get_wizard_status",
    title: "Get wizard status",
    description:
      "Poll draft state, generation jobs, stale state, content readiness, server checklist, and non-blocking warnings.",
    requiredToolGroup: "wizard",
    rateClass: "discovery",
    annotations: readAnnotations,
    inputSchema: z
      .object({
        draftId,
        includeJobs: z.boolean().default(true).describe("Include current jobs."),
        includeWarnings: z.boolean().default(true).describe("Include readiness warnings."),
      })
      .strict()
      .describe("Wizard status polling request."),
  }),
  tool({
    name: "review_wizard",
    title: "Review wizard",
    description:
      "Run the current server-side checklist and return previews, exact publish units, warnings, and a signed token for this reviewed state.",
    requiredToolGroup: "wizard",
    rateClass: "discovery",
    annotations: readAnnotations,
    inputSchema: z
      .object({
        draftId,
        includePreview: z.boolean().default(true).describe("Include persisted included mockup previews."),
        includePublishPlan: z.boolean().default(true).describe("Include pair and independent-design publish units."),
      })
      .strict()
      .describe("Revision-safe wizard review request."),
  }),
  tool({
    name: "publish_listing",
    title: "Publish reviewed listings",
    description:
      "Revalidate current access, the signed reviewed revision, and readiness before creating the same Listing, PublishAttempt, PublishJob, and PublishOutbox records as the browser.",
    requiredToolGroup: "publish",
    rateClass: "publish",
    annotations: destructiveMutationAnnotations,
    inputSchema: z
      .object({
        draftId,
        revisionToken: describedString("Latest opaque token returned by review_wizard."),
        idempotencyKey,
        note: z.string().max(500).optional().describe("Optional short ADMIN audit note."),
      })
      .strict()
      .describe("Explicit destructive submission of the latest reviewed wizard revision."),
  }),
  tool({
    name: "get_publish_status",
    title: "Get publish status",
    description:
      "Read persisted listing, attempt, and SHOPIFY/PRINTIFY stage status. Polling never creates a job, attempt, or retry.",
    requiredToolGroup: "publish",
    rateClass: "discovery",
    annotations: readAnnotations,
    inputSchema: z
      .object({
        draftId: describedString("Wizard draft selector.").optional(),
        listingId: describedString("Listing selector.").optional(),
        publishAttemptId: describedString("Publish attempt selector.").optional(),
        includeJobs: z.boolean().default(true).describe("Include persisted per-stage jobs."),
      })
      .strict()
      .refine(
        (value) =>
          [value.draftId, value.listingId, value.publishAttemptId].filter(Boolean)
            .length === 1,
        {
          message:
            "Exactly one of draftId, listingId, or publishAttemptId is required",
        },
      )
      .describe("Read-only persisted publish status selector."),
  }),
];

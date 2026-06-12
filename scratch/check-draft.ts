import dotenv from "dotenv";
dotenv.config({ path: ".env" });
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local", override: true });
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { getClientForStore } = await import("../src/lib/printify/account");
  const { buildPrintifyProductPayload } = await import("../src/lib/printify/product");

  try {
    const draftId = "cmqaji7bm0002llt0g584vr2c";
    console.log("Fetching draft:", draftId);
    const draft = await prisma.wizardDraft.findUnique({
      where: { id: draftId },
      include: {
        template: {
          include: {
            colors: {
              include: { color: true },
            },
          },
        },
        store: {
          include: {
            colors: true,
          },
        },
        draftDesigns: {
          orderBy: { sortOrder: "asc" },
          where: {
            design: {
              status: "ACTIVE",
              deletedAt: null,
            },
          },
          include: { design: true },
        },
      },
    });

    if (!draft || !draft.template || !draft.draftDesigns[0]) {
      console.log("Draft, template, or draft design not found");
      return;
    }

    const draftDesign = draft.draftDesigns[0];
    const productId = draftDesign.printifyDraftProductId;
    if (!productId) {
      console.log("No printifyDraftProductId found");
      return;
    }

    const { client, externalShopId } = await getClientForStore(draft.storeId!);
    const blueprintId = draft.template.printifyBlueprintId;
    const printProviderId = draft.template.printifyPrintProviderId;

    console.log(`\n1. Fetching product ${productId} from Printify...`);
    const printifyProduct = await client.getProduct(externalShopId, productId);
    console.log("Printify Product fetched successfully!");
    console.log("- Title:", printifyProduct.title);
    console.log("- Blueprint ID:", printifyProduct.blueprint_id);
    console.log("- Print Provider ID:", printifyProduct.print_provider_id);
    console.log("- Number of Variants in existing product:", printifyProduct.variants?.length);
    console.log("- Number of print_areas in existing product:", printifyProduct.print_areas?.length);

    console.log(`\n2. Fetching catalog variants from Printify for Blueprint: ${blueprintId}, Provider: ${printProviderId}...`);
    const catalogResponse = await client.getBlueprintVariants(blueprintId, printProviderId);
    const catalogVariants = catalogResponse.variants || [];

    // Resolve enabled variant IDs
    const templateVariantIds = draft.template.enabledVariantIds ?? [];
    const enabledVariantIds = draft.enabledVariantIdsOverride && draft.enabledVariantIdsOverride.length > 0
      ? draft.enabledVariantIdsOverride
      : templateVariantIds;

    const enabledSet = new Set(enabledVariantIds);

    // Build full variants array as done in createOrUpdatePrintifyProduct
    const fullVariants = catalogVariants.map((v: any) => {
      return {
        id: v.id,
        price: 2000,
        is_enabled: enabledSet.has(v.id),
      };
    });

    const placementData = {
      version: "2.1",
      variants: { _default: { front: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100, rotationDeg: 0 } } },
    };

    const payloadInput = {
      title: `[DEBUG_TEMP] Wizard PUT Test ${Date.now()}`,
      description: "Temporary product to debug PUT validation.",
      blueprintId,
      printProviderId,
      variantIds: enabledVariantIds,
      variants: fullVariants,
      imageId: draftDesign.printifyImageId || "dummy",
      placementData,
    };

    const payload = buildPrintifyProductPayload(payloadInput) as Record<string, any>;

    // Add visible_mockups if they exist
    const existingMockupIds = (printifyProduct.images ?? [])
      .map((img: any) => img.mockup_id)
      .filter(Boolean);
    if (existingMockupIds.length > 0) {
      payload.visible_mockups = existingMockupIds;
    }

    console.log("\n========================================");
    console.log("CONSTRUCTED PUT PAYLOAD:");
    console.log(JSON.stringify(payload, null, 2));
    console.log("========================================\n");

    console.log("Sending PUT request to updateProduct...");
    const updatedProduct = await client.updateProduct(externalShopId, productId, payload);
    console.log("Product updated successfully!");

  } catch (error: any) {
    console.error("\nError during request:");
    if (error.message) {
      console.error(error.message);
    } else {
      console.error(error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);

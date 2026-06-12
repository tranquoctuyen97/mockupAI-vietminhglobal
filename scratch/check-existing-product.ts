import dotenv from "dotenv";
dotenv.config({ path: ".env" });
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local", override: true });
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { getClientForStore } = await import("../src/lib/printify/account");

  try {
    const draftId = "cmqaji7bm0002llt0g584vr2c";
    const draft = await prisma.wizardDraft.findUnique({
      where: { id: draftId },
      include: {
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

    if (!draft || !draft.draftDesigns[0]) {
      console.log("Draft or draft design not found");
      return;
    }

    const draftDesign = draft.draftDesigns[0];
    const productId = draftDesign.printifyDraftProductId;
    if (!productId) {
      console.log("No printifyDraftProductId found");
      return;
    }

    const { client, externalShopId } = await getClientForStore(draft.storeId!);

    console.log(`Fetching product ${productId} from Printify...`);
    const printifyProduct = await client.getProduct(externalShopId, productId);
    console.log("Printify Product Details:\n", JSON.stringify({
      id: printifyProduct.id,
      title: printifyProduct.title,
      blueprint_id: printifyProduct.blueprint_id,
      print_provider_id: printifyProduct.print_provider_id,
      variants: printifyProduct.variants?.map((v: any) => ({
        id: v.id,
        title: v.title,
        is_enabled: v.is_enabled,
        sku: v.sku,
      })),
      print_areas: printifyProduct.print_areas?.map((pa: any) => ({
        variant_ids: pa.variant_ids,
        placeholders: pa.placeholders?.map((ph: any) => ({
          position: ph.position,
          images: ph.images?.map((img: any) => ({ id: img.id, x: img.x, y: img.y })),
        })),
      })),
    }, null, 2));

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);

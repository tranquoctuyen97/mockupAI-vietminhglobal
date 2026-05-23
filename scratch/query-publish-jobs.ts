import { prisma } from "../src/lib/db";

async function main() {
  // Find listing for this draft
  const listing = await prisma.listing.findFirst({
    where: { wizardDraftId: "cmpgoxaev000ja5t0a8yp5cux" },
    include: { publishJobs: true, variants: true },
  });
  if (!listing) { console.log("No listing found"); return; }
  
  console.log("=== LISTING ===");
  console.log("ID:", listing.id);
  console.log("Status:", listing.status);
  console.log("Shopify Product ID:", listing.shopifyProductId);
  console.log("Printify Product ID:", listing.printifyProductId);
  console.log("Store ID:", listing.storeId);
  
  console.log("\n=== PUBLISH JOBS ===");
  for (const job of listing.publishJobs) {
    console.log("---");
    console.log("Stage:", job.stage);
    console.log("Status:", job.status);
    console.log("Attempts:", job.attempts);
    console.log("Last Error:", job.lastError);
    console.log("Completed At:", job.completedAt);
  }
  
  console.log("\n=== LISTING VARIANTS ===");
  for (const v of listing.variants) {
    console.log(`  ${v.colorName} — printifyVariantId: ${v.printifyVariantId}, shopifyVariantId: ${v.shopifyVariantId}`);
  }
  
  // Check draft for Printify refs
  const draft = await prisma.wizardDraft.findUnique({
    where: { id: "cmpgoxaev000ja5t0a8yp5cux" },
    select: {
      printifyDraftProductId: true,
      printifyImageId: true,
      designId: true,
      enabledColorIds: true,
      enabledSizes: true,
      design: { select: { storagePath: true } },
      template: { select: { printifyBlueprintId: true, printifyPrintProviderId: true, enabledVariantIds: true } },
      store: { select: { id: true, name: true } },
    },
  });
  console.log("\n=== DRAFT ===");
  console.log("printifyDraftProductId:", draft?.printifyDraftProductId);
  console.log("printifyImageId:", draft?.printifyImageId);
  console.log("designId:", draft?.designId);
  console.log("design.storagePath:", draft?.design?.storagePath);
  console.log("template.blueprintId:", draft?.template?.printifyBlueprintId);
  console.log("template.printProviderId:", draft?.template?.printifyPrintProviderId);
  console.log("template.enabledVariantIds:", JSON.stringify(draft?.template?.enabledVariantIds));
  console.log("enabledColorIds:", JSON.stringify(draft?.enabledColorIds));
  console.log("enabledSizes:", JSON.stringify(draft?.enabledSizes));
  console.log("store:", JSON.stringify(draft?.store));
}

main().catch(console.error).finally(() => prisma.$disconnect());

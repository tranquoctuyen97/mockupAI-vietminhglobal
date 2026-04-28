import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=" .repeat(70));
  console.log("🔍 PUBLISH PIPELINE DIAGNOSTIC");
  console.log("=" .repeat(70));

  // 1. Check all listings
  const listings = await prisma.listing.findMany({
    include: {
      publishJobs: true,
      variants: true,
      store: { select: { id: true, name: true, shopifyDomain: true, printifyShopId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log(`\n📦 Found ${listings.length} listings (showing last 10)\n`);

  for (const listing of listings) {
    console.log("-".repeat(70));
    console.log(`📋 Listing: ${listing.id}`);
    console.log(`   Title:           ${listing.title}`);
    console.log(`   Status:          ${listing.status}`);
    console.log(`   Store:           ${listing.store?.name || "NULL"} (${listing.store?.id || "?"})`);
    console.log(`   Shopify Domain:  ${listing.store?.shopifyDomain || "NULL"}`);
    console.log(`   Printify ShopId: ${listing.store?.printifyShopId || "NULL"}`);
    console.log(`   Draft ID:        ${listing.wizardDraftId || "NULL"}`);
    console.log(`   Shopify Product: ${listing.shopifyProductId || "❌ NOT SET"}`);
    console.log(`   Printify Prod:   ${listing.printifyProductId || "❌ NOT SET"}`);
    console.log(`   Published At:    ${listing.publishedAt || "❌ NEVER"}`);
    console.log(`   Price USD:       $${listing.priceUsd}`);
    console.log(`   Variants:        ${listing.variants.length}`);

    for (const v of listing.variants) {
      console.log(`     • ${v.colorName} (${v.colorHex}) — Shopify: ${v.shopifyVariantId || "❌"} | Printify: ${v.printifyVariantId || "❌"}`);
    }

    console.log(`   Publish Jobs:`);
    for (const job of listing.publishJobs) {
      const statusEmoji = job.status === "SUCCEEDED" ? "✅" : job.status === "FAILED" ? "❌" : job.status === "RUNNING" ? "🔄" : "⏳";
      console.log(`     ${statusEmoji} ${job.stage}: ${job.status} (attempts: ${job.attempts})`);
      if (job.lastError) {
        console.log(`        Error: ${job.lastError}`);
      }
      if (job.completedAt) {
        console.log(`        Completed: ${job.completedAt.toISOString()}`);
      }
    }
  }

  // 2. Check drafts that say PUBLISHED
  console.log("\n" + "=" .repeat(70));
  console.log("📝 WIZARD DRAFTS WITH STATUS = PUBLISHED");
  console.log("=" .repeat(70));

  const publishedDrafts = await prisma.wizardDraft.findMany({
    where: { status: "PUBLISHED" },
    select: {
      id: true,
      storeId: true,
      designId: true,
      status: true,
      printifyDraftProductId: true,
      enabledColorIds: true,
      enabledSizes: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  for (const d of publishedDrafts) {
    const linkedListing = await prisma.listing.findUnique({
      where: { wizardDraftId: d.id },
      select: { id: true, status: true, shopifyProductId: true, printifyProductId: true },
    });

    console.log(`\n  Draft: ${d.id}`);
    console.log(`    Store:                 ${d.storeId || "NULL"}`);
    console.log(`    Design:                ${d.designId || "NULL"}`);
    console.log(`    Printify Draft Prod:   ${d.printifyDraftProductId || "NULL"}`);
    console.log(`    Enabled Colors:        ${d.enabledColorIds.length}`);
    console.log(`    Enabled Sizes:         ${d.enabledSizes.length > 0 ? d.enabledSizes.join(", ") : "NONE"}`);
    console.log(`    Updated:               ${d.updatedAt.toISOString()}`);

    if (linkedListing) {
      console.log(`    ✅ Linked Listing:     ${linkedListing.id} (${linkedListing.status})`);
      console.log(`       Shopify Product:    ${linkedListing.shopifyProductId || "❌ MISSING"}`);
      console.log(`       Printify Product:   ${linkedListing.printifyProductId || "❌ MISSING"}`);
    } else {
      console.log(`    ⚠️  NO LINKED LISTING (DB row missing despite PUBLISHED status)`);
    }
  }

  // 3. Check feature flags
  console.log("\n" + "=" .repeat(70));
  console.log("🏁 RELEVANT FEATURE FLAGS");
  console.log("=" .repeat(70));

  const flags = await prisma.featureFlag.findMany({
    where: {
      key: {
        in: ["publish_dry_run", "printify_real_mockups", "printify_orphan_cleanup_enabled"],
      },
    },
  });

  for (const f of flags) {
    const emoji = f.enabled ? "🟢" : "🔴";
    console.log(`  ${emoji} ${f.key}: ${f.enabled}`);
  }
  if (!flags.find(f => f.key === "publish_dry_run")) {
    console.log("  ⚠️  publish_dry_run flag NOT FOUND in DB (defaults to disabled — real publish)");
  }

  // 4. Check store credentials
  console.log("\n" + "=" .repeat(70));
  console.log("🔑 STORE CREDENTIALS STATUS");
  console.log("=" .repeat(70));

  const stores = await prisma.store.findMany({
    select: { id: true, name: true, shopifyDomain: true, printifyShopId: true },
  });

  for (const store of stores) {
    const creds = await prisma.storeCredentials.findUnique({
      where: { storeId: store.id },
      select: { shopifyTokenEncrypted: true },
    });

    // PrintifyShop is linked to Store, not PrintifyAccount
    const printifyShop = await (prisma as any).printifyShop?.findFirst?.({
      where: { storeId: store.id },
      select: { externalShopId: true },
    }).catch(() => null);

    console.log(`\n  ${store.name} (${store.id})`);
    console.log(`    Shopify Domain:        ${store.shopifyDomain || "❌ NOT SET"}`);
    console.log(`    Shopify Token:         ${creds?.shopifyTokenEncrypted ? "✅ ENCRYPTED" : "❌ MISSING"}`);
    console.log(`    Printify ShopId:       ${store.printifyShopId || "❌ NOT SET"}`);
    console.log(`    Printify Shop Link:    ${printifyShop?.externalShopId ? `✅ (extId: ${printifyShop.externalShopId})` : "⚠️ Check via printifyShopId"}`);
  }

  // 5. Summary
  console.log("\n" + "=" .repeat(70));
  console.log("📊 DIAGNOSIS SUMMARY");
  console.log("=" .repeat(70));

  const failedJobs = await prisma.publishJob.findMany({
    where: { status: "FAILED" },
    include: { listing: { select: { title: true, wizardDraftId: true } } },
  });

  const pendingJobs = await prisma.publishJob.findMany({
    where: { status: "PENDING" },
  });

  const runningJobs = await prisma.publishJob.findMany({
    where: { status: "RUNNING" },
  });

  console.log(`  Total Listings:          ${listings.length}`);
  console.log(`  Failed Jobs:             ${failedJobs.length}`);
  console.log(`  Pending Jobs:            ${pendingJobs.length}`);
  console.log(`  Running Jobs (stuck?):   ${runningJobs.length}`);

  if (failedJobs.length > 0) {
    console.log(`\n  ❌ FAILED JOBS DETAIL:`);
    for (const j of failedJobs) {
      console.log(`    ${j.stage} | ${j.listing.title} | Draft: ${j.listing.wizardDraftId}`);
      console.log(`      Error: ${j.lastError || "No error message"}`);
    }
  }

  if (runningJobs.length > 0) {
    console.log(`\n  🔄 STUCK RUNNING JOBS (may indicate crash mid-publish):`);
    for (const j of runningJobs) {
      console.log(`    ${j.id} | ${j.stage} | Created: ${j.createdAt.toISOString()}`);
    }
  }

  const dryRunFlag = flags.find(f => f.key === "publish_dry_run");
  if (dryRunFlag?.enabled) {
    console.log(`\n  ⚠️  CRITICAL: publish_dry_run IS ENABLED — nothing is actually published!`);
  }

  console.log("\n" + "=" .repeat(70));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

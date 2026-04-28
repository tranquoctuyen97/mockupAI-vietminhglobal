/**
 * Simulate the EXACT publish flow that worker.ts executes
 * — Build same payload, test same API calls, report results
 *
 * Usage: npx tsx scripts/simulate-printify-publish.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import * as crypto from "crypto";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PRINTIFY_BASE = "https://api.printify.com/v1";

function dec(enc: Buffer | Uint8Array): string {
  const k = process.env.MASTER_ENCRYPTION_KEY!;
  const b = Buffer.from(enc);
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(k, "hex"), b.subarray(0, 12), { authTagLength: 16 });
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf-8");
}

async function printifyFetch(apiKey: string, path: string, opts?: RequestInit) {
  const res = await fetch(`${PRINTIFY_BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(opts?.headers || {}) },
  });
  return res;
}

async function main() {
  console.log("=".repeat(70));
  console.log("🔬 SIMULATE EXACT WORKER PUBLISH FLOW");
  console.log("=".repeat(70));

  // ── 1. Load same data as worker ─────────────────────────────────────────

  const latestDraft = await prisma.wizardDraft.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { updatedAt: "desc" },
    include: {
      design: true,
      store: { include: { template: true, colors: true, printifyShop: { include: { account: true } } } },
    },
  });

  if (!latestDraft?.store?.printifyShop) {
    console.error("❌ No published draft with Printify shop found");
    return;
  }

  const draft = latestDraft;
  const store = draft.store!;
  const template = store.template;
  const apiKey = dec(store.printifyShop!.account.apiKeyEncrypted);
  const shopId = store.printifyShop!.externalShopId;
  const blueprintId = template?.printifyBlueprintId ?? 0;
  const printProviderId = template?.printifyPrintProviderId ?? 0;

  console.log(`\n📋 Draft:              ${draft.id}`);
  console.log(`   Status:             ${draft.status}`);
  console.log(`   printifyDraftProdId: ${draft.printifyDraftProductId || "NULL"}`);
  console.log(`   printifyImageId:    ${draft.printifyImageId || "NULL"}`);
  console.log(`   Blueprint:          ${blueprintId}`);
  console.log(`   Print Provider:     ${printProviderId}`);
  console.log(`   Design:             ${draft.design?.storagePath || "NULL"}`);
  const enabledColorIds = new Set(draft.enabledColorIds ?? []);
  const storeColors = (draft.store as any)?.colors ?? [];
  const resolvedColorNames: string[] = storeColors.filter((c: any) => enabledColorIds.has(c.id)).map((c: any) => c.name);
  console.log(`   Colors (resolved):  ${JSON.stringify(resolvedColorNames)}`);
  console.log(`   Sizes:              ${JSON.stringify(draft.enabledSizes)}`);

  // ── 2. Check if draft product still exists on Printify ──────────────────

  if (draft.printifyDraftProductId) {
    console.log(`\n--- Check: Does draft product ${draft.printifyDraftProductId} exist? ---`);
    const res = await printifyFetch(apiKey, `/shops/${shopId}/products/${draft.printifyDraftProductId}.json`);
    console.log(`   Status: ${res.status}`);
    if (res.status === 404) {
      console.log(`   🔴 PRODUCT NOT FOUND — it was deleted from Printify!`);
      console.log(`   → Worker will fail with 404 every time until we fix this`);
    } else if (res.ok) {
      const data = await res.json();
      console.log(`   ✅ Product exists: "${data.title}" (${data.variants?.length} variants)`);
    } else {
      console.log(`   ⚠️ Unexpected: ${await res.text()}`);
    }
  }

  // ── 3. Build exact variant payload (same as worker) ─────────────────────

  console.log(`\n--- Build variant payload (same as worker) ---`);

  const cachedVariants = await prisma.printifyVariantCache.findMany({
    where: { blueprintId, printProviderId },
  });
  console.log(`   Cached variants: ${cachedVariants.length}`);

  const pricing = await prisma.productPricingTemplate.findFirst({
    where: { productType: template?.blueprintTitle ?? (draft as any).productType },
  });
  const baseRetailPriceUSD = pricing?.basePriceUsd ?? 24.99;
  console.log(`   Base retail: $${baseRetailPriceUSD}`);

  const selectedColorNames = resolvedColorNames;
  const selectedSizes = draft.enabledSizes || [];
  const effectiveSizes = selectedSizes.length > 0
    ? selectedSizes
    : [...new Set(cachedVariants.filter(v => v.isAvailable).map(v => v.size))];

  console.log(`   Colors: ${selectedColorNames.join(", ") || "NONE"}`);
  console.log(`   Sizes:  ${effectiveSizes.join(", ") || "NONE"}`);

  // Build variant payload same as buildVariantPayload()
  const colorSet = new Set(selectedColorNames.map(c => c.trim().toLowerCase()));
  const sizeSet = new Set(effectiveSizes);
  const minCostCents = cachedVariants.reduce((min, v) => (v.isAvailable && v.costCents < min ? v.costCents : min), Infinity);
  const validMinCost = minCostCents === Infinity ? 0 : minCostCents;

  let firstAvailable = true;
  const variantsPayload = cachedVariants.map(v => {
    const isSelected = colorSet.has(v.colorName.trim().toLowerCase()) && sizeSet.has(v.size);
    const isEnabled = isSelected && v.isAvailable;
    const costDelta = v.costCents - validMinCost;
    const retailPriceCents = Math.round(Number(baseRetailPriceUSD) * 100) + costDelta;
    const p: any = {
      id: v.variantId,
      price: Math.max(100, retailPriceCents),
      is_enabled: isEnabled,
    };
    if (v.sku) p.sku = v.sku;
    if (isEnabled && firstAvailable) { p.is_default = true; firstAvailable = false; }
    return p;
  });

  const enabledCount = variantsPayload.filter(v => v.is_enabled).length;
  const disabledCount = variantsPayload.filter(v => !v.is_enabled).length;
  const zeroPriceCount = variantsPayload.filter(v => v.price <= 0).length;

  console.log(`   Total variants: ${variantsPayload.length} (${enabledCount} enabled, ${disabledCount} disabled)`);
  console.log(`   Zero-price variants: ${zeroPriceCount}`);
  console.log(`   Enabled variants sample: ${JSON.stringify(variantsPayload.filter(v => v.is_enabled).slice(0, 3))}`);

  // ── 4. Build full Printify payload ──────────────────────────────────────

  const imageId = draft.printifyImageId || "MISSING";
  const allVariantIds = variantsPayload.map(v => v.id);

  // Get listing for title/description
  const listing = await prisma.listing.findUnique({
    where: { wizardDraftId: draft.id },
  });

  const fullPayload = {
    title: listing?.title || "Test Product",
    description: listing?.descriptionHtml || "Test",
    blueprint_id: blueprintId,
    print_provider_id: printProviderId,
    variants: variantsPayload,
    print_areas: [{
      variant_ids: allVariantIds,
      placeholders: [{
        position: "front",
        images: [{
          id: imageId,
          x: 0.5,
          y: 0.5,
          scale: 1,
          angle: 0,
        }],
      }],
    }],
  };

  console.log(`\n--- Full payload stats ---`);
  console.log(`   Title:              ${fullPayload.title}`);
  console.log(`   Blueprint:          ${fullPayload.blueprint_id}`);
  console.log(`   Print Provider:     ${fullPayload.print_provider_id}`);
  console.log(`   Variants:           ${fullPayload.variants.length}`);
  console.log(`   Print area IDs:     ${fullPayload.print_areas[0].variant_ids.length}`);
  console.log(`   Image ID:           ${fullPayload.print_areas[0].placeholders[0].images[0].id}`);
  console.log(`   Payload size:       ${JSON.stringify(fullPayload).length} bytes`);

  // ── 5. Test CREATE new product (since draft product is likely 404) ──────

  console.log(`\n--- Test: POST create NEW product with this payload ---`);
  try {
    const res = await printifyFetch(apiKey, `/shops/${shopId}/products.json`, {
      method: "POST",
      body: JSON.stringify(fullPayload),
    });
    const text = await res.text();
    console.log(`   Status: ${res.status}`);

    if (res.ok) {
      const data = JSON.parse(text);
      console.log(`   ✅ SUCCESS! Product ID: ${data.id}`);
      console.log(`   Title: ${data.title}`);
      console.log(`   Variants: ${data.variants?.length}`);
      console.log(`   Images: ${data.images?.length}`);

      // Don't delete — this is the real product we want!
      console.log(`\n   🎉 Product created successfully! ID: ${data.id}`);
      console.log(`   → Worker should CREATE new products instead of UPDATE deleted ones`);

      // Clean up test product
      console.log(`   Deleting test product...`);
      await printifyFetch(apiKey, `/shops/${shopId}/products/${data.id}.json`, { method: "DELETE" });
      console.log(`   🗑️  Deleted`);
    } else {
      console.log(`   ❌ FAILED: ${text.slice(0, 500)}`);

      // Parse error for debugging
      try {
        const errData = JSON.parse(text);
        if (errData.errors) {
          console.log(`\n   Error details:`);
          for (const [key, val] of Object.entries(errData.errors)) {
            console.log(`     ${key}: ${JSON.stringify(val)}`);
          }
        }
      } catch {}
    }
  } catch (err) {
    console.error(`   ❌ Network error:`, err);
  }

  // ── 6. Summary ──────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(70));
  console.log("📊 ROOT CAUSE & FIX RECOMMENDATION");
  console.log("=".repeat(70));

  if (draft.printifyDraftProductId) {
    const checkRes = await printifyFetch(apiKey, `/shops/${shopId}/products/${draft.printifyDraftProductId}.json`);
    if (checkRes.status === 404) {
      console.log(`\n  🔴 ROOT CAUSE: printifyDraftProductId '${draft.printifyDraftProductId}' was DELETED from Printify`);
      console.log(`     but DB still references it → worker tries PUT update → 404 every time`);
      console.log(`\n  🛠️  FIX: In publishExistingPrintifyDraftProduct, catch 404 and:`);
      console.log(`     1. Clear printifyDraftProductId from draft`);
      console.log(`     2. Fall back to CREATE new product`);
      console.log(`     3. Save new product ID to listing`);
    } else {
      console.log(`\n  ✅ Draft product exists — issue may be transient`);
    }
  }

  console.log("\n" + "=".repeat(70));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

/**
 * Test Printify PUT update — replicate the exact payload the worker sends
 *
 * Usage: npx tsx scripts/test-printify-update.ts
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

const PRINTIFY_BASE_URL = "https://api.printify.com/v1";

function decryptKey(encrypted: Buffer | Uint8Array): string {
  const key = process.env.MASTER_ENCRYPTION_KEY;
  if (!key || key.length !== 64) throw new Error("MASTER_ENCRYPTION_KEY missing");
  const buf = Buffer.from(encrypted);
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf-8");
}

async function main() {
  console.log("=".repeat(70));
  console.log("🧪 PRINTIFY UPDATE (PUT) SIMULATION");
  console.log("=".repeat(70));

  // Get store + credentials
  const store = await prisma.store.findFirst({
    where: { printifyShopId: { not: null } },
    include: {
      printifyShop: {
        include: { account: { select: { apiKeyEncrypted: true } } },
      },
      template: true,
    },
  });

  if (!store?.printifyShop) { console.error("No store linked"); return; }

  const apiKey = decryptKey(store.printifyShop.account.apiKeyEncrypted);
  const shopId = store.printifyShop.externalShopId;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  const blueprintId = store.template?.printifyBlueprintId ?? 5;
  const printProviderId = store.template?.printifyPrintProviderId ?? 42;

  // Get latest published draft
  const draft = await prisma.wizardDraft.findFirst({
    where: { status: "PUBLISHED", printifyDraftProductId: { not: null } },
    orderBy: { updatedAt: "desc" },
  });

  if (!draft?.printifyDraftProductId) {
    console.error("No published draft with printifyDraftProductId found");
    return;
  }

  const productId = draft.printifyDraftProductId;
  console.log(`\n📋 Draft:     ${draft.id}`);
  console.log(`   Product:   ${productId}`);
  console.log(`   Blueprint: ${blueprintId}`);
  console.log(`   Provider:  ${printProviderId}`);

  // Step 1: GET current product state
  console.log("\n--- Step 1: GET current product from Printify ---");
  const getRes = await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${productId}.json`, { headers });
  if (!getRes.ok) {
    console.error(`❌ Product not found: ${getRes.status} — ${await getRes.text()}`);
    return;
  }
  const currentProduct = await getRes.json();
  console.log(`   Title:         ${currentProduct.title}`);
  console.log(`   Variants:      ${currentProduct.variants?.length}`);
  console.log(`   Images:        ${currentProduct.images?.length}`);
  console.log(`   Print Areas:   ${currentProduct.print_areas?.length}`);

  // Show first few variants
  if (currentProduct.variants) {
    console.log(`   First 3 variants:`);
    for (const v of currentProduct.variants.slice(0, 3)) {
      console.log(`     id=${v.id} price=${v.price} enabled=${v.is_enabled} cost=${v.cost}`);
    }
  }

  // Step 2: Get variant cache
  console.log("\n--- Step 2: Get cached variants from DB ---");
  const cachedVariants = await prisma.printifyVariantCache.findMany({
    where: { blueprintId, printProviderId },
  });
  console.log(`   Cached variants: ${cachedVariants.length}`);

  // Step 3: Build the EXACT payload that worker would send
  console.log("\n--- Step 3: Build update payload (same as worker) ---");

  // Get existing images from current product
  const existingImages = currentProduct.images || [];
  const existingImageId = existingImages.length > 0 ? existingImages[0].src?.split("/").pop()?.split(".")[0] : null;

  // Build variants payload
  const selectedSizes = draft.enabledSizes || [];
  const effectiveSizes = selectedSizes.length > 0
    ? selectedSizes
    : [...new Set(cachedVariants.filter(v => v.isAvailable).map(v => v.size))];

  console.log(`   Selected sizes: ${selectedSizes.length > 0 ? selectedSizes.join(", ") : "NONE (using all)"}`);
  console.log(`   Effective sizes: ${effectiveSizes.join(", ")}`);

  // Get all enabled variant IDs from current product
  const currentVariantIds = currentProduct.variants?.map((v: any) => v.id) || [];

  // Build minimal update payload — just change title/description, keep existing structure
  const updatePayload = {
    title: "Final First Order Achievement Unisex Sweatshirt 1",
    description: currentProduct.description || "Test",
    variants: currentProduct.variants?.map((v: any) => ({
      id: v.id,
      price: v.price > 0 ? v.price : 2499,
      is_enabled: v.is_enabled,
    })),
    print_areas: currentProduct.print_areas,
  };

  console.log(`   Payload size: ${JSON.stringify(updatePayload).length} bytes`);
  console.log(`   Variant count in payload: ${updatePayload.variants?.length}`);
  console.log(`   Print areas variant_ids count: ${updatePayload.print_areas?.[0]?.variant_ids?.length}`);

  // Step 4: Test minimal PUT — just title change
  console.log("\n--- Step 4a: PUT minimal update (title only) ---");
  const minimalUpdate = { title: `[TEST] ${currentProduct.title} — ${Date.now()}` };
  try {
    const res = await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${productId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify(minimalUpdate),
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    if (res.ok) {
      console.log(`   ✅ Minimal title update works!`);
      // Restore title
      await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${productId}.json`, {
        method: "PUT", headers,
        body: JSON.stringify({ title: currentProduct.title }),
      });
    } else {
      console.log(`   ❌ Error: ${JSON.stringify(data).slice(0, 300)}`);
    }
  } catch (err) {
    console.error(`   ❌ Network error:`, err);
  }

  // Step 4b: Test full update payload
  console.log("\n--- Step 4b: PUT full payload (title + variants + print_areas) ---");
  try {
    const res = await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${productId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify(updatePayload),
    });
    const text = await res.text();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response: ${text.slice(0, 500)}`);

    if (res.status === 500) {
      console.log(`\n   🔴 500 CONFIRMED with full payload!`);
      console.log(`   → Testing individual sections...`);

      // Test A: title + variants only (no print_areas)
      console.log("\n   --- Step 4c: PUT title + variants (NO print_areas) ---");
      const res2 = await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${productId}.json`, {
        method: "PUT", headers,
        body: JSON.stringify({
          title: updatePayload.title,
          variants: updatePayload.variants,
        }),
      });
      console.log(`   Status: ${res2.status}`);
      const text2 = await res2.text();
      console.log(`   Response: ${text2.slice(0, 300)}`);

      // Test B: title + print_areas only (no variants)
      console.log("\n   --- Step 4d: PUT title + print_areas (NO variants) ---");
      const res3 = await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${productId}.json`, {
        method: "PUT", headers,
        body: JSON.stringify({
          title: updatePayload.title,
          print_areas: updatePayload.print_areas,
        }),
      });
      console.log(`   Status: ${res3.status}`);
      const text3 = await res3.text();
      console.log(`   Response: ${text3.slice(0, 300)}`);

      // Test C: title + description only
      console.log("\n   --- Step 4e: PUT title + description only ---");
      const res4 = await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${productId}.json`, {
        method: "PUT", headers,
        body: JSON.stringify({
          title: updatePayload.title,
          description: updatePayload.description,
        }),
      });
      console.log(`   Status: ${res4.status}`);
      const text4 = await res4.text();
      console.log(`   Response: ${text4.slice(0, 200)}`);
    }

    // Restore original title
    await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${productId}.json`, {
      method: "PUT", headers,
      body: JSON.stringify({ title: currentProduct.title }),
    });
  } catch (err) {
    console.error(`   ❌ Network error:`, err);
  }

  console.log("\n" + "=".repeat(70));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

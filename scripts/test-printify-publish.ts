/**
 * Test Printify API directly — isolate whether the 500 error is from our payload or Printify's server
 *
 * Usage: npx tsx scripts/test-printify-publish.ts
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

// Decrypt helper (mirrors src/lib/crypto/envelope.ts)
function decryptKey(encrypted: Buffer | Uint8Array): string {
  const ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY;
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) throw new Error("MASTER_ENCRYPTION_KEY not set or invalid in .env.local");

  const buf = Buffer.from(encrypted);
  const ivLen = 12;
  const tagLen = 16;
  const iv = buf.subarray(0, ivLen);
  const authTag = buf.subarray(ivLen, ivLen + tagLen);
  const ciphertext = buf.subarray(ivLen + tagLen);

  const keyBuf = Buffer.from(ENCRYPTION_KEY, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv, { authTagLength: tagLen });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf-8");
}

async function main() {
  console.log("=" .repeat(70));
  console.log("🧪 PRINTIFY API TEST SCRIPT");
  console.log("=" .repeat(70));

  // 1. Get the store + Printify credentials
  const store = await prisma.store.findFirst({
    where: { printifyShopId: { not: null } },
    include: {
      printifyShop: {
        include: {
          account: { select: { id: true, apiKeyEncrypted: true, status: true } },
        },
      },
      template: true,
    },
  });

  if (!store || !store.printifyShop) {
    console.error("❌ No store with Printify shop linked found.");
    return;
  }

  console.log(`\n📦 Store: ${store.name} (${store.id})`);
  console.log(`   Printify Shop: ${store.printifyShop.title} (extId: ${store.printifyShop.externalShopId})`);
  console.log(`   Account Status: ${store.printifyShop.account.status}`);

  const apiKey = decryptKey(store.printifyShop.account.apiKeyEncrypted);
  console.log(`   API Key: ****${apiKey.slice(-4)}`);

  const shopId = store.printifyShop.externalShopId;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // 2. Test basic API access
  console.log("\n--- Test 1: GET /shops.json (Basic API access) ---");
  try {
    const res = await fetch(`${PRINTIFY_BASE_URL}/shops.json`, { headers });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Shops: ${JSON.stringify(data.map?.((s: any) => ({ id: s.id, title: s.title })) || data)}`);
  } catch (err) {
    console.error(`   ❌ Failed:`, err);
  }

  // 3. Test catalog access — get blueprint variants
  const blueprintId = store.template?.printifyBlueprintId ?? 6;
  const printProviderId = store.template?.printifyPrintProviderId ?? 99;

  console.log(`\n--- Test 2: GET /catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json ---`);
  let catalogVariants: any[] = [];
  try {
    const res = await fetch(
      `${PRINTIFY_BASE_URL}/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`,
      { headers }
    );
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    catalogVariants = data.variants ?? data;
    console.log(`   Variants count: ${Array.isArray(catalogVariants) ? catalogVariants.length : "NOT_ARRAY"}`);
    if (Array.isArray(catalogVariants) && catalogVariants.length > 0) {
      console.log(`   First 3 variant IDs: ${catalogVariants.slice(0, 3).map((v: any) => v.id).join(", ")}`);
    }
  } catch (err) {
    console.error(`   ❌ Failed:`, err);
  }

  // 4. Test: Create a MINIMAL product (1 variant, no image) — smallest possible payload
  console.log(`\n--- Test 3: POST create minimal product (1 variant, no image) ---`);
  const firstVariantId = catalogVariants[0]?.id ?? 39170;

  const minimalPayload = {
    title: "[TEST] Minimal Product — delete me",
    description: "Test product for debugging",
    blueprint_id: blueprintId,
    print_provider_id: printProviderId,
    variants: [
      { id: firstVariantId, price: 2499, is_enabled: true, is_default: true },
    ],
    print_areas: [
      {
        variant_ids: [firstVariantId],
        placeholders: [
          {
            position: "front",
            images: [
              {
                id: "67038bfc5e29e11c0a06fd3c", // dummy image ID — will likely fail but tells us if it's a payload issue
                x: 0.5,
                y: 0.5,
                scale: 1,
                angle: 0,
              },
            ],
          },
        ],
      },
    ],
  };

  console.log(`   Payload: ${JSON.stringify(minimalPayload, null, 2).slice(0, 500)}`);

  try {
    const res = await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products.json`, {
      method: "POST",
      headers,
      body: JSON.stringify(minimalPayload),
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log(`   Response: ${JSON.stringify(data).slice(0, 500)}`);

    // If success, clean up
    if (res.ok && data.id) {
      console.log(`   ✅ Product created: ${data.id} — deleting...`);
      await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${data.id}.json`, {
        method: "DELETE",
        headers,
      });
      console.log(`   🗑️  Deleted test product`);
    }
  } catch (err) {
    console.error(`   ❌ Network error:`, err);
  }

  // 5. Test: List existing products to verify API works
  console.log(`\n--- Test 4: GET /shops/${shopId}/products.json (List products) ---`);
  try {
    const res = await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products.json?page=1`, { headers });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    const products = data.data ?? data;
    console.log(`   Products count: ${Array.isArray(products) ? products.length : "NOT_ARRAY"}`);
    if (Array.isArray(products)) {
      for (const p of products.slice(0, 5)) {
        console.log(`     • ${p.id} — "${p.title}" (variants: ${p.variants?.length ?? 0})`);
      }
    }
  } catch (err) {
    console.error(`   ❌ Failed:`, err);
  }

  // 6. Test: Check the draft product that worker is trying to update
  const latestDraft = await prisma.wizardDraft.findFirst({
    where: { status: "PUBLISHED", printifyDraftProductId: { not: null } },
    orderBy: { updatedAt: "desc" },
  });

  if (latestDraft?.printifyDraftProductId) {
    const draftProdId = latestDraft.printifyDraftProductId;
    console.log(`\n--- Test 5: GET draft product ${draftProdId} ---`);
    try {
      const res = await fetch(`${PRINTIFY_BASE_URL}/shops/${shopId}/products/${draftProdId}.json`, { headers });
      console.log(`   Status: ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        console.log(`   Title: ${data.title}`);
        console.log(`   Variants count: ${data.variants?.length}`);
        console.log(`   Images count: ${data.images?.length}`);
      } else {
        const errText = await res.text();
        console.log(`   ❌ Error: ${errText.slice(0, 300)}`);
        console.log(`   → Draft product may have been deleted from Printify. Worker is trying to UPDATE a non-existent product.`);
      }
    } catch (err) {
      console.error(`   ❌ Network error:`, err);
    }
  }

  // 7. Summary
  console.log("\n" + "=" .repeat(70));
  console.log("📊 SUMMARY");
  console.log("=" .repeat(70));
  console.log(`  Blueprint:        ${blueprintId}`);
  console.log(`  Print Provider:   ${printProviderId}`);
  console.log(`  Shop ID:          ${shopId}`);
  console.log(`  Catalog Variants: ${catalogVariants.length}`);
  console.log(`  Draft Product:    ${latestDraft?.printifyDraftProductId || "NONE"}`);
  console.log("=" .repeat(70));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

/**
 * Pre-publish verification: Test all prerequisites before publish
 * Run: npx tsx scripts/test-publish-pipeline.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { decrypt } from "../src/lib/crypto/envelope";
import { ShopifyClient } from "../src/lib/shopify/client";
import { getStorage } from "../src/lib/storage/local-disk";

const DRAFT_ID = "cmofyh59p0000hmt044fkulmd";

async function main() {
  console.log("\n========== PRE-PUBLISH VERIFICATION ==========\n");

  // Step 1: Load draft
  console.log("Step 1: Load draft...");
  const draft = await prisma.wizardDraft.findUnique({
    where: { id: DRAFT_ID },
    include: { mockupJobs: true, design: true, store: { include: { template: true, colors: true } } },
  });
  if (!draft) { console.error("❌ Draft not found"); return; }
  console.log(`  ✅ Draft found | status: ${draft.status} | storeId: ${draft.storeId}`);

  // Step 2: Verify store exists
  console.log("Step 2: Verify store...");
  if (!draft.store) { console.error("❌ Store not found (storeId dangling)"); return; }
  console.log(`  ✅ Store: "${draft.store.name}" | domain: ${draft.store.shopifyDomain}`);

  // Step 3: Decrypt Shopify token
  console.log("Step 3: Decrypt Shopify token...");
  const creds = await prisma.storeCredentials.findUnique({ where: { storeId: draft.storeId! } });
  if (!creds?.shopifyTokenEncrypted) { console.error("❌ No Shopify credentials"); return; }
  let token: string;
  try {
    token = decrypt(creds.shopifyTokenEncrypted);
    console.log(`  ✅ Token: ****${token.slice(-4)} (${token.length} chars)`);
  } catch (err) { console.error("  ❌ Decrypt failed:", (err as Error).message); return; }

  // Step 4: Test Shopify API
  console.log("Step 4: Test Shopify API...");
  const client = new ShopifyClient(draft.store.shopifyDomain!, token);
  const test = await client.testConnection();
  console.log(`  ${test.ok ? "✅" : "❌"} Shopify: ${test.ok ? test.shopName : test.error}`);

  // Step 5: Test Printify
  console.log("Step 5: Test Printify...");
  try {
    const { getClientForStore } = await import("../src/lib/printify/account");
    const result = await getClientForStore(draft.storeId!);
    const pTest = await result.client.testConnection();
    console.log(`  ${pTest.ok ? "✅" : "❌"} Printify: externalShopId=${result.externalShopId} | ${pTest.ok ? "OK" : pTest.error}`);
  } catch (err) { console.error("  ❌ Printify:", (err as Error).message); }

  // Step 6: Check design + mockups
  console.log("Step 6: Check design + mockups...");
  const storage = getStorage();
  const fs = await import("node:fs");
  if (draft.design?.storagePath) {
    const p = storage.resolvePath(draft.design.storagePath);
    console.log(`  ${fs.existsSync(p) ? "✅" : "❌"} Design: ${p}`);
  } else { console.log("  ❌ No design"); }

  const images = await prisma.mockupImage.findMany({
    where: { mockupJob: { draftId: DRAFT_ID }, included: true, compositeUrl: { not: null } },
  });
  console.log(`  ✅ ${images.length} mockup images included`);

  // Step 7: Check idempotency — no stale listing
  console.log("Step 7: Check idempotency...");
  const existing = await prisma.listing.findUnique({ where: { wizardDraftId: DRAFT_ID } });
  console.log(`  ${existing ? "⚠️  Existing listing: " + existing.id + " (status: " + existing.status + ")" : "✅ No existing listing — fresh publish OK"}`);

  // Step 8: Check variant IDs
  console.log("Step 8: Check variants...");
  const variantIds = draft.store.template?.enabledVariantIds ?? [];
  console.log(`  ${variantIds.length > 0 ? "✅" : "❌"} ${variantIds.length} enabled variant IDs`);

  console.log("\n========== VERIFICATION COMPLETE ==========\n");
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

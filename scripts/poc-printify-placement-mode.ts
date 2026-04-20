/**
 * POC Script: Printify Placement Mode Test
 * ==========================================
 * Tests 3 placement modes (stretch | preserve | exact) against Printify Draft API
 * to compare how each mode affects the generated mockup.
 *
 * Usage:
 *   PRINTIFY_API_KEY=xxx PRINTIFY_SHOP_ID=xxx PRINTIFY_BLUEPRINT_ID=xxx \
 *   PRINTIFY_PRINT_PROVIDER_ID=xxx PRINTIFY_VARIANT_ID=xxx \
 *   DESIGN_IMAGE_URL=https://... \
 *   pnpm tsx scripts/poc-printify-placement-mode.ts
 *
 * Output:
 *   - logs 3 Printify draft product IDs + mockup URLs
 *   - saves results to scripts/poc-results.json for manual comparison
 */

import "dotenv/config";
import fs from "fs";
import path from "path";

const API_KEY = process.env.PRINTIFY_API_KEY!;
const SHOP_ID = process.env.PRINTIFY_SHOP_ID!;
const BLUEPRINT_ID = Number(process.env.PRINTIFY_BLUEPRINT_ID ?? "5"); // 5 = Unisex Heavy Cotton Tee
const PRINT_PROVIDER_ID = Number(process.env.PRINTIFY_PRINT_PROVIDER_ID ?? "99");
const VARIANT_ID = Number(process.env.PRINTIFY_VARIANT_ID ?? "17887");
const DESIGN_IMAGE_URL = process.env.DESIGN_IMAGE_URL ?? "";

if (!API_KEY || !SHOP_ID || !DESIGN_IMAGE_URL) {
  console.error("❌ Missing required env vars: PRINTIFY_API_KEY, PRINTIFY_SHOP_ID, DESIGN_IMAGE_URL");
  process.exit(1);
}

const BASE = "https://api.printify.com/v1";
const HEADERS = {
  "Authorization": `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

type PlacementMode = "stretch" | "preserve" | "exact";

interface PrintifyDraftProduct {
  id: string;
  title: string;
  images: Array<{ src: string; position: string; is_default: boolean }>;
}

/** Upload image to Printify's image library */
async function uploadImage(imageUrl: string): Promise<string> {
  console.log("📤 Uploading design image to Printify...");
  const res = await fetch(`${BASE}/uploads/images.json`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      file_name: "poc_design.png",
      url: imageUrl,
    }),
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { id: string };
  console.log(`✅ Uploaded image ID: ${data.id}`);
  return data.id;
}

/** Create a Printify Product in DRAFT state with given placement mode */
async function createDraftProduct(
  imageId: string,
  mode: PlacementMode,
  index: number,
): Promise<PrintifyDraftProduct> {
  console.log(`\n🔨 Creating draft [${mode}]...`);

  const payload = {
    title: `[POC] Placement Mode Test — ${mode} (${index + 1}/3)`,
    description: `Automated POC test for placement mode '${mode}'`,
    blueprint_id: BLUEPRINT_ID,
    print_provider_id: PRINT_PROVIDER_ID,
    variants: [
      {
        id: VARIANT_ID,
        price: 0,
        is_enabled: true,
      },
    ],
    print_areas: [
      {
        variant_ids: [VARIANT_ID],
        placeholders: [
          {
            position: "front",
            images: [
              {
                id: imageId,
                x: 0.5,       // center (Printify normalized 0-1 relative to print area)
                y: 0.5,
                scale: 0.6,   // 60% of design native size
                angle: 0,
                placement: mode, // <-- the field we are testing
              },
            ],
          },
        ],
      },
    ],
  };

  const res = await fetch(`${BASE}/shops/${SHOP_ID}/products.json`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Create product failed [${mode}]: ${res.status} ${text}`);

  const product = JSON.parse(text) as PrintifyDraftProduct;
  console.log(`✅ Draft created: ${product.id} — "${product.title}"`);
  return product;
}

/** Get mockup images for a product */
async function getMockups(productId: string): Promise<string[]> {
  const res = await fetch(`${BASE}/shops/${SHOP_ID}/products/${productId}.json`, {
    headers: HEADERS,
  });
  if (!res.ok) return [];
  const data = await res.json() as PrintifyDraftProduct;
  return data.images?.map((img) => img.src) ?? [];
}

/** Delete draft product (cleanup) */
async function deleteDraft(productId: string) {
  await fetch(`${BASE}/shops/${SHOP_ID}/products/${productId}.json`, {
    method: "DELETE",
    headers: HEADERS,
  });
}

async function main() {
  console.log("🧪 Printify Placement Mode POC");
  console.log("===================================");
  console.log(`Blueprint: ${BLUEPRINT_ID} | Provider: ${PRINT_PROVIDER_ID} | Variant: ${VARIANT_ID}`);
  console.log(`Design URL: ${DESIGN_IMAGE_URL}\n`);

  // Step 1: Upload design
  const imageId = await uploadImage(DESIGN_IMAGE_URL);

  const modes: PlacementMode[] = ["preserve", "stretch", "exact"];
  const results: Array<{
    mode: string;
    productId: string;
    mockups: string[];
  }> = [];

  // Step 2: Create 3 draft products
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    try {
      const product = await createDraftProduct(imageId, mode, i);

      // Wait 2s for Printify to generate mockups
      await new Promise((r) => setTimeout(r, 2000));

      const mockups = await getMockups(product.id);
      results.push({ mode, productId: product.id, mockups });

      console.log(`🖼  Mockups for [${mode}]:`);
      mockups.slice(0, 2).forEach((url) => console.log(`    ${url}`));
    } catch (err) {
      console.error(`❌ Error for mode [${mode}]:`, err);
      results.push({ mode, productId: "ERROR", mockups: [] });
    }
  }

  // Step 3: Save results
  const outputPath = path.join(__dirname, "poc-results.json");
  fs.writeFileSync(outputPath, JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2));
  console.log(`\n📄 Results saved to: ${outputPath}`);

  // Step 4: Summary
  console.log("\n📊 Summary:");
  console.log("Mode        | Product ID               | Mockup Count");
  console.log("------------|--------------------------|-------------");
  for (const r of results) {
    console.log(`${r.mode.padEnd(12)}| ${r.productId.padEnd(24)}| ${r.mockups.length}`);
  }

  console.log("\n🔍 Open each Product ID in Printify dashboard to visually compare.");
  console.log("⚠️  Remember to manually delete the 3 draft products after reviewing.");
  console.log("    Product IDs:", results.map((r) => r.productId).join(", "));
}

main().catch((e) => {
  console.error("❌ POC failed:", e);
  process.exit(1);
});

import { prisma } from "../src/lib/db";
import { decrypt } from "../src/lib/crypto/envelope";
import { ShopifyClient } from "../src/lib/shopify/client";

async function main() {
  const draftId = "cmpgoxaev000ja5t0a8yp5cux";
  const draft = await prisma.wizardDraft.findUnique({
    where: { id: draftId }
  });
  if (!draft) {
    throw new Error("Draft not found");
  }

  const storeId = draft.storeId;
  
  const listing = await prisma.listing.findFirst({
    where: { wizardDraftId: draftId }
  });
  if (!listing || !listing.shopifyProductId) {
    throw new Error("Active listing not found for draft or shopifyProductId is missing");
  }
  const shopifyProductId = listing.shopifyProductId;

  console.log(`=== Inspecting Shopify Product Media for ${shopifyProductId} ===`);
  console.log(`Draft Store ID: ${storeId}`);

  // Load credentials
  const creds = await prisma.storeCredentials.findUnique({
    where: { storeId: storeId },
  });
  if (!creds || !creds.shopifyTokenEncrypted) {
    throw new Error("Store credentials not found or Shopify not connected");
  }

  const shopifyAccessToken = decrypt(creds.shopifyTokenEncrypted);
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store || !store.shopifyDomain) {
    throw new Error("Store not found or shopifyDomain missing");
  }

  const client = new ShopifyClient(store.shopifyDomain, shopifyAccessToken);

  const query = `
    query getProductMedia($id: ID!) {
      product(id: $id) {
        id
        title
        media(first: 50) {
          nodes {
            id
            mediaContentType
            preview {
              image {
                id
                url
                width
                height
              }
            }
          }
        }
        variants(first: 50) {
          nodes {
            id
            title
            media(first: 10) {
              nodes {
                id
              }
            }
          }
        }
      }
    }
  `;

  const data = await client.graphql<any>(query, { id: shopifyProductId });
  console.log("Product:", data.product.title);
  console.log("Media nodes count:", data.product.media.nodes.length);
  for (const node of data.product.media.nodes) {
    console.log(`- Media ID: ${node.id}`);
    console.log(`  Type: ${node.mediaContentType}`);
    console.log(`  Image URL: ${node.preview?.image?.url}`);
  }

  console.log("\nVariants Media association:");
  for (const v of data.product.variants.nodes) {
    console.log(`- Variant: ${v.title} (${v.id})`);
    for (const m of v.media.nodes) {
      console.log(`  * Associated Media ID: ${m.id}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

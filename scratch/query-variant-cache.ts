import { prisma } from "../src/lib/db";

async function main() {
  // Check variant cache for blueprint 5 / provider 99
  const cached = await prisma.printifyVariantCache.findMany({
    where: { blueprintId: 5, printProviderId: 99 },
    orderBy: { variantId: "asc" },
    take: 20,
  });
  console.log(`=== VARIANT CACHE (blueprint=5, provider=99) ===`);
  console.log(`Count: ${cached.length}`);
  for (const v of cached.slice(0, 15)) {
    console.log(`  ID: ${v.variantId} | ${v.colorName} | ${v.size} | cost: ${v.costCents} | available: ${v.isAvailable}`);
  }
  if (cached.length > 15) console.log(`  ... and ${cached.length - 15} more`);

  // Check if template variant IDs [17420,17421,17591,17592] exist in cache
  const templateVarIds = [17420, 17421, 17591, 17592];
  const foundInCache = cached.filter(v => templateVarIds.includes(v.variantId));
  console.log(`\n=== TEMPLATE VARIANT IDs IN CACHE ===`);
  console.log(`Looking for: ${JSON.stringify(templateVarIds)}`);
  console.log(`Found: ${foundInCache.length}`);
  for (const v of foundInCache) {
    console.log(`  ID: ${v.variantId} | ${v.colorName} | ${v.size}`);
  }

  // Check what colors are "Solid Red" in cache
  const solidRed = cached.filter(v => v.colorName.toLowerCase().includes("red"));
  console.log(`\n=== "Solid Red" VARIANTS IN CACHE ===`);
  for (const v of solidRed) {
    console.log(`  ID: ${v.variantId} | ${v.colorName} | ${v.size} | available: ${v.isAvailable}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

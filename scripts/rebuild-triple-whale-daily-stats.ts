import { prisma } from "@/lib/db";
import { syncStore } from "@/lib/triple-whale/sync";

async function main() {
  const credentials = await prisma.tripleWhaleCredential.findMany({
    select: { id: true, shopDomain: true },
    orderBy: { createdAt: "asc" },
  });

  for (const credential of credentials) {
    console.log(`[TripleWhaleRebuild] Rebuilding ${credential.shopDomain}`);
    await prisma.tripleWhaleDailyStat.deleteMany({ where: { credentialId: credential.id } });
    await prisma.tripleWhaleCredential.update({
      where: { id: credential.id },
      data: { lastSyncedAt: null, syncError: null },
    });
    await syncStore(credential.id);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

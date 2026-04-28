import { prisma } from "@/lib/db";
import { isEnabled } from "@/lib/feature-flags";
import { getClientForStore } from "@/lib/printify/account";
import { DUMMY_PRODUCT_TITLE_PREFIX } from "@/lib/printify/variant-catalog";

const DEFAULT_RETENTION_DAYS = 7;

export interface PrintifyDraftCleanupCandidate {
  id: string;
  storeId: string | null;
  printifyDraftProductId: string | null;
  status: string;
  updatedAt: Date;
}

export function shouldCleanupPrintifyDraft(
  draft: PrintifyDraftCleanupCandidate,
  cutoff: Date,
): boolean {
  return Boolean(
    draft.storeId &&
    draft.printifyDraftProductId &&
    draft.status === "ABANDONED" &&
    draft.updatedAt < cutoff,
  );
}

export async function cleanupOrphanPrintifyProducts(options: {
  retentionDays?: number;
} = {}): Promise<{ cleanedCount: number; errors: string[] }> {
  if (!(await isEnabled("printify_orphan_cleanup_enabled"))) {
    return { cleanedCount: 0, errors: [] };
  }

  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const errors: string[] = [];
  let cleanedCount = 0;

  const candidates = await prisma.wizardDraft.findMany({
    where: {
      printifyDraftProductId: { not: null },
      status: "ABANDONED",
      updatedAt: { lt: cutoff },
    },
    select: {
      id: true,
      storeId: true,
      printifyDraftProductId: true,
      status: true,
      updatedAt: true,
    },
  });

  for (const draft of candidates) {
    if (!shouldCleanupPrintifyDraft(draft, cutoff)) continue;

    try {
      const { client, externalShopId } = await getClientForStore(draft.storeId!);
      await client.deleteProduct(externalShopId, draft.printifyDraftProductId!);
      await prisma.wizardDraft.update({
        where: { id: draft.id },
        data: {
          printifyDraftProductId: null,
          printifyImageId: null,
        },
      });
      cleanedCount++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to clean Printify draft product for ${draft.id}: ${message}`);
    }
  }

  // Phase 6.11: Cleanup orphan variant cost dummy products
  try {
    const stores = await prisma.store.findMany({
      where: { printifyShopId: { not: null } },
      select: { id: true, printifyShopId: true }
    });

    for (const store of stores) {
      if (!store.printifyShopId) continue;
      try {
        const { client, externalShopId } = await getClientForStore(store.id);
        const res = await client.getProducts(externalShopId, 1);
        if (res.data) {
          const orphans = res.data.filter((p: any) => p.title.startsWith(DUMMY_PRODUCT_TITLE_PREFIX));
          for (const orphan of orphans) {
            try {
              await client.deleteProduct(externalShopId, orphan.id);
              cleanedCount++;
            } catch (err) {
               errors.push(`Failed to clean dummy product ${orphan.id}: ${err}`);
            }
          }
        }
      } catch (err) {
        errors.push(`Failed to check dummy products for store ${store.id}: ${err}`);
      }
    }
  } catch (err) {
     errors.push(`Failed fetching stores for dummy product cleanup: ${err}`);
  }

  return { cleanedCount, errors };
}

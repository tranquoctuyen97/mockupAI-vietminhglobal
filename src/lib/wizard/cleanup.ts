import { prisma } from "@/lib/db";
import { getClientForStore } from "@/lib/printify/account";

export interface DeleteDraftWithCleanupDeps {
  db?: Pick<typeof prisma, "wizardDraft">;
  getClientForStore?: typeof getClientForStore;
  logger?: Pick<Console, "warn">;
}

export async function deleteDraftWithPrintifyCleanup(
  id: string,
  tenantId: string,
  deps: DeleteDraftWithCleanupDeps = {},
) {
  const db = deps.db ?? prisma;
  const resolveClient = deps.getClientForStore ?? getClientForStore;
  const logger = deps.logger ?? console;

  const draft = await db.wizardDraft.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      storeId: true,
      printifyDraftProductId: true,
    },
  });
  if (!draft) throw new Error("Draft not found");

  if (draft.storeId && draft.printifyDraftProductId) {
    try {
      const { client, externalShopId } = await resolveClient(draft.storeId);
      await client.deleteProduct(externalShopId, draft.printifyDraftProductId);
    } catch (error) {
      logger.warn(
        `[WizardCleanup] Failed to delete Printify draft product ${draft.printifyDraftProductId}`,
        error,
      );
    }
  }

  return db.wizardDraft.delete({ where: { id } });
}

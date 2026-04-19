/**
 * Cleanup expired assets worker
 * Runs daily — deletes designs that were soft-deleted > 7 days ago
 */

import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";

const RETENTION_DAYS = 7;

export async function cleanupExpiredAssets(): Promise<{
  purgedCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let purgedCount = 0;

  // Check feature flag
  const flag = await prisma.featureFlag.findUnique({
    where: { key: "retention_cleanup_enabled" },
  });

  if (flag && !flag.enabled) {
    console.log("[Cleanup] retention_cleanup_enabled is OFF — skipping");
    return { purgedCount: 0, errors: [] };
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Find expired designs
  const expiredDesigns = await prisma.design.findMany({
    where: {
      status: "DELETED",
      deletedAt: { lt: cutoff },
    },
    select: {
      id: true,
      storagePath: true,
      previewPath: true,
      name: true,
      tenantId: true,
    },
  });

  if (expiredDesigns.length === 0) {
    console.log("[Cleanup] No expired designs to purge");
    return { purgedCount: 0, errors: [] };
  }

  console.log(`[Cleanup] Found ${expiredDesigns.length} expired designs to purge`);

  const storage = getStorage();

  for (const design of expiredDesigns) {
    try {
      // Delete files from storage
      await storage.delete(design.storagePath);
      if (design.previewPath) {
        await storage.delete(design.previewPath);
      }

      // Hard delete from DB
      await prisma.design.delete({ where: { id: design.id } });

      // Audit event
      await prisma.auditEvent.create({
        data: {
          tenantId: design.tenantId,
          action: "design.purged",
          resourceType: "design",
          resourceId: design.id,
          metadata: { name: design.name, reason: "retention_expired" },
        },
      });

      purgedCount++;
    } catch (err) {
      const msg = `Failed to purge design ${design.id}: ${err}`;
      console.error(`[Cleanup] ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`[Cleanup] Purged ${purgedCount} designs, ${errors.length} errors`);
  return { purgedCount, errors };
}

/**
 * Health Check Worker
 * Runs every 6 hours to verify Shopify + Printify connections
 */

import { Worker } from "bullmq";
import { redisConnection } from "../queue";
import { testStoreConnection } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// HMR-safe singleton — survives Turbopack module re-evaluation
const globalForHealthCheckWorker = globalThis as unknown as {
  healthCheckWorker?: Worker;
};

export function startHealthCheckWorker() {
  if (globalForHealthCheckWorker.healthCheckWorker) return globalForHealthCheckWorker.healthCheckWorker;

  const worker = new Worker(
    "health-check-stores",
    async (_job) => {
      console.log("[HealthCheck] Starting store health check...");

      const stores = await prisma.store.findMany({
        where: {},
        select: { id: true, name: true, status: true, tenantId: true },
      });

      console.log(`[HealthCheck] Checking ${stores.length} stores...`);

      for (const store of stores) {
        try {
          const oldStatus = store.status;
          const result = await testStoreConnection(store.id);

          // Log status change
          if (result.status !== oldStatus) {
            console.log(`[HealthCheck] ${store.name}: ${oldStatus} → ${result.status}`);
            await logAudit({
              tenantId: store.tenantId,
              action: "store.health_check_status_changed",
              resourceType: "store",
              resourceId: store.id,
              metadata: {
                oldStatus,
                newStatus: result.status,
                shopify: result.shopify,
                printify: result.printify,
              },
            });
          }
        } catch (error) {
          console.error(`[HealthCheck] Error checking ${store.name}:`, error);
        }
      }

      console.log("[HealthCheck] Done.");
    },
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[HealthCheck] Job ${job?.id} failed:`, err.message);
  });

  globalForHealthCheckWorker.healthCheckWorker = worker;
  return worker;
}

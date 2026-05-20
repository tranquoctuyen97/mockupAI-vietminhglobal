import { startTripleWhaleSyncWorker } from "./src/lib/jobs/workers/triple-whale-sync-worker";
import { startMockupCompositeWorker } from "./src/lib/mockup/worker";

console.log("Starting BullMQ workers...");

const mockupWorker = startMockupCompositeWorker();
const tripleWhaleSyncWorker = startTripleWhaleSyncWorker();

mockupWorker.on("ready", () => {
  console.log("Mockup Worker is ready and listening to queue!");
});

tripleWhaleSyncWorker.on("ready", () => {
  console.log("Triple Whale Sync Worker is ready and listening to queue!");
});

process.on("SIGINT", async () => {
  console.log("Shutting down workers...");
  await Promise.all([mockupWorker.close(), tripleWhaleSyncWorker.close()]);
  process.exit(0);
});

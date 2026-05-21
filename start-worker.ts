import { startTripleWhaleSyncWorker } from "./src/lib/jobs/workers/triple-whale-sync-worker";
import { startPrintifyMockupPollWorker } from "./src/lib/mockup/printify-poll-worker";
import { startMockupCompositeWorker } from "./src/lib/mockup/worker";

console.log("Starting BullMQ workers...");

const mockupWorker = startMockupCompositeWorker();
const printifyMockupPollWorker = startPrintifyMockupPollWorker();
const tripleWhaleSyncWorker = startTripleWhaleSyncWorker();

mockupWorker.on("ready", () => {
  console.log("Mockup composite worker is ready and listening to queue.");
});

printifyMockupPollWorker.on("ready", () => {
  console.log("Printify mockup poll worker is ready and listening to queue.");
});

tripleWhaleSyncWorker.on("ready", () => {
  console.log("Triple Whale sync worker is ready and listening to queue.");
});

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    mockupWorker.close(),
    printifyMockupPollWorker.close(),
    tripleWhaleSyncWorker.close(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown().catch((error) => {
    console.error("Worker shutdown failed:", error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown().catch((error) => {
    console.error("Worker shutdown failed:", error);
    process.exit(1);
  });
});

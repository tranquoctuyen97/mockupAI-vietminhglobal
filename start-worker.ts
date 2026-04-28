import { mockupWorker } from "./src/lib/mockup/worker";

console.log("Starting BullMQ Mockup Worker...");

mockupWorker.on("ready", () => {
  console.log("Mockup Worker is ready and listening to queue!");
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down worker...');
  await mockupWorker.close();
  process.exit(0);
});

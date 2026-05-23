import dotenv from "dotenv";
import type { Worker } from "bullmq";

type ClosableWorker = Pick<Worker, "close" | "on">;

let mockupWorker: ClosableWorker | null = null;
let printifyMockupPollWorker: ClosableWorker | null = null;
let tripleWhaleSyncWorker: ClosableWorker | null = null;

loadStandaloneWorkerEnv();

console.log("Starting BullMQ workers...");

startWorkers().catch((error) => {
  console.error("Worker startup failed:", error);
  process.exit(1);
});

function loadStandaloneWorkerEnv() {
  dotenv.config({ path: ".env" });

  if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: ".env.local", override: true });
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the standalone worker process.");
  }
}

async function startWorkers() {
  const [{ startMockupCompositeWorker }, { startPrintifyMockupPollWorker }, { startTripleWhaleSyncWorker }] =
    await Promise.all([
      import("./src/lib/mockup/worker"),
      import("./src/lib/mockup/printify-poll-worker"),
      import("./src/lib/jobs/workers/triple-whale-sync-worker"),
    ]);

  mockupWorker = startMockupCompositeWorker();
  printifyMockupPollWorker = startPrintifyMockupPollWorker();
  tripleWhaleSyncWorker = startTripleWhaleSyncWorker();

  mockupWorker.on("ready", () => {
    console.log("Mockup composite worker is ready and listening to queue.");
  });

  printifyMockupPollWorker.on("ready", () => {
    console.log("Printify mockup poll worker is ready and listening to queue.");
  });

  tripleWhaleSyncWorker.on("ready", () => {
    console.log("Triple Whale sync worker is ready and listening to queue.");
  });
}

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    mockupWorker?.close(),
    printifyMockupPollWorker?.close(),
    tripleWhaleSyncWorker?.close(),
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

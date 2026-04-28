/**
 * Mockup Generation Worker — BullMQ
 * Phase 6.11: New Composite Worker
 */

import { mockupWorker } from "@/lib/mockup/worker";
import { startPrintifyMockupPollWorker } from "@/lib/mockup/printify-poll-worker";

export function startMockupWorker() {
  console.log("[MockupWorker] Ensuring workers are started via instrumentation.");
  return {
    mockupWorker,
    printifyMockupPollWorker: startPrintifyMockupPollWorker(),
  };
}

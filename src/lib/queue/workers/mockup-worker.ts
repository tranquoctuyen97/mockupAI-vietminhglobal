/**
 * Mockup Generation Worker — BullMQ
 * Phase 6.11: New Composite Worker
 */

import { startPrintifyMockupPollWorker } from "@/lib/mockup/printify-poll-worker";
import { startMockupCompositeWorker } from "@/lib/mockup/worker";

export function startMockupWorker() {
  console.log("[MockupWorker] Ensuring workers are started via instrumentation.");
  return {
    mockupWorker: startMockupCompositeWorker(),
    printifyMockupPollWorker: startPrintifyMockupPollWorker(),
  };
}

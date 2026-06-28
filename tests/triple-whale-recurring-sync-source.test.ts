import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale recurring sync dispatcher", () => {
  it("schedules one 30-minute dispatcher and filters due credentials by configured interval", () => {
    const queueSource = readFileSync(join(process.cwd(), "src/lib/triple-whale/queue.ts"), "utf8");
    const workerSource = readFileSync(join(process.cwd(), "src/lib/jobs/workers/triple-whale-sync-worker.ts"), "utf8");

    expect(queueSource).toContain("TRIPLE_WHALE_SYNC_DISPATCHER_INTERVAL_MS = 30 * 60 * 1000");
    expect(queueSource).toContain("scheduleTripleWhaleSyncDispatcher");
    expect(queueSource).toContain("dispatchDueTripleWhaleSyncs");
    expect(queueSource).toContain("syncIntervalMinutes");
    expect(workerSource).toContain("dispatch-due-triple-whale-syncs");
    expect(workerSource).toContain("dispatchDueTripleWhaleSyncs()");
  });
});

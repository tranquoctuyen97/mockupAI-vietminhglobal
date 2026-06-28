import { describe, expect, it, vi } from "vitest";
import {
  enqueueGmailLabelOperation,
  enqueueMailboxSync,
  MAILBOX_SYNC_POLL_INTERVAL_MS,
  MAILBOX_SYNC_SCHEDULER_JOB_ID,
  scheduleMailboxSyncDispatcher,
} from "../src/lib/mailboxes/queue";

describe("mailbox queue contracts", () => {
  it("dedupes mailbox sync jobs by mailbox while keeping per-operation label jobs deduped", async () => {
    const syncQueue = { add: vi.fn() };
    const labelQueue = { add: vi.fn() };

    await enqueueMailboxSync("mailbox-1", syncQueue as never);
    await enqueueMailboxSync("mailbox-1", syncQueue as never);
    await enqueueGmailLabelOperation("op-1", labelQueue as never);

    const firstSyncOptions = syncQueue.add.mock.calls[0]?.[2];
    const secondSyncOptions = syncQueue.add.mock.calls[1]?.[2];
    expect(firstSyncOptions.jobId).toBe("sync-mailbox-1");
    expect(secondSyncOptions.jobId).toBe("sync-mailbox-1");
    expect(syncQueue.add).toHaveBeenNthCalledWith(
      1,
      "sync-mailbox",
      { mailboxId: "mailbox-1" },
      expect.objectContaining({
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
    expect(labelQueue.add).toHaveBeenCalledWith(
      "gmail-label-operation",
      { operationId: "op-1" },
      expect.objectContaining({
        jobId: "label-op-1",
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
      }),
    );
  });

  it("uses one repeat dispatcher every minute", async () => {
    const queue = { add: vi.fn() };
    await scheduleMailboxSyncDispatcher(queue as never);
    expect(queue.add).toHaveBeenCalledWith(
      "dispatch-active-mailboxes",
      {},
      expect.objectContaining({
        jobId: MAILBOX_SYNC_SCHEDULER_JOB_ID,
        repeat: { every: MAILBOX_SYNC_POLL_INTERVAL_MS },
      }),
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  GMAIL_LABEL_OPERATIONS_WORKER_CONCURRENCY,
  MAILBOX_SYNC_WORKER_CONCURRENCY,
  MAILBOX_SYNC_WORKER_LOCK_DURATION_MS,
  serializeSyncMailboxResult,
} from "../src/lib/jobs/workers/mailbox-sync-worker";

describe("mailbox sync worker", () => {
  it("serializes sync results without BigInt values for BullMQ", () => {
    const result = serializeSyncMailboxResult({
      mailboxId: "mailbox-1",
      skipped: false,
      imported: 1,
      inherited: 0,
      lastCommittedUid: BigInt(42),
      nested: { uid: BigInt(101) },
    } as Parameters<typeof serializeSyncMailboxResult>[0] & { nested: { uid: bigint } });

    expect(result).toEqual({
      mailboxId: "mailbox-1",
      skipped: false,
      imported: 1,
      inherited: 0,
      lastCommittedUid: "42",
      nested: { uid: "101" },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("uses conservative defaults for long-running mailbox sync jobs", () => {
    expect(MAILBOX_SYNC_WORKER_CONCURRENCY).toBe(1);
    expect(MAILBOX_SYNC_WORKER_LOCK_DURATION_MS).toBeGreaterThanOrEqual(900_000);
    expect(GMAIL_LABEL_OPERATIONS_WORKER_CONCURRENCY).toBeLessThanOrEqual(2);
  });
});

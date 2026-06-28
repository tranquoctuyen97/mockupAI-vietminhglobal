import { describe, expect, it } from "vitest";
import { serializeSyncMailboxResult } from "../src/lib/jobs/workers/mailbox-sync-worker";

describe("mailbox sync worker", () => {
  it("serializes sync results without BigInt values for BullMQ", () => {
    const result = serializeSyncMailboxResult({
      mailboxId: "mailbox-1",
      skipped: false,
      imported: 1,
      inherited: 0,
      lastCommittedUid: BigInt(42),
    });

    expect(result).toEqual({
      mailboxId: "mailbox-1",
      skipped: false,
      imported: 1,
      inherited: 0,
      lastCommittedUid: "42",
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

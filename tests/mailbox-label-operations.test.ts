import { describe, expect, it } from "vitest";
import {
  assertUserLabelName,
  labelOperationIdempotencyKey,
  normalizeGmailLabelName,
} from "../src/lib/mailboxes/labels";

describe("mailbox label operations", () => {
  it("normalizes labels only for uniqueness", () => {
    expect(normalizeGmailLabelName(" Support/Tier 1 ")).toBe("support/tier 1");
  });

  it("rejects system labels for user CRUD", () => {
    expect(() => assertUserLabelName("Support/Tier 1")).not.toThrow();
    expect(() => assertUserLabelName("Inbox")).toThrow("gmail_system_label_read_only");
    expect(() => assertUserLabelName("\\Important")).toThrow("gmail_system_label_read_only");
  });

  it("builds stable idempotency keys per mailbox and request", () => {
    const base = {
      mailboxId: "mailbox-a",
      conversationId: "conversation-1",
      type: "ASSIGN" as const,
      labelId: "label-1",
      desiredPayload: { labelIds: ["label-1"] },
      requestId: "client-request-1",
    };
    expect(labelOperationIdempotencyKey(base)).toBe(labelOperationIdempotencyKey(base));
    expect(labelOperationIdempotencyKey({ ...base, mailboxId: "mailbox-b" })).not.toBe(labelOperationIdempotencyKey(base));
  });
});

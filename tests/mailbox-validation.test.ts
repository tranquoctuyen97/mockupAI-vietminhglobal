import { describe, expect, it } from "vitest";
import {
  createLabelSchema,
  createMailboxSchema,
  renameLabelSchema,
  replaceConversationLabelsSchema,
  replySchema,
  statusSchema,
  updateMailboxSchema,
} from "../src/lib/mailboxes/validation";

describe("Gmail mailbox validation", () => {
  const create = { storeId: "store-1", name: "Support", email: "support@example.com", appPassword: "secret" };

  it("accepts only the Gmail mailbox contract", () => {
    expect(createMailboxSchema.parse(create)).toEqual(create);
    for (const extra of ["provider", "inbound", "outbound", "assignments", "importMode", "historyWindowMonths"]) {
      expect(createMailboxSchema.safeParse({ ...create, [extra]: "nope" }).success).toBe(false);
    }
  });

  it("does not allow mailbox ownership or email to move on update", () => {
    expect(updateMailboxSchema.parse({ name: "New", fromName: "Team", appPassword: "replacement" })).toBeTruthy();
    expect(updateMailboxSchema.safeParse({ email: "other@example.com" }).success).toBe(false);
    expect(updateMailboxSchema.safeParse({ storeId: "store-2" }).success).toBe(false);
  });

  it("validates label, reply and status operations strictly", () => {
    const scope = { storeId: "store-1", mailboxId: "mailbox-1" };
    expect(createLabelSchema.parse({ ...scope, name: "Support/Test" })).toBeTruthy();
    expect(renameLabelSchema.parse({ ...scope, name: "Support/Renamed" })).toBeTruthy();
    expect(replaceConversationLabelsSchema.parse({ ...scope, labelIds: ["a", "b"] })).toBeTruthy();
    expect(replySchema.parse({ text: "hello" })).toEqual({ text: "hello" });
    expect(replySchema.safeParse({ text: "" }).success).toBe(false);
    expect(replySchema.safeParse({ text: "x".repeat(50_001) }).success).toBe(false);
    expect(statusSchema.parse({ status: "pending" })).toEqual({ status: "pending" });
    expect(statusSchema.safeParse({ status: "deleted" }).success).toBe(false);
  });
});

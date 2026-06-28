import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RT Gmail mailbox Prisma schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  it("defines the mailbox synchronization models", () => {
    expect(schema).toMatch(/enum MailboxSyncStatus/);
    expect(schema).toMatch(/enum GmailLabelOperationState/);
    expect(schema).toMatch(/model MailboxSyncCursor/);
    expect(schema).toMatch(/model GmailLabel/);
    expect(schema).toMatch(/model MailboxConversation/);
    expect(schema).toMatch(/model GmailMessageLink/);
    expect(schema).toMatch(/model ConversationLabel/);
    expect(schema).toMatch(/model GmailLabelOperation/);
  });

  it("stores encrypted Gmail credentials and server-owned RT identifiers", () => {
    expect(schema).toMatch(/rtQueueId\s+Int\?/);
    expect(schema).toMatch(/appPasswordEncrypted\s+Bytes/);
    expect(schema).toMatch(/encryptionKeyId\s+String/);
    expect(schema).toMatch(/initialSyncAfter\s+DateTime/);
    expect(schema).toMatch(/@@unique\(\[tenantId, email\]\)/);
  });

  it("removes legacy user mappings and external identifiers", () => {
    const legacyUserModel = ["model ", "Zam", "madUser"].join("");
    const legacyAccessModel = ["model User", "MailboxAccess"].join("");
    const legacyGroupField = ["zam", "madGroupId"].join("");
    const legacyChannelField = ["zam", "madChannelId"].join("");

    expect(schema).not.toContain(legacyUserModel);
    expect(schema).not.toContain(legacyAccessModel);
    expect(schema).not.toContain(legacyGroupField);
    expect(schema).not.toContain(legacyChannelField);
  });
});

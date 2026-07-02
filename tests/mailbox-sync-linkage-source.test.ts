import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox sync verified-linkage contract", () => {
  it("commits Inbox UIDs after creating Gmail-only conversations", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    expect(source).toContain("gmailOnly += 1");
    expect(source).toContain("return message.uid");
    expect(source).not.toContain("if (!link.rtTicketId || !link.rtTransactionId) return null");
  });

  it("enqueues inherited label operations and the scheduler recovers orphaned pending operations", () => {
    const syncSource = readFileSync("src/lib/mailboxes/sync.ts", "utf8");
    const queueSource = readFileSync("src/lib/mailboxes/queue.ts", "utf8");

    expect(syncSource).toContain("enqueueGmailLabelOperation(operationId)");
    expect(queueSource).toContain('where: { state: "PENDING" }');
    expect(queueSource).toContain("recoveredLabelOperations");
  });

  it("pre-indexes metadata, runs getmail, then reconciles verified RT linkage", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    const firstPersist = source.indexOf("const indexed = await deps.persist");
    const runGetmail = source.indexOf("await deps.runGetmail(configPath)");
    const secondPersist = source.indexOf("const reconciled = await deps.persist");
    expect(firstPersist).toBeGreaterThan(-1);
    expect(runGetmail).toBeGreaterThan(firstPersist);
    expect(secondPersist).toBeGreaterThan(runGetmail);
  });

  it("uses an atomic DB lease and always releases the owning lease", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    expect(source).toContain("mailboxSyncCursor.updateMany");
    expect(source).toContain("leaseExpiresAt: { lt: new Date() }");
    expect(source).toContain("await deps.releaseLease(mailbox.id, leaseOwner)");
  });

  it("distinguishes permanent credential/configuration errors from retryable dependency failures", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    expect(source).toContain("isPermanentSyncError(code)");
    expect(source).toContain('"gmail_auth_failed"');
    expect(source).not.toContain('"getmail_delivery_failed",\n    "gmail_extension_missing"');
  });

  it("discovers Gmail labels per mailbox while protecting in-flight app CRUD operations", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    expect(source).toContain("await deps.discoverLabels");
    expect(source).toContain("await deps.persistLabelCatalog(mailbox.id, discoveredLabels)");
    expect(source).toContain("protectedNames");
    expect(source).toContain('type: { in: ["CREATE", "RENAME", "DELETE"] }');
  });

  it("maps labels observed on Inbox messages and mirrors labels to RT only when available", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    expect(source).toContain("message.labels.map(normalizeObservedLabel)");
    expect(source).toContain("tx.conversationLabel.upsert");
    expect(source).toContain("conversation.rtTicketId == null");
    expect(source).toContain("setTicketGmailLabels(");
    expect(source).toContain('"rt_label_sync_failed"');
  });

  it("preserves list snapshot fields while syncing Gmail metadata", () => {
    const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

    expect(source).toContain("subject:");
    expect(source).toContain("articleCount");
    expect(source).toContain("lastActivityAt");
  });
});

describe("mailbox label mutation targeting", () => {
  it("renames from the persisted old name and only mutates Inbox-side inbound UIDs", () => {
    const source = readFileSync("src/lib/mailboxes/labels.ts", "utf8");

    expect(source).toContain('operation.type === "RENAME"');
    expect(source).toContain('String(payload.labelName ?? "")');
    expect(source).toContain('message.direction === "INBOUND"');
  });

  it("mirrors confirmed labels to RT outside the Prisma transaction", () => {
    const source = readFileSync("src/lib/mailboxes/labels.ts", "utf8");
    const transactionStart = source.indexOf("return prisma.$transaction");
    const transactionEnd = source.indexOf("function safeLabelErrorCode");
    const transactionBody = source.slice(transactionStart, transactionEnd);

    expect(source).toContain("const rtUpdate = await confirmOperationInDb");
    expect(source).toContain("await setTicketGmailLabels(rtUpdate.ticketId, rtUpdate.names)");
    expect(transactionBody).not.toContain("await setTicketGmailLabels");
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("mailbox sync reconnects orphan Gmail links to RT conversations", () => {
  const source = readFileSync("src/lib/mailboxes/sync.ts", "utf8");

  assert.match(source, /findMailgateIdentity/);
  assert.match(source, /RECENT_ORPHAN_BACKFILL_LIMIT.*20_000/);
  assert.match(source, /function backfillRecentOrphanLinks/);
  assert.match(source, /parseEmailIdentity/);
  assert.match(source, /fetchInboxByUids/);
  assert.match(source, /isUnread:\s*gmailUnread/);
  assert.match(source, /senderEmail:\s*senderEmail/);
  assert.match(source, /conversationId:\s*null/);
  assert.match(source, /type:\s*"INBOX"/);
  assert.match(source, /function findMessageConversation/);
  assert.match(source, /Number\(right\.uid - left\.uid\)/);
  assert.match(source, /committedUid && committedUid > lastCommittedUid/);
  assert.match(source, /!link\.conversationId \|\| !link\.rtTicketId \|\| !link\.rtTransactionId/);
  assert.match(source, /rtTransactionId:\s*mailgateIdentity\?\.transactionId/);
});

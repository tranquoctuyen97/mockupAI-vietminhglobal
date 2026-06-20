import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(path, "utf8");
}

test("mailbox schema is store-owned", () => {
  const source = read("prisma/schema.prisma");
  assert.match(source, /model Mailbox\s*\{[\s\S]*tenantId\s+String\s+@map\("tenant_id"\)[\s\S]*storeId\s+String\s+@map\("store_id"\)[\s\S]*store\s+Store\s+@relation\(/);
  assert.match(source, /Store\s+\{[\s\S]*mailboxes\s+Mailbox\[\]/);
  assert.match(source, /Tenant\s+\{[\s\S]*mailboxes\s+Mailbox\[\]/);
});

test("admin validation removes importMode and keeps the schema strict", () => {
  const source = read("src/lib/zammad/admin-validation.ts");
  assert.match(source, /MAILBOX_HISTORY_WINDOW_MONTHS\s*=\s*6/);
  assert.match(source, /createMailboxSchema[\s\S]*storeId/);
  assert.doesNotMatch(source, /importMode/);
  assert.doesNotMatch(source, /all_archive/);
  assert.doesNotMatch(source, /new_only/);
  assert.doesNotMatch(source, /historyWindowMonths/);
});

test("admin create route requires storeId and uses the fixed history policy", () => {
  const source = read("src/app/api/admin/mailboxes/route.ts");
  assert.match(source, /storeId/);
  assert.match(source, /MAILBOX_HISTORY_WINDOW_MONTHS/);
  assert.doesNotMatch(source, /assignments/);
});

test("admin and operator UIs are store-first", () => {
  const adminPage = read("src/app/(authed)/admin/mailboxes/page.tsx");
  const adminClient = read("src/app/(authed)/admin/mailboxes/CreateMailboxModal.tsx");
  const inboxPage = read("src/app/(authed)/mailboxes/page.tsx");
  const inboxClient = read("src/app/(authed)/mailboxes/MailboxesClient.tsx");

  assert.match(adminPage, /searchParams:\s*Promise<\{/);
  assert.match(adminPage, /storeId/);
  assert.match(adminClient, /fixed six-month/i);
  assert.doesNotMatch(adminClient, /importMode/);
  assert.match(inboxPage, /searchParams:\s*Promise<\{/);
  assert.match(inboxClient, /storeId/);
  assert.match(inboxClient, /router\.replace\(.+\?storeId=/s);
});

test("operator proxy requires storeId on all mailbox actions", () => {
  const source = read("src/app/api/mailbox-proxy/[...path]/route.ts");
  assert.match(source, /storeId/);
  assert.doesNotMatch(source, /getAllowedMailboxIds/);
  assert.doesNotMatch(source, /getMailboxAccess/);
});

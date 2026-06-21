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
  // GET requires storeId query param
  assert.match(source, /searchParams\.get\("storeId"\)/);
  // POST validates store and saves tenantId + storeId
  assert.match(source, /validateStore\(input\.storeId/);
  assert.match(source, /tenantId:\s*session\.tenantId/);
  assert.match(source, /storeId:\s*input\.storeId/);
});

test("admin detail route verifies tenant ownership", () => {
  const source = read("src/app/api/admin/mailboxes/[id]/route.ts");
  assert.match(source, /tenantId:\s*session\.tenantId/);
  assert.doesNotMatch(source, /assignedUsers/);
  assert.doesNotMatch(source, /userMailboxAccess/);
  assert.match(source, /select:\s*\{\s*id:\s*true/);
  assert.match(source, /name:\s*true/);
});

test("admin status route verifies tenant ownership", () => {
  const source = read("src/app/api/admin/mailboxes/[id]/status/route.ts");
  assert.match(source, /tenantId:\s*session\.tenantId/);
  assert.match(source, /storeId:\s*mailbox\.storeId/);
});

test("assignments route returns 410 Gone", () => {
  const source = read("src/app/api/admin/mailboxes/[id]/assignments/route.ts");
  assert.match(source, /410/);
  assert.match(source, /deprecated/i);
});

test("admin page has store selector with no auto-select", () => {
  const adminPage = read("src/app/(authed)/admin/mailboxes/page.tsx");
  assert.match(adminPage, /selectedStoreId/);
  assert.match(adminPage, /-- Chọn store --/);
  assert.match(adminPage, /storeId=\$\{encodeURIComponent\(selectedStoreId\)\}/);
  assert.match(adminPage, /Chọn store để xem mailbox/);
  // No auto-select
  assert.doesNotMatch(adminPage, /setSelectedStoreId\(stores\[0\]/);
});

test("admin create modal receives storeId and removes importMode", () => {
  const source = read("src/app/(authed)/admin/mailboxes/CreateMailboxModal.tsx");
  assert.match(source, /storeId/);
  assert.doesNotMatch(source, /importMode/);
  assert.doesNotMatch(source, /all_archive/);
  assert.doesNotMatch(source, /Chế độ nhận email/);
});

test("admin mailbox list has no users column or assign action", () => {
  const source = read("src/app/(authed)/admin/mailboxes/MailboxList.tsx");
  assert.doesNotMatch(source, /Users/);
  assert.doesNotMatch(source, /onAssign/);
  assert.doesNotMatch(source, /users/i);
});

test("operator page fetches stores for store selector", () => {
  const page = read("src/app/(authed)/mailboxes/page.tsx");
  assert.match(page, /store\.findMany/);
  assert.match(page, /stores=\{/);
  // No per-user mailbox access
  assert.doesNotMatch(page, /UserMailboxAccess/);
  assert.doesNotMatch(page, /user assignment/i);
});

test("operator client requires storeId on all proxy calls", () => {
  const source = read("src/app/(authed)/mailboxes/MailboxesClient.tsx");
  assert.match(source, /storeId/);
  assert.match(source, /storeId=\$\{encodeURIComponent\(selectedStoreId\)\}/);
  assert.match(source, /Chọn store để xem mailbox/);
  // No auto-select
  assert.doesNotMatch(source, /setSelectedMailbox\(mailboxes\[0\]\)/);
  assert.doesNotMatch(source, /Bạn chưa được assign vào mailbox nào/);
  // Store-based empty state
  assert.match(source, /Store này chưa có mailbox nào đang hoạt động/);
});

test("operator proxy requires storeId on all mailbox actions", () => {
  const source = read("src/app/api/mailbox-proxy/[...path]/route.ts");
  assert.match(source, /storeId/);
  assert.match(source, /extractStoreId/);
  assert.doesNotMatch(source, /getAllowedMailboxIds/);
  assert.doesNotMatch(source, /getMailboxAccess/);
  assert.doesNotMatch(source, /canReply/);
  assert.doesNotMatch(source, /canUpdateStatus/);
  assert.match(source, /requireActiveStoreMailbox/);
  assert.match(source, /listStoreMailboxes/);
});

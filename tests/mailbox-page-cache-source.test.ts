import { readFileSync } from "node:fs";

describe("mailbox page cache source", () => {
  const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");

  it("keys cached pages by store, mailbox, label, page, and page size", () => {
    expect(source).toContain("conversationPageCacheRef");
    expect(source).toContain("conversationPageCacheKey");
    expect(source).toContain("selectedStoreId");
    expect(source).toContain("selectedMailbox?.id");
    expect(source).toContain("effectiveSelectedLabelId");
    expect(source).toContain("currentPage");
    expect(source).toContain("pageSize");
  });

  it("renders cached pages before fetching and refreshes cache after fetch", () => {
    expect(source).toContain("conversationPageCacheRef.current.get(cacheKey)");
    expect(source).toContain("setConversations(cached.conversations)");
    expect(source).toContain("conversationPageCacheRef.current.set(cacheKey");
  });

  it("clears cache after mailbox writes and filter changes", () => {
    expect(source).toContain("clearConversationPageCache");
    expect(source).toContain("clearConversationPageCache();");
  });
});

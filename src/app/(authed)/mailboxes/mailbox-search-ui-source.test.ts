import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox conversation search UI source", () => {
  const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");

  it("debounces the search query into a committed value", () => {
    expect(source).toContain('const [searchQuery, setSearchQuery] = useState("")');
    expect(source).toContain('const [debouncedQuery, setDebouncedQuery] = useState("")');
    expect(source).toContain("setTimeout(() => setDebouncedQuery(searchQuery), 350)");
    expect(source).toContain("const searchActive = debouncedQuery.trim().length > 0");
  });

  it("sends q instead of labelId while searching and bypasses the label-required guard", () => {
    expect(source).toContain("if (!searchActive && labels.length > 0 && !effectiveSelectedLabelId) return;");
    expect(source).toContain('qs.set("q", debouncedQuery.trim())');
  });

  it("includes the query in the conversation page cache key", () => {
    expect(source).toContain('searchActive ? `q:${debouncedQuery.trim()}` : (effectiveSelectedLabelId ?? "")');
  });

  it("resets to page 1 when the committed query changes", () => {
    expect(source).toContain("setCurrentPage(1);\n  }, [debouncedQuery]);");
  });

  it("clears search when switching store, mailbox, or label", () => {
    expect(source).toContain('setSelectedMailbox(null);\n    setSearchQuery("");');
    expect(source).toContain('setDebouncedQuery("");\n    const mailbox = mailboxes.find');
    expect(source).toContain("setSelectedLabelId(labelId);\n                setSearchQuery(\"\");");
  });

  it("renders a bounded rounded search bar below the store switcher", () => {
    expect(source).toContain('placeholder="Search subject or content..."');
    expect(source).toContain("value={searchQuery}");
    expect(source).toContain("onChange={(event) => setSearchQuery(event.target.value)}");
    expect(source).toContain("aria-label=\"Clear search\"");
    expect(source).toContain('width: "min(100%, 1060px)"');
    expect(source).toContain("borderRadius: 999");
  });

  it("hides the active label highlight and relabels the list while searching", () => {
    expect(source).toContain("selectedLabelId={searchActive ? null : effectiveSelectedLabelId}");
    expect(source).toContain('title={searchActive ? `Search results for "${debouncedQuery.trim()}"` : conversationListTitle}');
    expect(source).toContain("total={searchActive ? totalConversations : (isInboxView ? null : totalConversations)}");
  });
});

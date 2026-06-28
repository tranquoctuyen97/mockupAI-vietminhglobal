import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");

describe("mailbox label UI source contract", () => {
  it("auto-selects the first active mailbox and scopes label requests to string app mailbox IDs", () => {
    expect(source).toContain("mailboxId: selectedMailbox.id");
    expect(source).toContain("if (!current) return activeMailboxes[0]");
    expect(source).toContain("selectedMailbox.email");
  });

  it("supports user label CRUD, filtering, pending states and replace-style conversation saves", () => {
    expect(source).toContain("renameLabel");
    expect(source).toContain("deleteLabel");
    expect(source).toContain("conversationCount");
    expect(source).toContain('label.state.startsWith("PENDING")');
    expect(source).toContain('qs.set("labelId", selectedLabelId)');
    expect(source).toContain("labelIds: conversationLabelIds");
    expect(source).toContain('"Save labels"');
  });

  it("styles unread conversations distinctly from read rows", () => {
    expect(source).toContain("const unread = conversation.unread ?? false");
    expect(source).toContain("borderLeft: unread ? \"3px solid #84cc16\" : \"3px solid transparent\"");
    expect(source).toContain("fontWeight: unread ? 900 : 600");
  });

  it("uses a popup action and label menu and lets the detail panel consume remaining width", () => {
    expect(source).toContain('gridTemplateColumns: "220px minmax(360px, 38vw) minmax(560px, 1fr)"');
    expect(source).toContain("const [labelMenuOpen, setLabelMenuOpen] = useState(false)");
    expect(source).toContain("const visibleLabelChips = conversationLabels.slice(0, 2)");
    expect(source).toContain("Mark as unread");
    expect(source).toContain("Report spam");
    expect(source).toContain("labelMenuTitle");
    expect(source).toContain("Search labels");
    expect(source).toContain('zIndex: 30');
  });
});

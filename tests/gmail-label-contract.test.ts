import { describe, expect, it, vi } from "vitest";
import { createGmailAdapter } from "../src/lib/mailboxes/gmail-client";

describe("Gmail label catalog", () => {
  it("shows user labels plus the three allowed read-only system labels", async () => {
    const client = {
      capabilities: new Map([["X-GM-EXT-1", true]]), connect: vi.fn(), logout: vi.fn(),
      list: vi.fn().mockResolvedValue([
        { path: "INBOX", specialUse: "\\Inbox" },
        { path: "[Gmail]/Important", specialUse: "\\Important" },
        { path: "[Gmail]/Starred", specialUse: "\\Flagged" },
        { path: "[Gmail]/Spam", specialUse: "\\Junk" },
        { path: "[Gmail]/Trash", specialUse: "\\Trash" },
        { path: "[Gmail]/Sent Mail", specialUse: "\\Sent" },
        { path: "[Gmail]/All Mail", specialUse: "\\All" },
        { path: "Support/Tier 1" },
      ]),
    };
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);
    const labels = await adapter.listVisibleLabels();
    expect(labels.map((label) => label.name)).toEqual(["INBOX", "IMPORTANT", "STARRED", "Support/Tier 1"]);
    expect(labels.slice(0, 3).every((label) => !label.mutable)).toBe(true);
    expect(labels[3]).toMatchObject({ normalizedName: "support/tier 1", type: "USER", mutable: true });
  });

  it("delegates user label CRUD with exact nested names", async () => {
    const client = {
      capabilities: new Map([["X-GM-EXT-1", true]]), connect: vi.fn(), logout: vi.fn(),
      mailboxCreate: vi.fn(), mailboxRename: vi.fn(), mailboxDelete: vi.fn(),
    };
    const adapter = createGmailAdapter({ email: "support@example.com", appPassword: "secret" }, () => client as never);
    await adapter.createLabel("Support/Tier 1");
    await adapter.renameLabel("Support/Tier 1", "Support/Tier 2");
    await adapter.deleteLabel("Support/Tier 2");
    expect(client.mailboxCreate).toHaveBeenCalledWith("Support/Tier 1");
    expect(client.mailboxRename).toHaveBeenCalledWith("Support/Tier 1", "Support/Tier 2");
    expect(client.mailboxDelete).toHaveBeenCalledWith("Support/Tier 2");
  });
});

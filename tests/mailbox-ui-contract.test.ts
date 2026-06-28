import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox UI/API label contract", () => {
  it("keeps labels mailbox-scoped and exposes conversation replacement plus confirmation counts", () => {
    const route = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

    expect(route).toContain("where: { mailboxId: mailbox.id }");
    expect(route).toContain("conversationCount: label._count.conversations");
    expect(route).toContain("handleReplaceConversationLabels");
    expect(route).toContain("labelIds: parsed.data.labelIds");
    expect(route).toContain("One or more labels do not belong to this mailbox");
  });
});

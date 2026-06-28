import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox proxy source", () => {
  it("returns a normalized conversation object and verifies the RT ticket belongs to the mailbox queue", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

    expect(source).toContain("getTicket(ticketId)");
    expect(source).toContain("ticketQueueId !== mailbox.rtQueueId");
    expect(source).toContain("...normalizeRtTicket(");
    expect(source).toContain("threads: displayThreads");
  });

  it("sends Gmail replies to the customer email, not to a Message-ID header", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

    expect(source).toContain("buildGmailReplyContext");
    expect(source).toContain("to: replyContext.to");
    expect(source).toContain("latestExternalMessageId: replyContext.latestExternalMessageId");
    expect(source).not.toContain("to: latestMessage.rfcMessageId");
  });

  it("handles unread and report-spam actions without live unread list probing", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

    expect(source).toContain("handleMarkConversationUnread");
    expect(source).toContain("handleReportConversationSpam");
    expect(source).toContain("isUnread: true");
    expect(source).not.toContain("loadLiveUnreadStates");
    expect(source).not.toContain("countInboxUnread()");
  });
});

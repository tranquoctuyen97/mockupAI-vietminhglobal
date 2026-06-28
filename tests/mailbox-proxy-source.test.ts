import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function functionBody(source: string, name: string) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("mailbox proxy source", () => {
  it("returns a normalized conversation object and verifies the RT ticket belongs to the mailbox queue", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

    expect(source).toContain("getTicket(ticketId)");
    expect(source).toContain("ticketQueueId !== mailbox.rtQueueId");
    expect(source).toContain("...normalizeRtTicket(");
    expect(source).toContain("threads: mergedThreads");
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

  it("implements skip sender as an app-side rule plus current thread spam", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
    const body = functionBody(source, "handleSkipSender");

    expect(source).toContain("/skip-sender");
    expect(body).toContain("mailboxSkippedSender.upsert");
    expect(body).toContain("reportThreadSpam");
    expect(body).toContain("mailbox.skip_sender");
    expect(body).toContain("senderEmail");
    expect(body).not.toContain("Skip sender requires Gmail");
    expect(body).not.toContain("gmail_filter_requires_oauth");
  });

  it("updates list snapshots when app-owned actions change a conversation", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

    expect(functionBody(source, "handleReply")).toContain("articleCount");
    expect(functionBody(source, "handleReply")).toContain("rtLastUpdatedAt");
    expect(functionBody(source, "handleStatusUpdate")).toContain("rtStatus");
    expect(functionBody(source, "handleMarkConversationRead")).toContain("isUnread: false");
    expect(functionBody(source, "handleMarkConversationUnread")).toContain("isUnread: true");
    expect(functionBody(source, "handleReportConversationSpam")).toContain("isUnread: false");
  });
});

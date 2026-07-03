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

    expect(source).toContain("parseConversationToken");
    expect(source).toContain('raw.startsWith("gmail:")');
    expect(source).toContain("normalizeMailboxConversationListRow(conversation)");
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

  it("allows Gmail-only conversations to reply without an RT ticket route", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
    const body = functionBody(source, "handleReply");

    expect(source).toContain('proxyPath.match(/^\\/conversations\\/([^/]+)\\/threads$/)');
    expect(source).toContain("return handleReply(request, session.tenantId, session.id, replyMatch[1])");
    expect(body).toContain("const token = parseConversationToken(conversationToken)");
    expect(body).toContain("where: conversationWhere(mailbox.id, token)");
    expect(body).toContain("if (conversation.rtTicketId != null)");
    expect(body).toContain("fetchThreadMessages(conversation.gmailThreadId)");
    expect(body).toContain("rtTicketId: conversation.rtTicketId");
    expect(body).toContain("if (conversation.rtTicketId != null) {");
  });

  it("fetches Gmail-only conversation detail from All Mail and repairs articleCount", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
    const body = functionBody(source, "handleGetConversation");

    expect(body).toContain("fetchThreadMessages(conversation.gmailThreadId)");
    expect(body).toContain("messageCount !== conversation.articleCount");
    expect(body).toContain("articleCount: messageCount");
    expect(source).toContain("function normalizeGmailThreadMessage");
    expect(source).toContain("displayType: fromEmail === mailboxEmail ? \"app_reply\" as const : \"email\" as const");
    expect(body).not.toContain("body: link.rfcMessageId ? `Message-ID: ${link.rfcMessageId}`");
  });

  it("uses live Gmail thread messages for RT-backed conversation detail counts", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
    const body = functionBody(source, "handleGetConversation");

    expect(body).toContain("withTimeout(");
    expect(body).toContain("Gmail detail fetch timed out; falling back to RT history");
    expect(body).toContain("cachedGmailThreadMessages(mailbox.id, conversation.id, conversation.articleCount)");
    expect(body).toContain("normalizeCachedGmailThreadMessage");
    expect(body).toContain("fetchThreadMessages(conversation.gmailThreadId)");
    expect(body).toContain(": threadResult.messages.map");
    expect(body).toContain("const displayThreads = gmailThreads.length > 0 ? gmailThreads : rtDisplayThreads");
    expect(body).toContain("articleCount: messageCount > 0 ? messageCount : conversation.articleCount");
  });
});

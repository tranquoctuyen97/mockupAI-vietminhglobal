import { readFileSync } from "node:fs";

function functionBody(source: string, name: string) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("mailbox list API DB snapshot source", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
  const listBody = functionBody(source, "handleListConversations");

  it("does not call RT list or search in normal pagination", () => {
    expect(listBody).not.toContain("searchTickets(");
    expect(listBody).not.toContain("listTicketsByIds(");
  });

  it("uses DB conversation count/findMany and normalizes local rows", () => {
    expect(listBody).toContain("prisma.mailboxConversation.count");
    expect(listBody).toContain("prisma.mailboxConversation.findMany");
    expect(listBody).toContain("normalizeMailboxConversationListRow");
    expect(listBody).toContain("labels: { include: { label: true } }");
    expect(listBody).toContain("responseMetric");
  });

  it("keeps RT calls available for detail and action paths", () => {
    expect(source).toContain("getTicket(ticketId)");
    expect(source).toContain("updateTicketStatus(");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function functionBody(source: string, name: string) {
  const start = source.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nasync function ", start + 1);
  const nextSync = source.indexOf("\nfunction ", start + 1);
  const candidates = [next, nextSync].filter((index) => index !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

describe("mailbox conversation search source", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

  it("builds a mailbox-wide OR filter on subject and latest preview when q is present", () => {
    const whereBody = functionBody(source, "mailboxConversationWhere");

    expect(whereBody).toContain("q?: string");
    expect(whereBody).toContain("input.q?.trim()");
    expect(whereBody).toContain('subject: { contains: trimmedQ, mode: "insensitive"');
    expect(whereBody).toContain('latestMessagePreview: { contains: trimmedQ, mode: "insensitive"');
  });

  it("ignores status and labelId once a search query is present", () => {
    const whereBody = functionBody(source, "mailboxConversationWhere");

    expect(whereBody).toMatch(/trimmedQ\s*\?\s*\{\s*OR:/);
    expect(whereBody.indexOf("OR:")).toBeLessThan(whereBody.indexOf("input.status"));
    expect(whereBody.indexOf("OR:")).toBeLessThan(whereBody.indexOf("input.labelId"));
  });

  it("reads q from the request and forwards it to the where builder", () => {
    const listBody = functionBody(source, "handleListConversations");

    expect(listBody).toContain('url.searchParams.get("q")');
    expect(listBody).toContain("labelId: selectedLabel?.id ?? null,\n    q,");
    expect(listBody).toContain("mailboxConversationWhere({");
  });
});

import { readFileSync } from "node:fs";

describe("mailbox list snapshot rebuild script", () => {
  const source = readFileSync("scripts/rebuild-mailbox-list-snapshots.ts", "utf8");

  it("defaults to dry-run and requires --write to mutate rows", () => {
    expect(source).toContain('process.argv.includes("--write")');
    expect(source).toContain("DRY_RUN");
    expect(source).toContain("prisma.mailboxConversation.update");
  });

  it("uses RT only for repair outside the list API hot path", () => {
    expect(source).toContain("getTicket(");
    expect(source).toContain("articleCount");
    expect(source).toContain("rtLastUpdatedAt");
  });
});

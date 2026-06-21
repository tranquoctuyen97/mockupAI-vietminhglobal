import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox proxy conversation list source", () => {
  it("uses the sender identity enriched ticket search", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

    expect(source).toContain("searchTicketsWithIdentity");
    expect(source).not.toContain("const result = await searchTickets({");
  });
});

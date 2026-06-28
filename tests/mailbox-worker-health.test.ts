import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox worker health endpoint source", () => {
  const source = readFileSync("src/app/api/health/route.ts", "utf8");

  it("reports aggregate mailbox and runtime health without identity fields", () => {
    expect(source).toContain("activeCount");
    expect(source).toContain("degradedCount");
    expect(source).toContain("oldestLastSyncAt");
    expect(source).toContain("mailboxQueues");
    expect(source).toContain("rtRest2");
    expect(source).not.toMatch(/email\s*:/i);
    expect(source).not.toMatch(/RT_API_TOKEN\s*:/);
  });
});

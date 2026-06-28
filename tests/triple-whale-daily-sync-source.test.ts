import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale daily sync", () => {
  it("uses chart points from one range response instead of saving a period aggregate as one day", () => {
    const client = readFileSync(join(process.cwd(), "src/lib/triple-whale/client.ts"), "utf8");
    const sync = readFileSync(join(process.cwd(), "src/lib/triple-whale/sync.ts"), "utf8");
    const rebuild = readFileSync(join(process.cwd(), "scripts/rebuild-triple-whale-daily-stats.ts"), "utf8");

    expect(client).toContain("function metricsToRecords");
    expect(client).toContain("metric?.charts?.current");
    expect(client).toContain("return eachDay(startDate, endDate).map");
    expect(sync).toContain("startDate,");
    expect(sync).toContain("endDate: today");
    expect(sync).not.toContain("for (const day of eachDay(startDate, today))");
    expect(rebuild).toContain("deleteMany({ where: { credentialId: credential.id } })");
    expect(rebuild).toContain("syncStore(credential.id)");
  });
});

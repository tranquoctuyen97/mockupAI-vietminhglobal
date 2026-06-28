import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale sync schedule API and sync source", () => {
  it("validates create/update schedule fields and uses syncFromDate before first sync", () => {
    const createRoute = readFileSync(join(process.cwd(), "src/app/api/integrations/triple-whale/route.ts"), "utf8");
    const updateRoute = readFileSync(join(process.cwd(), "src/app/api/integrations/triple-whale/[storeId]/route.ts"), "utf8");
    const syncSource = readFileSync(join(process.cwd(), "src/lib/triple-whale/sync.ts"), "utf8");

    expect(createRoute).toContain("fetchSummaryData");
    expect(createRoute).toContain("TWAuthError");
    expect(createRoute).toContain("Invalid Triple Whale API key");
    expect(createRoute).toContain("syncFromDate");
    expect(createRoute).toContain("syncIntervalMinutes");
    expect(createRoute).toContain(".min(30)");
    expect(updateRoute).toContain("syncIntervalMinutes");
    expect(syncSource).toContain("credential.syncFromDate");
    expect(syncSource).not.toContain("BACKFILL_DAYS");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale sync schedule schema", () => {
  it("stores initial backfill date and recurring interval on credentials", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const migration = readFileSync(
      join(process.cwd(), "prisma/migrations/20260628190000_triple_whale_sync_schedule/migration.sql"),
      "utf8",
    );

    expect(schema).toMatch(/syncFromDate\s+DateTime\s+@map\("sync_from_date"\) @db\.Date/);
    expect(schema).toMatch(/syncIntervalMinutes\s+Int\s+@default\(30\) @map\("sync_interval_minutes"\)/);
    expect(migration).toContain('ADD COLUMN "sync_from_date" DATE');
    expect(migration).toContain('ADD COLUMN "sync_interval_minutes" INTEGER NOT NULL DEFAULT 30');
    expect(migration).toContain('CHECK ("sync_interval_minutes" >= 30)');
  });
});

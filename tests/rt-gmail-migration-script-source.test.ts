import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RT Gmail migration script", () => {
  const source = readFileSync("scripts/migrate-rt-gmail-mailboxes.sh", "utf8");

  it("deploys migrations and verifies the exact completed migration record", () => {
    expect(source).toContain("npx prisma migrate deploy");
    expect(source).toContain('FROM "_prisma_migrations"');
    expect(source).toContain("migration_name = $1");
    expect(source).toContain("finished_at IS NOT NULL");
    expect(source).toContain("rolled_back_at IS NULL");
    expect(source).not.toContain('prisma migrate status | grep -q "$MIGRATION_NAME"');
  });

  it("creates protected runtime directories without printing secret values", () => {
    expect(source).toContain('chmod 700 "${RUNTIME_DIR}" "${RUNTIME_DIR}/secrets"');
    expect(source).toContain('chmod 755 "${RUNTIME_DIR}/configs" "${RUNTIME_DIR}/state"');
    expect(source).not.toContain("echo $DATABASE_URL");
    expect(source).not.toContain("echo $RT_API_TOKEN");
    expect(source).not.toContain("echo $MASTER_ENCRYPTION_KEY");
  });
});

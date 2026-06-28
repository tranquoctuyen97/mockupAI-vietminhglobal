import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox response metric schema", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260628120000_mailbox_response_metrics/migration.sql",
    "utf8",
  );

  it("adds a durable response metric model and internal Gmail dates", () => {
    expect(schema).toMatch(/model MailboxResponseMetric/);
    expect(schema).toMatch(/responseStartedAt\s+DateTime\s+@map\("response_started_at"\)/);
    expect(schema).toMatch(/latestAdminReplyAt\s+DateTime\?\s+@map\("latest_admin_reply_at"\)/);
    expect(schema).toMatch(/latestAdminReplyActorUserId\s+String\?\s+@map\("latest_admin_reply_actor_user_id"\)/);
    expect(schema).toMatch(/latestAdminReplyActor\s+User\?\s+@relation/);
    expect(schema).toMatch(/responseDurationMs\s+BigInt\?\s+@map\("response_duration_ms"\)/);
    expect(schema).toMatch(/responseMetric\s+MailboxResponseMetric\?/);
    expect(schema).toMatch(/gmailInternalDate\s+DateTime\?\s+@map\("gmail_internal_date"\)/);
  });

  it("creates the table and reporting indexes", () => {
    expect(migration).toContain("CREATE TABLE \"mailbox_response_metrics\"");
    expect(migration).toContain("\"response_started_at\" TIMESTAMP(3) NOT NULL");
    expect(migration).toContain("\"latest_admin_reply_at\" TIMESTAMP(3)");
    expect(migration).toContain("\"latest_admin_reply_actor_user_id\" TEXT");
    expect(migration).toContain("\"response_duration_ms\" BIGINT");
    expect(migration).toContain("CREATE INDEX \"mailbox_response_metrics_tenant_id_store_id_response_started_at_idx\"");
    expect(migration).toContain("CREATE INDEX \"mailbox_response_metrics_mailbox_id_response_started_at_idx\"");
    expect(migration).toContain("CREATE INDEX \"mailbox_response_metrics_latest_admin_reply_actor_user_id_response_started_at_idx\"");
    expect(migration).toContain("ALTER TABLE \"gmail_message_links\" ADD COLUMN \"gmail_internal_date\" TIMESTAMP(3)");
  });
});

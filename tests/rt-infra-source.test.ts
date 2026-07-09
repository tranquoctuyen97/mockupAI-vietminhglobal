import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RT production infrastructure source", () => {
  const compose = readFileSync("infra/rt/docker-compose.yml", "utf8");
  const dockerfile = readFileSync("infra/rt/Dockerfile", "utf8");
  const worker = readFileSync("infra/rt/Dockerfile.mailbox-worker", "utf8");
  const mailboxWorker = readFileSync("start-mailbox-worker.ts", "utf8");
  const site = readFileSync("infra/rt/RT_SiteConfig.pm", "utf8");
  const msmtp = readFileSync("infra/rt/msmtprc", "utf8");
  const helper = readFileSync("infra/rt/bin/mailbox-secret-helper", "utf8");

  it("pins RT 6.0.3 image digest and checks version at build time", () => {
    const digest = "sha256:61542e700818c1422ee476750fa33dfd5470a407329f2586df6fd00a6b8d67a8";
    expect(dockerfile).toContain(digest);
    expect(worker).toContain(digest);
    expect(dockerfile).toContain('$RT::VERSION eq "6.0.3"');
    expect(dockerfile).toMatch(/USER root[\s\S]*RUN chmod[\s\S]*USER rt/);
    expect(dockerfile).toContain("chown root:rt");
  });

  it("uses PostgreSQL, persistent volumes, health checks and internal network exposure", () => {
    expect(compose).toContain("postgres:17-alpine");
    expect(compose).toContain("rt-postgres:");
    expect(compose).toContain("rt-var:");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("internal: true");
    expect(compose).toContain("rt-edge:");
    expect(compose).toContain('command: ["/opt/rt/sbin/rt-server", "--server", "Standalone", "--port", "9000"]');
    expect(compose).toContain("127.0.0.1:${RT_WEB_PORT:-8082}:9000");
    expect(compose).toMatch(/postgres:[\s\S]*?networks:\n      - rt-internal\n\n  rt:/);
    expect(compose).toMatch(/mailbox-worker:[\s\S]*?networks:\n      - rt-internal\n      - rt-edge/);
    expect(compose).not.toContain("/var/run/docker.sock");
  });

  it("runs the containerized mailbox worker without consuming mockup queues", () => {
    expect(worker).toContain('CMD ["npx", "tsx", "start-mailbox-worker.ts"]');
    expect(mailboxWorker).toMatch(/^import "\.\/src\/lib\/env\/standalone-worker-env";/);
    expect(mailboxWorker).toContain("startMailboxSyncWorker");
    expect(mailboxWorker).toContain("startMailboxBackfillWorker");
    expect(mailboxWorker).toContain("startGmailLabelOperationsWorker");
    expect(mailboxWorker).not.toContain("startMockupCompositeWorker");
    expect(mailboxWorker).not.toContain("startPrintifyMockupPollWorker");
    expect(mailboxWorker).not.toContain("startTripleWhaleSyncWorker");
  });

  it("configures msmtp envelope selection and helper-based passwords", () => {
    expect(site).toContain("Set($DatabaseType, 'Pg')");
    expect(site).toContain("Set($MailCommand, 'sendmailpipe')");
    expect(site).toContain("Set($SendmailPath, '/usr/bin/msmtp')");
    expect(site).toContain("--read-envelope-from");
    expect(msmtp).toContain("passwordeval /usr/local/bin/mailbox-secret-helper");
    expect(helper).toContain("/run/mockupai-mailboxes/secrets/$mailbox_id");
    expect(msmtp).not.toMatch(/password\s*=/i);
  });
});

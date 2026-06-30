import { describe, expect, it, vi } from "vitest";
import { provisionMailbox, rtQueueName, type ProvisionMailboxDeps } from "../src/lib/rt/provisioning";

function deps(overrides: Partial<ProvisionMailboxDeps> = {}): ProvisionMailboxDeps {
  return {
    load: vi.fn().mockResolvedValue({
      id: "mailbox_1",
      name: "Support",
      email: "support@example.test",
      initialSyncAfter: new Date("2026-01-01T00:00:00Z"),
      rtQueueId: null,
      store: { name: "Store A" },
      syncCursor: { lastCommittedUid: BigInt(0) },
    }),
    createQueue: vi.fn().mockResolvedValue({ ok: true, id: 7 }),
    updateQueue: vi.fn().mockResolvedValue({ ok: true }),
    disableQueue: vi.fn().mockResolvedValue(undefined),
    ensureLabelsCustomField: vi.fn().mockResolvedValue({ ok: true }),
    grantRights: vi.fn().mockResolvedValue({ ok: true }),
    materialize: vi.fn().mockResolvedValue(undefined),
    markActive: vi.fn().mockResolvedValue(undefined),
    markDegraded: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("RT mailbox provisioning", () => {
  it("creates the deterministic queue, custom field, rights and runtime config", async () => {
    const d = deps();
    await expect(provisionMailbox("mailbox_1", d)).resolves.toEqual({ status: "ACTIVE", queueId: 7 });
    expect(d.createQueue).toHaveBeenCalledWith({
      name: "vmg-mailbox-mailbox_1",
      description: "Store A / Support",
      correspondAddress: "support@example.test",
    });
    expect(d.updateQueue).toHaveBeenCalledWith(7, {
      name: "vmg-mailbox-mailbox_1",
      description: "Store A / Support",
      correspondAddress: "support@example.test",
      disabled: false,
    });
    expect(d.ensureLabelsCustomField).toHaveBeenCalledWith(7);
    expect(d.grantRights).toHaveBeenCalledWith(7);
    expect(d.materialize).toHaveBeenCalled();
    expect(d.markActive).toHaveBeenCalledWith("mailbox_1", 7);
  });

  it("reuses existing queue ids for idempotent retries", async () => {
    const d = deps({
      load: vi.fn().mockResolvedValue({
        id: "mailbox_1",
        name: "Support",
        email: "support@example.test",
        initialSyncAfter: new Date("2026-01-01T00:00:00Z"),
        rtQueueId: 9,
        store: { name: "Store A" },
        syncCursor: null,
      }),
    });
    await provisionMailbox("mailbox_1", d);
    expect(d.createQueue).not.toHaveBeenCalled();
    expect(d.updateQueue).toHaveBeenCalledWith(9, expect.objectContaining({ name: rtQueueName("mailbox_1") }));
  });

  it("marks degraded and disables created RT queue on failure", async () => {
    const d = deps({ ensureLabelsCustomField: vi.fn().mockResolvedValue({ ok: false, error: "rt_custom_field_failed" }) });
    await expect(provisionMailbox("mailbox_1", d)).resolves.toEqual({ status: "DEGRADED", errorCode: "rt_custom_field_failed" });
    expect(d.disableQueue).toHaveBeenCalledWith(7);
    expect(d.markDegraded).toHaveBeenCalledWith("mailbox_1", "rt_custom_field_failed");
  });
});

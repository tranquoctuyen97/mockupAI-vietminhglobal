import { describe, expect, it, vi } from "vitest";
import {
  buildMonthlyResponseSummary,
  classifyResponseMetric,
  createResponseMetricService,
  durationMsBetween,
} from "../src/lib/mailboxes/response-metrics";

describe("mailbox response metrics", () => {
  it("creates the metric once and never resets the customer start", async () => {
    const createIfMissing = vi.fn().mockResolvedValue({ created: true });
    const service = createResponseMetricService({
      createIfMissing,
      findByConversationId: vi.fn(),
      updateAdminReply: vi.fn(),
      listForSummary: vi.fn(),
      listOverdue: vi.fn(),
      rebuild: vi.fn(),
    });

    await service.recordCustomerMessage({
      tenantId: "tenant-1",
      storeId: "store-1",
      mailboxId: "mailbox-1",
      conversationId: "conversation-1",
      messageAt: new Date("2026-06-01T10:00:00Z"),
    });
    await service.recordCustomerMessage({
      tenantId: "tenant-1",
      storeId: "store-1",
      mailboxId: "mailbox-1",
      conversationId: "conversation-1",
      messageAt: new Date("2026-06-01T12:00:00Z"),
    });

    expect(createIfMissing).toHaveBeenCalledTimes(2);
    expect(createIfMissing).toHaveBeenNthCalledWith(1, expect.objectContaining({
      conversationId: "conversation-1",
      responseStartedAt: new Date("2026-06-01T10:00:00Z"),
    }));
    expect(createIfMissing).toHaveBeenNthCalledWith(2, expect.objectContaining({
      conversationId: "conversation-1",
      responseStartedAt: new Date("2026-06-01T12:00:00Z"),
    }));
  });

  it("updates latest admin reply and computes the 10h to 13h example as 3 hours", async () => {
    const updateAdminReply = vi.fn().mockResolvedValue(undefined);
    const service = createResponseMetricService({
      createIfMissing: vi.fn(),
      findByConversationId: vi.fn().mockResolvedValue({
        conversationId: "conversation-1",
        responseStartedAt: new Date("2026-06-01T10:00:00Z"),
      }),
      updateAdminReply,
      listForSummary: vi.fn(),
      listOverdue: vi.fn(),
      rebuild: vi.fn(),
    });

    await service.recordAdminReply({
      conversationId: "conversation-1",
      actorUserId: "user-13h",
      repliedAt: new Date("2026-06-01T13:00:00Z"),
    });

    expect(updateAdminReply).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      latestAdminReplyAt: new Date("2026-06-01T13:00:00Z"),
      latestAdminReplyActorUserId: "user-13h",
      responseDurationMs: BigInt(10_800_000),
    });
  });

  it("rejects negative response durations", () => {
    expect(() => durationMsBetween(
      new Date("2026-06-01T13:00:00Z"),
      new Date("2026-06-01T10:00:00Z"),
    )).toThrow("negative_response_duration");
  });

  it("classifies overdue completed and pending conversations at 24 hours", () => {
    const now = new Date("2026-06-02T11:00:00Z");
    expect(classifyResponseMetric({
      responseStartedAt: new Date("2026-06-01T10:00:00Z"),
      latestAdminReplyAt: null,
      responseDurationMs: null,
    }, now).overdue).toBe(true);
    expect(classifyResponseMetric({
      responseStartedAt: new Date("2026-06-01T10:00:00Z"),
      latestAdminReplyAt: new Date("2026-06-01T13:00:00Z"),
      responseDurationMs: BigInt(10_800_000),
    }, now).overdue).toBe(false);
  });

  it("builds monthly summary by responseStartedAt month", () => {
    const summary = buildMonthlyResponseSummary([
      {
        responseStartedAt: new Date("2026-05-31T23:30:00Z"),
        latestAdminReplyAt: new Date("2026-06-01T01:00:00Z"),
        latestAdminReplyActorUserId: "user-1",
        responseDurationMs: BigInt(5_400_000),
      },
      {
        responseStartedAt: new Date("2026-06-02T10:00:00Z"),
        latestAdminReplyAt: null,
        latestAdminReplyActorUserId: null,
        responseDurationMs: null,
      },
    ], new Date("2026-06-03T10:00:00Z"));

    expect(summary).toEqual([
      expect.objectContaining({
        reportMonth: "2026-05",
        totalConversations: 1,
        repliedConversations: 1,
        actorBreakdown: [{ actorUserId: "user-1", repliedConversations: 1, averageResponseDurationMs: 5_400_000 }],
      }),
      expect.objectContaining({ reportMonth: "2026-06", totalConversations: 1, unrepliedConversations: 1 }),
    ]);
  });
});

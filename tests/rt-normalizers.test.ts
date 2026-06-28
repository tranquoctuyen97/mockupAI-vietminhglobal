import { describe, expect, it } from "vitest";
import {
  APP_TO_RT_STATUS,
  normalizeRtTicket,
  normalizeRtTransaction,
  rtStatusToAppStatus,
} from "../src/lib/rt/normalizers";

describe("RT normalizers", () => {
  it("maps statuses explicitly", () => {
    expect(rtStatusToAppStatus("stalled")).toBe("pending");
    expect(rtStatusToAppStatus("resolved")).toBe("closed");
    expect(rtStatusToAppStatus("rejected")).toBe("closed");
    expect(rtStatusToAppStatus("deleted")).toBe("closed");
    expect(rtStatusToAppStatus("open")).toBe("active");
    expect(APP_TO_RT_STATUS).toEqual({ active: "open", pending: "stalled", closed: "resolved" });
  });

  it("normalizes tickets and the Gmail Labels custom field", () => {
    expect(normalizeRtTicket({
      id: "12",
      Queue: { id: "7" },
      Subject: "Need help",
      Status: "stalled",
      Created: "2026-06-01T00:00:00Z",
      LastUpdated: "2026-06-02T00:00:00Z",
      EffectiveId: { id: "12" },
      CustomFields: [{ name: "Gmail Labels", values: ["Support/Test"] }],
    }, "mailbox-7", [{ id: "label-1", name: "Support/Test", state: "ACTIVE" }])).toMatchObject({
      id: 12,
      mailboxId: "mailbox-7",
      subject: "Need help",
      status: "pending",
      labels: [{ id: "label-1", name: "Support/Test", state: "ACTIVE" }],
    });
  });

  it("retains the existing thread and attachment shape", () => {
    expect(normalizeRtTransaction({
      id: "99",
      Ticket: { id: "12" },
      Type: "Correspond",
      Creator: { id: "agent" },
      Created: "2026-06-02T00:00:00Z",
      Content: "Hello",
      ContentType: "text/plain",
      Attachments: [{ id: "3", Filename: "a.txt", ContentLength: 12, ContentType: "text/plain" }],
    })).toMatchObject({
      id: 99,
      conversationId: 12,
      body: "Hello",
      contentType: "text/plain",
      attachments: [{ id: 3, filename: "a.txt", size: "12" }],
    });
  });

  it("accepts RT search results with an empty-string CustomFields block", () => {
    expect(normalizeRtTicket({ id: "7", CustomFields: "", TransactionCount: "2" }, "mailbox-1")).toMatchObject({
      id: 7,
      articleCount: 2,
      labels: [],
    });
  });

  it("accepts RT history rows with an empty-string Attachments block", () => {
    expect(normalizeRtTransaction({ id: "8", Ticket: "7", Type: "Create", Attachments: "" })).toMatchObject({
      id: 8,
      conversationId: 7,
      type: "create",
      attachments: [],
    });
  });
});

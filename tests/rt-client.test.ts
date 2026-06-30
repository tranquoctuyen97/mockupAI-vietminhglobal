import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("RT REST2 client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("RT_URL", "https://rt.example.test/");
    vi.stubEnv("RT_API_TOKEN", "rt-test-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses token authentication and normalizes the base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    vi.stubGlobal("fetch", fetchMock);
    const { rtRequest } = await import("../src/lib/rt/client");

    await rtRequest({ method: "GET", path: "/REST/2.0/ticket/1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://rt.example.test/REST/2.0/ticket/1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "token rt-test-token" }),
      }),
    );
  });

  it("redacts credentials from upstream failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rt-test-token leaked", { status: 500 })));
    const { rtRequest } = await import("../src/lib/rt/client");

    const result = await rtRequest({ method: "GET", path: "/REST/2.0/tickets" });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("rt-test-token");
  });

  it("maps aborts and network failures to stable errors", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const fetchMock = vi.fn().mockRejectedValueOnce(abort).mockRejectedValueOnce(new Error("socket rt-test-token"));
    vi.stubGlobal("fetch", fetchMock);
    const { rtRequest } = await import("../src/lib/rt/client");

    await expect(rtRequest({ method: "GET", path: "/REST/2.0/tickets" })).resolves.toMatchObject({ status: 502, error: "timeout" });
    await expect(rtRequest({ method: "GET", path: "/REST/2.0/tickets" })).resolves.toMatchObject({ status: 502, error: "network_error" });
  });

  it("preserves RT collection pagination", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      count: 1,
      page: 2,
      pages: 4,
      per_page: 25,
      next_page: "/REST/2.0/tickets?page=3",
      total: 76,
      items: [{ id: "42", Queue: { id: "7" }, Subject: "Hello", Status: "open", Created: "2026-01-01", LastUpdated: "2026-01-02" }],
    })));
    const { searchTickets } = await import("../src/lib/rt/client");

    const result = await searchTickets({ queueId: 7, page: 2, pageSize: 25 });

    expect(result.data).toMatchObject({ page: 2, pages: 4, total: 76, nextPage: "/REST/2.0/tickets?page=3" });
  });

  it("escapes label values before building TicketSQL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ count: 0, page: 1, pages: 0, per_page: 25, total: 0, items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { searchTickets } = await import("../src/lib/rt/client");

    await searchTickets({ queueId: 7, labelName: "VIP' OR Queue > 0" });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("query")).toContain("VIP'' OR Queue > 0");
    expect(url.searchParams.get("query")).toContain("Queue = 7");
  });

  it("resolves mailgate identity through exact Message-ID attachment and queue", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        count: 1,
        page: 1,
        pages: 1,
        per_page: 20,
        total: 1,
        items: [{ id: "5", MessageId: "gate-1@example.test", TransactionId: "99" }],
      }))
      .mockResolvedValueOnce(jsonResponse({ id: "99", Object: { id: "42", type: "ticket" }, Type: "Create" }))
      .mockResolvedValueOnce(jsonResponse({ id: "42", Queue: { id: "7" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { findMailgateIdentity } = await import("../src/lib/rt/client");

    await expect(findMailgateIdentity({ messageId: "<gate-1@example.test>", queueId: 7 })).resolves.toEqual({
      ticketId: 42,
      transactionId: 99,
    });

    const attachmentUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(JSON.parse(attachmentUrl.searchParams.get("query") ?? "[]")).toEqual([
      { field: "MessageId", operator: "=", value: "gate-1@example.test" },
    ]);
  });

  it("auto-resolves ticket, transaction and queue from an exact Gmail Message-ID", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        count: 1,
        page: 1,
        pages: 1,
        per_page: 20,
        total: 1,
        items: [{ id: "5", MessageId: "gate-auto@example.test", TransactionId: "99" }],
      }))
      .mockResolvedValueOnce(jsonResponse({ id: "99", Object: { id: "42", type: "ticket" }, Type: "Create" }))
      .mockResolvedValueOnce(jsonResponse({ id: "42", Queue: { id: "7" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { resolveMailgateIdentity } = await import("../src/lib/rt/client");

    await expect(resolveMailgateIdentity("<gate-auto@example.test>")).resolves.toEqual({
      ticketId: 42,
      transactionId: 99,
      queueId: 7,
    });
  });

  it("records app-sent replies as RT comments without relying on RT outbound mail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "101", Type: "Comment" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { comment } = await import("../src/lib/rt/client");

    await comment(42, {
      content: "Gmail-Message-ID: <mockupai-reply-1@example.test>\n\nAgent reply body",
      contentType: "text/plain",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://rt.example.test/REST/2.0/ticket/42/comment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          Content: "Gmail-Message-ID: <mockupai-reply-1@example.test>\n\nAgent reply body",
          ContentType: "text/plain",
        }),
      }),
    );
  });

  it("grants queue rights to users and groups with the RT REST2 principal shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { grantQueueRights } = await import("../src/lib/rt/client");

    await grantQueueRights(7, { type: "Group", name: "Everyone" }, ["CreateTicket"]);
    await grantQueueRights(7, { type: "User", name: "mailbox-service" }, ["ShowTicket"]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://rt.example.test/REST/2.0/queue/7/rights",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ Group: "Everyone", Right: "CreateTicket" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://rt.example.test/REST/2.0/queue/7/rights",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ User: "mailbox-service", Right: "ShowTicket" }),
      }),
    );
  });

  it("treats already-granted queue rights as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      message: "mailbox-service already has the right CreateTicket on RT::Queue 7",
    }, 409)));
    const { grantQueueRights } = await import("../src/lib/rt/client");

    await expect(grantQueueRights(7, { type: "User", name: "mailbox-service" }, ["CreateTicket"])).resolves.toMatchObject({
      ok: true,
    });
  });

  it("can find disabled queues and re-enable them", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        count: 2,
        page: 1,
        pages: 1,
        per_page: 20,
        total: 2,
        items: [
          { id: "1", Name: "General", Disabled: "0" },
          { id: "5", Name: "vmg-mailbox-1", Disabled: "1" },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ id: "5" }));
    vi.stubGlobal("fetch", fetchMock);
    const { findQueueByName, updateQueue } = await import("../src/lib/rt/client");

    await expect(findQueueByName("vmg-mailbox-1")).resolves.toMatchObject({
      ok: true,
      data: { id: "5", Disabled: "1" },
    });
    await updateQueue(5, {
      name: "vmg-mailbox-1",
      description: "Store / Support",
      correspondAddress: "support@example.test",
      disabled: false,
    });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("find_disabled_rows")).toBe("1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://rt.example.test/REST/2.0/queue/5",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          Name: "vmg-mailbox-1",
          Description: "Store / Support",
          CorrespondAddress: "support@example.test",
          Disabled: 0,
        }),
      }),
    );
  });

  it("rejects ambiguous attachment matches and wrong queues", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ count: 2, page: 1, pages: 1, per_page: 20, total: 2, items: [{ id: "1" }, { id: "2" }] }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, page: 1, pages: 1, per_page: 20, total: 1, items: [{ id: "5", MessageId: "gate-2@example.test", TransactionId: "100" }] }))
      .mockResolvedValueOnce(jsonResponse({ id: "100", Object: { id: "43", type: "ticket" }, Type: "Create" }))
      .mockResolvedValueOnce(jsonResponse({ id: "43", Queue: { id: "8" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { findMailgateIdentity } = await import("../src/lib/rt/client");

    await expect(findMailgateIdentity({ messageId: "gate-1@example.test", queueId: 7 })).resolves.toBeNull();
    await expect(findMailgateIdentity({ messageId: "gate-2@example.test", queueId: 7 })).resolves.toBeNull();
  });
});

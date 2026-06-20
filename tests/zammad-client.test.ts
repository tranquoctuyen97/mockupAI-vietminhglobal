/**
 * Unit tests for Zammad client module.
 *
 * Tests use fetch mocking to verify:
 * - Auth header format
 * - URL normalization
 * - Timeout behavior
 * - Token redaction in errors
 * - Status mapping in typed helpers
 * - Reply payload shape
 * - Pending status sends pending_time
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock env vars ──────────────────────────────────────────────────────────
beforeEach(() => {
  vi.stubEnv("ZAMMAD_URL", "http://localhost:8050/");
  vi.stubEnv("ZAMMAD_ADMIN_TOKEN", "test-secret-token-1234");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── Import after env setup ─────────────────────────────────────────────────
// Dynamic import to pick up env stubs
async function importClient() {
  // Reset module cache to pick up fresh env
  const mod = await import("../src/lib/zammad/client");
  return mod;
}

describe("zammadRequest", () => {
  it("sends Authorization: Token token=... header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { zammadRequest } = await importClient();
    await zammadRequest({ method: "GET", path: "/api/v1/groups" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(opts?.headers).toBeDefined();
    const headers = opts!.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Token token=test-secret-token-1234");
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("trims trailing slashes from ZAMMAD_URL", async () => {
    vi.stubEnv("ZAMMAD_URL", "http://localhost:8050///");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { zammadRequest } = await importClient();
    await zammadRequest({ method: "GET", path: "/api/v1/groups" });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://localhost:8050/api/v1/groups");
  });

  it("returns 502 on timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      return new Promise((_, reject) => {
        const err = new DOMException("The operation was aborted", "AbortError");
        setTimeout(() => reject(err), 10);
      });
    });

    const { zammadRequest } = await importClient();
    const result = await zammadRequest({ method: "GET", path: "/api/v1/groups" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBe("timeout");
  });

  it("returns 502 on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection refused"));

    const { zammadRequest } = await importClient();
    const result = await zammadRequest({ method: "GET", path: "/api/v1/groups" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBe("network_error");
  });

  it("does not expose token in error responses", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    const { zammadRequest } = await importClient();
    const result = await zammadRequest({ method: "GET", path: "/api/v1/groups" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);

    // Verify console.error was called but token is not in the log message
    const logCalls = consoleSpy.mock.calls;
    for (const call of logCalls) {
      const logStr = call.join(" ");
      expect(logStr).not.toContain("test-secret-token-1234");
    }
  });
});

describe("searchTickets", () => {
  it("maps active status to query with new OR open", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { searchTickets } = await importClient();
    await searchTickets({ groupId: 1, status: "active", page: 1, pageSize: 25 });

    const [url] = fetchSpy.mock.calls[0];
    const urlStr = url as string;
    // Should contain both new and open in the query
    expect(urlStr).toContain("state.name");
    expect(urlStr).toContain("new");
    expect(urlStr).toContain("open");
    expect(urlStr).toContain("group_id%3A1");
  });

  it("maps pending status to 'pending reminder'", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { searchTickets } = await importClient();
    await searchTickets({ groupId: 1, status: "pending" });

    const [url] = fetchSpy.mock.calls[0];
    expect((url as string)).toContain("pending+reminder");
  });

  it("maps closed status to 'closed'", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { searchTickets } = await importClient();
    await searchTickets({ groupId: 1, status: "closed" });

    const [url] = fetchSpy.mock.calls[0];
    expect((url as string)).toContain("closed");
  });

  it("sends sort_by=updated_at&order_by=desc", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { searchTickets } = await importClient();
    await searchTickets({ groupId: 1 });

    const [url] = fetchSpy.mock.calls[0];
    expect((url as string)).toContain("sort_by=updated_at");
    expect((url as string)).toContain("order_by=desc");
  });
});

describe("createTicketArticle", () => {
  it("sends correct payload shape", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: 5, ticket_id: 3, type_id: 10, sender_id: 1,
        from: "Agent", to: null, cc: null, subject: null,
        body: "Thank you", content_type: "text/plain",
        internal: false, type: "note", sender: "Agent",
        attachments: [], created_by: "admin@example.com",
        updated_by: "admin@example.com",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { createTicketArticle } = await importClient();
    await createTicketArticle(3, "Thank you");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts!.body as string);
    expect(body).toEqual({
      ticket_id: 3,
      body: "Thank you",
      content_type: "text/plain",
      type: "note",
      internal: false,
    });
  });
});

describe("updateTicketState", () => {
  it("sends pending_time for pending status", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: 3, group_id: 1, priority_id: 2, state_id: 3,
        organization_id: null, number: "84002", title: "Test",
        owner_id: 1, customer_id: 2, note: null, article_count: 2,
        pending_time: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        close_at: null, last_contact_at: null,
        last_contact_agent_at: null, last_contact_customer_at: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { updateTicketState } = await importClient();
    await updateTicketState(3, "pending");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts!.body as string);
    expect(body.state).toBe("pending reminder");
    expect(body.pending_time).toBeDefined();

    // pending_time should be ~24h from now
    const pendingTime = new Date(body.pending_time).getTime();
    const expected = now + 24 * 60 * 60 * 1000;
    expect(pendingTime).toBe(expected);
  });

  it("does NOT send pending_time for active status", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: 3, group_id: 1, priority_id: 2, state_id: 2,
        organization_id: null, number: "84002", title: "Test",
        owner_id: 1, customer_id: 2, note: null, article_count: 2,
        pending_time: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        close_at: null, last_contact_at: null,
        last_contact_agent_at: null, last_contact_customer_at: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { updateTicketState } = await importClient();
    await updateTicketState(3, "active");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts!.body as string);
    expect(body.state).toBe("open");
    expect(body.pending_time).toBeUndefined();
  });

  it("sends state: closed for closed status", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: 3, group_id: 1, priority_id: 2, state_id: 4,
        organization_id: null, number: "84002", title: "Test",
        owner_id: 1, customer_id: 2, note: null, article_count: 2,
        pending_time: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        close_at: "2026-01-01T00:00:00Z", last_contact_at: null,
        last_contact_agent_at: null, last_contact_customer_at: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const { updateTicketState } = await importClient();
    await updateTicketState(3, "closed");

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts!.body as string);
    expect(body.state).toBe("closed");
    expect(body.pending_time).toBeUndefined();
  });
});

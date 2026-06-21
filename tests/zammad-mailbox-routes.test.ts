import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Use vi.hoisted to declare mocks that will be hoisted by Vitest
const { mockPrisma, mockRequireMailboxAdmin } = vi.hoisted(() => {
  return {
    mockPrisma: {
      store: {
        findFirst: vi.fn(),
      },
      mailbox: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    mockRequireMailboxAdmin: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/auth/mailbox-admin-guard", () => ({
  requireMailboxAdmin: mockRequireMailboxAdmin,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  getRequestInfo: vi.fn(() => ({ ip: "127.0.0.1", userAgent: "test" })),
}));

// ─── Import Route Handlers after Mocks ───────────────────────────────────────
import { POST as handlePOST } from "../src/app/api/admin/mailboxes/route";
import { PUT as handlePUT } from "../src/app/api/admin/mailboxes/[id]/route";

type FetchSpy = {
  mock: {
    calls: Array<[unknown, RequestInit?]>;
  };
};

function findKeepOnServerVerifyCall(fetchSpy: FetchSpy) {
  return fetchSpy.mock.calls.find(([u, opts]: [unknown, RequestInit?]) => {
    if (!String(u).includes("/api/v1/channels_email_verify")) return false;
    const body = JSON.parse(opts!.body as string);
    return body.channel_id === 102 && body.inbound?.options?.keep_on_server === true;
  });
}

describe("Mailbox Admin API Routes", () => {
  beforeEach(() => {
    vi.stubEnv("ZAMMAD_URL", "http://localhost:8050/");
    vi.stubEnv("ZAMMAD_ADMIN_TOKEN", "test-secret-token-1234");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("POST /api/admin/mailboxes (Creation)", () => {
    it("successfully creates group, verifies channel, sets keep_on_server=true, and saves to DB", async () => {
      // Setup auth and store mocks
      mockRequireMailboxAdmin.mockResolvedValue({
        response: null,
        session: { id: 1, tenantId: "tenant-1" },
      });
      mockPrisma.store.findFirst.mockResolvedValue({ id: "store-1", name: "My Store" });
      mockPrisma.mailbox.create.mockResolvedValue({ id: "mailbox-1" });

      // Mock all Zammad network fetch calls
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/v1/groups")) {
          return new Response(JSON.stringify({ id: 101, name: "support" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/users/me")) {
          return new Response(JSON.stringify({ id: 1, group_ids: {} }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/users/1")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email_inbound")) {
          return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email_outbound")) {
          return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email_verify")) {
          return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email")) {
          return new Response(
            JSON.stringify({
              assets: {
                Channel: {
                  "102": {
                    id: 102,
                    group_id: 101,
                    area: "Email::Account",
                    active: true,
                    options: {
                      inbound: { adapter: "imap", options: { user: "test@example.com" } },
                      outbound: { adapter: "smtp", options: { user: "test@example.com" } },
                    },
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const body = {
        storeId: "store-1",
        name: "Support Mailbox",
        email: "test@example.com",
        provider: "custom",
        inbound: { host: "imap.example.com", port: 993, encryption: "ssl", username: "test", password: "password" },
        outbound: { host: "smtp.example.com", port: 587, encryption: "starttls", username: "test", password: "password" },
      };

      const request = new NextRequest("http://localhost:3000/api/admin/mailboxes", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const response = await handlePOST(request);
      expect(response.status).toBe(201);

      const keepOnServerCall = findKeepOnServerVerifyCall(fetchSpy);
      expect(keepOnServerCall).toBeDefined();

      // Verify DB creation happened
      expect(mockPrisma.mailbox.create).toHaveBeenCalledOnce();
    });

    it("rolls back and fails if updateEmailChannelInbound fails", async () => {
      mockRequireMailboxAdmin.mockResolvedValue({
        response: null,
        session: { id: 1, tenantId: "tenant-1" },
      });
      mockPrisma.store.findFirst.mockResolvedValue({ id: "store-1", name: "My Store" });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/v1/groups")) {
          return new Response(JSON.stringify({ id: 101, name: "support" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/users/me")) {
          return new Response(JSON.stringify({ id: 1, group_ids: {} }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/users/1")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email_inbound")) {
          return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email_outbound")) {
          return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email_verify")) {
          const body = JSON.parse(String(opts?.body ?? "{}"));
          if (body.channel_id === 102) {
            return new Response("Failed to save channel option", { status: 500 });
          }
          return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email")) {
          return new Response(
            JSON.stringify({
              assets: {
                Channel: {
                  "102": {
                    id: 102,
                    group_id: 101,
                    area: "Email::Account",
                    active: true,
                    options: {
                      inbound: { adapter: "imap", options: { user: "test@example.com" } },
                      outbound: { adapter: "smtp", options: { user: "test@example.com" } },
                    },
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        // Rollback calls
        if (urlStr.includes("/api/v1/channels_email_disable")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const body = {
        storeId: "store-1",
        name: "Support Mailbox",
        email: "test@example.com",
        provider: "custom",
        inbound: { host: "imap.example.com", port: 993, encryption: "ssl", username: "test", password: "password" },
        outbound: { host: "smtp.example.com", port: 587, encryption: "starttls", username: "test", password: "password" },
      };

      const request = new NextRequest("http://localhost:3000/api/admin/mailboxes", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const response = await handlePOST(request);
      expect(response.status).toBe(502);

      // Verify rollback disable was called
      const disableCall = fetchSpy.mock.calls.find(([u]) => String(u).includes("/api/v1/channels_email_disable"));
      expect(disableCall).toBeDefined();

      const deleteChannelCall = fetchSpy.mock.calls.find(
        ([u, opts]) => String(u).includes("/api/v1/channels_email") && opts?.method === "DELETE",
      );
      expect(deleteChannelCall).toBeDefined();

      // Verify DB creation was NOT called
      expect(mockPrisma.mailbox.create).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/admin/mailboxes/:id (Update)", () => {
    it("successfully updates connection, re-applies keep_on_server=true, and saves to DB", async () => {
      mockRequireMailboxAdmin.mockResolvedValue({
        response: null,
        session: { id: 1, tenantId: "tenant-1" },
      });
      mockPrisma.mailbox.findFirst.mockResolvedValue({
        id: "mailbox-1",
        zammadGroupId: 101,
        zammadChannelId: 102,
        email: "test@example.com",
        name: "Support",
      });
      mockPrisma.mailbox.update.mockResolvedValue({ id: "mailbox-1" });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/v1/channels_email_verify")) {
          return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email")) {
          return new Response(
            JSON.stringify({
              assets: {
                Channel: {
                  "102": {
                    id: 102,
                    group_id: 101,
                    area: "Email::Account",
                    active: true,
                    options: {
                      inbound: { adapter: "imap", options: { user: "test@example.com" } },
                      outbound: { adapter: "smtp", options: { user: "test@example.com" } },
                    },
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const body = {
        inbound: { host: "newimap.example.com", port: 993, encryption: "ssl", username: "test", password: "password" },
      };

      const request = new Request("http://localhost:3000/api/admin/mailboxes/mailbox-1", {
        method: "PUT",
        body: JSON.stringify(body),
      });

      const response = await handlePUT(request, { params: Promise.resolve({ id: "mailbox-1" }) });
      expect(response.status).toBe(200);

      const keepOnServerCall = findKeepOnServerVerifyCall(fetchSpy);
      expect(keepOnServerCall).toBeDefined();

      expect(mockPrisma.mailbox.update).toHaveBeenCalledOnce();
    });

    it("fails and does not update DB if updateEmailChannelInbound fails", async () => {
      mockRequireMailboxAdmin.mockResolvedValue({
        response: null,
        session: { id: 1, tenantId: "tenant-1" },
      });
      mockPrisma.mailbox.findFirst.mockResolvedValue({
        id: "mailbox-1",
        zammadGroupId: 101,
        zammadChannelId: 102,
        email: "test@example.com",
        name: "Support",
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/v1/channels_email_verify")) {
          const body = JSON.parse(String(opts?.body ?? "{}"));
          if (body.channel_id === 102) {
            return new Response("Update failed", { status: 500 });
          }
          return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/api/v1/channels_email")) {
          return new Response(
            JSON.stringify({
              assets: {
                Channel: {
                  "102": {
                    id: 102,
                    group_id: 101,
                    area: "Email::Account",
                    active: true,
                    options: {
                      inbound: { adapter: "imap", options: { user: "test@example.com" } },
                      outbound: { adapter: "smtp", options: { user: "test@example.com" } },
                    },
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const body = {
        inbound: { host: "newimap.example.com", port: 993, encryption: "ssl", username: "test", password: "password" },
      };

      const request = new Request("http://localhost:3000/api/admin/mailboxes/mailbox-1", {
        method: "PUT",
        body: JSON.stringify(body),
      });

      const response = await handlePUT(request, { params: Promise.resolve({ id: "mailbox-1" }) });
      expect(response.status).toBe(502);

      // Verify DB update was NOT called
      expect(mockPrisma.mailbox.update).not.toHaveBeenCalled();
    });
  });
});

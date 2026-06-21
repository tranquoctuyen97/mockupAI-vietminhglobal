/**
 * Unit tests for Zammad type helpers — status mapping + normalization.
 */
import { describe, it, expect } from "vitest";
import {
  stateIdToAppStatus,
  appStatusToZammadSearchStates,
  appStatusToZammadUpdateState,
  normalizeGroup,
  normalizeTicket,
  normalizeArticle,
  enrichConversationIdentity,
} from "../src/lib/zammad/types";
import type { ZammadGroup, ZammadTicket, ZammadArticle } from "../src/lib/zammad/types";

// ──────────────────────── Status mapping ────────────────────────

describe("stateIdToAppStatus", () => {
  it("maps state_id 1 (new) → active", () => {
    expect(stateIdToAppStatus(1)).toBe("active");
  });

  it("maps state_id 2 (open) → active", () => {
    expect(stateIdToAppStatus(2)).toBe("active");
  });

  it("maps state_id 3 (pending reminder) → pending", () => {
    expect(stateIdToAppStatus(3)).toBe("pending");
  });

  it("maps state_id 4 (closed) → closed", () => {
    expect(stateIdToAppStatus(4)).toBe("closed");
  });

  it("maps state_id 5 (merged) → active (fallback)", () => {
    expect(stateIdToAppStatus(5)).toBe("active");
  });

  it("maps state_id 6 (pending close) → active (fallback)", () => {
    expect(stateIdToAppStatus(6)).toBe("active");
  });

  it("maps unknown state_id → active (fallback)", () => {
    expect(stateIdToAppStatus(99)).toBe("active");
  });
});

describe("appStatusToZammadSearchStates", () => {
  it("active → ['new', 'open']", () => {
    expect(appStatusToZammadSearchStates("active")).toEqual(["new", "open"]);
  });

  it("pending → ['pending reminder']", () => {
    expect(appStatusToZammadSearchStates("pending")).toEqual(["pending reminder"]);
  });

  it("closed → ['closed']", () => {
    expect(appStatusToZammadSearchStates("closed")).toEqual(["closed"]);
  });
});

describe("appStatusToZammadUpdateState", () => {
  it("active → open", () => {
    expect(appStatusToZammadUpdateState("active")).toBe("open");
  });

  it("pending → pending reminder", () => {
    expect(appStatusToZammadUpdateState("pending")).toBe("pending reminder");
  });

  it("closed → closed", () => {
    expect(appStatusToZammadUpdateState("closed")).toBe("closed");
  });
});

// ──────────────────────── Normalization ────────────────────────

describe("normalizeGroup", () => {
  it("normalizes a Zammad group to app Mailbox shape", () => {
    const group: ZammadGroup = {
      id: 1,
      name: "Users",
      name_last: "Users",
      active: true,
      note: "Standard group",
      email_address_id: null,
      signature_id: 1,
      created_at: "2026-05-29T15:18:47.000Z",
      updated_at: "2026-05-29T15:18:47.000Z",
    };

    expect(normalizeGroup(group)).toEqual({
      id: 1,
      name: "Users",
      active: true,
    });
  });
});

describe("normalizeTicket", () => {
  it("normalizes a Zammad ticket to app Conversation shape", () => {
    const ticket: ZammadTicket = {
      id: 3,
      group_id: 1,
      priority_id: 2,
      state_id: 2, // open → active
      organization_id: null,
      number: "84002",
      title: "Test Support Request",
      owner_id: 3,
      customer_id: 2,
      note: null,
      article_count: 2,
      article_ids: [2, 3],
      pending_time: null,
      created_at: "2026-05-29T15:46:39.786Z",
      updated_at: "2026-05-29T15:47:10.782Z",
      close_at: null,
      last_contact_at: null,
      last_contact_agent_at: null,
      last_contact_customer_at: null,
    };

    const result = normalizeTicket(ticket);
    expect(result).toEqual({
      id: 3,
      mailboxId: 1,
      number: "84002",
      subject: "Test Support Request",
      status: "active",
      customerId: 2,
      assigneeId: 3,
      updatedAt: "2026-05-29T15:47:10.782Z",
      createdAt: "2026-05-29T15:46:39.786Z",
      articleCount: 2,
    });
  });

  it("omits assigneeId when owner_id is 1 (system user)", () => {
    const ticket: ZammadTicket = {
      id: 1, group_id: 1, priority_id: 2, state_id: 1, organization_id: null,
      number: "84001", title: "Test", owner_id: 1, customer_id: 2, note: null,
      article_count: 1, pending_time: null,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      close_at: null, last_contact_at: null, last_contact_agent_at: null, last_contact_customer_at: null,
    };

    const result = normalizeTicket(ticket);
    expect(result.assigneeId).toBeUndefined();
  });

  it("maps state_id 4 → closed", () => {
    const ticket: ZammadTicket = {
      id: 1, group_id: 1, priority_id: 2, state_id: 4, organization_id: null,
      number: "84001", title: "Test", owner_id: 1, customer_id: 2, note: null,
      article_count: 1, pending_time: null,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      close_at: "2026-01-01T00:00:00Z", last_contact_at: null, last_contact_agent_at: null, last_contact_customer_at: null,
    };

    expect(normalizeTicket(ticket).status).toBe("closed");
  });
});

describe("normalizeArticle", () => {
  it("normalizes a Zammad article to app Thread shape", () => {
    const article: ZammadArticle = {
      id: 2,
      ticket_id: 3,
      type_id: 10,
      sender_id: 1,
      from: "Admin User",
      to: null,
      cc: null,
      subject: "Test",
      body: "Hello, I need help.",
      content_type: "text/plain",
      internal: false,
      type: "note",
      sender: "Agent",
      attachments: [],
      created_by: "admin@example.com",
      updated_by: "admin@example.com",
      created_at: "2026-05-29T15:46:39.958Z",
      updated_at: "2026-05-29T15:46:39.958Z",
    };

    const result = normalizeArticle(article);
    expect(result).toEqual({
      id: 2,
      conversationId: 3,
      body: "Hello, I need help.",
      contentType: "text/plain",
      from: "Admin User",
      to: undefined,
      cc: undefined,
      type: "note",
      sender: "Agent",
      internal: false,
      attachments: [],
      createdAt: "2026-05-29T15:46:39.958Z",
    });
  });
});

describe("enrichConversationIdentity", () => {
  it("adds sender identity from the first non-internal email article with a from value", () => {
    const conversation = normalizeTicket({
      id: 3,
      group_id: 1,
      priority_id: 2,
      state_id: 2,
      organization_id: null,
      number: "84002",
      title: "ChatGPT - Ke hoach moi cua ban",
      owner_id: 1,
      customer_id: 69,
      note: null,
      article_count: 1,
      article_ids: [10],
      pending_time: null,
      created_at: "2026-06-21T05:19:00.000Z",
      updated_at: "2026-06-21T05:19:00.000Z",
      close_at: null,
      last_contact_at: null,
      last_contact_agent_at: null,
      last_contact_customer_at: null,
    });

    const result = enrichConversationIdentity(conversation, [
      normalizeArticle({
        id: 10,
        ticket_id: 3,
        type_id: 10,
        sender_id: 2,
        from: "OpenAI <noreply@tm.openai.com>",
        to: "anhiri66 <anhiri66@gmail.com>",
        cc: null,
        subject: "ChatGPT - Ke hoach moi cua ban",
        body: "<p>Hello</p>",
        content_type: "text/html",
        internal: false,
        type: "email",
        sender: "Customer",
        attachments: [],
        created_by: "noreply@tm.openai.com",
        updated_by: "noreply@tm.openai.com",
        created_at: "2026-06-21T05:19:00.000Z",
        updated_at: "2026-06-21T05:19:00.000Z",
      }),
    ]);

    expect(result.fromName).toBe("OpenAI");
    expect(result.fromEmail).toBe("noreply@tm.openai.com");
  });

  it("does not fail when articles are missing sender data", () => {
    const conversation = normalizeTicket({
      id: 4,
      group_id: 1,
      priority_id: 2,
      state_id: 2,
      organization_id: null,
      number: "84003",
      title: "No sender",
      owner_id: 1,
      customer_id: 70,
      note: null,
      article_count: 1,
      article_ids: [11],
      pending_time: null,
      created_at: "2026-06-21T05:19:00.000Z",
      updated_at: "2026-06-21T05:19:00.000Z",
      close_at: null,
      last_contact_at: null,
      last_contact_agent_at: null,
      last_contact_customer_at: null,
    });

    expect(enrichConversationIdentity(conversation, [])).toEqual(conversation);
  });
});

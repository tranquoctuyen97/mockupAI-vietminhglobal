import { describe, it, expect } from "vitest";
import {
  createMailboxSchema,
  updateMailboxSchema,
  statusSchema,
  assignmentsSchema,
  testConnectionSchema,
  probeSchema,
  toZammadInboundSsl,
  toZammadOutboundSsl,
} from "@/lib/zammad/admin-validation";

describe("createMailboxSchema", () => {
  const validCustomInput = {
    name: "Support",
    email: "support@example.com",
    provider: "custom",
    inbound: { host: "imap.gmail.com", port: 993, encryption: "ssl", username: "user", password: "pass" },
    outbound: { host: "smtp.gmail.com", port: 587, encryption: "starttls", username: "user", password: "pass" },
  };

  const validGmailInput = {
    name: "Support",
    email: "support@gmail.com",
    provider: "gmail",
    appPassword: "bhvlxzvguvnqjsfk",
  };

  it("accepts valid Gmail input with appPassword", () => {
    expect(createMailboxSchema.safeParse(validGmailInput).success).toBe(true);
  });

  it("accepts valid custom input with inbound/outbound", () => {
    expect(createMailboxSchema.safeParse(validCustomInput).success).toBe(true);
  });

  it("requires storeId and rejects importMode", () => {
    const input = { ...validCustomInput, storeId: "store_123" };
    expect(createMailboxSchema.safeParse(input).success).toBe(true);
    expect(createMailboxSchema.safeParse({ ...input, importMode: "all" }).success).toBe(false);
  });

  it("rejects gmail without appPassword", () => {
    const input = { name: "X", email: "a@gmail.com", provider: "gmail" };
    expect(createMailboxSchema.safeParse(input).success).toBe(false);
  });

  it("rejects custom without inbound/outbound", () => {
    const input = { name: "X", email: "a@b.com", provider: "custom" };
    expect(createMailboxSchema.safeParse(input).success).toBe(false);
  });

  it("requires name", () => {
    const input = { ...validCustomInput, name: "" };
    expect(createMailboxSchema.safeParse(input).success).toBe(false);
  });

  it("requires valid email", () => {
    const input = { ...validCustomInput, email: "not-email" };
    expect(createMailboxSchema.safeParse(input).success).toBe(false);
  });

  it("rejects invalid provider", () => {
    const input = { ...validCustomInput, provider: "outlook" };
    expect(createMailboxSchema.safeParse(input).success).toBe(false);
  });

  it("requires password on custom create", () => {
    const input = { ...validCustomInput, inbound: { ...validCustomInput.inbound, password: "" } };
    expect(createMailboxSchema.safeParse(input).success).toBe(false);
  });

  it("validates port range 1-65535", () => {
    expect(createMailboxSchema.safeParse({ ...validCustomInput, inbound: { ...validCustomInput.inbound, port: 0 } }).success).toBe(false);
    expect(createMailboxSchema.safeParse({ ...validCustomInput, inbound: { ...validCustomInput.inbound, port: 70000 } }).success).toBe(false);
  });

  it("validates encryption enum", () => {
    expect(createMailboxSchema.safeParse({ ...validCustomInput, inbound: { ...validCustomInput.inbound, encryption: "tls" } }).success).toBe(false);
  });

  it("accepts optional assignments on custom", () => {
    const input = { ...validCustomInput, assignments: [{ userId: "abc", canReply: true, canUpdateStatus: false }] };
    expect(createMailboxSchema.safeParse(input).success).toBe(true);
  });

  it("accepts optional fromName", () => {
    const input = { ...validCustomInput, fromName: "Support Team" };
    expect(createMailboxSchema.safeParse(input).success).toBe(true);
  });

  it("defaults folder to inbox for custom", () => {
    const result = createMailboxSchema.safeParse(validCustomInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.inbound?.folder).toBe("inbox");
  });
});

describe("updateMailboxSchema", () => {
  it("allows partial update with name only", () => {
    expect(updateMailboxSchema.safeParse({ name: "New Name" }).success).toBe(true);
  });

  it("allows password to be optional", () => {
    const input = {
      inbound: { host: "imap.example.com", port: 993, encryption: "ssl", username: "user" },
    };
    expect(updateMailboxSchema.safeParse(input).success).toBe(true);
  });

  it("rejects extra fields", () => {
    expect(updateMailboxSchema.safeParse({ name: "Ok", bad: true }).success).toBe(false);
  });
});

describe("statusSchema", () => {
  it("accepts active boolean", () => {
    expect(statusSchema.safeParse({ active: true }).success).toBe(true);
    expect(statusSchema.safeParse({ active: false }).success).toBe(true);
  });

  it("rejects non-boolean", () => {
    expect(statusSchema.safeParse({ active: "yes" }).success).toBe(false);
  });

  it("rejects extra fields", () => {
    expect(statusSchema.safeParse({ active: true, other: 1 }).success).toBe(false);
  });
});

describe("assignmentsSchema", () => {
  it("accepts valid assignments", () => {
    const input = { assignments: [{ userId: "abc", canReply: true, canUpdateStatus: false }] };
    expect(assignmentsSchema.safeParse(input).success).toBe(true);
  });

  it("rejects missing booleans", () => {
    const input = { assignments: [{ userId: "abc" }] };
    expect(assignmentsSchema.safeParse(input).success).toBe(false);
  });
});

describe("testConnectionSchema", () => {
  it("requires at least inbound or outbound", () => {
    expect(testConnectionSchema.safeParse({}).success).toBe(false);
  });

  it("accepts inbound only", () => {
    const input = { inbound: { host: "imap.example.com", port: 993, encryption: "ssl", username: "u", password: "p" } };
    expect(testConnectionSchema.safeParse(input).success).toBe(true);
  });

  it("accepts outbound only", () => {
    const input = { outbound: { host: "smtp.example.com", port: 587, encryption: "starttls", username: "u", password: "p", email: "a@b.com" } };
    expect(testConnectionSchema.safeParse(input).success).toBe(true);
  });
});

describe("probeSchema", () => {
  it("requires email and password", () => {
    expect(probeSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
    expect(probeSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
  });
});

describe("encryption mapping", () => {
  it("toZammadInboundSsl maps correctly", () => {
    expect(toZammadInboundSsl("ssl")).toBe("ssl");
    expect(toZammadInboundSsl("starttls")).toBe("starttls");
    expect(toZammadInboundSsl("none")).toBe("false");
  });

  it("toZammadOutboundSsl maps correctly", () => {
    expect(toZammadOutboundSsl("ssl")).toBe(true);
    expect(toZammadOutboundSsl("starttls")).toBe(false);
    expect(toZammadOutboundSsl("none")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { redactPasswords } from "@/lib/zammad/client";

describe("redactPasswords", () => {
  it("redacts top-level password fields", () => {
    const obj = { user: "test", password: "secret123" };
    const redacted = redactPasswords(obj);
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.user).toBe("test");
  });

  it("redacts nested password fields", () => {
    const obj = {
      inbound: { options: { host: "imap.gmail.com", password: "secret" } },
      outbound: { options: { host: "smtp.gmail.com", password: "secret2" } },
    };
    const redacted = redactPasswords(obj);
    expect((redacted.inbound as Record<string, unknown>).options).toHaveProperty("password", "[REDACTED]");
    expect((redacted.outbound as Record<string, unknown>).options).toHaveProperty("password", "[REDACTED]");
  });

  it("does not mutate the original object", () => {
    const obj = { password: "secret" };
    redactPasswords(obj);
    expect(obj.password).toBe("secret");
  });

  it("handles objects without passwords", () => {
    const obj = { name: "test", email: "a@b.com" };
    const redacted = redactPasswords(obj);
    expect(redacted).toEqual(obj);
  });

  it("redacts case-insensitive password variants", () => {
    const obj = { Password: "s1", imapPassword: "s2", smtpPassword: "s3" };
    const redacted = redactPasswords(obj);
    expect(redacted.Password).toBe("[REDACTED]");
    expect(redacted.imapPassword).toBe("[REDACTED]");
    expect(redacted.smtpPassword).toBe("[REDACTED]");
  });
});

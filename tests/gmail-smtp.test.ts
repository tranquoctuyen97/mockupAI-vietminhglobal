import { describe, expect, it, vi } from "vitest";
import { verifyGmailSmtp } from "../src/lib/mailboxes/gmail-smtp";

describe("Gmail SMTP verification", () => {
  it("uses STARTTLS and verifies without sending", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const createTransport = vi.fn().mockReturnValue({ verify, close: vi.fn() });
    await expect(verifyGmailSmtp({ email: "support@example.com", appPassword: "secret" }, createTransport as never)).resolves.toEqual({ ok: true });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true }));
    expect(verify).toHaveBeenCalledOnce();
  });

  it("maps authentication and connectivity failures without transcripts", async () => {
    const auth = vi.fn().mockReturnValue({ verify: vi.fn().mockRejectedValue(Object.assign(new Error("secret transcript"), { code: "EAUTH" })), close: vi.fn() });
    const network = vi.fn().mockReturnValue({ verify: vi.fn().mockRejectedValue(new Error("secret transcript")), close: vi.fn() });
    await expect(verifyGmailSmtp({ email: "a@b.com", appPassword: "secret" }, auth as never)).resolves.toEqual({ ok: false, error: "gmail_auth_failed" });
    await expect(verifyGmailSmtp({ email: "a@b.com", appPassword: "secret" }, network as never)).resolves.toEqual({ ok: false, error: "gmail_smtp_unavailable" });
  });
});

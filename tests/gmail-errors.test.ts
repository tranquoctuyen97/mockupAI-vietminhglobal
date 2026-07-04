import { describe, expect, it } from "vitest";
import { GMAIL_RATE_LIMIT_ERROR_CODE, gmailErrorDetails, isGmailRateLimitError } from "../src/lib/mailboxes/gmail-errors";

describe("gmail error helpers", () => {
  it("detects Gmail IMAP command/bandwidth limits", () => {
    const error = Object.assign(new Error("Unexpected close"), {
      code: "ClosedAfterConnectTLS",
      reason: "Account exceeded command or bandwidth limits.",
    });

    expect(isGmailRateLimitError(error)).toBe(true);
    expect(GMAIL_RATE_LIMIT_ERROR_CODE).toBe("gmail_rate_limited");
    expect(gmailErrorDetails(error)).toMatchObject({
      code: "ClosedAfterConnectTLS",
      reason: "Account exceeded command or bandwidth limits.",
      message: "Unexpected close",
    });
  });
});

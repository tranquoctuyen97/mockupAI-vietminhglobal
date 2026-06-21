import { describe, expect, it } from "vitest";
import {
  displayMailboxIdentity,
  parseEmailIdentity,
} from "../src/lib/mailboxes/identity";

describe("parseEmailIdentity", () => {
  it("parses quoted display name and email", () => {
    expect(parseEmailIdentity('"OpenAI" <noreply@tm.openai.com>')).toEqual({
      name: "OpenAI",
      email: "noreply@tm.openai.com",
    });
  });

  it("parses unquoted display name and email", () => {
    expect(parseEmailIdentity("Tran Quoc Tuyen <tuyentq.1997@gmail.com>")).toEqual({
      name: "Tran Quoc Tuyen",
      email: "tuyentq.1997@gmail.com",
    });
  });

  it("uses bare email as email and display fallback", () => {
    expect(parseEmailIdentity("noreply@tm.openai.com")).toEqual({
      name: "noreply@tm.openai.com",
      email: "noreply@tm.openai.com",
    });
  });

  it("keeps raw sender text as name when no email exists", () => {
    expect(parseEmailIdentity("OpenAI Billing")).toEqual({
      name: "OpenAI Billing",
      email: "",
    });
  });
});

describe("displayMailboxIdentity", () => {
  it("prefers fromName, then fromEmail, then customer fallback", () => {
    expect(displayMailboxIdentity({ customerId: 69, fromName: "OpenAI", fromEmail: "noreply@tm.openai.com" })).toBe("OpenAI");
    expect(displayMailboxIdentity({ customerId: 69, fromEmail: "noreply@tm.openai.com" })).toBe("noreply@tm.openai.com");
    expect(displayMailboxIdentity({ customerId: 69 })).toBe("Customer #69");
  });
});

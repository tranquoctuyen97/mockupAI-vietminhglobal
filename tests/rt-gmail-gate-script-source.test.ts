import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Gate C automatic discovery script", () => {
  const source = readFileSync("scripts/verify-rt-gmail-gates.ts", "utf8");

  it("requires only Gmail credentials and RT connection values", () => {
    expect(source).toContain('"GMAIL_TEST_USER"');
    expect(source).toContain('"GMAIL_TEST_APP_PASSWORD"');
    expect(source).toContain('"RT_URL"');
    expect(source).toContain('"RT_API_TOKEN"');
    expect(source).not.toContain('"RT_GATE_TICKET_ID"');
    expect(source).not.toContain('"GMAIL_GATE_THREAD_ID"');
    expect(source).not.toContain('"GMAIL_GATE_LATEST_MESSAGE_ID"');
  });

  it("discovers Gmail context and resolves the RT ticket by Message-ID", () => {
    expect(source).toContain("selectReplyGateCandidate");
    expect(source).toContain("const selectCandidate = () =>");
    expect(source).toContain("selectReplyGateCandidate(remaining, credentials.email) ?? selectReplyGateCandidate(remaining)");
    expect(source).toContain("candidate = selectCandidate()");
    expect(source).toContain("resolveMailgateIdentity");
    expect(source).toContain("candidate.latestExternalMessageId");
  });
});

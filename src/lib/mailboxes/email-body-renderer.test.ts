import { describe, expect, it } from "vitest";
import { buildEmailFrameDocument } from "./email-body-renderer";

describe("email body renderer document", () => {
  it("wraps rendered html in a constrained readable container", () => {
    const doc = buildEmailFrameDocument("<table><tr><td>Hello</td></tr></table>");
    expect(doc).toContain('class="mail-root"');
    expect(doc).toContain("max-width: 760px");
    expect(doc).toContain("width: 100% !important");
    expect(doc).toContain("overflow-wrap: anywhere");
  });
});

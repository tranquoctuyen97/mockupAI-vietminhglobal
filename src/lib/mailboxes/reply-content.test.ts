import { describe, expect, it } from "vitest";
import { prepareReplyContent, sanitizeReplyHtml } from "./reply-content";

describe("reply content", () => {
  it("keeps safe formatting and derives readable plain text", () => {
    const result = prepareReplyContent({
      text: "Hello customer",
      html: '<p style="font-weight:700"><strong>Hello customer</strong></p><ul><li>Next step</li></ul>',
    });

    expect(result.contentType).toBe("text/html");
    expect(result.html).toContain("<strong>");
    expect(result.text).toMatch(/Hello customer/);
    expect(result.text).toMatch(/Next step/);
  });

  it("removes unsafe tags, attributes, schemes, and CSS", () => {
    const html = sanitizeReplyHtml(
      '<p onclick="evil()" style="color:red;position:fixed">Safe</p>'
      + '<script>alert(1)</script>'
      + '<a href="javascript:alert(1)">bad</a>'
      + '<a href="https://example.com">good</a>',
    );

    expect(html).toContain("Safe");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("position");
  });

  it("rejects content with no meaningful text after sanitization", () => {
    expect(() => prepareReplyContent({ text: "x", html: "<script>evil()</script>" }))
      .toThrow("reply_content_empty");
  });

  it("keeps legacy plain-text replies unchanged", () => {
    expect(prepareReplyContent({ text: "Legacy reply" })).toEqual({
      text: "Legacy reply",
      html: null,
      contentType: "text/plain",
    });
  });
});

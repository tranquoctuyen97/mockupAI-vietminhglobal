import { describe, expect, it } from "vitest";
import {
  buildEmailFrameDocument,
  htmlToReadableText,
  isHtmlEmail,
  sanitizeEmailHtml,
} from "../src/lib/mailboxes/email-body-renderer";

describe("email body rendering helpers", () => {
  it("treats text/plain as plain text so newlines can be preserved by the UI", () => {
    const body = "Security alert\n\nNew sign-in detected\nReview your account";

    expect(isHtmlEmail("text/plain", body)).toBe(false);
    expect(body).toContain("\n\n");
  });

  it("detects text/html bodies for EmailBodyRenderer", () => {
    expect(isHtmlEmail("text/html; charset=utf-8", "<p>Hello</p>")).toBe(true);
  });

  it("does not concatenate block text when producing plain text fallback", () => {
    const text = htmlToReadableText("<div>Google</div><p>Security alert</p><table><tr><td>Review</td></tr></table>");

    expect(text).toMatch(/Google\n+Security alert/);
    expect(text).toMatch(/Security alert\n+Review/);
  });

  it("opens external links safely", () => {
    const html = sanitizeEmailHtml('<a href="https://example.com/path">open</a>', false);

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("removes scripts from HTML email", () => {
    const html = sanitizeEmailHtml("<p>Hello</p><script>window.evil = true</script>", false);

    expect(html).toContain("<p>Hello</p>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("window.evil");
  });

  it("shows images by default for HTML email rendering", () => {
    const html = sanitizeEmailHtml('<img src="https://example.com/pixel.png" alt="pixel">');

    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/pixel.png"');
  });

  it("removes inline event handlers from HTML email", () => {
    const html = sanitizeEmailHtml('<a href="https://example.com" onclick="evil()">open</a>');

    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("onclick");
  });

  it("builds a complete iframe document for sanitized email HTML", () => {
    const document = buildEmailFrameDocument("<p>Hello</p>");

    expect(document).toContain("<!doctype html>");
    expect(document).toContain('<base target="_blank">');
    expect(document).toContain("<p>Hello</p>");
  });
});

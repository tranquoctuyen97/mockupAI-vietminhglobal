import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

  it("does not sniff text/plain angle-bracket URLs as HTML", () => {
    expect(isHtmlEmail("text/plain", "See <https://example.com> for details")).toBe(false);
  });

  it("detects text/html bodies for EmailBodyRenderer", () => {
    expect(isHtmlEmail("text/html; charset=utf-8", "<p>Hello</p>")).toBe(true);
  });

  it("does not concatenate block text when producing plain text fallback", () => {
    const text = htmlToReadableText("<div>Google</div><p>Security alert</p><table><tr><td>Review</td></tr></table>");

    expect(text).toMatch(/Google\n+Security alert/);
    expect(text).toMatch(/Security alert\n+Review/);
  });

  it("does not include email CSS in readable text snippets", () => {
    const text = htmlToReadableText(
      '<html><head><style>* { font-family:Roboto, Arial; }</style></head><body><p>Address not found</p></body></html>',
    );

    expect(text).toBe("Address not found");
  });

  it("excludes Gmail quoted replies from readable snippets", () => {
    const text = htmlToReadableText(
      '<div dir="ltr">ferfre</div><br><div class="gmail_quote gmail_quote_container"><div>On Fri, someone wrote:</div><blockquote>old</blockquote></div>',
    );

    expect(text).toBe("ferfre");
  });

  it("keeps body text when Gmail wraps the only content in a quote container", () => {
    const text = htmlToReadableText(
      '<div dir="ltr"><div class="gmail_quote gmail_quote_container"><blockquote><br>OK</blockquote></div></div>',
    );

    expect(text).toBe("OK");
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

  it("removes data hrefs from anchors", () => {
    const html = sanitizeEmailHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');

    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain("alert(1)");
  });

  it("strips style attributes when images are hidden", () => {
    const html = sanitizeEmailHtml('<p style="background:url(https://tracker.example/pixel.png)">x</p>', false);

    expect(html).not.toContain("style=");
    expect(html).not.toContain("tracker.example");
  });

  it("builds a complete iframe document for sanitized email HTML", () => {
    const document = buildEmailFrameDocument("<p>Hello</p>");

    expect(document).toContain("<!doctype html>");
    expect(document).toContain('<base target="_blank">');
    expect(document).toContain("overflow-x: hidden; overflow-y: visible");
    expect(document).toContain("<p>Hello</p>");
  });

  it("allows same-origin iframe measurement for auto height", () => {
    const source = readFileSync("src/components/mailboxes/EmailBodyRenderer.tsx", "utf8");

    expect(source).toContain('sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
    expect(source).toContain("frame.contentDocument?.documentElement");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDescriptionHtml } from "./description-html";

describe("formatDescriptionHtml", () => {
  it("wraps single newline plain text into one paragraph with <br />", () => {
    assert.equal(formatDescriptionHtml("Line 1\nLine 2"), "<p>Line 1<br />Line 2</p>");
  });

  it("splits blank-line separated text into multiple paragraphs", () => {
    assert.equal(formatDescriptionHtml("Para 1\n\nPara 2"), "<p>Para 1</p><p>Para 2</p>");
  });

  it("sanitizes disallowed tags from HTML input", () => {
    assert.equal(formatDescriptionHtml("<p>Hello</p><script>alert(1)</script>"), "<p>Hello</p>");
  });

  it("preserves allowed list markup", () => {
    assert.equal(
      formatDescriptionHtml("<ul><li>Soft cotton</li></ul>"),
      "<ul><li>Soft cotton</li></ul>",
    );
  });

  it("escapes HTML special characters in plain text", () => {
    assert.equal(formatDescriptionHtml("5 < 10 & 10 > 5"), "<p>5 &lt; 10 &amp; 10 &gt; 5</p>");
  });

  it("returns empty string for nullish/empty input", () => {
    assert.equal(formatDescriptionHtml(null), "");
    assert.equal(formatDescriptionHtml(undefined), "");
    assert.equal(formatDescriptionHtml("   "), "");
  });

  it("adds rel/target to anchors", () => {
    const out = formatDescriptionHtml('<a href="https://example.com">link</a>');
    assert.ok(out.includes('rel="noopener noreferrer"'));
    assert.ok(out.includes('target="_blank"'));
    assert.ok(out.includes('href="https://example.com"'));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDescriptionHtml } from "./description-html";

describe("formatDescriptionHtml", () => {
  it("returns empty string for null, undefined, or empty input", () => {
    assert.equal(formatDescriptionHtml(null), "");
    assert.equal(formatDescriptionHtml(undefined), "");
    assert.equal(formatDescriptionHtml(""), "");
  });

  it("converts plain text line breaks into p and br tags", () => {
    assert.equal(
      formatDescriptionHtml("Line 1\nLine 2"),
      "<p>Line 1<br />Line 2</p>"
    );

    assert.equal(
      formatDescriptionHtml("Paragraph 1\n\nParagraph 2"),
      "<p>Paragraph 1</p><p>Paragraph 2</p>"
    );
  });

  it("escapes special HTML characters in plain text", () => {
    assert.equal(
      formatDescriptionHtml("5 < 10 & 10 > 5"),
      "<p>5 &lt; 10 &amp; 10 &gt; 5</p>"
    );

    assert.equal(
      formatDescriptionHtml('I love < cotton > shirts'),
      "<p>I love &lt; cotton &gt; shirts</p>"
    );
  });

  it("sanitizes HTML input with allowed tags and attributes", () => {
    const html = "<p>Hello <strong>world</strong></p><script>alert(1)</script>";
    assert.equal(
      formatDescriptionHtml(html),
      "<p>Hello <strong>world</strong></p>"
    );

    const badImg = '<img src=x onerror="alert(1)">';
    // img tag is not in allowedTags, so it should be stripped
    assert.equal(formatDescriptionHtml(badImg), "");

    const badLink = '<a href="javascript:alert(1)">x</a>';
    // javascript: link should be sanitized/stripped of href
    assert.equal(formatDescriptionHtml(badLink), '<a target="_blank" rel="noopener noreferrer">x</a>');
  });
});

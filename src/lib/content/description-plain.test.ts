import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPlainDescription } from "./description-plain";

describe("formatPlainDescription", () => {
  it("returns empty string for null, undefined, or empty input", () => {
    assert.equal(formatPlainDescription(null), "");
    assert.equal(formatPlainDescription(undefined), "");
    assert.equal(formatPlainDescription(""), "");
  });

  it("converts plain text line breaks into p and br tags", () => {
    assert.equal(
      formatPlainDescription("Line 1\nLine 2"),
      "<p>Line 1<br />Line 2</p>"
    );

    assert.equal(
      formatPlainDescription("Paragraph 1\n\nParagraph 2"),
      "<p>Paragraph 1</p><p>Paragraph 2</p>"
    );
  });

  it("escapes special HTML characters in plain text", () => {
    assert.equal(
      formatPlainDescription("5 < 10 & 10 > 5"),
      "<p>5 &lt; 10 &amp; 10 &gt; 5</p>"
    );

    assert.equal(
      formatPlainDescription('I love < cotton > shirts'),
      "<p>I love &lt; cotton &gt; shirts</p>"
    );
  });
});

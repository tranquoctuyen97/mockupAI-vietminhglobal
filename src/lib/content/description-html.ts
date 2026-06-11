/**
 * Description → HTML formatter shared by the publish route and Shopify publisher.
 *
 * Goal: preserve the author's formatting when it reaches Shopify.
 *  - HTML input → sanitized against a small allowlist (safe inline/list tags).
 *  - Plain text  → escaped, blank-line separated paragraphs, single newlines as <br />.
 */

import sanitizeHtml from "sanitize-html";

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;

const ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "span", "a"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainTextToHtml(input: string): string {
  const normalized = input.replace(/\r\n/g, "\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  if (paragraphs.length === 0) return "";

  return paragraphs
    .map((block) => {
      const escaped = escapeHtml(block).replace(/\n/g, "<br />");
      return `<p>${escaped}</p>`;
    })
    .join("");
}

function sanitizeRichHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  });
}

/**
 * Format a free-form description into Shopify-safe HTML, preserving structure.
 */
export function formatDescriptionHtml(description?: string | null): string {
  if (!description) return "";
  const trimmed = description.trim();
  if (trimmed.length === 0) return "";

  if (HTML_TAG_PATTERN.test(trimmed)) {
    return sanitizeRichHtml(trimmed).trim();
  }

  return plainTextToHtml(trimmed);
}

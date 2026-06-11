import sanitizeHtml from "sanitize-html";
import { formatPlainDescription } from "./description-plain";

/**
 * Shared formatter to sanitize HTML descriptions or convert plain text descriptions
 * into safe HTML paragraph structures.
 */
export function formatDescriptionHtml(description?: string | null): string {
  if (!description) return "";

  const normalizedInput = description.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Check if it has HTML tags (e.g. <p>, <strong>, </p>, etc.)
  const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(normalizedInput);

  if (hasHtmlTags) {
    // Sanitize user HTML with safe allowlist
    return sanitizeHtml(normalizedInput, {
      allowedTags: ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "span", "a"],
      allowedAttributes: {
        a: ["href", "target", "rel"],
        span: ["style"],
      },
      transformTags: {
        a: (tagName, attribs) => {
          const newAttribs = { ...attribs };
          if (newAttribs.href) {
            newAttribs.target = "_blank";
            newAttribs.rel = "noopener noreferrer";
          }
          return { tagName, attribs: newAttribs };
        },
      },
    });
  } else {
    return formatPlainDescription(description);
  }
}

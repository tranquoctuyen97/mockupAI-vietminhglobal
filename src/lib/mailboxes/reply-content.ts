import sanitizeHtml from "sanitize-html";
import { htmlToReadableText } from "./email-body-renderer";

export const RICH_REPLY_HTML_MAX_LENGTH = 150_000;

const SAFE_STYLE_VALUES: Record<string, RegExp[]> = {
  "font-family": [
    /^(?:Arial|Georgia|Tahoma|Times New Roman|Trebuchet MS|Verdana)(?:\s*,\s*(?:Arial|Georgia|Tahoma|Times New Roman|Trebuchet MS|Verdana))*$/i,
  ],
  "font-size": [/^(?:10|12|16|24)px$/],
  color: [/^#[0-9a-f]{6}$/i],
  "text-align": [/^(?:left|center|right|justify)$/i],
  "margin-left": [/^(?:0|24|48|72)px$/],
};

export interface ReplyComposerValue {
  html: string;
  text: string;
}

export interface PreparedReplyContent {
  text: string;
  html: string | null;
  contentType: "text/plain" | "text/html";
}

export function sanitizeReplyHtml(html: string): string {
  if (html.length > RICH_REPLY_HTML_MAX_LENGTH) {
    throw new Error("reply_content_too_large");
  }

  const sanitized = sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "blockquote", "a", "span"],
    allowedAttributes: {
      a: ["href", "target", "rel", "title"],
      blockquote: ["style"],
      li: ["style"],
      p: ["style"],
      span: ["style"],
    },
    allowedStyles: {
      blockquote: SAFE_STYLE_VALUES,
      li: SAFE_STYLE_VALUES,
      p: SAFE_STYLE_VALUES,
      span: SAFE_STYLE_VALUES,
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
    disallowedTagsMode: "discard",
    parseStyleAttributes: true,
  });

  if (sanitized.length > RICH_REPLY_HTML_MAX_LENGTH) {
    throw new Error("reply_content_too_large");
  }

  return sanitized;
}

export function prepareReplyContent(input: { text: string; html?: string }): PreparedReplyContent {
  const legacyText = input.text.trim();
  if (!input.html) {
    return {
      text: legacyText,
      html: null,
      contentType: "text/plain",
    };
  }

  const html = sanitizeReplyHtml(input.html);
  const text = htmlToReadableText(html).trim();
  if (!text) throw new Error("reply_content_empty");

  return {
    text,
    html,
    contentType: "text/html",
  };
}

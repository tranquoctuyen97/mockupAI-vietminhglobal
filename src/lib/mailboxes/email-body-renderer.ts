import sanitizeHtml from "sanitize-html";

const BLOCK_TAG_PATTERN =
  /<\/?(address|article|aside|blockquote|br|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;

export function normalizeContentType(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

export function isHtmlEmail(contentType: string | null | undefined, body: string): boolean {
  const normalized = normalizeContentType(contentType);
  if (normalized === "text/plain") return false;

  return normalized === "text/html" || /<\/?[a-z][\s\S]*>/i.test(body);
}

export function htmlToReadableText(html: string): string {
  return html
    .replace(BLOCK_TAG_PATTERN, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeEmailHtml(html: string, showImages = true): string {
  const layoutAttributes = showImages ? ["style"] : [];

  return sanitizeHtml(html, {
    allowedTags: [
      "a",
      "abbr",
      "address",
      "b",
      "blockquote",
      "br",
      "caption",
      "code",
      "col",
      "colgroup",
      "div",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "i",
      "li",
      "ol",
      "p",
      "pre",
      "span",
      "strong",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
      ...(showImages ? ["img"] : []),
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "title"],
      img: showImages ? ["src", "alt", "title", "width", "height"] : [],
      table: [
        "align",
        "border",
        "cellpadding",
        "cellspacing",
        "role",
        "width",
        ...layoutAttributes,
      ],
      td: ["align", "colspan", "rowspan", "width", ...layoutAttributes],
      th: ["align", "colspan", "rowspan", "width", ...layoutAttributes],
      div: layoutAttributes,
      p: layoutAttributes,
      span: layoutAttributes,
      "*": ["class", "title"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "cid", "data"],
    },
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
    parseStyleAttributes: false,
  });
}

export function buildEmailFrameDocument(html: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_blank">
  <style>
    html, body { margin: 0; padding: 0; background: #ffffff; color: #111827; width: 100%; max-width: 100%; overflow-x: hidden; }
    body { font: 14px/1.65 Arial, Helvetica, sans-serif; overflow-wrap: anywhere; word-break: break-word; }
    .mail-root {
      width: 100%;
      max-width: none;
      margin: 0;
      background: #fff;
      padding: 18px 20px 24px;
      box-sizing: border-box;
      overflow-x: hidden;
    }
    img { max-width: 100% !important; height: auto !important; }
    table { max-width: 100% !important; table-layout: auto !important; }
    td, th, div, p, span, pre, blockquote { max-width: 100% !important; overflow-wrap: anywhere; word-break: break-word; }
    [style*="width"] { max-width: 100% !important; box-sizing: border-box; }
    body, body * { max-width: 100%; box-sizing: border-box; }
    pre { white-space: pre-wrap !important; }
    body * { box-sizing: border-box; }
    a { color: #0b57d0; }
  </style>
</head>
<body><div class="mail-root">${html}</div></body>
</html>`;
}

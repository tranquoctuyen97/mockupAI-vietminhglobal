"use client";

import { useEffect, useState } from "react";
import { formatPlainDescription } from "@/lib/content/description-plain";

export function DescriptionRenderer({
  description,
  className,
  style,
}: {
  description?: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    if (!description) {
      setHtml("");
      return;
    }

    const normalizedInput = description.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(normalizedInput);

    if (hasHtmlTags) {
      // Dynamic import sanitize-html to prevent client-side bundle bloat
      import("sanitize-html").then(({ default: sanitizeHtml }) => {
        const sanitized = sanitizeHtml(normalizedInput, {
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
        setHtml(sanitized);
      });
    } else {
      // Render plain-text formatting synchronously (lightweight, zero bundle cost)
      setHtml(formatPlainDescription(description));
    }
  }, [description]);

  if (!html) {
    return null;
  }

  return (
    <div
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

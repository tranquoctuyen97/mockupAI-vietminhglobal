"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildEmailFrameDocument,
  htmlToReadableText,
  isHtmlEmail,
  sanitizeEmailHtml,
} from "@/lib/mailboxes/email-body-renderer";

export type EmailBodyViewMode = "rendered" | "plain" | "source";

interface Props {
  body: string;
  contentType: string;
  showImages?: boolean;
  mode?: EmailBodyViewMode;
  compact?: boolean;
}

export function EmailBodyRenderer({
  body,
  contentType,
  showImages = true,
  mode = "rendered",
  compact = false,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const minimumFrameHeight = compact ? 64 : 220;
  const [frameHeight, setFrameHeight] = useState(minimumFrameHeight);
  const html = isHtmlEmail(contentType, body);
  const sanitizedHtml = useMemo(() => sanitizeEmailHtml(body, showImages), [body, showImages]);
  const readableText = useMemo(() => (html ? htmlToReadableText(body) : body), [body, html]);
  const frameDocument = useMemo(() => buildEmailFrameDocument(sanitizedHtml), [sanitizedHtml]);

  useEffect(() => {
    if (mode !== "rendered" || !html) return;
    const frame = frameRef.current;
    if (!frame) return;

    const resize = () => {
      const documentElement = frame.contentDocument?.documentElement;
      const bodyElement = frame.contentDocument?.body;
      const nextHeight = Math.max(
        documentElement?.scrollHeight ?? 0,
        bodyElement?.scrollHeight ?? 0,
        documentElement?.offsetHeight ?? 0,
        bodyElement?.offsetHeight ?? 0,
        minimumFrameHeight,
      );
      setFrameHeight(Math.max(minimumFrameHeight, Math.min(nextHeight, 12000)));
    };

    const timer = window.setTimeout(resize, 80);
    frame.addEventListener("load", resize);
    return () => {
      window.clearTimeout(timer);
      frame.removeEventListener("load", resize);
    };
  }, [html, minimumFrameHeight, mode]);

  if (mode === "source") {
    return <pre style={sourceBlock}>{body}</pre>;
  }

  if (mode === "plain" || !html) {
    return <div style={compact ? compactPlainBlock : plainBlock}>{readableText}</div>;
  }

  return (
    <iframe
      ref={frameRef}
      title="Email body"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      scrolling="no"
      srcDoc={frameDocument}
      style={{ ...emailFrame, minHeight: minimumFrameHeight, height: frameHeight }}
    />
  );
}

const plainBlock: CSSProperties = {
  padding: 16,
  color: "#101828",
  fontSize: 14,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const compactPlainBlock: CSSProperties = {
  ...plainBlock,
  padding: "12px 14px",
  lineHeight: 1.5,
};

const sourceBlock: CSSProperties = {
  ...plainBlock,
  margin: 0,
  maxHeight: 420,
  overflow: "auto",
  background: "#0f172a",
  color: "#e5e7eb",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
};

const emailFrame: CSSProperties = {
  display: "block",
  width: "100%",
  border: 0,
  background: "#fff",
  overflow: "hidden",
};

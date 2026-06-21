"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
}

export function EmailBodyRenderer({
  body,
  contentType,
  showImages = true,
  mode = "rendered",
}: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [frameHeight, setFrameHeight] = useState(320);
  const html = isHtmlEmail(contentType, body);
  const sanitizedHtml = useMemo(() => sanitizeEmailHtml(body, showImages), [body, showImages]);
  const readableText = useMemo(() => (html ? htmlToReadableText(body) : body), [body, html]);
  const frameDocument = useMemo(() => buildEmailFrameDocument(sanitizedHtml), [sanitizedHtml]);

  useEffect(() => {
    if (mode !== "rendered" || !html) return;
    const frame = frameRef.current;
    if (!frame) return;

    const resize = () => {
      const nextHeight = frame.contentDocument?.documentElement.scrollHeight ?? 320;
      setFrameHeight(Math.max(220, Math.min(nextHeight, 1400)));
    };

    const timer = window.setTimeout(resize, 80);
    frame.addEventListener("load", resize);
    return () => {
      window.clearTimeout(timer);
      frame.removeEventListener("load", resize);
    };
  }, [frameDocument, html, mode]);

  if (mode === "source") {
    return <pre style={sourceBlock}>{body}</pre>;
  }

  if (mode === "plain" || !html) {
    return <div style={plainBlock}>{readableText}</div>;
  }

  return (
    <iframe
      ref={frameRef}
      title="Email body"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={frameDocument}
      style={{ ...emailFrame, height: frameHeight }}
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
  minHeight: 220,
  border: 0,
  background: "#fff",
};

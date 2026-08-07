import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");

describe("mailbox reply composer integration source contract", () => {
  it("uses the rich editor only for Reply and keeps Internal note as a textarea", () => {
    expect(source).toContain("ReplyRichTextEditor");
    expect(source).toContain("ReplyComposerValue");
    expect(source).toContain('const [replyContent, setReplyContent] = useState<ReplyComposerValue>');
    expect(source).toContain("composerMode === \"reply\" ? (");
    expect(source).toContain("<ReplyRichTextEditor");
    expect(source).toContain("value={internalNoteText}");
    expect(source).toContain("onSaveInternalNote(internalNoteText)");
  });

  it("keeps the required plain-text fallback beside the rich HTML value", () => {
    expect(source).toContain("replyContent.text.trim()");
    expect(source).toContain("replyContent.html");
    expect(source).toContain("onReplyContent");
  });
});

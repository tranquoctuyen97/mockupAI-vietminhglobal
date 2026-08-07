# Mailbox Reply Rich Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mailbox Reply textarea with a Gmail-like rich-text composer that sends sanitized HTML plus a plain-text fallback while keeping Internal note plain text and preserving Gmail threading.

**Architecture:** Add a focused client-side Tiptap editor that emits `{ html, text }`. A server-side reply-content boundary validates and sanitizes the HTML, derives the authoritative plain-text fallback, and passes both MIME bodies to Nodemailer. Persist sanitized rich replies as `GmailMessageLink.body` with `contentType: "text/html"`; keep legacy plain replies and RT fallback records readable.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, Tiptap 3.29.2, Nodemailer 9.0.1, `sanitize-html` 2.17.5, Zod 4.3.6, Vitest 4.1.7, pnpm 10.33.0.

## Global Constraints

- Only Reply uses rich text; Internal note remains a plain `<textarea>`.
- The toolbar includes font family, font size, bold, italic, underline, text color, text alignment, bulleted list, numbered list, quote, indent, outdent, link, emoji, undo, redo, and clear formatting.
- The Reply payload keeps required `text` with the existing 50,000-character limit and accepts optional `html` limited to 150,000 characters before and after sanitization.
- Server-side sanitization is required before SMTP, database persistence, RT mirroring, or app rendering.
- Allowed link schemes are `http`, `https`, and `mailto`; inline images, data URLs, scripts, forms, iframes, arbitrary CSS, Google Drive, signatures, quick replies, drafts, and confidential mode are excluded.
- Gmail, Outlook, and Apple Mail are the compatibility baseline; all rich sends include `text/plain` and `text/html` MIME bodies.
- Existing Gmail `In-Reply-To`, `References`, Message-ID readback, Sent-label validation, thread-ID validation, attachments, response metrics, and legacy plain-text replies must keep working.
- Do not add a database migration; the existing `GmailMessageLink.body` and `GmailMessageLink.contentType` fields are sufficient.
- Do not run `git add`, `git commit`, `git push`, or any other source-control mutation. Leave implementation changes unstaged for user review.

---

### Task 1: Add reply content contract and server-side sanitizer

**Files:**
- Create: `src/lib/mailboxes/reply-content.ts`
- Create: `src/lib/mailboxes/reply-content.test.ts`
- Modify: `src/lib/mailboxes/validation.ts:38-44`
- Modify: `tests/mailbox-validation.test.ts:30-38`

**Interfaces:**
- Produces `ReplyComposerValue`, `RICH_REPLY_HTML_MAX_LENGTH`, `sanitizeReplyHtml`, and `prepareReplyContent` for the UI, API route, and SMTP boundary.
- `ReplyComposerValue` is `{ html: string; text: string }`.
- `prepareReplyContent(input: { text: string; html?: string })` returns `{ text: string; html: string | null; contentType: "text/plain" | "text/html" }`.
- `sanitizeReplyHtml(html: string)` returns only the allowed rich-reply HTML.

- [ ] **Step 1: Write the failing content and validation tests**

Add tests that define the exact contract:

```ts
import { describe, expect, it } from "vitest";
import { prepareReplyContent, sanitizeReplyHtml } from "./reply-content";

describe("reply content", () => {
  it("keeps safe formatting and derives readable plain text", () => {
    const result = prepareReplyContent({
      text: "Hello customer",
      html: '<p style="font-weight:700"><strong>Hello customer</strong></p><ul><li>Next step</li></ul>',
    });

    expect(result.contentType).toBe("text/html");
    expect(result.html).toContain("<strong>");
    expect(result.text).toMatch(/Hello customer/);
    expect(result.text).toMatch(/Next step/);
  });

  it("removes unsafe tags, attributes, schemes, and CSS", () => {
    const html = sanitizeReplyHtml(
      '<p onclick="evil()" style="color:red;position:fixed">Safe</p>'
      + '<script>alert(1)</script>'
      + '<a href="javascript:alert(1)">bad</a>'
      + '<a href="https://example.com">good</a>',
    );

    expect(html).toContain("Safe");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("position");
  });

  it("rejects content with no meaningful text after sanitization", () => {
    expect(() => prepareReplyContent({ text: "x", html: "<script>evil()</script>" }))
      .toThrow("reply_content_empty");
  });

  it("keeps legacy plain-text replies unchanged", () => {
    expect(prepareReplyContent({ text: "Legacy reply" })).toEqual({
      text: "Legacy reply",
      html: null,
      contentType: "text/plain",
    });
  });
});
```

Extend `tests/mailbox-validation.test.ts` with these cases:

```ts
expect(replySchema.parse({ text: "hello", html: "<p>hello</p>" })).toEqual({
  text: "hello",
  html: "<p>hello</p>",
});
expect(replySchema.safeParse({ text: "hello", html: "x".repeat(150_001) }).success).toBe(false);
expect(replySchema.safeParse({ text: "hello", html: "<script>evil()</script>" }).success).toBe(true);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm exec vitest run src/lib/mailboxes/reply-content.test.ts tests/mailbox-validation.test.ts
```

Expected: FAIL because the reply-content module and optional `html` schema field do not exist yet.

- [ ] **Step 3: Implement the shared reply content boundary**

In `src/lib/mailboxes/reply-content.ts`:

1. Export `RICH_REPLY_HTML_MAX_LENGTH = 150_000`.
2. Export the `ReplyComposerValue` type for the client component.
3. Configure `sanitize-html` with only `p`, `br`, `strong`, `b`, `em`, `i`, `u`, `ul`, `ol`, `li`, `blockquote`, `a`, and `span` tags.
4. Allow link attributes `href`, `target`, `rel`, and `title`; transform links to `target="_blank"` and `rel="noopener noreferrer"`.
5. Allow only `http`, `https`, and `mailto` schemes.
6. Preserve only the toolbar style properties `font-family`, `font-size`, `color`, `text-align`, and fixed `margin-left` values `0px`, `24px`, `48px`, and `72px`.
7. Reject input above 150,000 characters before sanitization or after sanitization by throwing `reply_content_too_large`.
8. Derive the final plain text with the existing `htmlToReadableText` helper.
9. Return `text/plain` when `html` is absent; otherwise return sanitized HTML and `text/html`.
10. Throw `reply_content_empty` when the derived plain text is empty.

Use this shape for the public implementation:

```ts
export const RICH_REPLY_HTML_MAX_LENGTH = 150_000;

export interface ReplyComposerValue {
  html: string;
  text: string;
}

export interface PreparedReplyContent {
  text: string;
  html: string | null;
  contentType: "text/plain" | "text/html";
}

export function sanitizeReplyHtml(html: string): string;
export function prepareReplyContent(input: { text: string; html?: string }): PreparedReplyContent;
```

Update `replySchema` to keep `text` required and add `html: z.string().max(RICH_REPLY_HTML_MAX_LENGTH).optional()`. Keep `.strict()` and keep `internalNoteSchema` unchanged.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
pnpm exec vitest run src/lib/mailboxes/reply-content.test.ts tests/mailbox-validation.test.ts
```

Expected: PASS, including legacy validation behavior.

- [ ] **Step 5: Leave changes unstaged**

Do not run any git add or commit command. Confirm only the intended content and validation files are modified.

### Task 2: Add the Tiptap Reply editor and Gmail-like toolbar

**Files:**
- Modify: `package.json:42-77`
- Modify: `pnpm-lock.yaml`
- Create: `src/components/mailboxes/ReplyRichTextEditor.tsx`
- Create: `tests/mailbox-reply-editor-source.test.ts`

**Interfaces:**
- Consumes `ReplyComposerValue` from `src/lib/mailboxes/reply-content.ts`.
- Produces `onChange({ html, text })` on every editor update.
- Does not own or persist Internal note state.

- [ ] **Step 1: Add the aligned Tiptap dependencies**

Add these exact versions as direct dependencies using pnpm so `package.json` and `pnpm-lock.yaml` stay synchronized:

```bash
corepack pnpm add -w \
  @tiptap/core@3.29.2 \
  @tiptap/extension-color@3.29.2 \
  @tiptap/extension-font-family@3.29.2 \
  @tiptap/extension-link@3.29.2 \
  @tiptap/extension-text-align@3.29.2 \
  @tiptap/extension-text-style@3.29.2 \
  @tiptap/extension-underline@3.29.2 \
  @tiptap/react@3.29.2 \
  @tiptap/starter-kit@3.29.2
```

Keep all Tiptap packages on the same version. Do not add a third-party emoji package; use a local Unicode palette in the component.

- [ ] **Step 2: Write the failing editor source contract**

Create `tests/mailbox-reply-editor-source.test.ts` that reads the component source and asserts the editor contract:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/mailboxes/ReplyRichTextEditor.tsx", "utf8");

describe("Reply rich-text editor source contract", () => {
  it("uses client-only Tiptap initialization safe for Next SSR", () => {
    expect(source).toContain('"use client"');
    expect(source).toContain("useEditor");
    expect(source).toContain("immediatelyRender: false");
    expect(source).toContain("StarterKit");
  });

  it("exposes the approved Gmail-like toolbar controls", () => {
    for (const label of [
      "Font family", "Font size", "Bold", "Italic", "Underline", "Text color",
      "Align left", "Align center", "Align right", "Bulleted list", "Numbered list",
      "Quote", "Indent", "Outdent", "Insert link", "Emoji", "Undo", "Redo", "Clear formatting",
    ]) {
      expect(source).toContain(label);
    }
  });

  it("emits HTML and plain text and preserves selection on toolbar click", () => {
    expect(source).toContain("editor.getHTML()");
    expect(source).toContain("editor.getText");
    expect(source).toContain("preventDefault()");
    expect(source).toContain("onChange");
  });
});
```

- [ ] **Step 3: Run the source contract and verify it fails**

Run:

```bash
pnpm exec vitest run tests/mailbox-reply-editor-source.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement `ReplyRichTextEditor`**

Implement `src/components/mailboxes/ReplyRichTextEditor.tsx` with:

1. A `'use client'` directive and static top-level imports.
2. `useEditor({ immediatelyRender: false, extensions, content, onUpdate })`.
3. `StarterKit` for paragraphs, blockquotes, lists, list items, history, and basic commands.
4. `Underline`, `Link`, `Color`, `TextStyle`, `FontFamily`, and `TextAlign` extensions.
5. The official `FontSize` extension from `@tiptap/extension-text-style`, configured to accept only `10px`, `12px`, `16px`, and `24px`.
6. Font choices `Arial`, `Georgia`, `Tahoma`, `Times New Roman`, `Trebuchet MS`, and `Verdana`.
7. A fixed text-color palette: `#111827`, `#4b5563`, `#dc2626`, `#d97706`, `#16a34a`, `#2563eb`, and `#7c3aed`.
8. Four fixed paragraph indentation levels represented by `0px`, `24px`, `48px`, and `72px`; list indentation must use list nesting.
9. A small local emoji popover with common Unicode emoji and insertion through `editor.commands.insertContent(emoji)`.
10. Toolbar buttons using `onMouseDown={(event) => event.preventDefault()}` before running editor commands so the selection is retained.
11. `editor.getHTML()` and `editor.getText({ blockSeparator: "\n" })` in `onUpdate`.
12. Empty-editor initialization as `<p></p>` and a reset effect that calls `editor.commands.setContent(value.html || "<p></p>")` only when the external value changes for a new conversation.
13. `aria-label`, `title`, disabled states, active states, and visible focus styles for every control.

Use this editor boundary:

```tsx
interface ReplyRichTextEditorProps {
  value: ReplyComposerValue;
  disabled?: boolean;
  onChange: (value: ReplyComposerValue) => void;
}
```

The component must not render attachment controls or a send button; those remain owned by `ConversationDetail`.

- [ ] **Step 5: Run the editor contract and verify it passes**

Run:

```bash
pnpm exec vitest run tests/mailbox-reply-editor-source.test.ts
```

Expected: PASS.

- [ ] **Step 6: Leave dependency and editor changes unstaged**

Do not run git add or commit. Keep the dependency lockfile and new component visible in the worktree for review.

### Task 3: Integrate rich Reply state without changing Internal note behavior

**Files:**
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx:205-214`
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx:329-365`
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx:963-990`
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx:1188-1230`
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx:2380-2705`
- Modify: `tests/mailbox-ui-source.test.ts`

**Interfaces:**
- Consumes `ReplyRichTextEditor` and `ReplyComposerValue`.
- Produces the existing `onSend`, attachment, loading, and internal-note behavior.

- [ ] **Step 1: Extend the UI source contract before changing the component**

Add assertions to `tests/mailbox-ui-source.test.ts`:

```ts
expect(source).toContain("ReplyRichTextEditor");
expect(source).toContain("replyContent.html");
expect(source).toContain("replyContent.text");
expect(source).toContain("html: replyContent.html");
expect(source).toContain("placeholder=\"Write an internal note...\"");
expect(source).toContain("composerMode !== \"reply\"");
```

Keep the existing assertions for attachments, `Sending...`, `toast.loading("Sending reply...")`, and Internal note persistence.

- [ ] **Step 2: Run the UI source contract and verify it fails**

Run:

```bash
pnpm exec vitest run tests/mailbox-ui-source.test.ts
```

Expected: FAIL because the parent still owns only `replyText` and the composer still renders one textarea.

- [ ] **Step 3: Replace `replyText` with rich Reply state**

In `MailboxesClient.tsx`:

1. Import `ReplyRichTextEditor` and the `ReplyComposerValue` type with static top-level imports.
2. Replace `const [replyText, setReplyText] = useState("")` with:

```ts
const EMPTY_REPLY_CONTENT: ReplyComposerValue = { html: "", text: "" };
const [replyContent, setReplyContent] = useState<ReplyComposerValue>(EMPTY_REPLY_CONTENT);
```

3. Define `EMPTY_REPLY_CONTENT` at module scope, reset `replyContent` to that value when opening a conversation and after a successful send, and never recreate the empty object during render.
4. Keep `internalNoteText` local to `ConversationDetail` and keep `saveInternalNote(text)` unchanged.
5. Change the send guard and button disabled condition to `!replyContent.text.trim()`.
6. Send both fields while preserving attachment IDs:

```ts
body: JSON.stringify({
  text: replyContent.text,
  html: replyContent.html,
  attachmentIds: composerAttachments.map((attachment) => attachment.id),
}),
```

7. Preserve reply loading toast, disabled state, cache refresh, conversation reopen, attachment cleanup, and error handling.

- [ ] **Step 4: Render the editor only in Reply mode**

Update `ConversationDetail` props from `replyText/onReplyText` to `replyContent/onReplyContent`. Replace the single textarea branch with:

```tsx
{composerMode === "reply" ? (
  <ReplyRichTextEditor
    value={replyContent}
    disabled={sending || uploadingAttachment}
    onChange={onReplyContent}
  />
) : (
  <textarea
    value={internalNoteText}
    onChange={(event) => setInternalNoteText(event.target.value)}
    placeholder="Write an internal note..."
    rows={4}
    style={replyTextarea}
  />
)}
```

Keep the attachment footer disabled outside Reply mode and keep the existing Internal note save button behavior.

- [ ] **Step 5: Run the UI source contract and verify it passes**

Run:

```bash
pnpm exec vitest run tests/mailbox-ui-source.test.ts
```

Expected: PASS, including the existing mailbox UI contract assertions.

- [ ] **Step 6: Leave client changes unstaged**

Do not run git add or commit.

### Task 4: Extend Gmail SMTP to send HTML and plain-text MIME alternatives

**Files:**
- Modify: `src/lib/mailboxes/gmail-reply.ts:7-26,63-86`
- Modify: `tests/gmail-reply.test.ts:8-150`

**Interfaces:**
- Consumes optional `html?: string` on `GmailReplyInput`.
- Produces the same `GmailReplyResult` and all existing thread/readback guarantees.

- [ ] **Step 1: Add failing SMTP tests**

Extend the first `sendGmailThreadReply` test with `html: "<p><strong>Agent reply body</strong></p>"` and assert:

```ts
expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
  text: "Agent reply body",
  html: "<p><strong>Agent reply body</strong></p>",
  inReplyTo: "<customer-last@example.test>",
  references: "<customer-first@example.test> <customer-last@example.test>",
}));
```

Add a legacy test proving that omitting `html` does not add an HTML body:

```ts
expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ text: "Body" }));
expect(sendMail.mock.calls[0][0]).not.toHaveProperty("html");
```

- [ ] **Step 2: Run the Gmail reply tests and verify the new assertion fails**

Run:

```bash
pnpm exec vitest run tests/gmail-reply.test.ts
```

Expected: FAIL because `GmailReplyInput` and `sendMail` do not yet handle `html`.

- [ ] **Step 3: Implement optional HTML MIME support**

Add `html?: string` to `GmailReplyInput`. In the `sendMail` data object, keep `text` and add `html` only when supplied:

```ts
const message = {
  from: { name: input.fromName ?? input.credentials.email, address: input.credentials.email },
  to: input.to,
  subject: replySubject(input.subject),
  text: input.text,
  ...(input.html ? { html: input.html } : {}),
  messageId,
  inReplyTo: input.latestExternalMessageId,
  references: referenceHeader(input.references, input.latestExternalMessageId),
  attachments: input.attachments,
};

await transport.sendMail(message);
```

Do not alter transport setup, cleanup, readback polling, Sent-label checking, or thread-ID checking.

- [ ] **Step 4: Run all Gmail reply tests and verify they pass**

Run:

```bash
pnpm exec vitest run tests/gmail-reply.test.ts
```

Expected: PASS for rich, legacy, attachment, readback, and mismatch cases.

- [ ] **Step 5: Leave SMTP changes unstaged**

Do not run git add or commit.

### Task 5: Wire sanitized content through the reply route and persistence

**Files:**
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts:1240-1400`
- Modify: `tests/mailbox-proxy-source.test.ts`
- Modify: `tests/mailbox-response-proxy-source.test.ts`

**Interfaces:**
- Consumes `prepareReplyContent({ text, html })` and the updated `sendGmailThreadReply` input.
- Produces sanitized SMTP input, correct `GmailMessageLink` body/content type, preview text, and unchanged response metrics.

- [ ] **Step 1: Add route source-contract assertions**

Add assertions to the existing `handleReply` tests:

```ts
expect(body).toContain("prepareReplyContent");
expect(body).toContain("html: preparedReply.html");
expect(body).toContain("contentType: preparedReply.contentType");
expect(body).toContain("latestMessagePreview: summarizeMessagePreview(preparedReply.text");
expect(body.indexOf("prepareReplyContent")).toBeLessThan(body.indexOf("sendGmailThreadReply"));
expect(body.indexOf("await prisma.gmailMessageLink.create")).toBeLessThan(
  body.indexOf("mailboxResponseMetrics.recordAdminReply"),
);
```

- [ ] **Step 2: Run the route source contracts and verify the new assertions fail**

Run:

```bash
pnpm exec vitest run tests/mailbox-proxy-source.test.ts tests/mailbox-response-proxy-source.test.ts
```

Expected: FAIL because the route currently forwards raw `parsed.data.text` and persists `text/plain`.

- [ ] **Step 3: Prepare content once at the start of `handleReply`**

After `replySchema.safeParse` succeeds and before loading reply context, create:

```ts
const preparedReply = prepareReplyContent({
  text: parsed.data.text,
  html: parsed.data.html,
});
```

Import `prepareReplyContent` and the `PreparedReplyContent` type statically from `@/lib/mailboxes/reply-content`. Catch the two content-boundary errors and return the existing validation error shape with status `400`; rethrow unexpected errors:

```ts
let preparedReply: PreparedReplyContent;
try {
  preparedReply = prepareReplyContent({ text: parsed.data.text, html: parsed.data.html });
} catch (error) {
  const code = error instanceof Error ? error.message : "";
  if (code === "reply_content_empty" || code === "reply_content_too_large") {
    return json({
      error: "Validation failed",
      details: { fieldErrors: { html: [code] } },
    }, 400);
  }
  throw error;
}
```

- [ ] **Step 4: Use prepared content for SMTP and Gmail link persistence**

Pass the same prepared values to SMTP:

```ts
const sent = await sendGmailThreadReply({
  credentials,
  to: replyContext.to,
  fromName: mailbox.email,
  subject: replyContext.subject,
  text: preparedReply.text,
  html: preparedReply.html ?? undefined,
  attachments: attachmentPayload.length ? attachmentPayload : undefined,
  gmailThreadId: conversation.gmailThreadId,
  latestExternalMessageId: replyContext.latestExternalMessageId,
  references: replyContext.references,
  lookupByMessageId: gmail.lookupByMessageId,
});
```

Persist the same canonical representation:

```ts
body: preparedReply.html ?? preparedReply.text,
contentType: preparedReply.contentType,
```

Use `preparedReply.text` for `latestMessagePreview`, ensuring previews never contain HTML markup. Keep article count, timestamps, response metric recording, audit logging, attachment state transitions, and error behavior unchanged.

- [ ] **Step 5: Update RT mirror payload for rich replies**

For RT-backed conversations, keep the existing marker and headers, but append the canonical body and content type:

```ts
await comment(conversation.rtTicketId, {
  content: [
    "App-sent Gmail reply recorded.",
    `Gmail-Message-ID: ${sent.rfcMessageId}`,
    `Gmail-Thread-ID: ${sent.gmailThreadId}`,
    "",
    preparedReply.html ?? preparedReply.text,
  ].join("\n"),
  contentType: preparedReply.contentType,
});
```

Plain legacy replies keep the existing text/plain result.

- [ ] **Step 6: Run route source contracts and verify they pass**

Run:

```bash
pnpm exec vitest run tests/mailbox-proxy-source.test.ts tests/mailbox-response-proxy-source.test.ts
```

Expected: PASS, including the existing ordering assertion that Gmail link persistence precedes response metric recording.

- [ ] **Step 7: Leave route changes unstaged**

Do not run git add or commit.

### Task 6: Preserve rich content in RT fallback display

**Files:**
- Modify: `src/lib/rt/thread-display.ts:37-49,93-109`
- Modify: `src/lib/rt/thread-display.test.ts:42-128`

**Interfaces:**
- Consumes RT marker records with either `text/plain` or `text/html` content type.
- Produces `NormalizedThread` app replies with the original safe body and matching `contentType`.

- [ ] **Step 1: Add failing rich RT fallback tests**

Add a rich marker case to `src/lib/rt/thread-display.test.ts`:

```ts
it("preserves rich HTML for a recorded app reply", () => {
  const enriched = enrichThreadsForDisplay({
    threads: [{
      id: 302,
      conversationId: 26,
      subject: undefined,
      body: [
        "App-sent Gmail reply recorded.",
        "Gmail-Message-ID: <rich@example.com>",
        "Gmail-Thread-ID: 123",
        "",
        "<p><strong>Thanks</strong> for the update.</p>",
      ].join("\n"),
      contentType: "text/html",
      from: "",
      to: "",
      cc: "",
      type: "comment",
      sender: "RT_System",
      internal: true,
      attachments: [],
      createdAt: "2026-08-07T00:00:00.000Z",
    }],
    attachments: [],
    mailboxEmail: "support@example.com",
    customerEmail: "customer@example.com",
  });

  expect(enriched[0].displayType).toBe("app_reply");
  expect(enriched[0].contentType).toBe("text/html");
  expect(enriched[0].body).toContain("<strong>Thanks</strong>");
});
```

Keep the existing tests for old plain-text markers and old HTML markers.

- [ ] **Step 2: Run RT display tests and verify the new test fails**

Run:

```bash
pnpm exec vitest run src/lib/rt/thread-display.test.ts
```

Expected: FAIL because `parseRecordedAppReply` currently strips all HTML and always returns text/plain.

- [ ] **Step 3: Return body and content type from the marker parser**

Change the parser contract to:

```ts
function parseRecordedAppReply(
  body: string,
  contentType: string,
): { body: string; contentType: "text/plain" | "text/html" } | null;
```

For `text/html` records created by the new route:

1. Find the existing marker at the start of the raw body.
2. Find the first header/body separator `\n\n`.
3. Return the raw body after the separator as `text/html` without stripping tags.

For legacy records, retain the current normalization of `<br>`, `</p>`, and HTML tags, then return `text/plain`. This preserves old data and the existing punctuation-tolerant test.

- [ ] **Step 4: Integrate the parser result into `enrichThreadsForDisplay`**

Replace the current hardcoded app-reply mapping with:

```ts
const appReply = parseRecordedAppReply(thread.body, thread.contentType);
if (!appReply) {
  return { ...thread, hidden: true, displayType: "internal" as const };
}

return {
  ...thread,
  hidden: false,
  displayType: "app_reply" as const,
  body: appReply.body,
  contentType: appReply.contentType,
  from: input.mailboxEmail,
  sender: input.mailboxEmail,
  to: input.customerEmail ?? thread.to,
  subject: thread.subject || input.fallbackSubject || undefined,
};
```

- [ ] **Step 5: Run RT display tests and verify they pass**

Run:

```bash
pnpm exec vitest run src/lib/rt/thread-display.test.ts
```

Expected: PASS for new rich records, old plain records, old HTML records, and hidden system noise.

- [ ] **Step 6: Leave RT fallback changes unstaged**

Do not run git add or commit.

### Task 7: Add end-to-end source contracts and run focused verification

**Files:**
- Modify: `tests/mailbox-ui-source.test.ts`
- Modify: `tests/mailbox-validation.test.ts`
- Modify: `tests/gmail-reply.test.ts`
- Modify: `tests/mailbox-proxy-source.test.ts`
- Modify: `tests/mailbox-response-proxy-source.test.ts`
- Modify: `src/lib/mailboxes/reply-content.test.ts`
- Modify: `src/lib/rt/thread-display.test.ts`

**Interfaces:**
- Consumes all implementation outputs from Tasks 1–6.
- Produces focused regression evidence without requiring live mailbox credentials or destructive external actions.

- [ ] **Step 1: Run the complete focused test set**

Run the real source tests and exclude standalone build duplicates:

```bash
pnpm exec vitest run \
  src/lib/mailboxes/reply-content.test.ts \
  src/lib/rt/thread-display.test.ts \
  tests/mailbox-validation.test.ts \
  tests/mailbox-reply-editor-source.test.ts \
  tests/mailbox-ui-source.test.ts \
  tests/gmail-reply.test.ts \
  tests/mailbox-proxy-source.test.ts \
  tests/mailbox-response-proxy-source.test.ts \
  --exclude '.next/**'
```

Expected: PASS with no `.next/standalone` duplicate collection.

- [ ] **Step 2: Run formatting/diff validation**

Run:

```bash
git diff --check
```

Expected: no whitespace errors. Do not use a command that stages or commits files.

- [ ] **Step 3: Run the production build**

Run:

```bash
pnpm run build
```

Expected: the Next.js production build completes and the standalone packaging step succeeds. If the build exposes a Tiptap SSR import issue, fix the client boundary by keeping `useEditor` in the `'use client'` component and retaining `immediatelyRender: false`; then rerun the focused editor/source tests and build.

- [ ] **Step 4: Perform manual compatibility verification**

With disposable non-sensitive content and an authorized test mailbox, send one rich Reply containing:

- bold, italic, underline, font, size, and color;
- left/center/right alignment;
- ordered and unordered lists;
- quote and multiple indent levels;
- a safe link and emoji;
- an attachment.

Verify the same message in Gmail, Outlook, and Apple Mail, then reopen the conversation in the app. Verify Internal note still renders as plain text and does not add HTML to the customer email.

- [ ] **Step 5: Report the unstaged worktree state**

Run:

```bash
git status --short
```

Report the changed files and test/build results. Do not stage, commit, push, or deploy.

## Verification Summary

The implementation is ready for review only when:

1. Rich Reply editor source contracts and content sanitization tests pass.
2. Gmail SMTP tests prove both MIME bodies and unchanged threading headers.
3. Route tests prove sanitized content is used for send, persistence, preview, and RT mirror.
4. RT fallback tests prove new rich records and old plain records both display.
5. Focused Vitest, `git diff --check`, and `pnpm run build` pass.
6. `git status --short` shows all implementation changes unstaged and no commit was created.

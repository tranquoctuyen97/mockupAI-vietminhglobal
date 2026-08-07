# Mailbox Reply Rich Text Design

Date: 2026-08-07
Status: Draft for user review

## Goal

Upgrade the mailbox Reply composer from plain text to a Gmail-like rich-text
composer. Agents should be able to format customer replies with common email
formatting, while recipients on Gmail, Outlook, and Apple Mail receive a
readable HTML email with a plain-text fallback.

Internal notes remain plain text and keep their current persistence and
display behavior.

## Current Problem

The current Reply path is plain text end to end:

- `MailboxesClient.tsx` renders a `<textarea>` and stores `replyText` as a
  string.
- The reply request sends only `text`.
- `replySchema` validates only `text` and attachment ids.
- `sendGmailThreadReply` passes only `text` to Nodemailer.
- Outbound `GmailMessageLink` rows are written with `contentType: text/plain`.
- RT fallback records and displays app replies as plain text.

The repository already has HTML email parsing, sanitization, and rendering for
inbound messages. The feature should reuse those boundaries instead of adding a
second email display system.

## Scope Decisions

1. Use Tiptap with a custom toolbar styled to match the existing mailbox UI and
   Gmail's familiar composer controls.
2. Only Reply uses the rich-text editor. Internal note stays a plain `<textarea>`.
3. The toolbar includes:
   - font family
   - font size
   - bold
   - italic
   - underline
   - text color
   - text alignment
   - bulleted list
   - numbered list
   - block quote
   - indent and outdent
   - link
   - emoji insertion
   - undo and redo
   - clear formatting
4. The editor exports sanitized HTML for the HTML MIME part and readable plain
   text for the fallback MIME part.
5. The server remains the trust boundary. It sanitizes the HTML before SMTP,
   persistence, and RT mirroring; client-generated HTML is never trusted.
6. Existing attachments, Gmail `In-Reply-To`/`References` headers, readback,
   response metrics, and thread identity behavior remain unchanged.
7. No inline-image, Google Drive, signature, quick-reply/template, draft, or
   confidential-mode feature is included in this phase.
8. The acceptance baseline is Gmail, Outlook, and Apple Mail using
   email-compatible HTML/CSS. A client that does not render HTML must still
   receive the plain-text body.

## User Experience

### Reply mode

The Reply tab replaces its textarea with a rich editor. The editor has a
visible toolbar arranged in compact groups:

1. Font family and font size.
2. Bold, italic, underline, and text color.
3. Alignment, bulleted list, numbered list, indent, and outdent.
4. Quote, link, and emoji.
5. Undo, redo, and clear formatting.

Toolbar buttons must have accessible labels and tooltips. The selected state
must be visible for active marks and alignment. Buttons must not steal the
editor selection when they are clicked, so formatting applies to the current
selection or insertion point.

Keyboard behavior should follow normal editor conventions:

- `Cmd/Ctrl+B` toggles bold.
- `Cmd/Ctrl+I` toggles italic.
- `Cmd/Ctrl+U` toggles underline.
- `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` undo and redo.
- Enter creates a new paragraph.
- Shift+Enter creates a line break within the paragraph.

The Reply button is disabled when the editor contains no meaningful text or
while a reply is sending. Existing attachment chips and attachment upload
behavior remain in the composer footer.

### Internal note mode

Internal note continues to render the existing plain-text textarea. Switching
between Reply and Internal note must not convert content between HTML and plain
text, and the rich-text toolbar is hidden in Internal note mode.

### Format definitions

The editor uses email-safe output:

- Font family is limited to common fonts such as Arial, Georgia, Tahoma,
  `Times New Roman`, Trebuchet MS, and Verdana.
- Font size is limited to named small, normal, large, and huge choices that map
  to conservative pixel values.
- Text color uses a fixed safe palette plus the editor's default color.
- Alignment maps to left, center, right, and justified paragraphs.
- Lists use semantic ordered and unordered list HTML.
- Quote uses semantic `blockquote` HTML.
- Indent/outdent nests list items when the selection is in a list. For normal
  paragraphs it uses one of four fixed left margins: `0`, `24`, `48`, or
  `72px`; outdent cannot go below `0`. It must not emit arbitrary user CSS.
- Links accept `http`, `https`, and `mailto` URLs only and open in a new tab
  when rendered in the mailbox.
- Emoji is inserted as Unicode text, with no external image dependency.

## Architecture

### Editor boundary

Create a focused client component for the Reply editor. It owns Tiptap's
editor instance, toolbar commands, selection state, and conversion from editor
content to the send payload.

The component exposes a controlled boundary equivalent to:

```ts
interface ReplyComposerValue {
  html: string;
  text: string;
}

interface ReplyEditorProps {
  value: ReplyComposerValue;
  disabled?: boolean;
  onChange: (value: ReplyComposerValue) => void;
}
```

`ConversationDetail` decides whether to render this component or the existing
plain-text Internal note textarea. The page-level mailbox client stores the
Reply value and sends it through the existing conversation route.

Tiptap state is client-only and is not persisted as JSON. HTML is the transport
and email representation; JSON is not added to the database or API contract.

### Send data flow

```text
Tiptap editor
  -> HTML + readable text
  -> mailbox client POST
  -> schema validation
  -> server-side HTML sanitization
  -> server-derived plain-text fallback
  -> Nodemailer text/plain + text/html multipart email
  -> Gmail readback and thread validation
  -> GmailMessageLink body/contentType persistence
  -> thread display
```

The server derives the final plain-text fallback from the sanitized HTML when a
rich Reply is supplied. The client-provided `text` is used for validation and
compatibility checks but is not trusted as the security boundary.

### API contract

Extend the existing reply payload without breaking legacy plain-text callers:

```ts
{
  text: string;
  html?: string;
  attachmentIds?: string[];
}
```

Rules:

- `text` remains required and has the existing 50,000-character limit.
- `html` is optional for backwards compatibility and is limited to 150,000
  characters both before and after sanitization to prevent oversized payloads.
- If `html` is absent, the existing plain-text send path remains unchanged.
- If `html` is present, the server sanitizes it, derives the final fallback,
  and sends the HTML multipart form. The client-provided `text` is checked for
  the existing 50,000-character and non-empty constraints but is not treated
  as the authoritative body after HTML is accepted.
- Internal note requests continue to accept only `{ text }`.

### SMTP contract

Extend `GmailReplyInput` with an optional sanitized `html` field. The send
message continues to include all existing threading headers and attachments,
and adds:

```ts
{
  text: plainTextBody,
  html: sanitizedHtmlBody,
}
```

Nodemailer generates the multipart representation. No change is made to Gmail
thread lookup, generated Message-ID handling, Sent-label readback, or thread
ID validation.

### Persistence and display

For a rich Reply:

- `GmailMessageLink.body` stores the sanitized HTML body.
- `GmailMessageLink.contentType` stores `text/html`.
- The plain-text fallback is sent through SMTP but does not require a second
  database body column.

For a legacy plain-text Reply, persistence remains `text/plain`.

Gmail detail already prefers HTML message bodies and the existing
`EmailBodyRenderer` sanitizes/render them in an isolated frame. The rich Reply
path should feed that existing renderer after Gmail readback.

When Gmail detail cannot be fetched and RT history is used as a fallback, the
app-sent reply marker must preserve the sanitized body and its content type so
the fallback can render formatted content. The parser must continue to
recognize existing plain-text marker records.

## Sanitization and Security

The server-side sanitizer must:

- allow only the semantic tags required by the toolbar: paragraphs, line
  breaks, strong/bold, emphasis/italic, underline, lists, list items,
  blockquotes, links, and safe spans;
- allow only the attributes required for those tags;
- allow only `http`, `https`, and `mailto` links;
- remove scripts, forms, event-handler attributes, iframes, embedded objects,
  tracking markup, and unsupported URL schemes;
- restrict inline style properties to `font-family`, `font-size`, `color`,
  `text-align`, and the four fixed `margin-left` values used by indent;
- reject or normalize malformed HTML rather than sending it as raw content;
- apply the same sanitized value to SMTP, DB persistence, and RT fallback.

The sanitizer must not permit arbitrary CSS, external JavaScript, remote
actions, or data URLs in this phase. Emoji remains Unicode text. Inline images
are explicitly out of scope.

## Compatibility and Error Handling

- Gmail, Outlook, and Apple Mail receive both MIME alternatives. Clients that
  support HTML display the formatted body; plain-text clients display the
  fallback.
- Unsupported formatting is normalized to readable text rather than failing
  the entire send.
- If the HTML payload exceeds its server limit, return the existing validation
  error shape with a specific field error for `html`.
- If sanitization produces no meaningful text, reject the reply before SMTP.
- If Gmail readback fails after SMTP acceptance, preserve the existing
  `gmail_reply_not_found`, Sent-label, and thread-mismatch behavior.
- Reply failures must leave the composer content and attachments available for
  retry, as they do today.
- Legacy plain-text requests and existing stored plain-text messages continue
  to render and send normally.

## Testing Strategy

### Unit and source-contract tests

Add focused tests proving:

- The Reply editor emits expected HTML and plain-text values for bold, italic,
  underline, font, size, color, alignment, lists, quote, indent, links, and
  emoji.
- Undo and redo update the editor value correctly.
- Internal note mode does not render the rich editor or toolbar.
- Reply validation accepts the rich payload and preserves legacy plain text.
- Oversized HTML and empty-after-sanitization payloads are rejected.
- Unsafe tags, attributes, styles, and URL schemes are removed.
- `sendGmailThreadReply` passes both `text` and `html` while preserving
  threading headers and attachments.
- Rich outbound links persist as `text/html`; legacy outbound links persist as
  `text/plain`.
- RT fallback parses both new rich marker records and old plain marker records.

### Manual compatibility verification

Using a disposable mailbox and non-sensitive test content, send a reply that
contains every in-scope format. Verify:

1. Gmail shows the formatted content and preserves the conversation thread.
2. Outlook shows the formatted content without broken layout or unsafe markup.
3. Apple Mail shows the formatted content without broken layout or unsafe
   markup.
4. A plain-text view still contains all meaningful text in readable order.
5. Reopening the conversation in the app renders the outbound HTML correctly.
6. An attachment can still be sent together with a rich Reply.
7. Internal note remains plain text and does not affect customer email HTML.

## Acceptance Criteria

1. Reply displays a Gmail-like full toolbar with the approved controls.
2. Agents can compose and send formatted Replies with attachments.
3. Gmail, Outlook, and Apple Mail receive readable formatted HTML plus a
   plain-text fallback.
4. Existing Gmail thread headers, Sent readback, response metrics, and thread
   identity checks remain intact.
5. Outbound rich Replies reopen in the app with the expected formatting.
6. Internal notes remain plain text with no rich-text toolbar.
7. Unsafe HTML cannot reach SMTP, persistence, RT mirroring, or app rendering.
8. Existing plain-text replies and historical plain-text messages continue to
   work.
9. Focused automated tests cover editor output, sanitization, SMTP payload,
   persistence, display fallback, and backwards compatibility.

## Out of Scope

- Inline images and CID attachment mapping.
- Google Drive picker/insertion.
- Mailbox or user signatures.
- Quick reply/template management.
- Draft autosave or draft recovery.
- Gmail confidential mode.
- Collaborative editing or cross-device editor state.
- Changing Internal note storage or display from plain text.

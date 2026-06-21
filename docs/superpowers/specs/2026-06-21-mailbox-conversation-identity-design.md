# Mailbox Conversation Identity And Email Viewer Design

## Goal

Mailbox conversation rows must show the real sender identity instead of generated fallback labels such as `Customer #69`.

The email detail panel must render messages like a normal inbox. HTML emails should preserve layout, spacing, links, and images instead of collapsing into plain text. Admin users should see the email first, with technical actions moved out of the main body.

The detail panel already has access to `threads[0].from` and can show the real sender after a conversation is opened. The list view needs the same identity without issuing one detail request per row.

## Current Problem

`MailboxesClient` receives conversations with `customerId`, `subject`, `status`, timestamps, and counts. It does not receive the sender name or email for each row.

Because the list lacks sender fields, the UI falls back to `Customer #<customerId>`. This is better than fake names, but still wrong when Zammad has a real sender such as `OpenAI <noreply@tm.openai.com>`.

The current email body renderer also does not look like Gmail. HTML email content is rendered inside the app surface, which can lose the original email layout and make transactional messages look like one large plain-text block. Technical controls and labels are too close to the primary reading area.

## Conversation Identity Design

Enrich the conversation list API response with sender identity:

```ts
fromName?: string;
fromEmail?: string;
```

The mailbox proxy should derive those fields from Zammad ticket articles when building the conversation list. It should prefer a non-internal email article with a usable `from` value. If several article candidates are available, use the article that best represents the customer-facing sender for the conversation list.

Parsing rules:

1. Parse `"Name" <email@example.com>` into `fromName = "Name"` and `fromEmail = "email@example.com"`.
2. Parse `Name <email@example.com>` the same way.
3. If only an email exists, use it as `fromEmail` and also as display fallback.
4. If no email can be parsed but raw sender text exists, use it as `fromName`.
5. If no sender exists, fall back to `Customer #<customerId>`.

The UI list should render:

```ts
const displayName = conversation.fromName || conversation.fromEmail || `Customer #${conversation.customerId}`;
```

Avatar initials should use the same `displayName`.

The detail header should continue using the opened thread data, but it should rely on the same parsing helper so list and detail behavior remain consistent.

The mailbox rail and conversation filters must not show fake counts. If a section such as `Unassigned`, `Mentions`, `Snoozed`, `Channels`, or `Views` does not have real backend data, hide it from the default UI. Keep only real status filters such as `New`, `Pending`, and `Resolved`.

## Gmail-Like Email Viewer Design

The detail panel should prioritize reading the email:

1. Compact conversation header with sender name, sender email, status, store, and message menu.
2. Optional contextual cards such as order metadata, kept visually secondary.
3. Message card with clean email metadata and rendered body.
4. Real attachments section, only when attachments are user-facing files.
5. Internal notes after the message body.
6. Reply composer sticky at the bottom of the detail panel.

HTML email body rendering should move to a dedicated `EmailBodyFrame` or equivalent component:

- Render `text/html` bodies inside a sandboxed iframe.
- Show remote images by default.
- Sanitize scripts, forms, inline event handlers, dangerous URLs, and unsafe attributes before rendering.
- Force external links to open with `target="_blank"` and `rel="noopener noreferrer"`.
- Let the iframe resize to fit its content where practical, while the surrounding detail body remains scrollable.
- Keep app CSS isolated from email CSS.

Plain-text rendering remains available as fallback:

```css
white-space: pre-wrap;
overflow-wrap: anywhere;
line-height: 1.6;
```

Plain text should use normal inbox typography. It must not be enlarged into a marketing-style content block.

Technical controls move to the message overflow menu:

- View original
- Show plain text
- Download `.eml` if raw source is available

The main body must not show `HTML email`, `message.html`, `View source`, or similar debug controls as primary content.

## Data Flow

1. UI requests `/api/mailbox-proxy/conversations`.
2. Proxy fetches Zammad tickets/conversations as it does today.
3. Proxy obtains or reuses article metadata needed to identify the sender.
4. Proxy normalizes sender identity into `fromName` and `fromEmail`.
5. UI renders list rows from these fields.
6. When the user opens a conversation, detail view still loads the full thread body and can refine the displayed sender from article data.
7. Detail view sends each article body to the email body renderer with `contentType`, sanitized HTML, text fallback, and attachment metadata.

## Error Handling

Sender enrichment must be best-effort. A missing, malformed, or unavailable sender must not fail the conversation list request.

If Zammad article lookup fails for one conversation, return the conversation with no `fromName/fromEmail` and let the UI use the fallback label. Do not show fake names.

If HTML rendering fails, the message should fall back to readable plain text for that article. Rendering failure must not hide the whole conversation or composer.

If an attachment cannot be classified as user-facing, hide known technical artifacts such as `message.html` from the primary attachment list.

## Out Of Scope

- Do not fetch every conversation detail from the frontend.
- Do not keep fake names such as Daniel Lee or Noah Brown.
- Do not implement fake counts for filters such as Unassigned, Mentions, or Snoozed.
- Do not build account-level remote image preferences in this change. Remote images are shown by default for now.
- Do not implement raw `.eml` download unless the backend already exposes raw source safely.

## Tests

Add focused coverage for:

- Sender parser handles quoted name plus email.
- Sender parser handles bare email.
- Conversation normalization includes `fromName/fromEmail`.
- UI list prefers `fromName`, then `fromEmail`, then `Customer #id`.
- Missing sender does not break the list response.
- HTML email renders through the email frame path.
- Plain text preserves newlines and spacing.
- Sanitization removes scripts and inline event handlers.
- External links are opened safely.
- `message.html` is not shown as a primary attachment when it is a technical artifact.

## Acceptance Criteria

- Conversation rows show real sender names/emails when Zammad provides them.
- `Customer #id` appears only when no sender identity is available.
- No random/generated human names remain in mailbox UI.
- Conversation list avoids frontend N+1 detail calls.
- Existing detail view sender rendering remains correct.
- Default detail view reads like an inbox, not a debug panel.
- HTML emails preserve layout closely enough for transactional emails such as OpenAI or Google notifications.
- Remote images display by default after sanitization.
- Technical controls live in overflow menus, not the body.
- Composer remains visible at the bottom of the detail panel while the email body scrolls above it.

# Mailbox Composer Missing Features Plan

## Scope

Implement real backend support for composer features that currently only have UI entry points:

- Internal note persistence.
- Reply attachments.
- Quick reply/templates.
- More composer options such as signature/draft settings.

## Current State

- Reply text is already wired to Gmail send through `/api/mailbox-proxy/conversations/:id/threads`.
- Email body attachments are displayed when imported from RT/Gmail.
- There is no mailbox API route for saving internal-only notes.
- There is no reply attachment upload/send contract in `sendGmailThreadReply`.
- There is no quick reply/template model for mailbox replies.

## Implementation Plan

1. Internal notes
   - Add a `MailboxInternalNote` model or extend the existing thread/article snapshot with `displayType = internal`.
   - Add `POST /api/mailbox-proxy/conversations/:id/internal-notes`.
   - Render saved notes in the conversation thread with `displayType: "internal"`.
   - Include actor user id and created timestamp.

2. Reply attachments
   - Add upload endpoint or reuse existing file storage for temporary composer attachments.
   - Extend reply payload with attachment ids.
   - Extend Gmail SMTP send to include attachments.
   - Persist outbound attachment metadata in `GmailMessageLink`/thread snapshot after Gmail readback.

3. Quick replies/templates
   - Add mailbox/store-scoped template model.
   - Add CRUD UI under mailbox settings or a composer menu.
   - Insert selected template into the current reply/note editor.

4. Composer options
   - Add signature setting per mailbox.
   - Auto-append signature to replies.
   - Keep future draft scheduling as a separate phase because it needs durable draft state and worker execution.

## Verification

- Unit tests for validation and persistence.
- Source contract tests for UI actions.
- Focused API tests for internal note create/list and attachment reply payload.
- Live mailbox smoke: send a reply with attachment, confirm Gmail Sent, confirm imported thread renders attachment.

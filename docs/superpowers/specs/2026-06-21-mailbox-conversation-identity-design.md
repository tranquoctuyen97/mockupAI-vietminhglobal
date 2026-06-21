# Mailbox Conversation Identity Design

## Goal

Mailbox conversation rows must show the real sender identity instead of generated fallback labels such as `Customer #69`.

The detail panel already has access to `threads[0].from` and can show the real sender after a conversation is opened. The list view needs the same identity without issuing one detail request per row.

## Current Problem

`MailboxesClient` receives conversations with `customerId`, `subject`, `status`, timestamps, and counts. It does not receive the sender name or email for each row.

Because the list lacks sender fields, the UI falls back to `Customer #<customerId>`. This is better than fake names, but still wrong when Zammad has a real sender such as `OpenAI <noreply@tm.openai.com>`.

## Design

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

## Data Flow

1. UI requests `/api/mailbox-proxy/conversations`.
2. Proxy fetches Zammad tickets/conversations as it does today.
3. Proxy obtains or reuses article metadata needed to identify the sender.
4. Proxy normalizes sender identity into `fromName` and `fromEmail`.
5. UI renders list rows from these fields.
6. When the user opens a conversation, detail view still loads the full thread body and can refine the displayed sender from article data.

## Error Handling

Sender enrichment must be best-effort. A missing, malformed, or unavailable sender must not fail the conversation list request.

If Zammad article lookup fails for one conversation, return the conversation with no `fromName/fromEmail` and let the UI use the fallback label. Do not show fake names.

## Out Of Scope

- Do not fetch every conversation detail from the frontend.
- Do not keep fake names such as Daniel Lee or Noah Brown.
- Do not redesign the full Gmail-like email body renderer in this change.
- Do not implement fake counts for filters such as Unassigned, Mentions, or Snoozed.

## Tests

Add focused coverage for:

- Sender parser handles quoted name plus email.
- Sender parser handles bare email.
- Conversation normalization includes `fromName/fromEmail`.
- UI list prefers `fromName`, then `fromEmail`, then `Customer #id`.
- Missing sender does not break the list response.

## Acceptance Criteria

- Conversation rows show real sender names/emails when Zammad provides them.
- `Customer #id` appears only when no sender identity is available.
- No random/generated human names remain in mailbox UI.
- Conversation list avoids frontend N+1 detail calls.
- Existing detail view sender rendering remains correct.

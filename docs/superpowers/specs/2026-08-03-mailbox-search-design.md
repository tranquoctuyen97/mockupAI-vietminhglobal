# Mailbox conversation search (subject + content)

## Problem

The Mailboxes tab (`src/app/(authed)/mailboxes/MailboxesClient.tsx`) has no way to
search conversations. The sidebar has a "Search labels" input, but that only
filters the label list — there is no way to find a conversation by subject or
message content, unlike Gmail's search bar.

## Goal

Add a Gmail-style search box to the Mailboxes tab that matches against a
conversation's subject and its latest-message preview, scoped to the currently
selected mailbox, searching across the whole mailbox regardless of which
view/label is selected.

## Non-goals

- Searching across multiple mailboxes/stores at once.
- Searching the full message history (`GmailMessageLink.body`) of every message
  in a thread — only the conversation's `subject` and `latestMessagePreview`
  (the same snippet already shown in the list) are searched. This is a
  substring match, not a threaded email search engine.
- Highlighting the matched snippet in results.
- Full-text ranking/relevance scoring, `from:`/`in:`-style search operators.
- New indexes on `subject`/`latestMessagePreview` — not needed at current
  scale (see Known limitations).

## Behavior

- **Scope**: search runs against the currently selected mailbox only
  (`mailboxId`), matching `subject` OR `latestMessagePreview`, case-insensitive
  substring match.
- **Filter interaction**: while a search query is active, it **replaces** the
  current view/label/status filter — results come from the whole mailbox
  (Inbox + Sent + every label), not just the view that was open when typing
  started. Selecting a label/view while search is active clears the search
  and returns to that label's normal (unfiltered) list.
- **Timing**: debounced live search — results update automatically ~350ms
  after the user stops typing. No explicit submit/Enter needed.
- **Sidebar**: stays visible during search, but no label/view item is shown as
  "active", since results don't belong to any single view.
- **Clearing** the search box (or clicking a label) returns to whatever
  label/view was selected before searching.
- **Empty query** (or whitespace-only) is treated as "not searching" on both
  client and server.

## UI placement

A full-width search input goes inside the page `<header>`, directly below the
store/mailbox switcher row (`storeSwitcherRow`, currently
`MailboxesClient.tsx:1038-1048`) and above the two-pane
`<section style={inboxGridStyle}>` (`MailboxesClient.tsx:1094`). It spans the
full width, above both the filter rail and the conversation list — mirroring
Gmail's search bar sitting above its inbox tabs. Placeholder: "Search subject
or content...". Shows a search icon; shows a clear (×) button when non-empty.

## Backend changes

File: `src/app/api/mailbox-proxy/[...path]/route.ts`

`mailboxConversationWhere` (currently lines 351-369) gains an optional `q`:

```ts
function mailboxConversationWhere(input: {
  mailboxId: string;
  status?: AppStatus;
  labelId?: string | null;
  q?: string;
}) {
  const trimmedQ = input.q?.trim();
  return {
    mailboxId: input.mailboxId,
    ...(trimmedQ
      ? {
          OR: [
            { subject: { contains: trimmedQ, mode: "insensitive" as const } },
            { latestMessagePreview: { contains: trimmedQ, mode: "insensitive" as const } },
          ],
        }
      : {
          ...(input.status ? { status: input.status } : {}),
          ...(input.labelId ? { labels: { some: { labelId: input.labelId } } } : {}),
        }),
  };
}
```

When `q` is present, `status` and `labelId` are ignored entirely — this is
what implements "search replaces the current filter".

`handleListConversations` (currently lines 743-804) reads `q` from
`url.searchParams`, trims it, and passes it through to
`mailboxConversationWhere`. Count + `findMany` + `orderBy` + pagination stay
unchanged.

## Frontend changes

File: `src/app/(authed)/mailboxes/MailboxesClient.tsx`

1. **New state**: `searchQuery` (raw input value) and `debouncedQuery`
   (committed after ~350ms of no typing). `searchActive =
   debouncedQuery.trim().length > 0`.

2. **`loadConversations`** (currently lines 663-719):
   - The early-return guard on line 666
     (`if (labels.length > 0 && !effectiveSelectedLabelId) return;`) must not
     apply while `searchActive` — search doesn't depend on a label being
     selected.
   - When `searchActive`, the request sends `q=<debouncedQuery.trim()>`
     instead of `labelId`. Otherwise, behavior is unchanged.
   - `debouncedQuery` is added to the hook's dependency array (currently
     lines 711-719).
   - The client-side page cache key (`conversationPageCacheKey`, line 668)
     must include `debouncedQuery.trim()`, otherwise switching search on/off
     at the same page number can render a stale cached page from the other
     state.

3. **Cache/page invalidation** (currently lines 721-723): the effect that
   clears the conversation page cache adds `debouncedQuery` to its
   dependencies; changing the query also resets `currentPage` to `1`.

4. **Clearing search on label click** (`onLabel` handler, currently lines
   1105-1111): also resets `searchQuery`/`debouncedQuery` to `""`.

5. **Clearing search on mailbox/store change**: the effect that reloads
   labels on mailbox/store change (currently lines 725-749) also resets
   `searchQuery`/`debouncedQuery`, so a query typed in one mailbox doesn't
   leak into another.

6. **Sidebar highlight** (`FilterRail` props, currently line 1099): pass
   `selectedLabelId={searchActive ? null : effectiveSelectedLabelId}` so no
   Inbox/Sent/label item renders as active during search — no prop threading
   needed beyond this.

7. **List header** (currently lines 1127-1128): while `searchActive`, the
   title becomes `Search results for "<query>"` and the result count is
   always shown (the existing `isInboxView ? null : totalConversations`
   suppression only applies when not searching).

## Known limitations (accepted, not engineered around)

- Prisma's `contains` does not escape SQL LIKE metacharacters (`%`, `_`) in
  user input. A query containing those characters matches more broadly than
  a literal substring search would (e.g. `%` acts as a wildcard). This is not
  a SQL injection risk (the value is parameterized), only a precision quirk.
- No new database index is added. At the current and near-term scale
  (production mailboxes seen up to ~14k conversations), an `ILIKE` sequential
  scan over `subject`/`latest_message_preview` is fast enough for a debounced
  search. If a mailbox grows past roughly 50k conversations and search
  becomes noticeably slow, revisit with a `pg_trgm` GIN index on those two
  columns.

## Testing plan

- API: `handleListConversations` with `q` — matches on `subject` and on
  `latestMessagePreview` independently, case-insensitive, trims whitespace,
  ignores `labelId`/`status` when `q` is present, and treats
  empty/whitespace-only `q` as absent.
- Manual UI: search term present in subject; present only in preview; not
  found (empty state); typing then clearing (returns to prior view); clicking
  a different label while searching (clears search); switching mailbox while
  searching (clears search); paginating through search results.

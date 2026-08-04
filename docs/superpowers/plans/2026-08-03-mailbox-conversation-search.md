# Mailbox Conversation Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Gmail-style search box to the Mailboxes tab that finds conversations by subject or latest-message-preview content, scoped to the current mailbox, ignoring whatever view/label is currently selected.

**Architecture:** Extend the existing `/api/mailbox-proxy/conversations` GET handler with an optional `q` query param that, when present, replaces the `status`/`labelId` filter with a case-insensitive `OR` match on `MailboxConversation.subject` and `MailboxConversation.latestMessagePreview`. The mailbox UI (`MailboxesClient.tsx`) gets a debounced search input wired into the same `loadConversations` fetch/pagination/cache path already used for label browsing — no new endpoint, no new component tree, no new DB index.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Vitest, existing `/api/mailbox-proxy/[...path]` route.

**Approved spec:** `docs/superpowers/specs/2026-08-03-mailbox-search-design.md`

**Commit policy:** Do not run `git add` or `git commit`. The repository owner stages and commits manually. Each task ends with a verification step instead of a commit step.

## Global Constraints

- Search matches only `MailboxConversation.subject` and `MailboxConversation.latestMessagePreview` — do not join `GmailMessageLink` or search full message bodies (out of scope per spec).
- When a search query (`q`) is present, `status` and `labelId` filters are ignored entirely — search always runs against the whole mailbox.
- No new Prisma migration and no new index — `ILIKE` substring match on the two existing text columns is accepted as fast enough at current scale (see spec's Known Limitations).
- Empty or whitespace-only `q` is treated as "not searching" on both the client and the server.
- Follow `AGENTS.md`: static top-level imports only, no dynamic `await import()`.

---

## File Map

- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts` — `mailboxConversationWhere` gains an optional `q`; `handleListConversations` reads `q` from the query string.
- Create: `tests/mailbox-conversation-search-source.test.ts` — source contract for the backend `q` handling.
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx` — search state, debounce, fetch wiring, cache key, and the search input UI.
- Create: `src/app/(authed)/mailboxes/mailbox-search-ui-source.test.ts` — source contract for the frontend search wiring.

---

### Task 1: Backend — Search Filter On The Conversations Endpoint

**Files:**
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
- Create: `tests/mailbox-conversation-search-source.test.ts`

**Interfaces:**
- Produces: `mailboxConversationWhere(input: { mailboxId: string; status?: AppStatus; labelId?: string | null; q?: string })` — the `q` field is new; when `q` trims to a non-empty string, the returned where-clause is `{ mailboxId, OR: [{ subject: { contains, mode: "insensitive" } }, { latestMessagePreview: { contains, mode: "insensitive" } }] }` and `status`/`labelId` are omitted.
- Produces: `handleListConversations` now reads `url.searchParams.get("q")` and passes its trimmed value through to `mailboxConversationWhere`. Response shape (`{ conversations, page }`) is unchanged.

- [ ] **Step 1: Write the failing source test**

Create `tests/mailbox-conversation-search-source.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function functionBody(source: string, name: string) {
  const start = source.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nasync function ", start + 1);
  const nextSync = source.indexOf("\nfunction ", start + 1);
  const candidates = [next, nextSync].filter((index) => index !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

describe("mailbox conversation search source", () => {
  const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

  it("builds a mailbox-wide OR filter on subject and latest preview when q is present", () => {
    const whereBody = functionBody(source, "mailboxConversationWhere");

    expect(whereBody).toContain("q?: string");
    expect(whereBody).toContain("input.q?.trim()");
    expect(whereBody).toContain('subject: { contains: trimmedQ, mode: "insensitive"');
    expect(whereBody).toContain('latestMessagePreview: { contains: trimmedQ, mode: "insensitive"');
  });

  it("ignores status and labelId once a search query is present", () => {
    const whereBody = functionBody(source, "mailboxConversationWhere");

    expect(whereBody).toMatch(/trimmedQ\s*\?\s*\{\s*OR:/);
    expect(whereBody.indexOf("OR:")).toBeLessThan(whereBody.indexOf("input.status"));
    expect(whereBody.indexOf("OR:")).toBeLessThan(whereBody.indexOf("input.labelId"));
  });

  it("reads q from the request and forwards it to the where builder", () => {
    const listBody = functionBody(source, "handleListConversations");

    expect(listBody).toContain('url.searchParams.get("q")');
    expect(listBody).toContain("labelId: selectedLabel?.id ?? null,\n    q,");
    expect(listBody).toContain("q:");
    expect(listBody).toContain("mailboxConversationWhere({");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run tests/mailbox-conversation-search-source.test.ts
```

Expected: FAIL — `mailboxConversationWhere` has no `q` handling yet and `handleListConversations` doesn't read `q`.

- [ ] **Step 3: Add `q` support to `mailboxConversationWhere`**

In `src/app/api/mailbox-proxy/[...path]/route.ts`, replace the current function (existing lines 351-369):

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
          ...(input.labelId
            ? {
                labels: {
                  some: {
                    labelId: input.labelId,
                  },
                },
              }
            : {}),
        }),
  };
}
```

- [ ] **Step 4: Read `q` in `handleListConversations`**

In the same file, inside `handleListConversations` (existing lines 743-766), after the existing `labelId` lookup and before building `where`, add:

```ts
  const q = url.searchParams.get("q") ?? undefined;
```

Then update the `where` construction to pass it through:

```ts
  const where = mailboxConversationWhere({
    mailboxId: mailbox.id,
    status: effectiveStatus,
    labelId: selectedLabel?.id ?? null,
    q,
  });
```

Leave the rest of `handleListConversations` (the `Promise.all` count/`findMany`, `orderBy`, pagination, and response shape) unchanged.

- [ ] **Step 5: Run the test and verify it passes**

Run:

```bash
npx vitest run tests/mailbox-conversation-search-source.test.ts
```

Expected: PASS.

---

### Task 2: Frontend — Search Input, Debounce, And Fetch Wiring

**Files:**
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`
- Create: `src/app/(authed)/mailboxes/mailbox-search-ui-source.test.ts`

**Interfaces:**
- Consumes: the `q` query param support added in Task 1 (`GET /api/mailbox-proxy/conversations?...&q=<term>`).
- Produces: `searchQuery` (raw input state), `debouncedQuery` (committed ~350ms after typing stops), `searchActive` (`debouncedQuery.trim().length > 0`) — later UI code in this same task reads all three.

- [ ] **Step 1: Write the failing source test**

Create `src/app/(authed)/mailboxes/mailbox-search-ui-source.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox conversation search UI source", () => {
  const source = readFileSync("src/app/(authed)/mailboxes/MailboxesClient.tsx", "utf8");

  it("debounces the search query into a committed value", () => {
    expect(source).toContain('const [searchQuery, setSearchQuery] = useState("")');
    expect(source).toContain('const [debouncedQuery, setDebouncedQuery] = useState("")');
    expect(source).toContain("setTimeout(() => setDebouncedQuery(searchQuery), 350)");
    expect(source).toContain("const searchActive = debouncedQuery.trim().length > 0");
  });

  it("sends q instead of labelId while searching and bypasses the label-required guard", () => {
    expect(source).toContain("if (!searchActive && labels.length > 0 && !effectiveSelectedLabelId) return;");
    expect(source).toContain('qs.set("q", debouncedQuery.trim())');
  });

  it("includes the query in the conversation page cache key", () => {
    expect(source).toContain('searchActive ? `q:${debouncedQuery.trim()}` : (effectiveSelectedLabelId ?? "")');
  });

  it("resets to page 1 when the committed query changes", () => {
    expect(source).toContain("setCurrentPage(1);\n  }, [debouncedQuery]);");
  });

  it("clears search when switching store, mailbox, or label", () => {
    expect(source).toContain('setSelectedMailbox(null);\n    setSearchQuery("");');
    expect(source).toContain('setDebouncedQuery("");\n    const mailbox = mailboxes.find');
    expect(source).toContain("setSelectedLabelId(labelId);\n                setSearchQuery(\"\");");
  });

  it("renders a full-width search bar below the store switcher", () => {
    expect(source).toContain('placeholder="Search subject or content..."');
    expect(source).toContain("value={searchQuery}");
    expect(source).toContain("onChange={(event) => setSearchQuery(event.target.value)}");
    expect(source).toContain("aria-label=\"Clear search\"");
  });

  it("hides the active label highlight and relabels the list while searching", () => {
    expect(source).toContain("selectedLabelId={searchActive ? null : effectiveSelectedLabelId}");
    expect(source).toContain('title={searchActive ? `Search results for "${debouncedQuery.trim()}"` : conversationListTitle}');
    expect(source).toContain("total={searchActive ? totalConversations : (isInboxView ? null : totalConversations)}");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run "src/app/(authed)/mailboxes/mailbox-search-ui-source.test.ts"
```

Expected: FAIL — none of this exists yet.

- [ ] **Step 3: Add the `Search` icon import**

In `src/app/(authed)/mailboxes/MailboxesClient.tsx`, the `lucide-react` import (existing lines 3-19) already imports `X`. Add `Search` to the same import list, keeping alphabetical order:

```ts
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clock3,
  Inbox,
  Mail,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  StickyNote,
  X,
} from "lucide-react";
```

- [ ] **Step 4: Add search state and the debounce effect**

Add the two new state fields next to `selectedLabelId` (existing line 193):

```ts
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
```

Add the debounce effect right after the `conversationPageCacheKey`/`clearConversationPageCache` declarations (existing lines 249-262), before `chooseStore`:

```ts
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchQuery), 350);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedQuery]);
```

- [ ] **Step 5: Derive `searchActive` and use it in the page cache key**

Add the derived constant next to `effectiveSelectedLabelId` (existing line 232):

```ts
  const effectiveSelectedLabelId = selectedLabelId ?? inboxLabel?.id ?? null;
  const searchActive = debouncedQuery.trim().length > 0;
```

Update `conversationPageCacheKey` (existing lines 249-259) to key on the query while searching instead of the label:

```ts
  const conversationPageCacheKey = useCallback(
    (page: number, pageSize: number) =>
      [
        selectedStoreId ?? "",
        selectedMailbox?.id ?? "",
        searchActive ? `q:${debouncedQuery.trim()}` : (effectiveSelectedLabelId ?? ""),
        page,
        pageSize,
      ].join(":"),
    [selectedStoreId, selectedMailbox?.id, effectiveSelectedLabelId, searchActive, debouncedQuery],
  );
```

Update the cache-clearing effect right below it (existing lines 721-723) to also clear on query change:

```ts
  useEffect(() => {
    clearConversationPageCache();
  }, [selectedStoreId, selectedMailbox?.id, effectiveSelectedLabelId, debouncedQuery, clearConversationPageCache]);
```

- [ ] **Step 6: Bypass the label-required guard and send `q` in `loadConversations`**

In `loadConversations` (existing lines 663-719):

Change the early-return guard (existing line 666) from:

```ts
    if (labels.length > 0 && !effectiveSelectedLabelId) return;
```

to:

```ts
    if (!searchActive && labels.length > 0 && !effectiveSelectedLabelId) return;
```

Change the query-string construction (existing lines 676-682) from:

```ts
      const qs = new URLSearchParams({
        storeId: selectedStoreId,
        mailboxId: String(selectedMailbox.id),
        page: String(currentPage),
        pageSize: String(pageSize),
      });
      if (effectiveSelectedLabelId) qs.set("labelId", effectiveSelectedLabelId);
```

to:

```ts
      const qs = new URLSearchParams({
        storeId: selectedStoreId,
        mailboxId: String(selectedMailbox.id),
        page: String(currentPage),
        pageSize: String(pageSize),
      });
      if (searchActive) {
        qs.set("q", debouncedQuery.trim());
      } else if (effectiveSelectedLabelId) {
        qs.set("labelId", effectiveSelectedLabelId);
      }
```

Add `searchActive` and `debouncedQuery` to the hook's dependency array (existing lines 711-719):

```ts
  }, [
    selectedMailbox,
    selectedStoreId,
    effectiveSelectedLabelId,
    currentPage,
    labels.length,
    labelsReady,
    conversationPageCacheKey,
    searchActive,
    debouncedQuery,
  ]);
```

- [ ] **Step 7: Clear search when switching store, mailbox, or label**

In `chooseStore` (existing lines 264-283), add a reset next to the other state resets:

```ts
  const chooseStore = (storeId: string | null) => {
    clearConversationPageCache();
    setSelectedStoreId(storeId);
    setSelectedMailbox(null);
    setSearchQuery("");
    setDebouncedQuery("");
    setLabels([]);
```

In `chooseMailbox` (existing lines 751-765), add the same reset:

```ts
  const chooseMailbox = (mailboxId: string) => {
    clearConversationPageCache();
    setSearchQuery("");
    setDebouncedQuery("");
    const mailbox = mailboxes.find((candidate) => candidate.id === mailboxId) ?? null;
```

In the `FilterRail`'s `onLabel` callback at the call site (existing lines 1105-1111), add the same reset:

```ts
              onLabel={(labelId) => {
                setSelectedLabelId(labelId);
                setSearchQuery("");
                setDebouncedQuery("");
                setCurrentPage(1);
                setSelectedConv(null);
                selectedConversationIdRef.current = null;
                setThreads([]);
              }}
```

- [ ] **Step 8: Hide the active label highlight and relabel the list while searching**

At the `FilterRail` call site (existing line 1099), change:

```tsx
              selectedLabelId={effectiveSelectedLabelId}
```

to:

```tsx
              selectedLabelId={searchActive ? null : effectiveSelectedLabelId}
```

At the `ConversationList` call site (existing lines 1127-1128), change:

```tsx
                title={conversationListTitle}
                total={isInboxView ? null : totalConversations}
```

to:

```tsx
                title={searchActive ? `Search results for "${debouncedQuery.trim()}"` : conversationListTitle}
                total={searchActive ? totalConversations : (isInboxView ? null : totalConversations)}
```

- [ ] **Step 9: Render the search bar**

In the `<header style={topHeader}>` block (existing lines 1021-1049), insert a new row between the closing `</div>` of `storeSwitcherRow` and the closing `</header>`:

```tsx
        <div style={storeSwitcherRow}>
          <StoreMenu
            stores={stores}
            mailboxes={mailboxes}
            selectedStore={selectedStore}
            selectedMailbox={selectedMailbox}
            unread={mailboxUnreadCount}
            onChoose={chooseStore}
            onChooseMailbox={chooseMailbox}
          />
        </div>
        {selectedMailbox ? (
          <div style={searchBarRow}>
            <Search size={16} style={searchBarIcon} />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search subject or content..."
              style={searchBarInput}
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setDebouncedQuery("");
                }}
                style={searchBarClearButton}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
```

- [ ] **Step 10: Add the search bar styles**

Next to the `storeSwitcherRow` style declaration (existing lines 2977-2981), add:

```ts
const searchBarRow: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  width: "100%",
};

const searchBarIcon: React.CSSProperties = {
  position: "absolute",
  left: 12,
  color: "#6b7280",
  pointerEvents: "none",
};

const searchBarInput: React.CSSProperties = {
  width: "100%",
  height: 44,
  border: "1px solid #d8dee8",
  borderRadius: 8,
  background: "#fff",
  padding: "0 40px 0 38px",
  outline: "none",
  fontSize: 14,
  color: "#101828",
};

const searchBarClearButton: React.CSSProperties = {
  position: "absolute",
  right: 10,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  border: "none",
  background: "transparent",
  color: "#6b7280",
  cursor: "pointer",
};
```

- [ ] **Step 11: Run the test and verify it passes**

Run:

```bash
npx vitest run "src/app/(authed)/mailboxes/mailbox-search-ui-source.test.ts"
```

Expected: PASS.

---

### Task 3: Final Focused Verification

**Files:**
- No new files.

- [ ] **Step 1: Run the new search tests together**

Run:

```bash
npx vitest run \
  tests/mailbox-conversation-search-source.test.ts \
  "src/app/(authed)/mailboxes/mailbox-search-ui-source.test.ts"
```

Expected: PASS.

- [ ] **Step 2: Run adjacent mailbox tests that touch the same functions**

Run:

```bash
npx vitest run \
  tests/mailbox-proxy-source.test.ts \
  tests/mailbox-list-db-source.test.ts \
  tests/mailbox-ui-source.test.ts \
  tests/mailbox-ui-contract.test.ts \
  tests/mailbox-list-snapshot-normalizer.test.ts
```

Expected: PASS. These cover `handleListConversations`, `mailboxConversationWhere`'s existing label/status behavior, and the rest of `MailboxesClient.tsx` — this confirms the search changes didn't regress label browsing, status filtering, or the conversation list rendering.

- [ ] **Step 3: Type-check the changed files**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS (no new type errors from the `q` field, the new state, or the new JSX).

- [ ] **Step 4: Manual smoke test**

With the dev server running (`npm run dev`) against a mailbox that has conversations:

1. Open the Mailboxes tab, select a mailbox with conversations in more than one label.
2. Type a term known to be in one conversation's subject → confirm only that conversation (or conversations sharing the term) appears, no label is shown as active in the sidebar, and the list header reads `Search results for "<term>"`.
3. Type a term known to appear only in a conversation's preview text (not its subject) → confirm it's found too.
4. Type a term with no matches → confirm an empty list with no error.
5. Clear the search box → confirm the previously selected label/view's conversations return.
6. While a search is active, click a different label → confirm the search box clears and that label's conversations show.
7. While a search is active, switch to a different mailbox (if more than one is available) → confirm the search box clears.
8. Type a search term that returns more than one page of results (or temporarily note that pagination wasn't exercised if the mailbox has too few matching conversations) → confirm paging through results keeps the same query.

Report back if any of these steps show gaps, so the plan can be corrected before this step is checked off — do not check it off if any of steps 2-8 aren't independently verified via seed data or a mailbox with enough conversations to exercise them.

# Mailbox Conversation Identity And Email Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real sender identity in mailbox conversation rows and render email detail like a normal inbox with HTML layout preserved.

**Architecture:** Add focused mailbox/email helpers for sender parsing and email HTML rendering, then wire them into Zammad normalization, the mailbox proxy, and `MailboxesClient`. Keep the conversation list API responsible for sender identity so the frontend avoids N+1 detail calls. Use a sandboxed iframe for HTML email bodies and keep plain text as a safe fallback.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Zammad REST API, Vitest, `sanitize-html`, existing `pnpm` scripts.

---

## File Structure

- Create: `src/lib/mailboxes/identity.ts`
  - Owns sender parsing and display fallback rules.
- Modify: `src/lib/zammad/types.ts`
  - Adds `fromName` and `fromEmail` to `NormalizedConversation`.
  - Adds a helper that enriches conversations from articles without frontend N+1 calls.
- Modify: `src/lib/zammad/client.ts`
  - Adds a server-side enrichment function used by the proxy list endpoint.
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
  - Calls enriched search for `/conversations`.
- Modify: `src/lib/mailboxes/email-body-renderer.ts`
  - Keeps sanitizer policy, changes default image policy to allow images, adds iframe document builder.
- Modify: `src/components/mailboxes/EmailBodyRenderer.tsx`
  - Renders HTML in a sandboxed iframe and plain text in normal inbox typography.
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`
  - Uses real `fromName/fromEmail` in list rows.
  - Hides fake sidebar/filter sections.
  - Keeps technical controls in overflow menu and removes body debug labels.
- Test: `tests/mailbox-identity.test.ts`
- Test: `tests/email-body-renderer.test.ts`
- Test: `tests/zammad-types.test.ts`

---

### Task 1: Add Mailbox Sender Identity Helper

**Files:**
- Create: `src/lib/mailboxes/identity.ts`
- Test: `tests/mailbox-identity.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/mailbox-identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  displayMailboxIdentity,
  parseEmailIdentity,
} from "../src/lib/mailboxes/identity";

describe("parseEmailIdentity", () => {
  it("parses quoted display name and email", () => {
    expect(parseEmailIdentity('"OpenAI" <noreply@tm.openai.com>')).toEqual({
      name: "OpenAI",
      email: "noreply@tm.openai.com",
    });
  });

  it("parses unquoted display name and email", () => {
    expect(parseEmailIdentity("Tran Quoc Tuyen <tuyentq.1997@gmail.com>")).toEqual({
      name: "Tran Quoc Tuyen",
      email: "tuyentq.1997@gmail.com",
    });
  });

  it("uses bare email as email and display fallback", () => {
    expect(parseEmailIdentity("noreply@tm.openai.com")).toEqual({
      name: "noreply@tm.openai.com",
      email: "noreply@tm.openai.com",
    });
  });

  it("keeps raw sender text as name when no email exists", () => {
    expect(parseEmailIdentity("OpenAI Billing")).toEqual({
      name: "OpenAI Billing",
      email: "",
    });
  });
});

describe("displayMailboxIdentity", () => {
  it("prefers fromName, then fromEmail, then customer fallback", () => {
    expect(displayMailboxIdentity({ customerId: 69, fromName: "OpenAI", fromEmail: "noreply@tm.openai.com" })).toBe("OpenAI");
    expect(displayMailboxIdentity({ customerId: 69, fromEmail: "noreply@tm.openai.com" })).toBe("noreply@tm.openai.com");
    expect(displayMailboxIdentity({ customerId: 69 })).toBe("Customer #69");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/mailbox-identity.test.ts
```

Expected: FAIL because `src/lib/mailboxes/identity.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/mailboxes/identity.ts`:

```ts
export interface MailboxIdentityInput {
  customerId: number;
  fromName?: string;
  fromEmail?: string;
}

export interface ParsedEmailIdentity {
  name: string;
  email: string;
}

export function parseEmailIdentity(value?: string | null): ParsedEmailIdentity {
  const raw = value?.trim() ?? "";
  if (!raw) return { name: "", email: "" };

  const angleMatch = raw.match(/^(?:"?([^"<]*)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1]?.trim().replace(/^"|"$/g, "") ?? "";
    const email = angleMatch[2]?.trim() ?? "";
    return { name: name || email, email };
  }

  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) return { name: raw, email: "" };

  const email = emailMatch[0];
  const name = raw
    .replace(email, "")
    .replace(/[<>"']/g, "")
    .trim();

  return { name: name || email, email };
}

export function displayMailboxIdentity(input: MailboxIdentityInput): string {
  return input.fromName || input.fromEmail || `Customer #${input.customerId}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm exec vitest run tests/mailbox-identity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mailboxes/identity.ts tests/mailbox-identity.test.ts
git commit -m "feat: add mailbox sender identity helper"
```

---

### Task 2: Enrich Zammad Conversations With Sender Identity

**Files:**
- Modify: `src/lib/zammad/types.ts`
- Modify: `src/lib/zammad/client.ts`
- Test: `tests/zammad-types.test.ts`

- [ ] **Step 1: Write failing normalization tests**

In `tests/zammad-types.test.ts`, extend the import list:

```ts
import {
  normalizeGroup,
  normalizeTicket,
  normalizeArticle,
  enrichConversationIdentity,
} from "../src/lib/zammad/types";
```

Add this `describe` block after the `normalizeArticle` tests:

```ts
describe("enrichConversationIdentity", () => {
  it("adds sender identity from the first non-internal email article with a from value", () => {
    const conversation = normalizeTicket({
      id: 3,
      group_id: 1,
      priority_id: 2,
      state_id: 2,
      organization_id: null,
      number: "84002",
      title: "ChatGPT - Ke hoach moi cua ban",
      owner_id: 1,
      customer_id: 69,
      note: null,
      article_count: 1,
      article_ids: [10],
      pending_time: null,
      created_at: "2026-06-21T05:19:00.000Z",
      updated_at: "2026-06-21T05:19:00.000Z",
      close_at: null,
      last_contact_at: null,
      last_contact_agent_at: null,
      last_contact_customer_at: null,
    });

    const result = enrichConversationIdentity(conversation, [
      normalizeArticle({
        id: 10,
        ticket_id: 3,
        type_id: 10,
        sender_id: 2,
        from: "OpenAI <noreply@tm.openai.com>",
        to: "anhiri66 <anhiri66@gmail.com>",
        cc: null,
        subject: "ChatGPT - Ke hoach moi cua ban",
        body: "<p>Hello</p>",
        content_type: "text/html",
        internal: false,
        type: "email",
        sender: "Customer",
        attachments: [],
        created_by: "noreply@tm.openai.com",
        updated_by: "noreply@tm.openai.com",
        created_at: "2026-06-21T05:19:00.000Z",
        updated_at: "2026-06-21T05:19:00.000Z",
      }),
    ]);

    expect(result.fromName).toBe("OpenAI");
    expect(result.fromEmail).toBe("noreply@tm.openai.com");
  });

  it("does not fail when articles are missing sender data", () => {
    const conversation = normalizeTicket({
      id: 4,
      group_id: 1,
      priority_id: 2,
      state_id: 2,
      organization_id: null,
      number: "84003",
      title: "No sender",
      owner_id: 1,
      customer_id: 70,
      note: null,
      article_count: 1,
      article_ids: [11],
      pending_time: null,
      created_at: "2026-06-21T05:19:00.000Z",
      updated_at: "2026-06-21T05:19:00.000Z",
      close_at: null,
      last_contact_at: null,
      last_contact_agent_at: null,
      last_contact_customer_at: null,
    });

    expect(enrichConversationIdentity(conversation, [])).toEqual(conversation);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/zammad-types.test.ts
```

Expected: FAIL because `enrichConversationIdentity` is not exported and `NormalizedConversation` has no sender fields.

- [ ] **Step 3: Add sender fields and enrichment helper**

Modify `src/lib/zammad/types.ts`:

```ts
import { parseEmailIdentity } from "@/lib/mailboxes/identity";
```

Add fields to `NormalizedConversation`:

```ts
export interface NormalizedConversation {
  id: number;
  mailboxId: number;
  number: string;
  subject: string;
  status: "active" | "pending" | "closed";
  customerId: number;
  assigneeId?: number;
  updatedAt: string;
  createdAt: string;
  articleCount: number;
  fromName?: string;
  fromEmail?: string;
}
```

Add this helper below `normalizeArticle`:

```ts
export function enrichConversationIdentity(
  conversation: NormalizedConversation,
  articles: NormalizedThread[],
): NormalizedConversation {
  const source = articles.find((article) => {
    return !article.internal && article.type === "email" && Boolean(article.from);
  }) ?? articles.find((article) => !article.internal && Boolean(article.from));

  if (!source?.from) return conversation;

  const parsed = parseEmailIdentity(source.from);
  return {
    ...conversation,
    fromName: parsed.name || undefined,
    fromEmail: parsed.email || undefined,
  };
}
```

- [ ] **Step 4: Add client enrichment function without frontend N+1 calls**

Modify `src/lib/zammad/client.ts` imports:

```ts
import {
  normalizeGroup,
  normalizeTicket,
  normalizeArticle,
  enrichConversationIdentity,
} from "@/lib/zammad/types";
```

Add this function after `searchTickets`:

```ts
export async function searchTicketsWithIdentity(opts: {
  groupId: number;
  status?: AppStatus;
  page?: number;
  pageSize?: number;
}): Promise<ZammadResponse<NormalizedConversation[]>> {
  const result = await searchTickets(opts);
  if (!result.ok || !result.data) {
    return result;
  }

  const conversations = await Promise.all(
    result.data.map(async (conversation) => {
      const articles = await getTicketArticles(conversation.id);
      if (!articles.ok || !articles.data) return conversation;
      return enrichConversationIdentity(conversation, articles.data);
    }),
  );

  return {
    ok: true,
    status: result.status,
    data: conversations,
  };
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm exec vitest run tests/mailbox-identity.test.ts tests/zammad-types.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zammad/types.ts src/lib/zammad/client.ts tests/zammad-types.test.ts
git commit -m "feat: enrich mailbox conversations with sender identity"
```

---

### Task 3: Return Sender Identity From Mailbox Proxy

**Files:**
- Modify: `src/app/api/mailbox-proxy/[...path]/route.ts`
- Test: add route coverage to an existing mailbox proxy test if present, otherwise rely on `tests/zammad-types.test.ts` and a source assertion.

- [ ] **Step 1: Add a source assertion test**

Create `tests/mailbox-proxy-source.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mailbox proxy conversation list source", () => {
  it("uses the sender identity enriched ticket search", () => {
    const source = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");

    expect(source).toContain("searchTicketsWithIdentity");
    expect(source).not.toContain("const result = await searchTickets({");
  });
});
```

- [ ] **Step 2: Run the source assertion to verify it fails**

Run:

```bash
pnpm exec vitest run tests/mailbox-proxy-source.test.ts
```

Expected: FAIL because the route still imports and calls `searchTickets`.

- [ ] **Step 3: Update proxy route import**

Modify `src/app/api/mailbox-proxy/[...path]/route.ts` import block:

```ts
import {
  searchTicketsWithIdentity,
  getTicket,
  getTicketArticles,
  createTicketArticle,
  updateTicketState,
} from "@/lib/zammad/client";
```

- [ ] **Step 4: Update list endpoint**

In `handleListConversations`, replace:

```ts
const result = await searchTickets({
  groupId: mailboxId,
  status: effectiveStatus,
  page,
  pageSize,
});
```

with:

```ts
const result = await searchTicketsWithIdentity({
  groupId: mailboxId,
  status: effectiveStatus,
  page,
  pageSize,
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm exec vitest run tests/mailbox-proxy-source.test.ts tests/zammad-types.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/api/mailbox-proxy/[...path]/route.ts' tests/mailbox-proxy-source.test.ts
git commit -m "feat: return sender identity in mailbox conversations"
```

---

### Task 4: Render HTML Email In A Sandboxed Frame With Images Shown

**Files:**
- Modify: `src/lib/mailboxes/email-body-renderer.ts`
- Modify: `src/components/mailboxes/EmailBodyRenderer.tsx`
- Test: `tests/email-body-renderer.test.ts`

- [ ] **Step 1: Update failing helper tests**

In `tests/email-body-renderer.test.ts`, update imports:

```ts
import {
  buildEmailFrameDocument,
  htmlToReadableText,
  isHtmlEmail,
  sanitizeEmailHtml,
} from "../src/lib/mailboxes/email-body-renderer";
```

Replace the image test with:

```ts
it("shows images by default for HTML email rendering", () => {
  const html = sanitizeEmailHtml('<img src="https://example.com/pixel.png" alt="pixel">');

  expect(html).toContain("<img");
  expect(html).toContain('src="https://example.com/pixel.png"');
});
```

Add:

```ts
it("removes inline event handlers from HTML email", () => {
  const html = sanitizeEmailHtml('<a href="https://example.com" onclick="evil()">open</a>');

  expect(html).toContain('href="https://example.com"');
  expect(html).not.toContain("onclick");
});

it("builds a complete iframe document for sanitized email HTML", () => {
  const document = buildEmailFrameDocument("<p>Hello</p>");

  expect(document).toContain("<!doctype html>");
  expect(document).toContain("<base target=\"_blank\">");
  expect(document).toContain("<p>Hello</p>");
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run:

```bash
pnpm exec vitest run tests/email-body-renderer.test.ts
```

Expected: FAIL because `buildEmailFrameDocument` does not exist and `sanitizeEmailHtml` still requires a `showImages` argument.

- [ ] **Step 3: Update sanitizer helper**

Modify `src/lib/mailboxes/email-body-renderer.ts`:

```ts
export function sanitizeEmailHtml(html: string, showImages = true): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a",
      "abbr",
      "address",
      "b",
      "blockquote",
      "br",
      "caption",
      "code",
      "col",
      "colgroup",
      "div",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "i",
      "li",
      "ol",
      "p",
      "pre",
      "span",
      "strong",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
      ...(showImages ? ["img"] : []),
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "title"],
      img: showImages ? ["src", "alt", "title", "width", "height"] : [],
      table: ["align", "border", "cellpadding", "cellspacing", "role", "width", "style"],
      td: ["align", "colspan", "rowspan", "width", "style"],
      th: ["align", "colspan", "rowspan", "width", "style"],
      div: ["align", "style"],
      p: ["align", "style"],
      span: ["style"],
      "*": ["class", "title"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "cid", "data"],
    allowedSchemesByTag: {
      img: ["http", "https", "cid", "data"],
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
    disallowedTagsMode: "discard",
    parseStyleAttributes: false,
  });
}
```

Add:

```ts
export function buildEmailFrameDocument(html: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base target="_blank">
  <style>
    html, body { margin: 0; padding: 0; background: #fff; color: #111827; }
    body { font: 14px/1.55 Arial, Helvetica, sans-serif; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    a { color: #0b57d0; }
  </style>
</head>
<body>${html}</body>
</html>`;
}
```

- [ ] **Step 4: Update `EmailBodyRenderer` to use iframe**

Modify `src/components/mailboxes/EmailBodyRenderer.tsx` imports:

```ts
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildEmailFrameDocument,
  htmlToReadableText,
  isHtmlEmail,
  sanitizeEmailHtml,
} from "@/lib/mailboxes/email-body-renderer";
```

Replace the component body with:

```tsx
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
```

Replace styles:

```ts
const plainBlock: React.CSSProperties = {
  padding: "18px 20px",
  color: "#111827",
  fontSize: 14,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const sourceBlock: React.CSSProperties = {
  ...plainBlock,
  margin: 0,
  maxHeight: 420,
  overflow: "auto",
  background: "#0f172a",
  color: "#e5e7eb",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
};

const emailFrame: React.CSSProperties = {
  width: "100%",
  minHeight: 220,
  border: 0,
  display: "block",
  background: "#fff",
};
```

Remove unused `shell`, `htmlFrame`, and `htmlBody` styles.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm exec vitest run tests/email-body-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mailboxes/email-body-renderer.ts src/components/mailboxes/EmailBodyRenderer.tsx tests/email-body-renderer.test.ts
git commit -m "feat: render mailbox html email in sandboxed frame"
```

---

### Task 5: Clean Up Mailboxes UI Data And Detail Layout

**Files:**
- Modify: `src/app/(authed)/mailboxes/MailboxesClient.tsx`

- [ ] **Step 1: Update TypeScript interfaces**

In `src/app/(authed)/mailboxes/MailboxesClient.tsx`, add sender fields to `Conversation`:

```ts
interface Conversation {
  id: number;
  mailboxId: number;
  number: string;
  subject: string;
  status: "active" | "pending" | "closed";
  customerId: number;
  assigneeId?: number;
  updatedAt: string;
  createdAt: string;
  articleCount: number;
  fromName?: string;
  fromEmail?: string;
}
```

Add import:

```ts
import {
  displayMailboxIdentity,
  parseEmailIdentity,
} from "@/lib/mailboxes/identity";
```

Remove the local `parseEmailIdentity` and `conversationContactName` functions from this file.

- [ ] **Step 2: Update conversation rows**

In `ConversationRow`, replace:

```ts
const contactName = conversationContactName(conversation);
```

with:

```ts
const contactName = displayMailboxIdentity(conversation);
```

Keep:

```tsx
<Avatar label={contactName} index={index} />
<strong style={truncate}>{contactName}</strong>
```

- [ ] **Step 3: Update detail identity fallback**

In `ConversationDetail`, replace:

```ts
const detailContactName = sender.name || conversationContactName(conversation);
```

with:

```ts
const detailContactName = sender.name || displayMailboxIdentity(conversation);
```

Keep:

```ts
const detailContactEmail = sender.email || conversation.fromEmail || "Email address unavailable";
```

- [ ] **Step 4: Hide fake rail sections**

In `FilterRail`, replace the returned JSX with only real status controls:

```tsx
return (
  <aside style={railPanel}>
    <RailHeader title="Status" />
    {(["active", "pending", "closed"] as StatusFilter[]).map((status) => (
      <RailButton
        key={status}
        active={activeStatus === status}
        dot={STATUS_COLORS[status].dot}
        label={STATUS_LABELS[status]}
        count={activeStatus === status ? total : undefined}
        onClick={() => onStatus(status)}
      />
    ))}
  </aside>
);
```

This removes fake `All conversations`, `Unassigned`, `Mentions`, `Snoozed`, `Channels`, and `Views` counts from the default UI.

- [ ] **Step 5: Remove remote image notice from body**

In `ThreadCard`, set remote images shown by default:

```ts
const [showImages, setShowImages] = useState(true);
```

Remove this block:

```tsx
{html && !showImages ? (
  <div style={remoteImageNotice}>Remote images are hidden for privacy.</div>
) : null}
```

Keep the overflow menu item for toggling images:

```tsx
<button type="button" style={messageMenuItem} onClick={() => setShowImages((value) => !value)}>
  {showImages ? "Hide remote images" : "Show remote images"}
</button>
```

- [ ] **Step 6: Keep technical controls in overflow**

In `ThreadCard`, ensure only the overflow menu contains:

```tsx
<button type="button" style={messageMenuItem} onClick={() => setModeFromMenu("plain")}>
  Show plain text
</button>
<button type="button" style={messageMenuItem} onClick={() => setModeFromMenu("source")}>
  View original
</button>
<button type="button" style={{ ...messageMenuItem, color: "#98a2b3", cursor: "not-allowed" }} disabled>
  Download .eml unavailable
</button>
```

Do not render `HTML email`, `View source`, `Show images`, or `message.html` as visible body controls.

- [ ] **Step 7: Run a focused type/build check**

Run:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: It may still fail on existing unrelated test type errors in this repo. If it fails, confirm there are no errors mentioning:

```text
MailboxesClient
EmailBodyRenderer
email-body-renderer
identity
zammad/types
zammad/client
mailbox-proxy
```

Then run:

```bash
pnpm run build
```

Expected: PASS when Google Fonts are reachable. If it fails only on `next/font` fetching `Inter` from Google Fonts, record that as environment/network failure and continue with targeted tests.

- [ ] **Step 8: Commit**

```bash
git add 'src/app/(authed)/mailboxes/MailboxesClient.tsx'
git commit -m "feat: clean mailbox list and detail email controls"
```

---

### Task 6: Verification Pass

**Files:**
- No new source files unless a previous task reveals a small compile fix.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/mailbox-identity.test.ts tests/email-body-renderer.test.ts tests/zammad-types.test.ts tests/mailbox-proxy-source.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run diff check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm run build
```

Expected: PASS. If Google Fonts network fails, capture the exact `next/font` error and verify all focused tests still pass.

- [ ] **Step 4: Manual UI verification**

Start dev server:

```bash
pnpm run dev
```

Open `/mailboxes`, select the `tuyen` store in the store switcher if it is not already selected, and verify:

- Conversation list rows show `OpenAI` or real sender emails where Zammad provides sender data.
- `Customer #id` appears only when sender identity is missing.
- Fake names such as Daniel Lee and Noah Brown are not present.
- Fake rail sections and fake counts are not present.
- HTML email body preserves layout better than the previous plain text block.
- Remote images are visible by default.
- `message.html` is not shown as a primary attachment.
- Composer is visible at the bottom of the detail panel while the email body scrolls above it.

- [ ] **Step 5: Commit final verification note if any source changed**

If verification required source changes:

```bash
git add src/lib/mailboxes/identity.ts src/lib/mailboxes/email-body-renderer.ts src/components/mailboxes/EmailBodyRenderer.tsx src/lib/zammad/types.ts src/lib/zammad/client.ts 'src/app/api/mailbox-proxy/[...path]/route.ts' 'src/app/(authed)/mailboxes/MailboxesClient.tsx' tests/mailbox-identity.test.ts tests/email-body-renderer.test.ts tests/zammad-types.test.ts tests/mailbox-proxy-source.test.ts
git commit -m "fix: verify mailbox email viewer behavior"
```

If no source changed, do not create an empty commit.

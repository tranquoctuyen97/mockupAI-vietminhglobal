# Facebook Group Crawl Flow

Date: 2026-07-22  
Status: research/spec plus MVP skill and Edge extension artifacts  
Target browser for future implementation: Edge (logged-in Facebook session)  
Inspected group: `https://www.facebook.com/groups/3248800598584736`

Update: the first implementation artifacts now exist:

- Edge extension source: `tools/facebook-group-crawler-extension`
- Codex skill: `/Users/tuyen.tq/.codex/skills/facebook-pod-research`
- Analyzer script: `/Users/tuyen.tq/.codex/skills/facebook-pod-research/scripts/analyze_facebook_pod_raw.py`

## Goal

Collect all posts, comments, and replies from one or more Facebook groups into one raw file, then use that file as the source for a later summarizer skill.

This document is the bridge between:

- a future Edge extension that performs the collection
- a future skill whose input is `groupUrls[]`
- a later synthesis pass that turns raw Facebook discussions into POD knowledge

## What was verified in browser

The group page was first checked in the in-app browser, then re-verified in the user's signed-in Microsoft Edge session on 2026-07-22.

Observed facts:

- The group is public and currently paused.
- In the signed-in Edge session, the group page is fully visible without a login wall.
- The group feed uses a root container with `role="feed"`.
- Posts render as top-level nodes with `role="article"`.
- Post permalinks follow the pattern `/groups/<groupId>/posts/<postId>/`.
- Clicking `Comment` in the group feed can inline-expand comments under the post.
- In expanded state, comments also render as nested `role="article"` nodes inside the parent post article.
- In the signed-in Edge session, clicking the post date opens a post-detail overlay at `/groups/<groupId>/posts/<postId>`.
- The signed-in Edge session is using Vietnamese labels such as `Phù hợp nhất`, `Xem thêm`, and `bình luận`.
- In the signed-in Edge session, long post bodies expose a plain `Xem thêm` button before media/reaction blocks.
- In the signed-in Edge session, replies can be expanded with buttons such as `Xem 1 phản hồi` and `Xem thêm câu trả lời`.
- After a reply thread is expanded, reply permalinks include `reply_comment_id=...`.
- A direct post detail page is much better for stable extraction than the feed.

## Core DOM findings

### 1. Group feed page

Stable anchors found during inspection:

| Purpose | Observed anchor |
|---|---|
| Feed root | `[role="feed"]` |
| Post card | top-level `[role="article"]` |
| Post permalink | `a[href*="/groups/3248800598584736/posts/"]` |
| Post author | usually near the top of the post card; author link shape varies |
| Post actions | visible buttons such as `Like`, `Comment` |

Important note:

- Feed extraction is fine for discovering post URLs.
- Feed extraction is not the best source for full comments because the page is virtualized, partial, and lazily expanded.

### 2. Post detail page

Direct post URLs render a much cleaner thread view.

Observed detail-page anchors:

| Purpose | Observed anchor |
|---|---|
| Root post | first `[role="article"]` inside feed |
| Group backlink | link back to `/groups/<groupId>/` |
| Post date permalink | link containing `multi_permalinks=<postId>` or post URL |
| Comment counter | button like `18 comments` |
| Comment sort | button like `Most relevant` or Vietnamese `Phù hợp nhất` |
| Expand comments | button like `View more comments` or Vietnamese equivalent |
| Comment node | signed-in Edge AX tree showed container labels like `Bình luận dưới tên <author> vào <time>` |
| Comment permalink | `a[href*="comment_id="]` |
| Truncated content | button like `See more` or Vietnamese `Xem thêm` |
| Replies expander | signed-in Edge showed `Xem 1 phản hồi` and `Xem thêm câu trả lời` |
| Reply node | signed-in Edge AX tree showed labels like `Phản hồi bình luận của <comment-author> dưới tên <reply-author> vào <time>` |
| Reply permalink | `a[href*="reply_comment_id="]` |

This is the most important finding:

- Future collection should use the group feed only to discover posts.
- Full post/comment/reply extraction should happen on each post detail page.
- In signed-in Edge, opening the post date is a reliable way to reach the detail surface.

## Why detail view is the correct crawl surface

The feed mixes several unstable behaviors:

- virtualized loading
- partial comment expansion
- mixed top-level posts and nested comments in the same tree
- lazy loading when scrolling

The detail page gives a clearer extraction contract:

- one main post thread
- visible comment count
- explicit comment sort, observed as `Phù hợp nhất`
- explicit `View more comments`-style expansion where available
- explicit per-comment permalink via `comment_id`
- explicit per-reply permalink via `reply_comment_id`
- visible reply expanders

So the future collector should be a 2-pass crawler:

1. Crawl the group feed to collect all post URLs.
2. Visit each post detail page to extract the full thread.

## Recommended future flow for Edge extension

### Phase A: group post discovery

For each input group URL:

1. Open the group in logged-in Edge.
2. Dismiss any modal/interstitial if present.
3. Stay on `Discussion`.
4. Scroll the feed gradually.
5. Collect every unique post permalink matching `/groups/<groupId>/posts/<postId>/`.
6. Parse and dedupe by `postId`.
7. Stop only when the feed no longer yields new post IDs after repeated scroll windows.

### Phase B: per-post detail extraction

For each discovered post URL:

1. Open the post detail page.
2. Expand post body by clicking `See more` or `Xem thêm` until no more truncation remains.
3. If available, switch comment sort from `Most relevant` or `Phù hợp nhất` to the broadest available option.
4. Click `View more comments` or the locale equivalent until exhausted, if such a button exists on that thread.
5. Expand reply sections by clicking buttons like `Xem 1 phản hồi` or `Xem thêm câu trả lời` until exhausted.
6. Expand every nested `See more` or `Xem thêm` inside comments/replies.
7. Extract the root post, then each visible comment, then each reply.
8. Capture comment permalinks via `comment_id=` links whenever available.
9. Capture reply permalinks via `reply_comment_id=` links whenever available.

Important note from the signed-in Edge sample:

- On at least one `18 bình luận` thread, Facebook rendered the visible discussion directly without needing an extra `Xem thêm bình luận` click first.
- So the crawler must not assume there is always a dedicated top-level “more comments” button.
- The safe logic is: first scan the loaded thread, then expand only the buttons that actually exist.

### Phase C: persistence

Write one raw file per group:

- recommended format: JSONL
- recommended path pattern: `facebook-groups/<groupId>.jsonl`
- one line per post thread

JSONL is recommended over one giant JSON array because it supports:

- resumable appends
- partial recovery on interruption
- lower memory pressure
- easy downstream summarization by chunk

## Recommended raw schema

Each JSONL line should represent one post thread:

```json
{
  "group": {
    "id": "3248800598584736",
    "url": "https://www.facebook.com/groups/3248800598584736",
    "title": "Build Brand POD Shopify"
  },
  "post": {
    "id": "3771268483004609",
    "url": "https://www.facebook.com/groups/3248800598584736/posts/3771268483004609/",
    "authorName": "Tạ Hiếu Khanh",
    "publishedText": "22 November 2025",
    "contentText": "Chào mọi người ạ, e có mở 1 store Shopify ...",
    "reactionCountText": "8",
    "commentCountText": "18 comments"
  },
  "comments": [
    {
      "commentId": "3771385442992913",
      "url": "https://www.facebook.com/groups/3248800598584736/posts/3771268483004609/?comment_id=3771385442992913",
      "authorName": "Truong Giang Nguyen",
      "publishedText": "34w",
      "contentText": "Qua rồi thời ăn xổi chạy ads xong vứt đó bạn ơi...",
      "replies": []
    }
  ],
  "capturedAt": "2026-07-22T00:00:00.000Z"
}
```

## Extraction rules that should be stable

Prefer these signals over Facebook CSS classes:

- `role="feed"`
- `role="article"`
- `aria-label` values like `Comment by ...`
- permalink patterns containing `/groups/<groupId>/posts/`
- comment permalinks containing `comment_id=`
- reply permalinks containing `reply_comment_id=`
- explicit button text for expansion

Do not build the collector around obfuscated class names like `x1...`.

## Text matching guidance

Button text can vary by locale. The future implementation should support at least:

- English: `Comment`, `See more`, `View more comments`, `Most relevant`
- Vietnamese equivalents when the session locale changes, including `Bình luận`, `Xem thêm`, `Phù hợp nhất`, `Xem 1 phản hồi`, and `Xem thêm câu trả lời`

Best practice:

- use URL patterns and ARIA/role signals first
- use button text only as a fallback or expansion trigger

## Stop conditions

### Stop group feed scrolling when

- the last N scroll windows produce no new `postId`
- the page keeps re-showing already captured post links
- the feed stops adding new DOM content

Observed signed-in Edge behavior:

- After additional scroll windows, the visible feed changed from the top older posts to new visible posts such as `Tạ Hiếu Khanh`, `Minh Tuấn`, and `Tiến Anh`.
- This confirms that repeated feed scrolls do reveal additional posts in the live signed-in session.
- A practical stop rule is to maintain a rolling set of visible post IDs per scroll batch and stop only after several consecutive batches add zero unseen IDs.

### Stop detail-page expansion when

- no `View more comments` button remains
- no reply expander remains
- no visible `See more` remains inside the thread

## Risks and edge cases

- Private groups will require a logged-in session with permission to view the group.
- This group is currently paused, so some posts show `Bình luận đã bị tắt cho bài viết này.` and newer posts may not expose open discussions.
- Signed-in Edge is the authoritative surface for future implementation because it reflects the user's real Facebook locale and permissions.
- Facebook may localize labels or change button wording.
- Some comments or replies may be hidden behind ranking or moderation states.
- Feed virtualization means the same DOM nodes may be reused while scrolling.
- Some threads render comments immediately after the detail page opens, while other threads may require additional expansion clicks.
- Media-only posts and image comments need attachment-aware extraction later.
- Group pages can contain admin updates, featured content, or non-standard post cards.

## Recommended future skill contract

The later skill can wrap the raw collection flow instead of re-implementing research.

Suggested input:

```json
{
  "groupUrls": [
    "https://www.facebook.com/groups/3248800598584736"
  ]
}
```

Suggested output:

- path to raw JSONL file per group
- path to a merged Markdown synthesis
- summary stats such as total posts, total comments, and capture date

Implemented skill/extension split:

- The Edge extension performs browser-side crawling and downloads JSONL.
- The Codex skill uses the extension output as input.
- The analyzer creates `pod-dropship-keyword-data.json`, `pod-dropship-keyword-data.md`, and `pod-dropship-keyword-snippets.csv`.

## Immediate next step

When ready to implement:

1. build the Edge extension collector around this 2-pass flow
2. write raw output to JSONL first
3. only after raw capture is reliable, add the summarizer skill on top

## Bottom line

The correct architecture is:

`group feed discovery -> post detail crawl -> raw JSONL -> synthesis skill`

Not:

`scrape everything directly from the feed in one pass`

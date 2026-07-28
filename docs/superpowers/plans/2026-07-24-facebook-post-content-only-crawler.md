# Facebook Post Content-Only Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import an 851-record Facebook discovery NDJSON file in the Edge extension and crawl every post's expanded content without reading comments, with batch persistence and true resume.

**Architecture:** A small shared core parses and deduplicates discovery records. The popup imports the file and starts a dedicated `post_content_only` job; the service worker persists its queue/index and controls navigation, batching, cooldown, Stop, and Resume; the content script exposes a separate extraction function that waits adaptively and expands only post text.

**Tech Stack:** Manifest V3 Edge extension, browser `FileReader`, `chrome.storage.local`, `chrome.tabs`, `chrome.downloads`, vanilla JavaScript, Node `node:test` and `vm`.

## Global Constraints

- Process all 851 imported posts from the beginning.
- Never call comment sorting, pagination, reply expansion, or comment extraction in content-only mode.
- Minimum settle time is 2.5 seconds and maximum readiness wait is 8 seconds per attempt.
- Retry a missing post root exactly once.
- Cool down for 60 seconds after every 50 processed posts.
- Download a batch after every 20 processed posts and flush 1–19 pending records on Stop.
- Successful records use `crawlMode: "post_content_only"`, `commentsSkipped: true`, and `comments: []`.
- Persist the complete URL queue, `nextPostIndex`, pending records, counters, batch number, and output filenames.
- Do not commit or stage files.

---

### Task 1: Discovery NDJSON parser

**Files:**
- Create: `tools/facebook-group-crawler-extension/content-only-core.js`
- Create: `tools/facebook-group-crawler-extension/content-only-core.test.cjs`
- Modify: `tools/facebook-group-crawler-extension/popup.html`

**Interfaces:**
- Produces: `FB_POD_CONTENT_ONLY_CORE.parseDiscoveryNdjson(text)`.
- Returns: `{ posts, validRecords, duplicateRecords, rejectedRecords, groupId, groupUrl }`.
- `posts` items are `{ postId: string, url: string }`.

- [ ] **Step 1: Write failing parser tests**

Test valid discovery records, duplicate IDs, malformed JSON, irrelevant record
types, URL fallback identity, and the real 851-record input:

```js
test("imports all 851 unique discovered posts", () => {
  const parsed = core.parseDiscoveryNdjson(realDiscoveryText);
  assert.equal(parsed.posts.length, 851);
  assert.equal(parsed.validRecords, 851);
  assert.equal(parsed.duplicateRecords, 0);
  assert.equal(parsed.rejectedRecords, 0);
  assert.equal(parsed.groupId, "3248800598584736");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tools/facebook-group-crawler-extension/content-only-core.test.cjs
```

Expected: FAIL because `content-only-core.js` and
`parseDiscoveryNdjson()` do not exist.

- [ ] **Step 3: Implement the shared parser**

Expose a browser/VM-compatible global:

```js
globalThis.FB_POD_CONTENT_ONLY_CORE = (() => {
  function normalizePost(raw) {
    const postId = String(raw?.post?.id || "").trim();
    const url = String(raw?.post?.url || "").trim();
    const match = url.match(/\/groups\/([^/?#]+)\/(?:posts|permalink)\/(\d+)/);
    const normalizedId = postId || match?.[2] || null;
    const groupId = String(raw?.group?.id || match?.[1] || "").trim();
    if (!normalizedId || !groupId) return null;
    return {
      groupId,
      groupUrl: `https://www.facebook.com/groups/${groupId}`,
      postId: normalizedId,
      url: `https://www.facebook.com/groups/${groupId}/posts/${normalizedId}/`
    };
  }

  function parseDiscoveryNdjson(text) {
    const posts = new Map();
    let validRecords = 0;
    let duplicateRecords = 0;
    let rejectedRecords = 0;
    let groupId = null;
    let groupUrl = null;
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let raw;
      try {
        raw = JSON.parse(line);
      } catch {
        rejectedRecords += 1;
        continue;
      }
      if (raw.recordType !== "discovered_post") continue;
      const post = normalizePost(raw);
      if (!post) {
        rejectedRecords += 1;
        continue;
      }
      validRecords += 1;
      groupId ||= post.groupId;
      groupUrl ||= post.groupUrl;
      if (posts.has(post.postId)) {
        duplicateRecords += 1;
        continue;
      }
      posts.set(post.postId, { postId: post.postId, url: post.url });
    }
    return {
      posts: [...posts.values()],
      validRecords,
      duplicateRecords,
      rejectedRecords,
      groupId,
      groupUrl
    };
  }

  return { parseDiscoveryNdjson };
})();
```

- [ ] **Step 4: Load the core before popup.js**

Add:

```html
<script src="content-only-core.js"></script>
<script src="popup.js"></script>
```

- [ ] **Step 5: Run parser tests and syntax checks**

Run:

```bash
node --test tools/facebook-group-crawler-extension/content-only-core.test.cjs
node --check tools/facebook-group-crawler-extension/content-only-core.js
```

Expected: all parser tests PASS and syntax checks exit 0.

---

### Task 2: Popup import and controls

**Files:**
- Modify: `tools/facebook-group-crawler-extension/popup.html`
- Modify: `tools/facebook-group-crawler-extension/popup.css`
- Modify: `tools/facebook-group-crawler-extension/popup.js`
- Create: `tools/facebook-group-crawler-extension/popup.test.cjs`

**Interfaces:**
- Consumes: `parseDiscoveryNdjson(text)` from Task 1.
- Sends: `FB_POD_START_CONTENT_ONLY` with `{ tabId, importSummary, posts, options }`.
- Sends: `FB_POD_RESUME_CONTENT_ONLY` with `{ tabId }`.

- [ ] **Step 1: Write failing popup behavior tests**

Verify that import displays the count, Start sends all posts and balanced timing,
and Resume sends the active Edge tab:

```js
assert.equal(sent.type, "FB_POD_START_CONTENT_ONLY");
assert.equal(sent.posts.length, 851);
assert.deepEqual(sent.options, {
  batchSize: 20,
  minimumSettleMs: 2500,
  readinessTimeoutMs: 8000,
  cooldownEvery: 50,
  cooldownMs: 60000,
  maxPostExpandClicks: 12
});
```

- [ ] **Step 2: Run popup test and verify RED**

Run:

```bash
node --test tools/facebook-group-crawler-extension/popup.test.cjs
```

Expected: FAIL because file import, Start content-only, and Resume controls do
not exist.

- [ ] **Step 3: Add popup controls**

Add a section containing:

```html
<section class="content-only">
  <h2>Import discovery NDJSON</h2>
  <input id="discoveryFile" type="file" accept=".ndjson,.jsonl,application/x-ndjson" />
  <div id="importSummary">No discovery file imported.</div>
  <div class="actions">
    <button id="startContentOnly">Start post-content crawl</button>
    <button id="resumeContentOnly" class="secondary">Resume</button>
  </div>
</section>
```

- [ ] **Step 4: Implement import, Start, and Resume**

Keep parsed posts in popup memory only until Start:

```js
let importedDiscovery = null;

discoveryFileInput.addEventListener("change", async () => {
  const file = discoveryFileInput.files?.[0];
  importedDiscovery = file
    ? FB_POD_CONTENT_ONLY_CORE.parseDiscoveryNdjson(await file.text())
    : null;
  importSummary.textContent = importedDiscovery
    ? `${importedDiscovery.posts.length} unique posts imported`
    : "No discovery file imported.";
});
```

Start sends the balanced options exactly as specified. Resume is enabled only
for `mode: "post_content_only"` jobs whose status is `interrupted` or `stopped`
and whose `nextPostIndex < importedPosts`.

- [ ] **Step 5: Run popup tests**

Run:

```bash
node --test tools/facebook-group-crawler-extension/popup.test.cjs
```

Expected: all popup tests PASS.

---

### Task 3: Content-only DOM extraction

**Files:**
- Modify: `tools/facebook-group-crawler-extension/content-script.js`
- Create: `tools/facebook-group-crawler-extension/content-script.test.cjs`

**Interfaces:**
- Produces: `FACEBOOK_POD_CRAWLER.extractPostContentOnly(groupId, options)`.
- Receives: `FB_POD_EXTRACT_POST_CONTENT_ONLY`.
- Returns a successful `post_thread` record or throws a normalized extraction
  error for the service worker to retry.

- [ ] **Step 1: Write failing extraction tests**

Use a VM DOM fixture to verify:

- The extractor waits for a post root.
- It clicks post-text `Xem thêm`.
- It never invokes `expandThread`.
- It returns `comments: []`, `commentsSkipped: true`, and the required metadata.
- It refuses to use `document.body`.

Core assertion:

```js
assert.equal(result.crawlMode, "post_content_only");
assert.equal(result.commentsSkipped, true);
assert.deepEqual(result.comments, []);
assert.match(result.post.rawText, /expanded body/);
assert.equal(threadExpansionCalls, 0);
```

- [ ] **Step 2: Run extraction tests and verify RED**

Run:

```bash
node --test tools/facebook-group-crawler-extension/content-script.test.cjs
```

Expected: FAIL because the content-only message and extractor do not exist.

- [ ] **Step 3: Add adaptive post-root readiness**

Implement:

```js
async function waitForStablePostRoot(groupId, options) {
  const startedAt = Date.now();
  const minimumSettleMs = Math.max(2500, Number(options.minimumSettleMs || 2500));
  const timeoutMs = Math.max(minimumSettleMs, Number(options.readinessTimeoutMs || 8000));
  let previousText = "";
  let stableSamples = 0;
  while (Date.now() - startedAt < timeoutMs && !stopRequested) {
    const article = findArticleForPost(groupId);
    const text = article ? cleanText(article.innerText || article.textContent) : "";
    stableSamples = text && text === previousText ? stableSamples + 1 : 0;
    previousText = text;
    if (article && Date.now() - startedAt >= minimumSettleMs && stableSamples >= 1) {
      return article;
    }
    await wait(250);
  }
  throw new Error("POST_ROOT_TIMEOUT");
}
```

- [ ] **Step 4: Implement content-only extraction and message**

The function resets `stopRequested`, waits for the root, expands only post text,
and returns:

```js
{
  recordType: "post_thread",
  group: { id: groupId, url: `https://www.facebook.com/groups/${groupId}` },
  crawlMode: "post_content_only",
  commentsSkipped: true,
  post: {
    id: extractPostId(groupId),
    url: location.href,
    author: extractVisibleAuthor(postRoot),
    timestamp: extractVisibleTimestamp(postRoot),
    rawText: getPostBodyText(postRoot)
  },
  comments: [],
  expansion: { postText: postTextExpansion },
  capturedAt: new Date().toISOString()
}
```

- [ ] **Step 5: Run extraction tests and syntax check**

Run:

```bash
node --test tools/facebook-group-crawler-extension/content-script.test.cjs
node --check tools/facebook-group-crawler-extension/content-script.js
```

Expected: all tests PASS and syntax check exits 0.

---

### Task 4: Persistent content-only job, Stop, and Resume

**Files:**
- Modify: `tools/facebook-group-crawler-extension/service-worker.js`
- Modify: `tools/facebook-group-crawler-extension/service-worker.test.cjs`

**Interfaces:**
- Consumes popup start/resume messages from Task 2.
- Consumes content-only extraction from Task 3.
- Produces content-only NDJSON batches and resumable `fbPodCrawlerActiveJob`.

- [ ] **Step 1: Extend the service-worker harness and write failing tests**

Cover:

- Starting with 851 posts skips discovery.
- Navigation uses no fixed 3.5-second post delay.
- One `POST_ROOT_TIMEOUT` causes one reload retry.
- Every processed URL creates either success or error.
- Batch 20 downloads automatically.
- Stop flushes 1–19 pending records.
- Cooldown occurs after 50 records.
- Worker restart becomes `interrupted`.
- Resume starts from persisted `nextPostIndex` without duplicate persisted IDs.

Stop assertion:

```js
assert.equal(stopped.job.status, "stopped");
assert.equal(stopped.job.pendingBatchRecords, 0);
assert.equal(downloads.length, 1);
assert.equal(saved.fbPodCrawlerActiveJob.nextPostIndex, 7);
```

- [ ] **Step 2: Run worker tests and verify RED**

Run:

```bash
node --test tools/facebook-group-crawler-extension/service-worker.test.cjs
```

Expected: existing regression passes; new content-only tests FAIL because the
mode does not exist.

- [ ] **Step 3: Extend status and content-only batch builder**

Add to `summarizeJob()`:

```js
mode: job.mode || "all_posts_all_comments",
importedPosts: job.mode === "post_content_only" ? job.postUrls?.length || 0 : null,
successfulPosts: job.successfulPosts || 0,
failedPosts: job.failedPosts || 0,
nextPostIndex: job.nextPostIndex || 0,
```

Build files using `post-content-batch` filenames and a `crawl_meta` header that
reports imported, processed, successful, failed, and remaining counts.

- [ ] **Step 4: Implement the persistent loop**

Create `runContentOnlyCrawl(tabId, job)` which:

1. Iterates from `job.nextPostIndex`.
2. Navigates and sends `FB_POD_EXTRACT_POST_CONTENT_ONLY`.
3. Retries once after `POST_ROOT_TIMEOUT`.
4. Creates `post_content_error` after the retry fails.
5. Pushes the record and advances counters/index.
6. Persists the complete active job.
7. Flushes every 20 records.
8. Waits 60 seconds after each 50 processed records.
9. Flushes the final partial batch before `completed`.

- [ ] **Step 5: Implement Start, Stop, and Resume messages**

`FB_POD_START_CONTENT_ONLY` creates a fresh job from imported posts.

`FB_POD_STOP_CRAWL` recognizes content-only mode, sets `stopRequested`, signals
the tab, waits for the loop to exit, flushes pending records, and leaves Resume
available if `nextPostIndex` is less than the queue length.

`FB_POD_RESUME_CONTENT_ONLY` clears interruption/stop flags, uses the new active
tab ID, and invokes the same loop from the persisted index.

- [ ] **Step 6: Run all worker tests**

Run:

```bash
node --test tools/facebook-group-crawler-extension/service-worker.test.cjs
```

Expected: all existing and content-only worker tests PASS.

---

### Task 5: Manifest, complete verification, and live Edge smoke test

**Files:**
- Modify: `tools/facebook-group-crawler-extension/manifest.json`
- Verify: all extension files and the real discovery input.

**Interfaces:**
- Produces extension version `0.3.0`.

- [ ] **Step 1: Bump the manifest**

Set:

```json
{
  "version": "0.3.0",
  "description": "Import Facebook group discovery data and crawl post content, with optional full comment and reply extraction."
}
```

- [ ] **Step 2: Run the complete automated verification**

Run:

```bash
node --test tools/facebook-group-crawler-extension/*.test.cjs
node --check tools/facebook-group-crawler-extension/content-only-core.js
node --check tools/facebook-group-crawler-extension/content-script.js
node --check tools/facebook-group-crawler-extension/service-worker.js
node --check tools/facebook-group-crawler-extension/popup.js
python3 -m json.tool tools/facebook-group-crawler-extension/manifest.json >/dev/null
git diff --check
```

Expected: all tests PASS, all syntax/JSON checks exit 0, and no whitespace
errors.

- [ ] **Step 3: Reload in Edge**

Open `edge://extensions`, reload `Facebook POD Group Crawler`, and verify Edge
shows version `0.3.0`.

- [ ] **Step 4: Run a three-post smoke test**

Import a three-record discovery fixture, run content-only mode, and verify:

- Three processed records.
- No comment expansion in the UI.
- One final partial batch downloaded.
- Every success has non-empty `post.rawText`.
- `commentsSkipped` is true and `comments` is empty.

- [ ] **Step 5: Verify Stop and Resume live**

Run a second fixture, Stop after at least one processed post, verify the partial
batch downloads, then Resume and confirm remaining posts complete with no
duplicate post IDs.


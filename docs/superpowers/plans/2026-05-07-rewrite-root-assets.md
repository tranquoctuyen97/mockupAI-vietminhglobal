# rewriteRootAssets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 404s for root-relative static asset files (`.ico`, `.png`, etc.) that the React app loads as JS string literals, by rewriting those paths to go through the inkhub-proxy.

**Architecture:** Add `rewriteRootAssets(body, proxyBase)` to `proxy-utils.ts` and call it in the UI proxy handler on all text content after the existing HTML rewrites. The regex targets quoted string literals whose paths end in known asset extensions, skipping already-proxied paths via a negative lookahead.

**Tech Stack:** TypeScript, Node.js `test` runner (no extra deps).

---

### Task 1: Add `rewriteRootAssets` with tests

**Files:**
- Modify: `src/lib/inkhub/proxy-utils.ts`
- Modify: `src/lib/inkhub/proxy-utils.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `src/lib/inkhub/proxy-utils.test.ts`:

```typescript
import { isTextContent, rewriteApiUrls, injectTokenScript, rewriteAbsolutePaths, rewriteRootAssets } from "./proxy-utils";

test("rewriteRootAssets: rewrites root-relative asset paths in JS double-quotes", () => {
  const js = 'const logo = "/shopify-logo.ico"; const img = "/brand.png";';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.ok(result.includes('"/api/inkhub-proxy/shopify-logo.ico"'));
  assert.ok(result.includes('"/api/inkhub-proxy/brand.png"'));
});

test("rewriteRootAssets: rewrites root-relative asset paths in JS single-quotes", () => {
  const js = "const logo = '/shopify-logo.ico';";
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.ok(result.includes("'/api/inkhub-proxy/shopify-logo.ico'"));
});

test("rewriteRootAssets: does not rewrite already-proxied paths", () => {
  const js = 'const logo = "/api/inkhub-proxy/shopify-logo.ico";';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.equal(result, js);
});

test("rewriteRootAssets: does not rewrite non-asset paths", () => {
  const js = 'router.push("/orders"); router.push("/login");';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.equal(result, js);
});

test("rewriteRootAssets: handles query strings", () => {
  const js = 'const url = "/favicon.ico?v=2";';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.ok(result.includes('"/api/inkhub-proxy/favicon.ico?v=2"'));
});

test("rewriteRootAssets: rewrites svg, webp, woff2 extensions", () => {
  const js = '"/icon.svg" "/hero.webp" "/font.woff2"';
  const result = rewriteRootAssets(js, "/api/inkhub-proxy");
  assert.ok(result.includes('"/api/inkhub-proxy/icon.svg"'));
  assert.ok(result.includes('"/api/inkhub-proxy/hero.webp"'));
  assert.ok(result.includes('"/api/inkhub-proxy/font.woff2"'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/tuyen.tq/Documents/freelancer/vietminhglobal/app
node --experimental-strip-types --test src/lib/inkhub/proxy-utils.test.ts 2>&1 | tail -20
```

Expected: failures mentioning `rewriteRootAssets is not a function` (or import error).

- [ ] **Step 3: Add `rewriteRootAssets` to `proxy-utils.ts`**

Add this function at the bottom of `src/lib/inkhub/proxy-utils.ts`:

```typescript
// Rewrite root-relative static asset paths in JS/CSS string literals to go through the proxy.
// Matches quoted strings like "/logo.png" or "/icon.ico?v=2". Skips already-proxied paths.
export function rewriteRootAssets(body: string, proxyBase: string): string {
  return body.replace(
    /(["'])(\/(?!api\/)(?:[^"'?#]*\.)(?:ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot|otf)(?:\?[^"']*)?)\1/g,
    `$1${proxyBase}$2$1`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --experimental-strip-types --test src/lib/inkhub/proxy-utils.test.ts 2>&1 | tail -20
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inkhub/proxy-utils.ts src/lib/inkhub/proxy-utils.test.ts
git commit -m "feat: add rewriteRootAssets to proxy root-relative asset paths in JS/CSS"
```

---

### Task 2: Call `rewriteRootAssets` in the UI proxy handler

**Files:**
- Modify: `src/app/api/inkhub-proxy/[[...path]]/route.ts`

- [ ] **Step 1: Update the import line**

In `src/app/api/inkhub-proxy/[[...path]]/route.ts`, change:

```typescript
import { injectTokenScript, isTextContent, rewriteAbsolutePaths, rewriteApiUrls } from "@/lib/inkhub/proxy-utils";
```

to:

```typescript
import { injectTokenScript, isTextContent, rewriteAbsolutePaths, rewriteApiUrls, rewriteRootAssets } from "@/lib/inkhub/proxy-utils";
```

- [ ] **Step 2: Add the call after existing rewrites**

Change the body-processing block from:

```typescript
  body = rewriteApiUrls(body, host);

  if (contentType.includes("text/html")) {
    body = rewriteAbsolutePaths(body, "/api/inkhub-proxy");
    body = injectTokenScript(body, token, orgId);
  }

  return new Response(body, { status: upstream.status, headers: responseHeaders });
```

to:

```typescript
  body = rewriteApiUrls(body, host);

  if (contentType.includes("text/html")) {
    body = rewriteAbsolutePaths(body, "/api/inkhub-proxy");
    body = injectTokenScript(body, token, orgId);
  }

  body = rewriteRootAssets(body, "/api/inkhub-proxy");

  return new Response(body, { status: upstream.status, headers: responseHeaders });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/tuyen.tq/Documents/freelancer/vietminhglobal/app
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors).

- [ ] **Step 4: Smoke-test in the browser**

Start the dev server (`pnpm dev`) and navigate to `/auto-fulfill`. Open DevTools → Network tab. Confirm no 404s for `/shopify-logo.ico`, `/merchize-logo.png`, `/beeful-logo.png`. They should now be fetched as `/api/inkhub-proxy/shopify-logo.ico` etc.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/inkhub-proxy/[[...path]]/route.ts
git commit -m "fix: proxy root-relative static assets through inkhub-proxy"
```

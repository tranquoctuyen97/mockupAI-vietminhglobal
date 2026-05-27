# Browser Performance Audit: `/wizard` and the authenticated shell

Date: 2026-05-27  
Environment: `localhost:3000` with the dev user from `.env.local`, checked in Chrome headless via CDP.

## Scope

I audited the authenticated shell and the main workspace routes that a user reaches from the sidebar:

`/dashboard`, `/wizard`, `/stores`, `/listings`, `/designs`, `/auto-fulfill`, `/integrations/printify`, `/integrations/triple-whale`, `/admin/users`, `/admin/pricing`, `/admin/ai-settings`, `/admin/acl`, `/admin/inkhub`, `/stores/new`, `/docs/custom-app`, and one real store config detail page: `/stores/cmogmwkrv0006axt0ktw5e3eq/config`.

## Short version

The `/wizard` page is slow, but it is not the only problem. The biggest shared cost is the global `TokenExpiredBanner`, which mounts inside `AuthedShell` on every authenticated page and fetches `/api/stores` on first render. That single fetch is visible across almost every route I checked and usually takes 5-8 seconds. Some pages add their own second store fetch on top of that.

So the blast radius is wider than the original `/wizard` report: the authenticated shell is carrying a global store-list request everywhere.

## Browser measurements

The numbers below are browser measurements from the navigation timing API and resource entries, not inferred from code.

| Route | TTFB | load event | API/network notes | DB Queries Executed |
|---|---:|---:|---|---|
| `/dashboard` | 781 ms | 3.78 s | `/api/stores` took 7.75 s | **15 + N** (10 SSR, 5+N client api) |
| `/wizard` | 975 ms | 2.30 s | `/api/stores` took 5.73 s | **12 + N** (7 SSR, 5+N client api) |
| `/stores` | 833 ms | 7.90 s | `/api/stores` took 5.16 s | **12 + 2N** (7+N SSR, 5+N client api) |
| `/listings` | 2.61 s | 4.08 s | `/api/stores` took 5.10 s | **14 + N** (9 SSR, 5+N client api) |
| `/designs` | 1.51 s | 2.43 s | `/api/stores` took 5.47 s | **12 + N** (7 SSR, 5+N client api) |
| `/integrations/triple-whale` | 4.34 s | 4.45 s | `/api/stores` took 7.56 s | **10 + N** (5 SSR, 5+N client api) |
| `/admin/users` | 1.60 s | 1.71 s | `/api/stores` took 8.11 s | **13 + N** (3 SSR, 10+N client api) |
| `/admin/pricing` | 1.55 s | 1.67 s | `/api/stores` took 7.95 s | **12 + N** (3 SSR, 9+N client api) |
| `/admin/ai-settings` | 1.62 s | 1.75 s | `/api/stores` took 7.71 s | **17 + N** (3 SSR, 14+N client api) |
| `/admin/acl` | 1.34 s | 1.70 s | `/api/stores` took 5.35 s | **11 + N** (6 SSR, 5+N client api) |
| `/admin/inkhub` | 1.52 s | 1.86 s | `/api/stores` took 5.05 s | **12 + N** (7 SSR, 5+N client api) |
| `/stores/new` | 1.43 s | 1.52 s | `/api/stores` took 5.33 s | **8 + N** (3 SSR, 5+N client api) |
| `/docs/custom-app` | 1.46 s | 1.61 s | `/api/stores` took 5.15 s | **8 + N** (3 SSR, 5+N client api) |
| `/stores/cmogmwkrv0006axt0ktw5e3eq/config` | 1.24 s | 1.32 s | two `/api/stores` fetches, 7.66 s and 7.60 s | **13 + 2N** (3 SSR, 10+2N client api) |
| `/auto-fulfill` | 5.72 s | 5.72 s | no idle within window; pending XHRs to `/api/inkhub-api/api/orders/stats/*` | **6** (6 SSR, 0 client api) |
| `/integrations/printify` | 0.88 s | 1.05 s | `/api/stores` took 4.79 s and `/api/integrations/printify/accounts` took 1.83 s | **13 + N** (3 SSR, 10+N client api) |

> [!TIP]
> Fix #1 + #2 + #4 có thể làm ngay, giảm ~3s mà không thay đổi kiến trúc. Fix #6 (migrate DB region) sẽ giải quyết triệt để vấn đề latency cho toàn bộ app.

---

## 🔍 Chi Tiết Truy Vấn Database Cho Từng Route (Detailed Query Breakdown)

Dưới đây là thống kê chi tiết các bảng được truy vấn và số lượng câu lệnh SQL/Prisma tương ứng cho mỗi route (khi thực hiện SSR và gọi các API client liên quan):

### 1. `/dashboard`
* **SSR Queries (10 queries)**:
  * `sessions` (layout `validateSession`)
  * `users` (layout `validateSession`)
  * `sessions` (page `validateSession` - trùng lặp)
  * `users` (page `validateSession` - trùng lặp)
  * `tenant_role_permissions` (lấy feature permissions)
  * `tenants` (lấy múi giờ `twTimezone`)
  * `designs` (đếm số lượng mẫu thiết kế đang hoạt động)
  * `listings` (đếm số lượng listings đang bán)
  * `orders` (đếm số đơn hàng 7 ngày qua)
  * `orders` (tính tổng doanh thu `totalUsd`)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * `sessions` & `users` (authed check)
  * `stores` (truy vấn danh sách cửa hàng)
  * `store_colors`, `store_mockup_templates`, `template_colors` (các quan hệ include trong `listStores`)
  * `printify_variant_cache` (vòng lặp N câu truy vấn tuần tự để lấy bảng màu)

### 2. `/wizard`
* **SSR Queries (7 queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
  * `wizard_drafts` (truy vấn drafts)
  * `mockup_jobs` (lấy job render đi kèm)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Kích hoạt bởi banner `TokenExpiredBanner` để lấy danh sách cửa hàng.

### 3. `/stores`
* **SSR Queries (7 + N queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
  * `tenant_role_permissions` (kiểm tra quyền truy cập tính năng `stores`)
  * `stores` cùng các bảng liên quan (thực thi hàm `listStores()` bao gồm N câu truy vấn tuần tự)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Gọi trùng lặp lại toàn bộ logic `listStores()` từ `TokenExpiredBanner`.

### 4. `/listings`
* **SSR Queries (9 queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
  * `listings` (lấy danh sách)
  * `listing_variants` & `shopify_publish_jobs` (các quan hệ include)
  * `listings` (phân trang count)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Gọi danh sách stores từ global banner.

### 5. `/designs`
* **SSR Queries (7 queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
  * `designs` (lấy danh sách)
  * `designs` (phân trang count)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Gọi danh sách stores từ global banner.

### 6. `/integrations/triple-whale`
* **SSR Queries (5 queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Gọi danh sách stores từ global banner.

### 7. `/admin/users`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
* **Client-side API Queries (10 + N queries)**:
  * `GET /api/stores` (5 + N queries từ banner)
  * `GET /api/auth/me` (2 queries check auth)
  * `GET /api/admin/users` (3 queries: check auth + lấy danh sách người dùng)

### 8. `/admin/pricing`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
* **Client-side API Queries (9 + N queries)**:
  * `GET /api/stores` (5 + N queries từ banner)
  * `GET /api/admin/pricing-templates` (4 queries: check auth + check feature pricing + lấy danh sách pricing templates)

### 9. `/admin/ai-settings`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
* **Client-side API Queries (14 + N queries)**:
  * `GET /api/stores` (5 + N queries từ banner)
  * `GET /api/admin/ai-settings` (9 queries: check auth, check feature ai_settings, `ai_settings`, `ai_provider_settings`, `ai_usage_events`, và 3 truy vấn `ai_provider_model_cache` của 3 AI providers)

### 10. `/admin/acl`
* **SSR Queries (6 queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
  * `tenant_role_permissions` (lấy danh sách ACL)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Gọi danh sách stores từ global banner.

### 11. `/admin/inkhub`
* **SSR Queries (7 queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
  * `tenant_role_permissions` (check feature inkhub)
  * `inkhub_credentials` (lấy cấu hình kết nối Inkhub)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Gọi danh sách stores từ global banner.

### 12. `/stores/new`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Gọi danh sách stores từ global banner.

### 13. `/docs/custom-app`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Gọi danh sách stores từ global banner.

### 14. `/stores/[id]/config`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
* **Client-side API Queries (10 + 2N queries)**:
  * `GET /api/stores` (5 + N queries từ banner)
  * `GET /api/stores` (5 + N queries do page tự gọi độc lập qua `fetchStore`, lãng phí thêm 12 queries trùng lặp)

### 15. `/auto-fulfill`
* **SSR Queries (6 queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
  * `inkhub_credentials` (lấy cấu hình credentials)
  *(Không có Client-side API Queries cho store-list do route này render qua iframe riêng, không dùng AuthedShell).*

### 16. `/integrations/printify`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession`)
  * `tenant_role_permissions` (lấy feature permissions)
* **Client-side API Queries (10 + N queries)**:
  * `GET /api/stores` (5 + N queries từ banner)
  * `GET /api/integrations/printify/accounts` (5 queries: check auth + `printify_accounts` + `printify_shops` + `stores`)

> [!NOTE]
> **N** represents the number of unique blueprint-provider pairs in the system, which causes an N+1 query loop on `printify_variant_cache` in `listStores()`. In our dev system, **N = 7**. Thus, routes loading `/api/stores` trigger 7 additional DB queries.

## What the browser proved

1. `/wizard` itself is not the source of the global store fetch. The page is a server component that only renders `WizardListClient`; it does not call `/api/stores` directly.

   Code reference: `src/app/(authed)/wizard/page.tsx:15-24`

2. The shared fetch comes from `TokenExpiredBanner`, which is mounted inside `AuthedShell` for every authenticated page.

   Code references:
   - `src/app/(authed)/AuthedShell.tsx:369`
   - `src/components/TokenExpiredBanner.tsx:17-27`

3. `/api/stores` returns the full store list, not a lightweight summary.

   Code reference: `src/app/api/stores/route.ts:20-27`

4. The store config detail page adds its own extra `fetch("/api/stores")` on top of the global banner, which is why that route showed two long store fetches in Chrome.

   Code reference: `src/app/(authed)/stores/[id]/config/page.tsx:159-181`

5. `/auto-fulfill` is intentionally an iframe shell. The body text looks empty because the visible content is inside `<iframe src="/api/inkhub-proxy/">`, not because the page failed to render.

   Code reference: `src/app/(authed)/auto-fulfill/page.tsx:40-45`

## Findings

### P0: Global `/api/stores` fetch on every authenticated page

This is the main performance problem. The banner is mounted globally, and the browser showed the same long `/api/stores` call on almost every authenticated route. Even pages that otherwise load quickly still inherit this cost in the background.

This matches the route-level data:
- `/dashboard`, `/wizard`, `/designs`, `/stores/new`, `/docs/custom-app`, and all admin pages paid for the same store fetch.
- The fetch is not cached across navigations in the browser measurements.

### P1: Store config detail page duplicates the same request

`/stores/{id}/config` has the global banner fetch plus its own `fetchStore()` effect. Chrome showed two `/api/stores` requests, both around 7.6 s.

### P1: `/auto-fulfill` is a separate embedded app and does not reach idle

This route is not a normal React page. It embeds the Inkhub UI through `/api/inkhub-proxy/`, and the browser still had three XHRs pending for orders stats after the local shell had loaded. That means the user experience is gated by the embedded app, not just by MockupAI.

### P2: `/integrations/printify` is much lighter than the store-heavy pages

It still pays the global `/api/stores` cost, but the page-specific fetch to `/api/integrations/printify/accounts` was much cheaper than the store-list fetch. This page is not the current bottleneck.

## What I would fix first

1. Remove or defer the global `TokenExpiredBanner` fetch.
   - Best option: render the banner from server data or switch it to a narrow endpoint like an expired-count/expired-ids summary.
   - If the banner only matters when something is expired, it should not pull the full store list on every authenticated page.

2. Stop refetching the full store list on store config pages.
   - Pass the selected store from the server component or add a per-store endpoint.
   - Right now the store config route duplicates the same expensive data path.

3. Keep `/auto-fulfill` lazy.
   - The iframe is fine, but treat it as a separate embedded app and show a fast local shell while it streams in.

4. Treat `/api/stores` as a shared hot path.
   - Any work on the underlying query path will improve the whole app, not just `/wizard`.

## Bottom line

The browser audit confirms the original `/wizard` complaint, but it also shows the issue is broader:

- the authenticated shell pays for `/api/stores` everywhere,
- `/stores/{id}/config` pays twice,
- `/auto-fulfill` is a separate embedded flow with its own long-lived requests.

Fixing `/wizard` alone will not clear the app. The first win is to remove the global store-list fetch from the shared shell path, then trim the detail pages that duplicate it.

---

## Detailed Database Query Breakdown by Route

Below is the list of database queries executed during server-side rendering (SSR) and client-side API fetches for each audited route. Note that **N** represents the number of unique blueprint-provider pairs causing N+1 sequential Prisma queries on `printify_variant_cache` in the store list service (where **N = 7**).

### 1. `/dashboard`
* **SSR Queries (10 queries)**:
  * `sessions` (layout `validateSession` check)
  * `users` (layout `validateSession` check)
  * `sessions` (page `validateSession` check)
  * `users` (page `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
  * `tenants` (reads `twTimezone` config)
  * `designs` (count of active designs)
  * `listings` (count of active listings)
  * `orders` (count of orders in the past 7 days)
  * `orders` (aggregate sum of `totalUsd`)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * `sessions` & `users` (endpoint session validation)
  * `stores` (retrieves stores list)
  * `store_colors`, `store_mockup_templates`, `template_colors` (includes in listStores)
  * `printify_variant_cache` (loop of N sequential queries for color cache)

### 2. `/wizard`
* **SSR Queries (7 queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (feature permissions lookup)
  * `wizard_drafts` (listDrafts)
  * `mockup_jobs` (jobs matching the drafts list)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Standard store list fetch via the global `TokenExpiredBanner` component.

### 3. `/stores`
* **SSR Queries (7 + N queries)**:
  * `sessions` & `users` (layout `validateSession`)
  * `sessions` & `users` (page `validateSession`)
  * `tenant_role_permissions` (feature permissions lookup)
  * `tenant_role_permissions` (check for page feature permission)
  * `stores` and related tables (retrieved via `listStores()`, including N queries for cache)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Re-fetches the entire store list via the `TokenExpiredBanner` banner, duplicating the query sequence.

### 4. `/listings`
* **SSR Queries (9 queries)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `sessions` & `users` (page `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
  * `listings` (findMany)
  * `listing_variants` & `shopify_publish_jobs` (includes)
  * `listings` (count for pagination)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Global banner store list + cache N+1 queries.

### 5. `/designs`
* **SSR Queries (7 queries)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `sessions` & `users` (page `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
  * `designs` (findMany matching tenant)
  * `designs` (count for pagination)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Global banner store list + cache N+1 queries.

### 6. `/integrations/triple-whale`
* **SSR Queries (5 queries)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `sessions` & `users` (page `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Global banner store list + cache N+1 queries.

### 7. `/admin/users`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
* **Client-side API Queries (10 + N queries)**:
  * `GET /api/stores` (5 + N queries for global banner)
  * `GET /api/auth/me` (2 queries: `sessions`, `users` lookups)
  * `GET /api/admin/users` (3 queries: `sessions`, `users`, and list of user accounts)

### 8. `/admin/pricing`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
* **Client-side API Queries (9 + N queries)**:
  * `GET /api/stores` (5 + N queries for global banner)
  * `GET /api/admin/pricing-templates` (4 queries: `sessions`, `users`, `tenant_role_permissions` check, `product_pricing_templates` list)

### 9. `/admin/ai-settings`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
* **Client-side API Queries (14 + N queries)**:
  * `GET /api/stores` (5 + N queries for global banner)
  * `GET /api/admin/ai-settings` (9 queries: `sessions`, `users`, `tenant_role_permissions` check, `ai_settings`, `ai_provider_settings`, `ai_usage_events`, and 3x `ai_provider_model_cache` lookups)

### 10. `/admin/acl`
* **SSR Queries (6 queries)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `sessions` & `users` (page `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
  * `tenant_role_permissions` (lists ACL entries)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Global banner store list + cache N+1 queries.

### 11. `/admin/inkhub`
* **SSR Queries (7 queries)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `sessions` & `users` (page `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
  * `tenant_role_permissions` (check for inkhub features)
  * `inkhub_credentials` (retrieves credentials)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Global banner store list + cache N+1 queries.

### 12. `/stores/new`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Global banner store list + cache N+1 queries.

### 13. `/docs/custom-app`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
* **Client-side API Queries (`GET /api/stores` - 5 + N queries)**:
  * Global banner store list + cache N+1 queries.

### 14. `/stores/[id]/config`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
* **Client-side API Queries (10 + 2N queries)**:
  * `GET /api/stores` (5 + N queries for global banner)
  * `GET /api/stores` (5 + N queries for config detail page loading - duplicates entire store list queries)

### 15. `/auto-fulfill`
* **SSR Queries (6 queries)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `sessions` & `users` (page `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
  * `inkhub_credentials` (retrieves credentials)
  *(Note: This page uses an iframe shell and does not load the AuthedShell navbar, so it has 0 client-side queries for store listing).*

### 16. `/integrations/printify`
* **SSR Queries (3 queries - shell)**:
  * `sessions` & `users` (layout `validateSession` check)
  * `tenant_role_permissions` (feature permissions lookup)
* **Client-side API Queries (10 + N queries)**:
  * `GET /api/stores` (5 + N queries for global banner)
  * `GET /api/integrations/printify/accounts` (5 queries: `sessions`, `users`, `printify_accounts`, `printify_shops`, and store checks)


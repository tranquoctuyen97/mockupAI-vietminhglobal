# Auto-Fulfill Embed — Design Spec
**Date:** 2026-05-05  
**Status:** Approved

## Problem

Khách hàng có platform auto-fulfill riêng tại `inkhub.grabink.co` (custom-built, chạy trên Cloudflare). Yêu cầu:
- Nhúng toàn bộ UI của platform vào MockupAI
- Admin của MockupAI không biết credential của platform
- Phân quyền qua hệ thống role của MockupAI

iframe trực tiếp không đủ vì:
- Không thể inject token vào localStorage của origin khác (Same-Origin Policy)
- Cần auto-login seamless, không để lộ credential ra client

## Approach: Reverse Proxy + Token Injection

Proxy toàn bộ platform qua 2 Next.js API routes cùng origin với app. Vì cùng origin, iframe có thể nhận script inject token vào localStorage trước khi React app của platform boot.

## Architecture

```
Admin (browser)
    │  GET /auto-fulfill
    ▼
[Next.js /auto-fulfill page]
    │  <iframe src="/api/inkhub-proxy/">
    ▼
[UI Proxy]  /api/inkhub-proxy/[...path]
    │  → fetch https://inkhub.grabink.co/[...path]
    │  → text/html: inject token script + rewrite API URLs
    │  → other: stream as-is
    ▼
[API Proxy]  /api/inkhub-api/[...path]
    │  → fetch https://api-inkhub-v2.grabink.co/[...path]
    │  → spoof origin: https://inkhub.grabink.co
    │  → inject Authorization: Bearer <token>
    ▼
[Token Manager]  lib/inkhub/token.ts
    └  → POST https://api-inkhub-v2.grabink.co/api/auth/login
```

## Components

### 1. Token Manager — `src/lib/inkhub/token.ts`

Singleton in-memory trên server. Thread-safe với single promise lock khi đang refresh.

**State:**
```ts
cachedToken: string | null
orgId: string | null       // organizations[0].id từ login response
expiresAt: number | null   // JWT exp * 1000 - 5 phút buffer
```

**API:**
- `getToken(): Promise<{ token: string; orgId: string }>` — return cached nếu còn hạn, gọi login nếu không
- `login()` — POST đến login endpoint, parse JWT `exp` từ base64 payload, cache kết quả

**Login endpoint:**
```
POST https://api-inkhub-v2.grabink.co/api/auth/login
Body: { username: INKHUB_USERNAME, password: INKHUB_PASSWORD }
Response: { token, organizations: [{ id, name, role }] }
```

Token expiry: 30 ngày (`exp - iat = 2,592,000s`). Trong thực tế hiếm khi cần refresh.

**Env vars:**
```
INKHUB_USERNAME=inkhub@vietminhglobal.com
INKHUB_PASSWORD=<secret>
```

### 2. UI Proxy — `src/app/api/inkhub-proxy/[...path]/route.ts`

Proxy mọi request đến `https://inkhub.grabink.co`.

**Text response processing** (`text/html`, `text/javascript`, `application/javascript`, `text/css`):
1. Decompress nếu `Content-Encoding: gzip/br`
2. String replace: `api-inkhub-v2.grabink.co` → `${HOST}/api/inkhub-api`  
   (JS bundle chứa hardcoded API URL — nếu không rewrite trong JS → CORS block khi JS gọi thẳng từ browser)
3. Nếu `text/html`: inject trước `</head>`:
   ```html
   <script>
     localStorage.setItem('token','TOKEN');
     localStorage.setItem('organizationId','ORG_ID');
   </script>
   ```
4. Re-set `Content-Length` theo body mới, xóa `Content-Encoding` (đã decompress)

**Binary response** (images, fonts, woff2, v.v.): stream thẳng về, không xử lý.

**Headers forwarded:** `accept`, `accept-language`, `user-agent`, `cookie` (nếu có).  
**Headers stripped từ response:** `x-frame-options`, `content-security-policy` (để iframe hoạt động).

### 3. API Proxy — `src/app/api/inkhub-api/[...path]/route.ts`

Proxy mọi request đến `https://api-inkhub-v2.grabink.co`.

**Headers injected:**
```
origin: https://inkhub.grabink.co
referer: https://inkhub.grabink.co/
authorization: Bearer <token từ TokenManager>
```

**Headers forwarded từ client:** `content-type`, `accept`, request body.

**Response:** stream thẳng về, bao gồm status code, không strip headers.

### 4. Page — `src/app/(authed)/auto-fulfill/page.tsx`

```tsx
<iframe
  src="/api/inkhub-proxy/"
  className="w-full border-0"
  style={{ height: 'calc(100vh - 56px)' }}  // 56px = mobile topbar height
  title="Auto Fulfill"
/>
```

Desktop (lg+): không có topbar → `height: 100vh`.

**Layout:** `AuthedShell.tsx` check `pathname.startsWith('/auto-fulfill')` → skip `p-6 lg:p-8 max-w-7xl` wrapper, render `children` full-width.

### 5. Navigation — `AuthedShell.tsx`

Thêm vào `NAV_ITEMS`:
```ts
{ label: "Auto Fulfill", href: "/auto-fulfill", icon: <Truck size={18} /> }
```

Import `Truck` từ `lucide-react`.

## Security

| Concern | Mitigation |
|---------|-----------|
| Credential leak | Chỉ trong `.env` server, không bao giờ ra client hay logs |
| JWT exposed qua DevTools | JWT là service account của tổ chức, không phải account cá nhân admin — rủi ro chấp nhận được cho internal tool |
| Proxy accessible khi chưa login | `proxy.ts` middleware hiện tại chặn tất cả routes chưa auth → redirect `/login` |
| Platform update thay đổi URL pattern | URL rewrite dùng string replace đơn giản — nếu họ đổi API domain cần update 1 constant |

## Files to Create/Modify

**Tạo mới:**
- `src/lib/inkhub/token.ts` — Token Manager
- `src/app/api/inkhub-proxy/[...path]/route.ts` — UI Proxy
- `src/app/api/inkhub-api/[...path]/route.ts` — API Proxy
- `src/app/(authed)/auto-fulfill/page.tsx` — Iframe page

**Sửa:**
- `src/app/(authed)/AuthedShell.tsx` — thêm nav item + conditional layout
- `.env.example` — thêm `INKHUB_USERNAME`, `INKHUB_PASSWORD`

## Out of Scope

- WebSocket support (chưa biết platform có dùng không — có thể thêm sau nếu cần)
- Caching static assets qua proxy (performance optimization — v2)
- Multi-organization support (hiện tại hardcode `organizations[0]`)

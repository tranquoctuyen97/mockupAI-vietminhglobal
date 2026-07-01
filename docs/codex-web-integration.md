# Codex Web Integration

## Mục tiêu

Nhúng `0xcaff/codex-web` vào website nội bộ để member dùng Codex qua trình duyệt mà không phải tự login Codex/OpenAI.

Phase 1 dùng 1 runtime chung trên VPS để không tăng RAM:

```text
Member đăng nhập website
  -> /ai-hub iframe
  -> /api/codex-proxy/ qua ai-hub gateway
  -> codex-web chạy trên 127.0.0.1:8214
  -> Codex CLI/app-server trên VPS
  -> file, shell, project trên VPS
```

Không cần Cloudflare. Website nội bộ và app proxy đứng trước `codex-web`.

## Vì sao chuyển sang codex-web

`0xcaff/codex-web` là browser frontend mỏng cho Codex, chạy trên máy mình kiểm soát. README ghi rõ nó:

- chạy được trên Linux box/cloud/home lab;
- dùng binary `codex` từ `PATH`;
- hỗ trợ override bằng `CODEX_CLI_PATH`;
- cần host đã `codex login --device-auth`;
- không tự xử lý authn/authz, nên phải đặt sau auth/reverse proxy của app.

Điểm này hợp với MockupAI hơn `codex-mobile`: website đang có member/session/RBAC, còn Codex chỉ là runtime nội bộ.

## Ranh giới bảo mật

Với 1 `codex-web` instance và 1 Linux user chạy Codex, A và B dùng chung quyền hệ thống của user đó.

Workspace filter chỉ làm:

- A chỉ thấy folder của A và folder chung.
- B chỉ thấy folder của B và folder chung.
- Route mở project bị chặn nếu path không nằm trong allowlist.

Workspace filter không phải phân quyền cứng ở mức OS. Nếu cần chặn tuyệt đối A đọc B, phải tách Linux user/process/container. Phase 1 bỏ hướng đó vì mục tiêu là không tăng RAM.

MCP servers, skills, config và Codex credential thuộc service user `codexbot`. Member có quyền `ai_hub` dùng chung các khả năng đó.

## Runtime trên VPS

Chạy bằng user riêng, ví dụ `codexbot`, không dùng root:

```bash
sudo useradd --system --create-home --shell /bin/bash codexbot
sudo -u codexbot npm install -g @openai/codex
sudo -u codexbot codex login --device-auth
```

Kiểm tra binary:

```bash
sudo -u codexbot sh -lc 'command -v codex && codex --version'
```

Start `codex-web`:

```bash
sudo -u codexbot sh -lc 'CODEX_CLI_PATH="$(command -v codex)" npx --yes git+ssh://git@github.com/tranquoctuyen97/codex-web.git#<pinned-commit-or-tag>'
```

Nếu `command -v codex` không ra trong PM2/systemd, set path cứng:

```bash
CODEX_CLI_PATH=/home/codexbot/.local/bin/codex
```

Lỗi cần nhớ:

```text
Unable to locate the Codex CLI binary
```

Nghĩa là `codex-web` không thấy binary `codex`. Fix bằng cách cài Codex CLI cho đúng user chạy runtime, hoặc set `CODEX_CLI_PATH`.

## PM2 runtime

PM2 app trong VPS:

```text
name: mockupai-codex
user: codexbot
command: npx
args: --yes git+ssh://git@github.com/tranquoctuyen97/codex-web.git#<pinned-commit-or-tag>
env:
  CODEX_CLI_PATH=/home/codexbot/.local/bin/codex
  PORT=8214
```

Port `8214` chỉ bind nội bộ hoặc chỉ cho app/proxy truy cập. Không expose trực tiếp ra internet.

## App routes

```text
/ai-hub
  iframe -> /api/codex-proxy/

/api/codex-proxy/[[...path]]
  served by the MockupAI Next app
  validates website session directly
  injects X-Internal-Member-Id
  proxies HTTP to http://127.0.0.1:8214

/admin/ai-hub
  Connect Codex
  Check status
  Restart runtime
```

## Codex account dùng chung

Member không login Codex. Admin login Codex một lần cho service user `codexbot`.

Luồng admin UI:

```text
Admin bấm Connect Codex
  -> backend chạy: sudo -u codexbot codex login --device-auth
  -> backend lấy link/code từ stdout
  -> UI hiển thị link/code
  -> admin đăng nhập ChatGPT/Codex
  -> Codex ghi credential vào /home/codexbot/.codex/auth.json
  -> backend chạy codex login status
  -> restart mockupai-codex
```

Command kiểm tra:

```bash
sudo -u codexbot codex login status
```

UI admin chỉ cần 3 nhóm trạng thái:

```text
Codex account:
  not_connected | waiting_for_device_auth | connected

Runtime:
  stopped | online | errored | unknown

Proxy:
  reachable | unreachable
```

## Workspace theo member

Website là nguồn quyền. `codex-web` cần được patch hoặc bọc để chỉ nhận workspace allowlist từ website/backend.

Schema tối thiểu:

```text
ai_hub_workspaces
  id
  tenant_id
  name
  path
  type        private | shared
  provider    codex

ai_hub_member_workspaces
  user_id
  workspace_id
```

Ví dụ quyền:

```text
A:
  /srv/ai-hub/members/a
  /srv/ai-hub/common

B:
  /srv/ai-hub/members/b
  /srv/ai-hub/common
```

Endpoint nội bộ:

```http
GET /api/internal/ai-hub/workspaces?provider=codex
X-Internal-Member-Id: <member_id>
Authorization: Bearer <ai_hub_internal_token>
```

Response:

```json
[
  { "name": "My workspace", "path": "/srv/ai-hub/members/u_123" },
  { "name": "Common", "path": "/srv/ai-hub/common" }
]
```

Khi member mở AI Hub lần đầu:

```text
1. Check session + ai_hub permission.
2. Tạo folder riêng /srv/ai-hub/members/<member_id> nếu chưa có.
3. Upsert private workspace.
4. Upsert shared workspace /srv/ai-hub/common.
5. Gán private + shared workspace cho member.
```

## Patch cần làm với codex-web

Giữ patch nhỏ:

1. Project/folder picker gọi endpoint workspace allowlist theo member.
2. API mở/start project reject path không thuộc allowlist.
3. Cache allowlist 30-60 giây.
4. Log member id, project path, thời điểm mở session.

Không tạo permission engine riêng trong `codex-web`. Quyền nằm ở website.

## Embed vào website

Trang nội bộ dùng iframe giống Auto Fulfill:

```html
<iframe src="/api/codex-proxy/" style="width:100%;height:100vh;border:0"></iframe>
```

Nếu realtime/WebSocket không chạy ổn qua Next route handler, fallback nhỏ nhất là thêm internal Node proxy process phía sau website auth. Không chuyển phase này sang direct Nginx proxy nếu chưa chứng minh cần.

Codex Web dùng WebSocket `/__backend/ipc`. Chỉ thêm gateway process nếu smoke test chứng minh Next route handler không đủ:

```text
browser /api/codex-proxy/*
  -> MockupAI Next route validates website session
  -> inject X-Internal-Member-Id
  -> proxy HTTP tới 127.0.0.1:8214
```

Gateway không tự quyết quyền. Nó gọi:

```http
GET /api/internal/ai-hub/session
Authorization: Bearer <ai_hub_internal_token>
Cookie: mockupai_session=...
```

App endpoint check session, `ai_hub`, bootstrap workspace, rồi trả member id cho gateway.

## Quyết định hiện tại

- Dùng `0xcaff/codex-web`.
- Dùng 1 runtime để không tăng RAM.
- Không dùng Cloudflare tunnel.
- Member dùng chung Codex account của `codexbot`.
- Website quản lý member và workspace allowlist.
- Filter folder là UX/guard mềm, không phải isolation tuyệt đối.
- Tên bảng dùng prefix `ai_hub_` để không khóa vào Codex nếu sau này AI Hub có tool khác.

## Nguồn tham khảo

- `0xcaff/codex-web`: https://github.com/0xcaff/codex-web
- `openai/codex`: https://github.com/openai/codex
- Codex authentication: https://developers.openai.com/codex/auth/

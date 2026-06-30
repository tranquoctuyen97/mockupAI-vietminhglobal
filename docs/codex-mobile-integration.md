# Codex Mobile Integration

## Mục tiêu

Nhúng `friuns2/codex-mobile` vào website nội bộ để member dùng Codex qua trình duyệt, không phải tự login Codex/OpenAI.

Thiết kế chọn 1 instance dùng chung để không tăng RAM:

```text
Member đăng nhập website
  -> /codex iframe hoặc page nội bộ
  -> reverse proxy nội bộ
  -> codexapp chạy trên 127.0.0.1:18923
  -> Codex CLI/app-server trên VPS
  -> file, shell, project trên VPS
```

Không cần Cloudflare nếu website đã chạy trên VPS. Cloudflare tunnel chỉ cần khi muốn public nhanh từ máy không có domain/reverse proxy.

## Ranh giới bảo mật

Với 1 `codexapp` instance và 1 Linux user chạy Codex, A và B dùng chung quyền hệ thống của user đó.

Workspace filter chỉ làm:

- A chỉ thấy folder của A và folder chung.
- B chỉ thấy folder của B và folder chung.
- Route mở project bị chặn nếu path không nằm trong allowlist.

Workspace filter không phải phân quyền cứng ở mức OS. Nếu cần chặn tuyệt đối A đọc B, phải tách Linux user/process/container. Hiện tại bỏ hướng đó vì mục tiêu là không tăng RAM.

## Runtime trên VPS

Chạy `codexapp` bằng user riêng, ví dụ `codexbot`, không dùng root:

```bash
sudo useradd --system --create-home --shell /bin/bash codexbot
sudo -u codexbot npm install -g @openai/codex
sudo -u codexbot npx codexapp --no-tunnel --port 18923
```

Port `18923` chỉ bind nội bộ hoặc chỉ cho Nginx truy cập. Không expose trực tiếp ra internet.

## Reverse proxy

Website nội bộ chịu trách nhiệm auth member. Sau khi member đăng nhập, proxy `/codex/` sang `codexapp`.

```nginx
location /codex/ {
  proxy_pass http://127.0.0.1:18923/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Internal-Member-Id $authenticated_member_id;
}
```

Header `X-Internal-Member-Id` chỉ được set bởi server/proxy. Không nhận header này trực tiếp từ client.

## Codex account dùng chung

Member không login Codex. Admin login Codex một lần cho service user `codexbot`.

Luồng admin UI:

```text
Admin bấm Connect Codex
  -> backend chạy: sudo -u codexbot codex login --device-auth
  -> backend lấy link/code từ stdout
  -> UI hiển thị link/code hoặc QR từ link
  -> admin đăng nhập ChatGPT/Codex
  -> Codex ghi credential vào /home/codexbot/.codex/auth.json
  -> backend chạy codex login status
  -> restart codexapp
```

Command kiểm tra:

```bash
sudo -u codexbot codex login status
```

UI admin chỉ cần 3 trạng thái:

```text
not_connected
waiting_for_device_auth
connected
```

API key/access token là đường thay thế cho automation, không bắt buộc.

## Workspace theo member

Website là nguồn quyền. `codex-mobile` chỉ đọc allowlist động từ website/backend.

Schema tối thiểu:

```text
members
  id
  email
  name

codex_workspaces
  id
  name
  path
  type        private | shared

codex_member_workspaces
  member_id
  workspace_id
```

Ví dụ quyền:

```text
A:
  /srv/codex/members/a
  /srv/codex/common

B:
  /srv/codex/members/b
  /srv/codex/common
```

Endpoint nội bộ cho `codex-mobile`:

```http
GET /internal/codex/workspaces
X-Internal-Member-Id: <member_id>
Authorization: Bearer <internal_service_token>
```

Response:

```json
[
  { "name": "My workspace", "path": "/srv/codex/members/u_123" },
  { "name": "Common", "path": "/srv/codex/common" }
]
```

Khi thêm member:

```text
1. Tạo member trong website.
2. Tạo folder riêng /srv/codex/members/<member_id>.
3. Gán workspace riêng cho member.
4. Gán các workspace shared cần dùng.
```

Có thể tạo folder lazy khi member mở Codex lần đầu.

## Patch cần làm trong codex-mobile

Giữ patch nhỏ:

1. Project/folder picker gọi endpoint workspace allowlist theo member.
2. API mở/start project reject path không thuộc allowlist.
3. Cache allowlist 30-60 giây.
4. Log member id, project path, thời điểm mở session.

Không tạo permission engine riêng trong `codex-mobile`. Quyền nằm ở website.

## Embed vào website

Trang nội bộ có thể dùng iframe:

```html
<iframe src="/codex/" style="width:100%;height:100vh;border:0"></iframe>
```

Nếu iframe gặp lỗi cookie/CSP/frame headers thì chuyển sang page reverse-proxy trực tiếp thay vì iframe.

## Quyết định hiện tại

- Dùng 1 `codexapp` instance để không tăng RAM.
- Không dùng Cloudflare tunnel.
- Member dùng chung Codex account của `codexbot`.
- Website quản lý member và workspace allowlist.
- Filter folder là UX/guard mềm, không phải isolation tuyệt đối.

## Nguồn tham khảo

- `friuns2/codex-mobile`: https://github.com/friuns2/codex-mobile
- Codex authentication: https://developers.openai.com/codex/auth/
- Codex remote connections: https://developers.openai.com/codex/remote-connections/

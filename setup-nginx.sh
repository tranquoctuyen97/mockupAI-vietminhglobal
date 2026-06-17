#!/usr/bin/env bash
# =============================================================================
# setup-nginx.sh — Tự động setup Nginx reverse proxy + SSL cho MockupAI
#
# Chạy: sudo bash setup-nginx.sh [--dry-run] [--no-ssl]
#
# Đọc config từ .env cùng thư mục:
#   NEXT_PUBLIC_APP_URL  → domain (bắt buộc)
#   PORT                 → proxy port (default: 3000)
#   UPLOAD_DIR           → static file path (default: ./uploads)
#   ADMIN_EMAIL          → certbot email (bắt buộc nếu dùng SSL)
# =============================================================================
set -euo pipefail

# ─── Colors & Helpers ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_ok()   { echo -e "${GREEN}✅ $*${NC}"; }
log_warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
log_err()  { echo -e "${RED}❌ $*${NC}"; }
log_info() { echo -e "${CYAN}ℹ️  $*${NC}"; }
log_step() { echo -e "\n${BOLD}━━━ $* ━━━${NC}"; }

# ─── Parse CLI flags ─────────────────────────────────────────────────────────
DRY_RUN=false
NO_SSL=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --no-ssl)  NO_SSL=true ;;
    --help|-h)
      echo "Usage: sudo bash setup-nginx.sh [--dry-run] [--no-ssl]"
      echo ""
      echo "Options:"
      echo "  --dry-run   Chỉ in config, không apply"
      echo "  --no-ssl    Skip certbot, chỉ HTTP"
      echo ""
      echo "Config đọc từ .env cùng thư mục."
      exit 0
      ;;
    *)
      log_err "Unknown flag: $arg"
      echo "Usage: sudo bash setup-nginx.sh [--dry-run] [--no-ssl]"
      exit 1
      ;;
  esac
done

# ─── Constants ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
NGINX_SITE_NAME="mockupai"
NGINX_AVAILABLE="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"

# ─── Step 1: Root check ──────────────────────────────────────────────────────
log_step "Step 1/8 — Kiểm tra quyền root"

if [[ "$EUID" -ne 0 ]]; then
  log_err "Script cần chạy với sudo/root"
  echo "  → sudo bash setup-nginx.sh"
  exit 1
fi
log_ok "Đang chạy root"

# ─── Step 2: Đọc .env ────────────────────────────────────────────────────────
log_step "Step 2/8 — Đọc .env"

if [[ ! -f "$ENV_FILE" ]]; then
  log_err ".env không tồn tại: $ENV_FILE"
  echo "  → Tạo .env trước khi chạy script"
  exit 1
fi

# Source .env (chỉ lấy biến, không execute)
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# Parse domain từ NEXT_PUBLIC_APP_URL
FULL_URL="${NEXT_PUBLIC_APP_URL:-}"
if [[ -z "$FULL_URL" ]]; then
  log_err "NEXT_PUBLIC_APP_URL chưa set trong .env"
  exit 1
fi

# Extract domain: https://app.code2ship.cloud → app.code2ship.cloud
DOMAIN=$(echo "$FULL_URL" | sed -E 's|^https?://||' | sed -E 's|/.*$||' | sed -E 's|:.*$||')

if [[ -z "$DOMAIN" ]]; then
  log_err "Không parse được domain từ NEXT_PUBLIC_APP_URL=$FULL_URL"
  exit 1
fi

# Other configs with defaults
APP_PORT="${PORT:-3000}"
UPLOAD_PATH="${UPLOAD_DIR:-${SCRIPT_DIR}/uploads}"
CERTBOT_EMAIL="${ADMIN_EMAIL:-}"

log_ok ".env loaded"
log_info "Domain:     ${BOLD}$DOMAIN${NC}"
log_info "Port:       ${BOLD}$APP_PORT${NC}"
log_info "Upload dir: ${BOLD}$UPLOAD_PATH${NC}"
log_info "Email:      ${BOLD}${CERTBOT_EMAIL:-<chưa set>}${NC}"

# ─── Step 3: Validate ────────────────────────────────────────────────────────
log_step "Step 3/8 — Validate config"

ERRORS=0

# Validate domain format (basic check)
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
  log_err "Domain không hợp lệ: $DOMAIN"
  ERRORS=$((ERRORS + 1))
fi

# Validate port is a number
if [[ ! "$APP_PORT" =~ ^[0-9]+$ ]]; then
  log_err "PORT phải là số: $APP_PORT"
  ERRORS=$((ERRORS + 1))
fi

# Validate upload dir exists (warn only)
if [[ ! -d "$UPLOAD_PATH" ]]; then
  log_warn "Upload dir chưa tồn tại: $UPLOAD_PATH (sẽ tạo)"
  mkdir -p "$UPLOAD_PATH"
  log_ok "Đã tạo: $UPLOAD_PATH"
fi

# Validate domain is not localhost or IP-only (SSL requires real FQDN)
if [[ "$NO_SSL" == false ]]; then
  if [[ "$DOMAIN" == "localhost" || "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log_warn "Domain là '$DOMAIN' — Let's Encrypt không cấp SSL cho localhost/IP"
    log_info "Sửa NEXT_PUBLIC_APP_URL trong .env thành domain thật (vd: https://app.code2ship.cloud)"
    log_info "Tạm thời chạy HTTP only"
    NO_SSL=true
  fi
fi

# Validate email for SSL
if [[ "$NO_SSL" == false && -z "$CERTBOT_EMAIL" ]]; then
  log_warn "ADMIN_EMAIL chưa set — sẽ skip SSL"
  log_info "Set ADMIN_EMAIL trong .env để bật HTTPS"
  NO_SSL=true
fi

if [[ "$NO_SSL" == false && -n "$CERTBOT_EMAIL" && ! "$CERTBOT_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
  log_err "Email không hợp lệ: $CERTBOT_EMAIL"
  ERRORS=$((ERRORS + 1))
fi

if [[ $ERRORS -gt 0 ]]; then
  log_err "Có $ERRORS lỗi. Fix rồi chạy lại."
  exit 1
fi

log_ok "Config hợp lệ"

# ─── Generate nginx config ───────────────────────────────────────────────────
# Ensure upload path ends with /
UPLOAD_PATH_SLASH="${UPLOAD_PATH%/}/"

NGINX_CONFIG="server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 500M;

    # Static uploads — bypass Node.js
    location /api/files/ {
        alias ${UPLOAD_PATH_SLASH};
        expires 7d;
        add_header Cache-Control \"public, immutable\";
    }

    # Reverse proxy → Next.js (PM2)
    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # SSE: disable buffering
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_set_header X-Accel-Buffering no;
    }
}"

# ─── Dry-run: print and exit ─────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
  log_step "DRY RUN — Config sẽ ghi vào $NGINX_AVAILABLE"
  echo ""
  echo "$NGINX_CONFIG"
  echo ""
  if [[ "$NO_SSL" == false ]]; then
    log_info "Certbot sẽ chạy: certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $CERTBOT_EMAIL"
  else
    log_info "SSL: bỏ qua (--no-ssl)"
  fi
  log_ok "Dry-run xong. Chạy lại không có --dry-run để apply."
  exit 0
fi

# ─── Step 4: Cài Nginx ───────────────────────────────────────────────────────
log_step "Step 4/8 — Cài Nginx"

if command -v nginx &>/dev/null; then
  log_ok "Nginx đã cài ($(nginx -v 2>&1 | sed 's/.*\///'))"
else
  log_info "Đang cài Nginx..."
  apt-get update -qq
  apt-get install -y -qq nginx
  systemctl enable nginx
  systemctl start nginx
  log_ok "Nginx đã cài xong"
fi

# ─── Step 5: Cài Certbot ─────────────────────────────────────────────────────
log_step "Step 5/8 — Cài Certbot"

if [[ "$NO_SSL" == true ]]; then
  log_info "Skip certbot (--no-ssl hoặc không có email)"
else
  if command -v certbot &>/dev/null; then
    log_ok "Certbot đã cài ($(certbot --version 2>&1 | head -1))"
  else
    log_info "Đang cài Certbot..."
    # Cài qua snap (recommended bởi Let's Encrypt)
    if command -v snap &>/dev/null; then
      snap install --classic certbot 2>/dev/null || true
      ln -sf /snap/bin/certbot /usr/bin/certbot 2>/dev/null || true
    else
      # Fallback: cài qua apt
      apt-get update -qq
      apt-get install -y -qq certbot python3-certbot-nginx
    fi
    log_ok "Certbot đã cài xong"
  fi
fi

# ─── Step 6: Ghi nginx config ────────────────────────────────────────────────
log_step "Step 6/8 — Ghi nginx config"

# Backup bản cũ nếu tồn tại
if [[ -f "$NGINX_AVAILABLE" ]]; then
  BACKUP_NAME="${NGINX_AVAILABLE}.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$NGINX_AVAILABLE" "$BACKUP_NAME"
  log_info "Backup config cũ → $BACKUP_NAME"
fi

# Ghi config mới
echo "$NGINX_CONFIG" > "$NGINX_AVAILABLE"
log_ok "Config đã ghi: $NGINX_AVAILABLE"

# ─── Step 7: Enable & reload ─────────────────────────────────────────────────
log_step "Step 7/8 — Enable site & reload Nginx"

# Enable site
ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
log_ok "Symlink: $NGINX_ENABLED"

# Remove default site
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
  log_info "Đã xoá default site"
fi

# Test config
log_info "Testing nginx config..."
if nginx -t 2>&1; then
  log_ok "nginx -t passed"
else
  log_err "nginx -t FAILED!"
  # Rollback
  if [[ -n "${BACKUP_NAME:-}" && -f "${BACKUP_NAME}" ]]; then
    cp "$BACKUP_NAME" "$NGINX_AVAILABLE"
    log_warn "Đã rollback config cũ từ backup"
    nginx -t 2>&1 && systemctl reload nginx
  fi
  exit 1
fi

# Reload
systemctl reload nginx
log_ok "Nginx reloaded"

# ─── Step 8: Certbot SSL ─────────────────────────────────────────────────────
log_step "Step 8/8 — SSL Certificate"

if [[ "$NO_SSL" == true ]]; then
  log_info "SSL bỏ qua (--no-ssl hoặc không có email)"
  log_warn "Site đang chạy HTTP only: http://$DOMAIN"
else
  log_info "Đang cấp SSL certificate cho $DOMAIN..."
  if certbot --nginx \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    -m "$CERTBOT_EMAIL" \
    --redirect; then
    log_ok "SSL certificate đã cấp thành công!"
    log_info "Auto-renew: certbot tự chạy (systemd timer)"
  else
    log_err "Certbot thất bại!"
    log_warn "Kiểm tra:"
    log_warn "  1. DNS đã trỏ $DOMAIN → IP VPS chưa?"
    log_warn "  2. Port 80 có mở trên firewall không?"
    log_warn "  3. Chạy lại: sudo certbot --nginx -d $DOMAIN"
    log_warn "Site vẫn chạy HTTP: http://$DOMAIN"
    exit 1
  fi
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
log_step "HOÀN TẤT"
echo ""
if [[ "$NO_SSL" == true ]]; then
  log_ok "Nginx reverse proxy đã setup: ${BOLD}http://$DOMAIN${NC}"
else
  log_ok "Nginx reverse proxy + SSL đã setup: ${BOLD}https://$DOMAIN${NC}"
  log_info "SSL auto-renew: mỗi 90 ngày (tự động)"
  log_info "Kiểm tra: sudo certbot renew --dry-run"
fi
echo ""
log_info "Config file: $NGINX_AVAILABLE"
log_info "Proxy:       127.0.0.1:$APP_PORT → $DOMAIN"
log_info "Static:      $UPLOAD_PATH_SLASH → /api/files/"
echo ""

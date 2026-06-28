#!/usr/bin/env bash
# =============================================================================
# setup-dev.sh — Bootstrap MockupAI RT/Gmail mailbox dev in one command
#
# What it does:
#   1) Creates .env files from the checked-in examples when they are missing
#   2) Fills the required dev secrets that are safe to auto-generate
#   3) Installs getmail6 for host-side mailbox sync
#   4) Starts RT with Docker Compose
#   5) Runs the RT/Gmail migration when RT_API_TOKEN is available
#
# Usage:
#   bash setup-dev.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ENV_FILE="${ROOT_DIR}/.env"
APP_ENV_EXAMPLE="${ROOT_DIR}/.env.example"
RT_ENV_FILE="${ROOT_DIR}/infra/rt/.env"
RT_ENV_EXAMPLE="${ROOT_DIR}/infra/rt/.env.example"

log_step() { printf '\n== %s ==\n' "$1"; }
log_ok() { printf '✓ %s\n' "$1"; }
log_warn() { printf '⚠ %s\n' "$1"; }
log_err() { printf '✗ %s\n' "$1" >&2; }

die() {
  log_err "$1"
  exit 1
}

usage() {
  cat <<'EOF'
Usage: bash setup-dev.sh

Bootstraps the local dev environment:
  - creates .env files from examples when missing
  - fills required dev secrets
  - installs getmail6 for host-side mailbox sync
  - reuses the existing MockupAI Postgres server and creates a separate RT database there
  - seeds RT, creates RT_API_TOKEN, and runs the RT/Gmail migration
  - leaves app/worker process management to ecosystem.config.js
EOF
}

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $arg"
      ;;
  esac
done

cd "$ROOT_DIR"

[[ -f "$APP_ENV_EXAMPLE" ]] || die "Missing example env file: $APP_ENV_EXAMPLE"
[[ -f "$RT_ENV_EXAMPLE" ]] || die "Missing example env file: $RT_ENV_EXAMPLE"

copy_if_missing() {
  local src="$1"
  local dst="$2"

  if [[ -f "$dst" ]]; then
    log_ok "Kept existing ${dst#"$ROOT_DIR"/}"
    return
  fi

  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  log_ok "Created ${dst#"$ROOT_DIR"/} from example"
}

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
}

parse_database_url() {
  python3 - "$1" <<'PY'
from urllib.parse import urlparse, unquote
import shlex
import sys

url = sys.argv[1].strip()
parsed = urlparse(url)
if parsed.scheme not in {"postgresql", "postgres"}:
    raise SystemExit(f"Unsupported DATABASE_URL scheme: {parsed.scheme}")

host = parsed.hostname or ""
port = parsed.port or 5432
user = parsed.username or ""
password = parsed.password or ""
dbname = (parsed.path or "").lstrip("/")
if not dbname:
    raise SystemExit("DATABASE_URL is missing a database name")

print(f"export DB_HOST={shlex.quote(unquote(host))}")
print(f"export DB_PORT={int(port)}")
print(f"export DB_USER={shlex.quote(unquote(user))}")
print(f"export DB_PASSWORD={shlex.quote(unquote(password))}")
print(f"export DB_NAME={shlex.quote(unquote(dbname))}")
PY
}

ensure_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local preserve_non_empty="${4:-true}"

  python3 - "$file" "$key" "$value" "$preserve_non_empty" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
preserve_non_empty = sys.argv[4].lower() == "true"
placeholders = {
    "",
    '""',
    "''",
    "change-this-to-a-random-32-char-string",
    "change-me",
    "changeme",
    "changeme123",
    "generate-with-openssl-rand-hex-32",
    "/var/lib/mockupai-mailboxes",
    "/run/mockupai-mailboxes",
}

text = path.read_text()
pattern = re.compile(rf'^(?P<prefix>\s*{re.escape(key)}\s*=\s*)(?P<value>.*)$', re.M)
match = pattern.search(text)
replacement = f'{key}="{value}"'

if match:
    raw = match.group("value").strip()
    parsed = raw
    if len(parsed) >= 2 and parsed[0] == parsed[-1] and parsed[0] in {'"', "'"}:
        parsed = parsed[1:-1]
    if preserve_non_empty and parsed not in placeholders:
        sys.exit(0)
    text = pattern.sub(replacement, text, count=1)
else:
    if text and not text.endswith("\n"):
        text += "\n"
    text += replacement + "\n"

path.write_text(text)
PY
}

read_env_value() {
  local file="$1"
  local key="$2"

  python3 - "$file" "$key" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
pattern = re.compile(rf'^\s*{re.escape(key)}\s*=\s*(?P<value>.*)$', re.M)
text = path.read_text()
match = pattern.search(text)
if not match:
    raise SystemExit(1)
value = match.group("value").strip()
if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
    value = value[1:-1]
print(value)
PY
}

ensure_getmail() {
  if command -v getmail >/dev/null 2>&1; then
    log_ok "getmail already available at $(command -v getmail)"
    return
  fi

  log_step "Installing getmail6"
  python3 -m pip install --user "getmail6==6.20.0"

  local user_base
  user_base="$(python3 -m site --user-base)"
  local user_bin="${user_base}/bin"
  mkdir -p "${HOME}/.local/bin"

  if [[ -x "${user_bin}/getmail" ]]; then
    ln -sf "${user_bin}/getmail" "${HOME}/.local/bin/getmail"
  fi

  export PATH="${HOME}/.local/bin:${user_bin}:${PATH}"

  command -v getmail >/dev/null 2>&1 || die "getmail is still not available after installation"
  log_ok "getmail installed at $(command -v getmail)"
}

ensure_node_deps() {
  if [[ -x "${ROOT_DIR}/node_modules/.bin/next" ]]; then
    log_ok "Node dependencies already installed"
    return
  fi

  log_step "Installing Node dependencies"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
  else
    npm install
  fi

  [[ -x "${ROOT_DIR}/node_modules/.bin/next" ]] || die "Node dependencies are still missing after install"
  log_ok "Node dependencies installed"
}

wait_for_rt_http() {
  local url="$1"
  local attempts=60
  local i=1

  log_step "Waiting for RT to become reachable"
  while (( i <= attempts )); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      log_ok "RT is reachable at ${url}"
      return
    fi
    sleep 2
    i=$((i + 1))
  done

  die "RT did not become reachable at ${url}"
}

rt_token_http_status() {
  local url="$1"
  local token="$2"

  if [[ -z "$token" ]]; then
    printf '000'
    return
  fi

  curl -fsS -o /dev/null -w '%{http_code}' \
    -H "Authorization: token ${token}" \
    "${url%/}/REST/2.0/rt" 2>/dev/null || printf '000'
}

log_step "Preparing env files"
copy_if_missing "$APP_ENV_EXAMPLE" "$APP_ENV_FILE"
copy_if_missing "$RT_ENV_EXAMPLE" "$RT_ENV_FILE"

APP_MASTER_KEY="$(rand_hex)"
DEV_PASSWORD="$(rand_hex)"

APP_DATABASE_URL="$(read_env_value "$APP_ENV_FILE" "DATABASE_URL")"
APP_REDIS_URL="$(read_env_value "$APP_ENV_FILE" "REDIS_URL")"
eval "$(parse_database_url "$APP_DATABASE_URL")"

RT_DB_HOST="$DB_HOST"
if [[ "$RT_DB_HOST" == "127.0.0.1" || "$RT_DB_HOST" == "localhost" || "$RT_DB_HOST" == "::1" ]]; then
  RT_DB_HOST="host.docker.internal"
fi
RT_POSTGRES_DB="${DB_NAME}_rt"

ensure_env_value "$APP_ENV_FILE" "SESSION_SECRET" "$(rand_hex)"
ensure_env_value "$APP_ENV_FILE" "MASTER_ENCRYPTION_KEY" "$APP_MASTER_KEY"
ensure_env_value "$APP_ENV_FILE" "ADMIN_EMAIL" "admin@mockupai.local"
ensure_env_value "$APP_ENV_FILE" "ADMIN_PASSWORD" "$DEV_PASSWORD"
ensure_env_value "$APP_ENV_FILE" "SUPER_ADMIN_EMAIL" "admin@mockupai.local"
ensure_env_value "$APP_ENV_FILE" "SUPER_ADMIN_PASSWORD" "$DEV_PASSWORD"
ensure_env_value "$APP_ENV_FILE" "RT_URL" "http://127.0.0.1:8082" false
ensure_env_value "$APP_ENV_FILE" "MAILBOX_RUNTIME_DIR" "/tmp/mockupai-mailboxes" false
APP_MASTER_KEY="$(read_env_value "$APP_ENV_FILE" "MASTER_ENCRYPTION_KEY")"

ensure_env_value "$RT_ENV_FILE" "RT_POSTGRES_HOST" "$RT_DB_HOST" false
ensure_env_value "$RT_ENV_FILE" "RT_POSTGRES_PORT" "$DB_PORT" false
ensure_env_value "$RT_ENV_FILE" "RT_POSTGRES_DB" "$RT_POSTGRES_DB" false
ensure_env_value "$RT_ENV_FILE" "RT_POSTGRES_USER" "$DB_USER" false
ensure_env_value "$RT_ENV_FILE" "RT_POSTGRES_PASSWORD" "$DB_PASSWORD" false
ensure_env_value "$RT_ENV_FILE" "DATABASE_URL" "$APP_DATABASE_URL" false
ensure_env_value "$RT_ENV_FILE" "REDIS_URL" "$APP_REDIS_URL" false
ensure_env_value "$RT_ENV_FILE" "MASTER_ENCRYPTION_KEY" "$APP_MASTER_KEY" false
ensure_env_value "$RT_ENV_FILE" "RT_URL" "http://rt:9000" false
ensure_env_value "$RT_ENV_FILE" "MAILBOX_RUNTIME_DIR" "/tmp/mockupai-mailboxes" false
RT_ROOT_PASSWORD_VALUE="$(read_env_value "$RT_ENV_FILE" "RT_ROOT_PASSWORD" || true)"
if [[ -z "${RT_ROOT_PASSWORD_VALUE:-}" ]]; then
  RT_ROOT_PASSWORD_VALUE="$(rand_hex)"
  ensure_env_value "$RT_ENV_FILE" "RT_ROOT_PASSWORD" "$RT_ROOT_PASSWORD_VALUE" false
fi

log_ok "Env files are ready"

set -a
# shellcheck disable=SC1090
source "$APP_ENV_FILE"
set +a

ensure_node_deps
ensure_getmail

log_step "Creating RT database when needed"
docker compose --env-file infra/rt/.env -f infra/rt/docker-compose.yml run --rm --no-deps --entrypoint perl rt -MDBI -e '
  use strict;
  use warnings;

  my $host = $ENV{RT_POSTGRES_HOST} or die "RT_POSTGRES_HOST is required\n";
  my $port = $ENV{RT_POSTGRES_PORT} || 5432;
  my $db   = $ENV{RT_POSTGRES_DB}   or die "RT_POSTGRES_DB is required\n";
  my $user = $ENV{RT_POSTGRES_USER} or die "RT_POSTGRES_USER is required\n";
  my $pass = $ENV{RT_POSTGRES_PASSWORD} // "";

  my $admin = DBI->connect(
    "dbi:Pg:dbname=postgres;host=$host;port=$port",
    $user,
    $pass,
    { RaiseError => 1, PrintError => 0, AutoCommit => 1 },
  );

  my ($exists) = $admin->selectrow_array(
    "SELECT 1 FROM pg_database WHERE datname = ?",
    undef,
    $db,
  );

  unless ($exists) {
    my $quoted_db = $admin->quote_identifier($db);
    $admin->do("CREATE DATABASE $quoted_db");
  }
' 

log_step "Initializing RT schema when needed"
RT_SCHEMA_READY="$(
  docker compose --env-file infra/rt/.env -f infra/rt/docker-compose.yml run --rm --no-deps --entrypoint perl rt -MDBI -e '
    use strict;
    use warnings;

    my $host = $ENV{RT_POSTGRES_HOST} or die "RT_POSTGRES_HOST is required\n";
    my $port = $ENV{RT_POSTGRES_PORT} || 5432;
    my $db   = $ENV{RT_POSTGRES_DB}   or die "RT_POSTGRES_DB is required\n";
    my $user = $ENV{RT_POSTGRES_USER} or die "RT_POSTGRES_USER is required\n";
    my $pass = $ENV{RT_POSTGRES_PASSWORD} // "";

    my $dbh = DBI->connect(
      "dbi:Pg:dbname=$db;host=$host;port=$port",
      $user,
      $pass,
      { RaiseError => 1, PrintError => 0, AutoCommit => 1 },
    );

    my ($ready) = $dbh->selectrow_array(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
      undef,
      "public",
      "users",
    );

    print $ready ? "ready" : "needs_init";
  ' | tail -n 1
)"

if [[ "$RT_SCHEMA_READY" != "ready" ]]; then
  docker compose --env-file infra/rt/.env -f infra/rt/docker-compose.yml run --rm --no-deps -e RT_ROOT_PASSWORD="$RT_ROOT_PASSWORD_VALUE" --entrypoint sh rt -lc '
    set -eu
    password_file="$(mktemp)"
    trap "rm -f \"$password_file\"" EXIT
    printf "%s\n" "$RT_ROOT_PASSWORD" > "$password_file"
    exec /opt/rt/sbin/rt-setup-database \
      --action init \
      --skip-create \
      --root-password-file "$password_file"
  '
fi

log_step "Starting RT service"
docker compose --env-file infra/rt/.env -f infra/rt/docker-compose.yml up -d --no-deps rt

HOST_RT_URL="${RT_URL:-http://127.0.0.1:8082}"
wait_for_rt_http "${HOST_RT_URL%/}/"

RT_API_TOKEN_VALUE="$(read_env_value "$RT_ENV_FILE" "RT_API_TOKEN" || true)"
if [[ -z "${RT_API_TOKEN_VALUE:-}" ]]; then
  RT_API_TOKEN_VALUE="$(read_env_value "$APP_ENV_FILE" "RT_API_TOKEN" || true)"
fi
if [[ "$(rt_token_http_status "$HOST_RT_URL" "${RT_API_TOKEN_VALUE:-}")" != "200" ]]; then
  log_step "Creating RT API token"
  RT_API_TOKEN_VALUE="$(
    docker compose --env-file infra/rt/.env -f infra/rt/docker-compose.yml exec -T rt perl -I/opt/rt/lib -Mstrict -Mwarnings -MRT -MRT::User -MRT::AuthToken -e '
      RT::LoadConfig();
      RT::Init();
      my $current_user = RT::CurrentUser->new();
      $current_user->Load("root") or die "root user not found\n";
      my $owner = RT::User->new($current_user);
      $owner->Load("root") or die "root user record not found\n";
      my $token = RT::AuthToken->new($current_user);
      my ($id, $msg, $authstring) = $token->Create(
        Owner => $owner->Id,
        Description => "mockupai-mailbox-worker",
      );
      die "$msg\n" unless $id && $authstring;
      print $authstring;
    ' | tail -n 1
  )"
fi

ensure_env_value "$APP_ENV_FILE" "RT_API_TOKEN" "$RT_API_TOKEN_VALUE" false
ensure_env_value "$RT_ENV_FILE" "RT_API_TOKEN" "$RT_API_TOKEN_VALUE" false
export RT_API_TOKEN="$RT_API_TOKEN_VALUE"

log_step "Ensuring RT mailbox service principal"
SERVICE_USER_STATUS="$(
  curl -sS -o /tmp/mockupai-rt-service-user.json -w '%{http_code}' \
    -X POST \
    -H "Authorization: token ${RT_API_TOKEN}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    --data '{"Name":"mailbox-service","EmailAddress":"mailbox-service@mockupai.local","Privileged":1,"RealName":"MockupAI Mailbox Service"}' \
    "${HOST_RT_URL%/}/REST/2.0/user"
)"
if [[ "$SERVICE_USER_STATUS" == "400" ]] && grep -q '"Name in use"' /tmp/mockupai-rt-service-user.json; then
  SERVICE_USER_STATUS="exists"
fi
if [[ "$SERVICE_USER_STATUS" != "201" && "$SERVICE_USER_STATUS" != "exists" ]]; then
  die "Could not ensure RT mailbox-service user; RT returned HTTP ${SERVICE_USER_STATUS}"
fi

log_step "Running RT/Gmail migration"
npm run db:migrate:rt-gmail
log_ok "RT/Gmail migration finished"

export MAILBOX_SCRIPT_ROOT="$ROOT_DIR"
export PATH="${HOME}/.local/bin:${PATH}"

log_ok "Bootstrap completed"
printf '\nNext checks:\n'
printf '  - pm2 start ecosystem.config.js   # start app/worker manually when needed\n'
printf '  - pm2 status\n'
printf '  - docker compose -f infra/rt/docker-compose.yml logs -f rt\n'
printf '  - npm run db:migrate:rt-gmail   # rerun only after changing mailbox migration env\n'

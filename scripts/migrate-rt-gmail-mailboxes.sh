#!/usr/bin/env bash
# Deploy the RT + Gmail mailbox database/runtime migration.
# Safe for production: does not print tokens, app passwords, or database URLs.

set -euo pipefail

MIGRATION_NAME="20260624090000_rt_getmail_gmail_mailboxes"
RUNTIME_DIR="${MAILBOX_RUNTIME_DIR:-/var/lib/mockupai-mailboxes}"

log() {
  printf '[rt-gmail-migrate] %s\n' "$1"
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    printf '[rt-gmail-migrate] missing required env: %s\n' "$name" >&2
    exit 1
  fi
}

require_env "DATABASE_URL"
require_env "REDIS_URL"
require_env "MASTER_ENCRYPTION_KEY"
require_env "RT_URL"
require_env "RT_API_TOKEN"

log "checking migration file"
if [[ ! -f "prisma/migrations/${MIGRATION_NAME}/migration.sql" ]]; then
  printf '[rt-gmail-migrate] missing prisma/migrations/%s/migration.sql\n' "$MIGRATION_NAME" >&2
  exit 1
fi

log "validating Prisma schema"
npx prisma validate

log "deploying pending Prisma migrations"
npx prisma migrate deploy

log "generating Prisma client"
npx prisma generate

log "verifying mailbox migration is applied"
npx prisma migrate status >/dev/null
npx tsx scripts/verify-rt-gmail-migration.ts "$MIGRATION_NAME"

log "preparing runtime directories at ${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}/configs" "${RUNTIME_DIR}/secrets" "${RUNTIME_DIR}/state"
chmod 700 "${RUNTIME_DIR}" "${RUNTIME_DIR}/secrets"
chmod 755 "${RUNTIME_DIR}/configs" "${RUNTIME_DIR}/state"

log "done"
log "next: restart app + worker, then create Gmail mailboxes from the admin UI"

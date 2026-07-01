#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"

cd "$APP_DIR"

if [ "${SKIP_GIT_PULL:-0}" != "1" ]; then
  git pull --ff-only
fi

corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
pnpm db:generate

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  pnpm db:migrate:deploy
fi

pnpm run build

pm2 startOrReload ecosystem.config.js --only mockupai --update-env
pm2 startOrReload ecosystem.config.js --only mockupai-worker --update-env
pm2 save

#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/mockupai-deploy.lock}"

exec 9>"$LOCK_FILE"
flock 9

cd "$APP_DIR"

if [ "${SKIP_GIT_PULL:-0}" != "1" ]; then
  git pull --ff-only
fi

corepack enable >/dev/null 2>&1 || true
if command -v dnf >/dev/null 2>&1; then
  dnf install -y unzip patch
fi
command -v codex >/dev/null 2>&1 || npm install -g @openai/codex
pnpm install --frozen-lockfile
pnpm db:generate

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  pnpm db:migrate:deploy
fi

pnpm run build
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
if [ -d ".next/node_modules" ]; then
  mkdir -p .next/standalone/node_modules
  cp -a .next/node_modules/. .next/standalone/node_modules/
fi
AI_HUB_MANIFEST=".next/standalone/.next/server/app/(authed)/ai-hub/page_client-reference-manifest.js"
if [ -f "$AI_HUB_MANIFEST" ] && ! grep -q '__RSC_MANIFEST\["/ai-hub"\]' "$AI_HUB_MANIFEST"; then
  printf '\nglobalThis.__RSC_MANIFEST["/ai-hub"] = globalThis.__RSC_MANIFEST["/(authed)/ai-hub/page"];\n' >> "$AI_HUB_MANIFEST"
fi

CODEX_WEB_DIR="${AI_HUB_CODEX_WEB_DIR:-/root/code/codex-web}"
CODEX_WEB_REF="${AI_HUB_CODEX_WEB_REF:-https://github.com/tranquoctuyen97/codex-web.git}"
CODEX_WEB_BRANCH="${AI_HUB_CODEX_WEB_BRANCH:-main}"

if [ -d "$CODEX_WEB_DIR/.git" ]; then
  git -C "$CODEX_WEB_DIR" fetch origin "$CODEX_WEB_BRANCH"
  git -C "$CODEX_WEB_DIR" checkout "$CODEX_WEB_BRANCH"
  git -C "$CODEX_WEB_DIR" pull --ff-only
else
  git clone -b "$CODEX_WEB_BRANCH" "$CODEX_WEB_REF" "$CODEX_WEB_DIR"
fi

npm --prefix "$CODEX_WEB_DIR" install
npm --prefix "$CODEX_WEB_DIR" run build:server
npm --prefix "$CODEX_WEB_DIR" run build:browser

pm2 startOrReload ecosystem.config.js --only mockupai --update-env
pm2 startOrReload ecosystem.config.js --only mockupai-ai-hub-gateway --update-env
pm2 startOrReload ecosystem.config.js --only mockupai-worker --update-env
pm2 startOrReload ecosystem.config.js --only mockupai-codex --update-env
pm2 save

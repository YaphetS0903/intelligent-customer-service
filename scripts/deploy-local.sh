#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
GIT_REF="${GIT_REF:-}"
APP_NAME="${APP_NAME:-tianrui-ai-support}"

cd "$APP_DIR"

echo "==> Deploying $APP_NAME in $APP_DIR"

if [ ! -f ".env.local" ]; then
  echo "ERROR: .env.local is missing. Create it before deploying." >&2
  exit 1
fi

if [ -n "$GIT_REF" ] && [ -d ".git" ]; then
  echo "==> Updating git ref: $GIT_REF"
  git fetch --all --prune
  if git show-ref --verify --quiet "refs/remotes/origin/$GIT_REF"; then
    git checkout "$GIT_REF"
    git pull --ff-only origin "$GIT_REF"
  else
    git checkout "$GIT_REF"
  fi
fi

echo "==> Installing dependencies"
npm ci

echo "==> Type checking"
npm run typecheck

echo "==> Building"
npm run build

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing pm2"
  npm install -g pm2
fi

echo "==> Starting or reloading PM2 app"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "==> Deployment complete"
pm2 status "$APP_NAME" || pm2 status

#!/usr/bin/env bash

release_timestamp() {
  date -u +%Y%m%d-%H%M%S
}

require_release_tools() {
  local tool
  for tool in node npm pm2 curl tar rsync; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "ERROR: required command is missing: $tool" >&2
      return 1
    fi
  done
}

assert_managed_app() {
  if ! pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    echo "ERROR: PM2 app does not exist: $APP_NAME" >&2
    return 1
  fi
  local cwd
  cwd="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);if(p)process.stdout.write(p.pm2_env?.pm_cwd||'')})" "$APP_NAME")"
  if [ "$(cd "$cwd" 2>/dev/null && pwd -P)" != "$(cd "$APP_DIR" && pwd -P)" ]; then
    echo "ERROR: refusing to manage $APP_NAME because its PM2 cwd is $cwd, expected $APP_DIR" >&2
    return 1
  fi
}

create_release_archive() {
  local source_dir="$1"
  local target_archive="$2"
  mkdir -p "$(dirname "$target_archive")"
  tar --create --gzip --file="$target_archive" --directory="$source_dir" --anchored \
    --exclude='./.env.local' \
    --exclude='./.data' \
    --exclude='./uploads' \
    --exclude='./backups' \
    --exclude='./.ops' \
    --exclude='./test-results' \
    --exclude='./playwright-report' \
    .
  chmod 600 "$target_archive"
  if ! tar -tzf "$target_archive" | grep -Fx './app/api/admin/backups/route.ts' >/dev/null; then
    echo "ERROR: release archive lost app/api/admin/backups/route.ts" >&2
    return 1
  fi
}

validate_release_archive() {
  local archive="$1"
  [ -f "$archive" ] || { echo "ERROR: release archive not found: $archive" >&2; return 1; }
  tar -tzf "$archive" >/dev/null
  local required
  for required in \
    './package.json' \
    './package-lock.json' \
    './ecosystem.config.cjs' \
    './scripts/deploy-preflight.mjs' \
    './app/api/admin/backups/route.ts' \
    './app/api/admin/runtime-monitor/route.ts' \
    './app/api/admin/operations-dashboard/route.ts'; do
    if ! tar -tzf "$archive" | grep -Fx "$required" >/dev/null; then
      echo "ERROR: release archive is missing $required" >&2
      return 1
    fi
  done
}

link_protected_paths() {
  local target="$1"
  local name
  mkdir -p "$APP_DIR/.data" "$APP_DIR/uploads" "$APP_DIR/backups" "$APP_DIR/.ops"
  for name in .env.local .data uploads backups .ops; do
    if [ -e "$APP_DIR/$name" ] || [ -L "$APP_DIR/$name" ]; then
      rm -rf "$target/$name"
      ln -s "$APP_DIR/$name" "$target/$name"
    fi
  done
}

sync_release_tree() {
  local source_dir="$1"
  rsync -a --delete \
    --filter='protect /.env.local' \
    --filter='protect /.data' \
    --filter='protect /uploads' \
    --filter='protect /backups' \
    --filter='protect /.ops' \
    --exclude='/.env.local' \
    --exclude='/.data' \
    --exclude='/.data/' \
    --exclude='/uploads' \
    --exclude='/uploads/' \
    --exclude='/backups' \
    --exclude='/backups/' \
    --exclude='/.ops' \
    --exclude='/.ops/' \
    --exclude='/test-results/' \
    --exclude='/playwright-report/' \
    "$source_dir/" "$APP_DIR/"
}

reload_managed_app() {
  pm2 reload "$APP_NAME" --update-env
}

health_check_managed_app() {
  local base_url="${RELEASE_HEALTH_BASE_URL:-${RUNTIME_MONITOR_BASE_URL:-http://127.0.0.1:3020}}"
  local attempt login_status auth_status
  for attempt in $(seq 1 "${RELEASE_HEALTH_ATTEMPTS:-20}"); do
    login_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "$base_url/login" || true)"
    auth_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "$base_url/api/auth/me" || true)"
    if [ "$login_status" = "200" ] && [ "$auth_status" = "401" ]; then
      echo "==> Health check passed: /login=$login_status, /api/auth/me=$auth_status"
      return 0
    fi
    echo "==> Waiting for health check ($attempt): /login=$login_status, /api/auth/me=$auth_status"
    sleep 2
  done
  echo "ERROR: health check failed for $base_url" >&2
  return 1
}

restore_release_archive() {
  local archive="$1"
  local restore_dir="$2"
  rm -rf "$restore_dir"
  mkdir -p "$restore_dir"
  tar -xzf "$archive" -C "$restore_dir"
  sync_release_tree "$restore_dir"
}

prune_release_archives() {
  local keep="${RELEASE_KEEP_ROLLBACKS:-2}"
  find "$RELEASE_DIR" -maxdepth 1 -type f -name 'rollback-*.tar.gz' -printf '%T@ %p\n' \
    | sort -nr \
    | awk -v keep="$keep" 'NR > keep {sub(/^[^ ]+ /, ""); print}' \
    | while IFS= read -r archive; do
        [ -n "$archive" ] && rm -f "$archive"
      done
}

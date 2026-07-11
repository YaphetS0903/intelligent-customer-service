#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups/mysql}"
KEEP_DAYS="${KEEP_DAYS:-14}"
ENV_FILE="${ENV_FILE:-.env.local}"
BACKUP_STATE_FILE="${BACKUP_STATE_FILE:-./.ops/mysql-backup-last-success.json}"
BACKUP_TIMEOUT_SECONDS="${BACKUP_TIMEOUT_SECONDS:-300}"

if [ "${BACKUP_ENGINE:-node}" = "node" ] && command -v node >/dev/null 2>&1 && [ -f "scripts/backup-mysql.mjs" ]; then
  exec node scripts/backup-mysql.mjs
fi

read_env_value() {
  local key="$1"
  local line value

  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi

  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    return 0
  fi

  value="${line#*=}"
  value="${value%$'\r'}"

  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf "%s" "$value"
}

MYSQL_HOST="${MYSQL_HOST:-$(read_env_value MYSQL_HOST)}"
MYSQL_PORT="${MYSQL_PORT:-$(read_env_value MYSQL_PORT)}"
MYSQL_DATABASE="${MYSQL_DATABASE:-$(read_env_value MYSQL_DATABASE)}"
MYSQL_USER="${MYSQL_USER:-$(read_env_value MYSQL_USER)}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-$(read_env_value MYSQL_PASSWORD)}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

if [ -z "$MYSQL_HOST" ] || [ -z "$MYSQL_DATABASE" ] || [ -z "$MYSQL_USER" ]; then
  echo "ERROR: MYSQL_HOST, MYSQL_DATABASE and MYSQL_USER are required." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/${MYSQL_DATABASE}-${timestamp}.sql.gz"
tmp_target="${target}.tmp"

echo "==> Backing up $MYSQL_DATABASE to $target"
rm -f "$tmp_target"
if ! MYSQL_PWD="$MYSQL_PASSWORD" timeout "${BACKUP_TIMEOUT_SECONDS}s" mysqldump \
    --host="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --user="$MYSQL_USER" \
    --single-transaction \
    --no-tablespaces \
    --routines \
    --triggers \
    "$MYSQL_DATABASE" | gzip > "$tmp_target"; then
  rm -f "$tmp_target"
  echo "ERROR: MySQL backup failed or timed out after ${BACKUP_TIMEOUT_SECONDS}s." >&2
  exit 1
fi

mv "$tmp_target" "$target"
chmod 600 "$target"

echo "==> Removing backups older than $KEEP_DAYS days"
find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +"$KEEP_DAYS" -delete

mkdir -p "$(dirname "$BACKUP_STATE_FILE")"
cat > "$BACKUP_STATE_FILE" <<EOF
{
  "checkedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "database": "$MYSQL_DATABASE",
  "target": "$target"
}
EOF
chmod 600 "$BACKUP_STATE_FILE"

echo "==> Backup complete: $target"

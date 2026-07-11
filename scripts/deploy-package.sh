#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_NAME="${APP_NAME:-tianrui-ai-support}"
RELEASE_DIR="${RELEASE_DIR:-$(dirname "$APP_DIR")/tianrui-releases}"
ARCHIVE="${1:-}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
STAGING_DIR="$RELEASE_DIR/staging-$TIMESTAMP"
ROLLBACK_ARCHIVE="$RELEASE_DIR/rollback-$TIMESTAMP.tar.gz"
ROLLBACK_STAGING="$RELEASE_DIR/restore-$TIMESTAMP"
SWITCHED=0
ROLLING_BACK=0

# shellcheck source=release-common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-common.sh"

cleanup() {
  rm -rf "$STAGING_DIR" "$ROLLBACK_STAGING"
}

automatic_rollback() {
  local exit_code="$?"
  if [ "$SWITCHED" -eq 1 ] && [ "$ROLLING_BACK" -eq 0 ] && [ -f "$ROLLBACK_ARCHIVE" ]; then
    ROLLING_BACK=1
    trap - ERR
    echo "ERROR: deployment failed after switching; restoring $ROLLBACK_ARCHIVE" >&2
    if restore_release_archive "$ROLLBACK_ARCHIVE" "$ROLLBACK_STAGING" \
      && reload_managed_app \
      && health_check_managed_app; then
      echo "==> Automatic rollback succeeded"
    else
      echo "ERROR: automatic rollback also failed; manual intervention is required" >&2
    fi
  fi
  cleanup
  exit "$exit_code"
}

trap automatic_rollback ERR
trap cleanup EXIT

if [ -z "$ARCHIVE" ]; then
  echo "Usage: $0 /absolute/path/to/release.tar.gz" >&2
  exit 2
fi

ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
mkdir -p "$RELEASE_DIR"
require_release_tools
assert_managed_app
validate_release_archive "$ARCHIVE"

echo "==> Extracting release into $STAGING_DIR"
mkdir -p "$STAGING_DIR"
tar -xzf "$ARCHIVE" -C "$STAGING_DIR"
link_protected_paths "$STAGING_DIR"

echo "==> Installing release dependencies"
(cd "$STAGING_DIR" && npm ci)

echo "==> Type checking release"
(cd "$STAGING_DIR" && npm run typecheck)

echo "==> Building release"
(cd "$STAGING_DIR" && npm run build)

echo "==> Running production preflight before switching"
(cd "$STAGING_DIR" && node scripts/deploy-preflight.mjs)

echo "==> Saving current release to $ROLLBACK_ARCHIVE"
create_release_archive "$APP_DIR" "$ROLLBACK_ARCHIVE"

echo "==> Switching release files"
SWITCHED=1
sync_release_tree "$STAGING_DIR"

echo "==> Reloading only $APP_NAME"
reload_managed_app
health_check_managed_app
SWITCHED=0

prune_release_archives
pm2 save >/dev/null
echo "==> Deployment complete; rollback archive: $ROLLBACK_ARCHIVE"

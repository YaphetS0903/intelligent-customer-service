#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_NAME="${APP_NAME:-tianrui-ai-support}"
RELEASE_DIR="${RELEASE_DIR:-$(dirname "$APP_DIR")/tianrui-releases}"
SELECTED="${1:-}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
EMERGENCY_ARCHIVE="$RELEASE_DIR/rollback-before-manual-$TIMESTAMP.tar.gz"
RESTORE_DIR="$RELEASE_DIR/manual-restore-$TIMESTAMP"
EMERGENCY_DIR="$RELEASE_DIR/emergency-restore-$TIMESTAMP"
SWITCHED=0
RECOVERING=0

# shellcheck source=release-common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-common.sh"

cleanup() {
  rm -rf "$RESTORE_DIR" "$EMERGENCY_DIR"
}

recover_current_release() {
  local exit_code="$?"
  if [ "$SWITCHED" -eq 1 ] && [ "$RECOVERING" -eq 0 ] && [ -f "$EMERGENCY_ARCHIVE" ]; then
    RECOVERING=1
    trap - ERR
    echo "ERROR: rollback health check failed; restoring the release that was active before rollback" >&2
    restore_release_archive "$EMERGENCY_ARCHIVE" "$EMERGENCY_DIR" || true
    reload_managed_app || true
    health_check_managed_app || true
  fi
  cleanup
  exit "$exit_code"
}

trap recover_current_release ERR
trap cleanup EXIT

mkdir -p "$RELEASE_DIR"
require_release_tools
assert_managed_app

if [ -z "$SELECTED" ]; then
  SELECTED="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name 'rollback-*.tar.gz' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
fi
if [ -z "$SELECTED" ]; then
  echo "ERROR: no rollback archive found in $RELEASE_DIR" >&2
  exit 1
fi
if [[ "$SELECTED" != /* ]]; then
  SELECTED="$RELEASE_DIR/$SELECTED"
fi
SELECTED="$(cd "$(dirname "$SELECTED")" && pwd)/$(basename "$SELECTED")"
case "$SELECTED" in
  "$RELEASE_DIR"/*) ;;
  *) echo "ERROR: rollback archive must be inside $RELEASE_DIR" >&2; exit 1 ;;
esac

validate_release_archive "$SELECTED"
echo "==> Saving current release to $EMERGENCY_ARCHIVE"
create_release_archive "$APP_DIR" "$EMERGENCY_ARCHIVE"

echo "==> Restoring $SELECTED"
SWITCHED=1
restore_release_archive "$SELECTED" "$RESTORE_DIR"
reload_managed_app
health_check_managed_app
SWITCHED=0

prune_release_archives
pm2 save >/dev/null
echo "==> Rollback complete; previous active release saved as $EMERGENCY_ARCHIVE"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="CC Switch 纪"
LEGACY_APP_NAME="CC Switch"
BUNDLE_ID="com.ccswitch.desktop"
APP_BUNDLE="${APP_NAME}.app"
BUILD_APP="${ROOT_DIR}/src-tauri/target/release/bundle/macos/${APP_BUNDLE}"
TARGET_APP="/Applications/${APP_BUNDLE}"
LEGACY_TARGET_APP="/Applications/${LEGACY_APP_NAME}.app"

log() {
  printf '[update_app] %s\n' "$1"
}

run_with_optional_sudo() {
  if [[ -w /Applications ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

log "1/5 Rebuild application"
cd "$ROOT_DIR"
pnpm run build

if [[ ! -d "$BUILD_APP" ]]; then
  log "Build output not found: $BUILD_APP"
  exit 1
fi

log "2/5 Ad-hoc codesign bundle"
codesign --force --deep --sign - --timestamp=none "$BUILD_APP"
codesign --verify --deep --strict "$BUILD_APP"

log "3/5 Stop running process (if any)"
osascript -e "try" -e "tell application id \"${BUNDLE_ID}\" to quit" -e "end try" >/dev/null 2>&1 || true
pkill -x "$APP_NAME" >/dev/null 2>&1 || true
pkill -f "CC Switch\\.app/Contents/MacOS" >/dev/null 2>&1 || true
pkill -f "CC Switch 纪\\.app/Contents/MacOS" >/dev/null 2>&1 || true
sleep 1

log "4/5 Replace /Applications bundle"
if [[ -d "$TARGET_APP" ]]; then
  run_with_optional_sudo rm -rf "$TARGET_APP"
fi
if [[ -d "$LEGACY_TARGET_APP" ]]; then
  run_with_optional_sudo rm -rf "$LEGACY_TARGET_APP"
fi
run_with_optional_sudo cp -R "$BUILD_APP" /Applications/
run_with_optional_sudo codesign --force --deep --sign - --timestamp=none "$TARGET_APP"
codesign --verify --deep --strict "$TARGET_APP"

log "5/5 Launch app from /Applications"
open -na "$TARGET_APP"
log "Completed: ${TARGET_APP}"

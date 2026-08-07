#!/usr/bin/env bash
# Build a release binary via SwiftPM and assemble a minimal .app bundle.
# Production distribution should use an Xcode archive; this is enough to sign,
# notarize, and smoke-test outside Xcode.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="TimeTrack"
RELEASE_BIN=".build/release/${APP_NAME}"
APP="dist/${APP_NAME}.app"

echo "→ swift build -c release"
swift build -c release

echo "→ assembling ${APP}"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$RELEASE_BIN" "$APP/Contents/MacOS/${APP_NAME}"
cp Info.plist "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# Distribution knobs. Defaults match the committed Info.plist (dev/localhost), so a plain
# build is unchanged; a distribution build sets these to the team's bundle id + the prod
# deployment URLs. TCC (Screen Recording, etc.) keys off bundle id + signing identity, so the
# bundle id must be the team's real reverse-DNS id before signing for real machines.
BUNDLE_ID="${BUNDLE_ID:-com.niftyitsolution.timetrack}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3001/v1}"
DASHBOARD_URL="${DASHBOARD_URL:-http://127.0.0.1:3000}"
PB=/usr/libexec/PlistBuddy
"$PB" -c "Set :CFBundleIdentifier ${BUNDLE_ID}" "$APP/Contents/Info.plist"
"$PB" -c "Set :TimeTrackAPIBaseURL ${API_BASE_URL}" "$APP/Contents/Info.plist"
"$PB" -c "Set :TimeTrackDashboardURL ${DASHBOARD_URL}" "$APP/Contents/Info.plist"
echo "  bundle id:  ${BUNDLE_ID}"
echo "  api base:   ${API_BASE_URL}"
echo "  dashboard:  ${DASHBOARD_URL}"

# Sign the bundle. macOS TCC (Screen Recording, etc.) keys a permission grant to the app's
# code-signing identity: an ad-hoc signature has no stable identity, so its fingerprint changes
# every rebuild and macOS re-prompts each time. Set CODESIGN_IDENTITY to a stable identity (an
# "Apple Development: …" or "Developer ID Application: …" from `security find-identity -v
# -p codesigning`) and — with the bundle ID held fixed — a granted permission persists across
# rebuilds. Falls back to ad-hoc (dev only; re-prompts) when unset.
IDENTITY="${CODESIGN_IDENTITY:--}"
if [[ "$IDENTITY" == "-" ]]; then
  echo "→ codesign (ad-hoc — permissions WILL re-prompt each rebuild; set CODESIGN_IDENTITY to persist)"
else
  echo "→ codesign (identity: ${IDENTITY})"
fi
codesign --force --sign "$IDENTITY" "$APP"

echo "✓ built ${APP}"

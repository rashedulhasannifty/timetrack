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

echo "✓ built ${APP}"

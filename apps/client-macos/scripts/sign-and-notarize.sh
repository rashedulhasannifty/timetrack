#!/usr/bin/env bash
# Sign (Developer ID + Hardened Runtime), notarize, and staple the .app.
# See SIGNING.md. Credentials come from the environment — NEVER commit them.
#
# Required env:
#   DEVELOPER_ID_APP  e.g. "Developer ID Application: Your Org (TEAMID)"
#   NOTARY_PROFILE    a notarytool keychain profile created once with:
#                     xcrun notarytool store-credentials NOTARY_PROFILE \
#                       --apple-id you@org.com --team-id TEAMID --password <app-specific>
set -euo pipefail
cd "$(dirname "$0")/.."

APP="dist/TimeTrack.app"
ZIP="dist/TimeTrack.zip"
: "${DEVELOPER_ID_APP:?set DEVELOPER_ID_APP to your Developer ID Application identity}"
: "${NOTARY_PROFILE:?set NOTARY_PROFILE to your notarytool keychain profile}"

[ -d "$APP" ] || { echo "✗ $APP not found — run scripts/package-app.sh first"; exit 1; }

echo "→ codesign (hardened runtime + entitlements)"
codesign --force --options runtime --timestamp \
  --entitlements TimeTrack.entitlements \
  --sign "$DEVELOPER_ID_APP" "$APP"
codesign --verify --strict --verbose=2 "$APP"

echo "→ notarize (submit + wait)"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait

echo "→ staple"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

echo "✓ signed + notarized + stapled: $APP"

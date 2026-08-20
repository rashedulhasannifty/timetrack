#!/usr/bin/env bash
# Build a release binary via SwiftPM and assemble a minimal .app bundle.
# Production distribution should use an Xcode archive; this is enough to sign,
# notarize, and smoke-test outside Xcode.
set -euo pipefail
cd "$(dirname "$0")/.."

# The .app is user-visible and carries the product name; the executable inside keeps the
# SwiftPM target's name, which nobody sees. CFBundleExecutable must match EXEC_NAME.
#
# BUNDLE_NAME is overridable so a side-by-side dev build gets a DIFFERENT .app filename. Without
# that, packaging a dev build overwrites dist/"Nifty Timer".app and installing it replaces the
# released app in /Applications — see scripts/package-dev-app.sh.
BUNDLE_NAME="${BUNDLE_NAME:-Nifty Timer}"
EXEC_NAME="TimeTrack"
RELEASE_BIN=".build/release/${EXEC_NAME}"
APP="dist/${BUNDLE_NAME}.app"

echo "→ swift build -c release"
swift build -c release

echo "→ assembling ${APP}"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$RELEASE_BIN" "$APP/Contents/MacOS/${EXEC_NAME}"
cp Info.plist "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# Brand assets. These are loaded through Bundle.main, NOT SwiftPM's Bundle.module:
# this script assembles the bundle by hand and never copies SwiftPM's generated
# resource bundle out of .build/release, so Bundle.module would work under
# `swift run` and then trap at runtime in a packaged build.
#
# Copied by explicit name, not a glob: a glob still succeeds when one file has been
# renamed or dropped, and the missing state would then silently fall back to its SF
# Symbol forever. Naming them makes that a build failure instead.
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
for state in idle tracking capturing; do
  cp "Resources/menubar_${state}@1x.png" "$APP/Contents/Resources/menubar_${state}@1x.png"
  cp "Resources/menubar_${state}@2x.png" "$APP/Contents/Resources/menubar_${state}@2x.png"
done

# Distribution knobs. A packaged .app IS the artifact employees run, so these default to the
# PRODUCTION deployment — shipping a build that silently talks to 127.0.0.1 is the worse
# failure. Local development is unaffected: `swift run` has no bundle, so it falls back to
# the localhost URLs hardcoded in AppDelegate.apiBaseURL()/dashboardURL().
#
# To package a build pointed at a local stack, override explicitly:
#   API_BASE_URL=http://127.0.0.1:3001/v1 DASHBOARD_URL=http://127.0.0.1:3000 ./scripts/package-app.sh
#
# The API base MUST keep the /v1 suffix: the client pins that prefix and the deployment's
# Caddy routes /v1/* to the API. TCC (Screen Recording, etc.) keys off bundle id + signing
# identity, so the bundle id must be the team's real reverse-DNS id before signing.
BUNDLE_ID="${BUNDLE_ID:-com.niftyitsolution.niftytimer}"
API_BASE_URL="${API_BASE_URL:-https://timer.niftyitsolution.com/v1}"
DASHBOARD_URL="${DASHBOARD_URL:-https://timer.niftyitsolution.com}"
PB=/usr/libexec/PlistBuddy
"$PB" -c "Set :CFBundleIdentifier ${BUNDLE_ID}" "$APP/Contents/Info.plist"
"$PB" -c "Set :TimeTrackAPIBaseURL ${API_BASE_URL}" "$APP/Contents/Info.plist"
"$PB" -c "Set :TimeTrackDashboardURL ${DASHBOARD_URL}" "$APP/Contents/Info.plist"
# The displayed name follows BUNDLE_NAME, so a dev build is distinguishable in the Screen
# Recording pane, Login Items, and notification banners — where two identically named entries
# would be worse than useless.
"$PB" -c "Set :CFBundleName ${BUNDLE_NAME}" "$APP/Contents/Info.plist"
"$PB" -c "Set :CFBundleDisplayName ${BUNDLE_NAME}" "$APP/Contents/Info.plist"
echo "  name:       ${BUNDLE_NAME}"
echo "  bundle id:  ${BUNDLE_ID}"
echo "  api base:   ${API_BASE_URL}"
echo "  dashboard:  ${DASHBOARD_URL}"

# Sign the bundle. macOS TCC (Screen Recording, etc.) keys a permission grant to the app's
# code-signing identity: an ad-hoc signature has no stable identity, so its fingerprint changes
# every rebuild and macOS re-prompts each time (and the prior grant never sticks). With the
# bundle ID held fixed, a STABLE identity makes a granted permission persist across rebuilds.
#
# Identity resolution: explicit CODESIGN_IDENTITY wins; otherwise auto-pick a stable cert so a
# plain dev build is stably signed by default and nobody has to remember CODESIGN_IDENTITY.
# Prefer "Developer ID Application" (distribution), else "Apple Development" (local dev). The
# pick MUST be deterministic — `security find-identity` does not guarantee order, and picking a
# different identity between rebuilds would itself re-trigger the TCC prompt — so sort the
# fingerprints and take the first. If several exist, note it (pin one with CODESIGN_IDENTITY).
# awk (not grep) so a no-match exits 0 — grep's exit 1 would trip `set -o pipefail`.
find_ids() { security find-identity -v -p codesigning 2>/dev/null | awk -v p="$1" 'index($0, p) { print $2 }' | sort; }
IDENTITY="${CODESIGN_IDENTITY:-}"
if [[ -z "$IDENTITY" ]]; then
  ids="$(find_ids 'Developer ID Application')"
  [[ -z "$ids" ]] && ids="$(find_ids 'Apple Development')"
  IDENTITY="$(printf '%s\n' "$ids" | head -1)"
  if [[ "$(printf '%s\n' "$ids" | grep -c .)" -gt 1 ]]; then
    echo "  note: multiple signing identities found; using ${IDENTITY} (deterministic). Set CODESIGN_IDENTITY to pin one."
  fi
fi
IDENTITY="${IDENTITY:--}"
# A secure timestamp keeps the signature valid after the signing certificate expires. Without it,
# a bundle already installed on an employee machine stops validating on the cert's expiry date —
# which matters for a pilot signed with a 1-year "Apple Development" cert. Ad-hoc has no cert and
# rejects the flag, so only pass it for a real identity. Requires network (Apple's TSA).
TS_FLAG=(--timestamp)
if [[ "$IDENTITY" == "-" ]]; then
  echo "→ codesign (ad-hoc — no signing identity installed; permissions WILL re-prompt each rebuild)"
  TS_FLAG=()
else
  echo "→ codesign (identity: ${IDENTITY})"
fi
# ${a[@]+"${a[@]}"} — bash 3.2 (the /bin/bash macOS ships) treats an empty array as unbound
# under `set -u`; this expands to nothing instead of aborting.
codesign --force ${TS_FLAG[@]+"${TS_FLAG[@]}"} --sign "$IDENTITY" "$APP"

echo "✓ built ${APP}"

#!/usr/bin/env bash
# Produce the two files a release must carry: the zip the client downloads, and the SHA-256
# digest it verifies against.
#
# The names are part of the contract and must not drift:
#   NiftyTimer-pilot.zip         — the dashboard's DOWNLOAD_URL resolves to this via
#                                  releases/latest/download/<name>
#   NiftyTimer-pilot.zip.sha256  — GitHubReleaseFeed refuses a release without it, so a release
#                                 published without this file is invisible to the updater
#                                 rather than installable-but-unverified. That is deliberate.
#
# The release tag must carry the version, matching CFBundleShortVersionString — AppVersion
# parses the tag and compares it against the running build. Pilot builds are tagged
# `vX.Y.Z-pilot`; AppVersion strips a pre-release suffix, so `v0.2.0-pilot` compares as 0.2.0.
# At general availability, drop the suffix with TAG_SUFFIX= ./scripts/release-assets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TAG_SUFFIX="${TAG_SUFFIX--pilot}"

APP="dist/Nifty Timer.app"
ZIP="dist/NiftyTimer-pilot.zip"

[ -d "$APP" ] || { echo "✗ $APP not found — run scripts/package-app.sh first"; exit 1; }

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$APP/Contents/Info.plist")

# ditto, not zip: it preserves the bundle's symlinks and extended attributes. A zip that mangles
# them produces a bundle whose signature no longer validates, which the updater then rejects.
echo "→ packing $ZIP"
rm -f "$ZIP" "$ZIP.sha256"
/usr/bin/ditto -c -k --keepParent "$APP" "$ZIP"

# `shasum` output is "<digest>  <filename>"; the client parses either that or a bare digest.
( cd dist && /usr/bin/shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256" )

echo "✓ version $VERSION (build $BUILD)"
echo "  $ZIP"
echo "  $ZIP.sha256  $(cut -d' ' -f1 < "$ZIP.sha256")"
echo
echo "Publish both as assets on a release tagged v$VERSION$TAG_SUFFIX:"
echo "  gh release create v$VERSION$TAG_SUFFIX \"$ZIP\" \"$ZIP.sha256\" \\"
echo "    --repo rashedulhasansojib/timetrack-app --title \"v$VERSION${TAG_SUFFIX:+ — pilot}\""

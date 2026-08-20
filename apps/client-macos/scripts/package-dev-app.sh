#!/usr/bin/env bash
# Package a DEV build that can be installed alongside the released Nifty Timer.
#
# The two installs must not share state. They no longer do: the Application Support container
# and the Keychain service are derived from the bundle id (Sources/TimeTrack/App/AppInstall.swift),
# so the dev build gets ~/Library/Application Support/TimeTrack-dev/ and its own refresh token.
# Sharing them is lossy, not just untidy — both processes drain the same durable buffers, so a
# dev build would upload the released app's pending records to the dev server and delete them.
#
# What is still separate ONLY because the bundle id differs: TCC grants (Screen Recording &c.)
# and UserDefaults. Expect a one-time Screen Recording prompt for the dev build.
#
# The dev build points at a LOCAL stack by default. Never point it at production — its captures
# and time entries would land in real employee data.
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE_NAME="${BUNDLE_NAME:-Nifty Timer Dev}" \
BUNDLE_ID="${BUNDLE_ID:-com.niftyitsolution.niftytimer.dev}" \
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3001/v1}" \
DASHBOARD_URL="${DASHBOARD_URL:-http://127.0.0.1:3000}" \
  ./scripts/package-app.sh

cat <<'NOTE'

Next:
  open dist/                      # drag "Nifty Timer Dev.app" to /Applications, or run it in place
  Both apps can run at once — separate state, separate sign-in, separate permissions.
  System Settings › Privacy & Security › Screen Recording will ask once for the dev build.
NOTE

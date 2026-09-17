#!/usr/bin/env bash
#
# Runs ON THE VPS as the deploy user. Invoked over SSH by .github/workflows/deploy.yml with the
# git SHA being deployed. Expects the release tarball at $APP_ROOT/tmp/<sha>.tar.gz and
# $APP_ROOT/shared/.env to be already written.
#
# Contract: this script either leaves the new release serving traffic, or leaves the previous
# one serving traffic. A failure before the symlink flip (unpack, datastores, migrations) never
# touches what is live.
#
# Migrations run BEFORE the new code, so every migration must be compatible with the release
# currently serving — and they are forward-only, so a rollback below restores code, not schema.

set -euo pipefail

readonly APP_ROOT="${APP_ROOT:-/srv/timetrack}"
readonly KEEP_RELEASES=3 # each release is ~1GB (two pnpm-deployed node_modules trees)

readonly SHA="${1:?usage: remote-deploy.sh <git-sha>}"
readonly RELEASES="$APP_ROOT/releases"
readonly SHARED="$APP_ROOT/shared"
readonly CURRENT="$APP_ROOT/current"
readonly NEW_RELEASE="$RELEASES/$SHA"
readonly TARBALL="$APP_ROOT/tmp/$SHA.tar.gz"
readonly ECOSYSTEM="$SHARED/ecosystem.config.cjs"
readonly WITH_ENV=(node "$SHARED/with-env.cjs" "$SHARED/.env")
readonly APPS=(timetrack-api timetrack-worker timetrack-dashboard)

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mFAIL: %s\033[0m\n' "$*" >&2; }

PREVIOUS_RELEASE=""
if [ -L "$CURRENT" ]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT")"
fi
readonly PREVIOUS_RELEASE

# ---------------------------------------------------------------- unpack ----

log "Unpacking release $SHA"
[ -f "$TARBALL" ] || { fail "tarball not found: $TARBALL"; exit 1; }
[ -f "$SHARED/.env" ] || { fail "$SHARED/.env missing"; exit 1; }

if [ "$NEW_RELEASE" = "$PREVIOUS_RELEASE" ]; then
  fail "$SHA is already the live release — re-running it would delete what is serving"
  exit 1
fi
rm -rf "$NEW_RELEASE"
mkdir -p "$NEW_RELEASE"
# -p keeps the symlinks inside the pnpm-deployed node_modules.
tar -xzpf "$TARBALL" -C "$NEW_RELEASE"
rm -f "$TARBALL"

for f in api/dist/main.js worker/dist/main.js dashboard/apps/dashboard/server.js \
  api/node_modules/@timetrack/db/node_modules/.bin/prisma \
  pm2/ecosystem.config.cjs pm2/env-file.cjs pm2/with-env.cjs; do
  [ -e "$NEW_RELEASE/$f" ] || { fail "release is missing $f"; exit 1; }
done

# These must outlive any single release (PM2 keeps the ecosystem path).
cp "$NEW_RELEASE"/pm2/*.cjs "$SHARED/"

# ------------------------------------------------------------ datastores ----

# Root-owned unit (infra/systemd/timetrack-datastores.service). A no-op when already running;
# otherwise blocks until Postgres, Redis and MinIO are healthy.
log "Ensuring datastores are up"
sudo -n /usr/bin/systemctl start timetrack-datastores.service

# ------------------------------------------------------------ migrations ----

# Prisma resolves prisma.config.ts from the CWD, and schema + migrations sit beside it.
log "Applying migrations"
(cd "$NEW_RELEASE/api/node_modules/@timetrack/db" && "${WITH_ENV[@]}" node_modules/.bin/prisma migrate deploy)

# ------------------------------------------------------------ flip + boot ----

# Atomic: `mv -T` on a symlink is a single rename(2). `ln -sfn` alone unlinks first.
log "Pointing current -> releases/$SHA"
ln -sfn "$NEW_RELEASE" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"

boot() {
  export APP_VERSION="$1"
  # startOrReload re-reads the ecosystem file, so every app re-resolves `current`.
  # --only: this PM2 daemon also runs other apps, which a deploy must never touch.
  pm2 startOrReload "$ECOSYSTEM" --only "$(IFS=,; echo "${APPS[*]}")" --update-env
  pm2 save --force >/dev/null 2>&1 || true
}

log "Reloading PM2"
boot "$SHA"

# ------------------------------------------------------------- smoke test ----

wait_for() {
  local name="$1" url="$2" attempts="${3:-60}"
  for i in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 3 -o /dev/null "$url" 2>/dev/null; then
      log "$name responding after ${i}s"
      return 0
    fi
    sleep 1
  done
  fail "$name did not respond at $url after ${attempts}s"
  return 1
}

# Every app is online AND running from the release we just shipped. Without the path check, a
# stale PM2 process still on the previous release passes every HTTP probe.
apps_on_release() {
  local want="$1"
  pm2 jlist | node -e '
    const fs = require("node:fs");
    const [want, ...names] = process.argv.slice(1);
    const list = JSON.parse(fs.readFileSync(0, "utf8"));
    let ok = true;
    for (const name of names) {
      const procs = list.filter((p) => p.name === name);
      if (procs.length === 0) { console.error(`  ${name}: not in pm2`); ok = false; continue; }
      for (const p of procs) {
        const cwd = fs.realpathSync(p.pm2_env.pm_cwd);
        const status = p.pm2_env.status;
        const onRelease = cwd.startsWith(fs.realpathSync(want) + "/");
        console.log(`  ${name}: ${status} ${cwd}`);
        if (status !== "online" || !onRelease) ok = false;
      }
    }
    process.exit(ok ? 0 : 1);
  ' "$want" "${APPS[@]}"
}

smoke_test() {
  wait_for "API" "http://127.0.0.1:3001/health" || return 1
  wait_for "Dashboard" "http://127.0.0.1:3100/login" || return 1

  local ready
  ready="$(curl -sS --max-time 10 http://127.0.0.1:3001/health/ready || true)"
  echo "  ready: $ready"
  for dep in database redis storage; do
    case "$ready" in
      *"\"$dep\":\"up\""*) ;;
      *) fail "/health/ready reports $dep not up"; return 1 ;;
    esac
  done

  # Let a worker that crashes on boot (bad env, unreachable Redis) show itself before judging.
  sleep 10
  apps_on_release "$NEW_RELEASE" || { fail "a PM2 app is not online on $SHA"; return 1; }
  return 0
}

# ---------------------------------------------------------------- verdict ----

if smoke_test; then
  log "Deploy OK — $SHA is live"

  # Prune old releases, never the live one.
  live="$(readlink -f "$CURRENT")"
  # shellcheck disable=SC2012  # names are git SHAs: no spaces or newlines
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
    old="${old%/}"
    [ "$(readlink -f "$old")" = "$live" ] && continue
    log "Pruning $(basename "$old")"
    rm -rf "$old"
  done
  exit 0
fi

# ------------------------------------------------------------- rollback ----

fail "Smoke test failed for $SHA"
for app in "${APPS[@]}"; do
  pm2 logs "$app" --lines 30 --nostream 2>/dev/null || true
done

if [ -z "$PREVIOUS_RELEASE" ] || [ ! -d "$PREVIOUS_RELEASE" ]; then
  fail "No previous release to roll back to — leaving $SHA in place for inspection."
  exit 1
fi

log "Rolling back to $(basename "$PREVIOUS_RELEASE")"
ln -sfn "$PREVIOUS_RELEASE" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"
cp "$PREVIOUS_RELEASE"/pm2/*.cjs "$SHARED/" 2>/dev/null || true
boot "$(basename "$PREVIOUS_RELEASE")"

if wait_for "API (rolled back)" "http://127.0.0.1:3001/health" 30; then
  fail "Rolled back to $(basename "$PREVIOUS_RELEASE"). The bad release is at $NEW_RELEASE."
else
  fail "ROLLBACK ALSO FAILED — site is down, manual intervention required."
fi
exit 1

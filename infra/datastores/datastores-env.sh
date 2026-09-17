#!/usr/bin/env bash
# Renders /opt/timetrack/datastores.env from the deploy's shared/.env. Runs as root, as the
# ExecStartPre of timetrack-datastores.service.
#
# Why not point compose straight at shared/.env: that file is written by the deploy user, and
# compose reads more than the variables it interpolates from an --env-file (COMPOSE_* keys
# change its own behaviour). Copying across only the keys the datastores need keeps a
# deploy-user-writable file from steering a root-run compose.
#
# Values are single-quoted, which compose takes literally — a password containing `$` would
# otherwise be interpolated and the database initialised with the wrong one.
set -euo pipefail

SRC="${TIMETRACK_SHARED_ENV:-/srv/timetrack/shared/.env}"
DST="${TIMETRACK_DATASTORES_ENV:-/opt/timetrack/datastores.env}"
KEYS=(POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_BUCKET)

[[ -f "$SRC" ]] || { echo "✖ $SRC not found — the deploy writes it; run a deploy first" >&2; exit 1; }

umask 077
tmp="$(mktemp "${DST}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

for key in "${KEYS[@]}"; do
  line="$(grep -m1 "^${key}=" "$SRC" || true)"
  value="${line#*=}"
  [[ -n "$line" && -n "$value" ]] || { echo "✖ $key missing or empty in $SRC" >&2; exit 1; }
  [[ "$value" != *"'"* ]] || { echo "✖ $key contains a single quote, which cannot be quoted for compose" >&2; exit 1; }
  printf "%s='%s'\n" "$key" "$value" >> "$tmp"
done

mv "$tmp" "$DST"
trap - EXIT
chmod 600 "$DST"

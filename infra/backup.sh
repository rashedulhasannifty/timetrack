#!/usr/bin/env bash
# TimeTrack backup — Postgres dump (+ off-site S3 copy) + MinIO mirror. See docs/deployment.md §6.
#
#   sudo /opt/timetrack/backup.sh              # run a backup
#   sudo BACKUP_DIR=/mnt/backups /opt/timetrack/backup.sh
#   sudo KEEP_DAYS=30 /opt/timetrack/backup.sh
#
# Runs as ROOT: the datastores are root-managed containers (infra/datastores/) and the deploy
# user has no Docker access. Installed root-owned at /opt/timetrack/ with a systemd timer from
# infra/systemd/ — see §6. Exits non-zero on any failure so the timer's unit is marked failed
# and OnFailure alerting fires; a backup that quietly produced nothing is worse than none.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/timetrack}"
OPT_DIR="${OPT_DIR:-/opt/timetrack}"
BACKUP_DIR="${BACKUP_DIR:-${APP_ROOT}/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
ENV_FILE="${APP_ROOT}/shared/.env"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"

[[ -f "$ENV_FILE" ]] || { echo "✖ no shared .env at $ENV_FILE"; exit 1; }

# Read only the keys we need. Do NOT `source` the .env: MAIL_FROM contains spaces and
# angle brackets, which the shell would treat as redirection.
env_value() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }

COMPOSE=(docker compose --env-file "$OPT_DIR/datastores.env" -f "$OPT_DIR/docker-compose.datastores.yml")
mkdir -p "$BACKUP_DIR/postgres" "$BACKUP_DIR/minio"

# ── Postgres ────────────────────────────────────────────────────────────────────────────
# pg_dump runs INSIDE the container and reads its own POSTGRES_* env, so no credential is
# ever passed on the host command line or visible in `ps`.
DUMP="$BACKUP_DIR/postgres/timetrack-${STAMP}.sql.gz"
echo "→ postgres → ${DUMP}"
"${COMPOSE[@]}" exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  | gzip -9 > "$DUMP"

# A truncated dump is the classic silent backup failure: pg_dump dies mid-stream, the pipe
# still yields a valid-looking file. Verify the gzip AND that the tail carries pg_dump's
# own end marker, which only a complete dump has.
gzip -t "$DUMP" || { echo "✖ dump is not valid gzip"; exit 1; }
gunzip -c "$DUMP" | tail -5 | grep -q "PostgreSQL database dump complete" || {
  echo "✖ dump is truncated — no completion marker"; exit 1;
}
echo "  ✓ $(du -h "$DUMP" | cut -f1) verified"

# ── Off-site copy (S3) ──────────────────────────────────────────────────────────────────
# The dump above lands on the same disk as the database: that covers a bad migration or an
# accidental delete, not losing the VM. This ships the verified dump to an S3 bucket — see
# docs/deployment.md §6 for the bucket settings and IAM policy. The key may PUT under postgres/
# and nothing else: it cannot list, read or delete, and bucket versioning + Object Lock keep an
# overwrite from destroying anything, so a compromised VM cannot take the off-site copies too.
#
# Optional until configured: with no BACKUP_S3_BUCKET this warns and carries on, and the
# monitor keeps reporting "no off-site backup" until an upload succeeds. `|| true` because
# env_value's grep exits 1 on a missing key, which `set -e` would otherwise treat as fatal.
OFFSITE_BUCKET="$(env_value BACKUP_S3_BUCKET || true)"
OFFSITE_STAMP="$BACKUP_DIR/postgres/.offsite-last"
OFFSITE_FAILED=""
if [[ -z "$OFFSITE_BUCKET" ]]; then
  echo "⚠ off-site copy NOT configured (BACKUP_S3_BUCKET unset) — this is not disaster recovery"
else
  OFFSITE_REGION="$(env_value BACKUP_S3_REGION || true)"
  OFFSITE_ENDPOINT="$(env_value BACKUP_S3_ENDPOINT || true)"
  if [[ -z "$OFFSITE_ENDPOINT" ]]; then
    [[ -n "$OFFSITE_REGION" ]] || { echo "✖ BACKUP_S3_REGION is required"; exit 1; }
    OFFSITE_ENDPOINT="https://s3.${OFFSITE_REGION}.amazonaws.com"
  fi
  OFFSITE_KEY="$(env_value BACKUP_S3_ACCESS_KEY)"
  OFFSITE_SECRET="$(env_value BACKUP_S3_SECRET_KEY)"
  OFFSITE_NAME="$(basename "$DUMP")"
  # Exported and handed to docker by NAME only, so the secret never appears in `ps`.
  export OFFSITE_BUCKET OFFSITE_ENDPOINT OFFSITE_KEY OFFSITE_SECRET OFFSITE_NAME

  echo "→ off-site → ${OFFSITE_ENDPOINT}/${OFFSITE_BUCKET}/postgres/${OFFSITE_NAME}"
  # --api pins the signature version so `alias set` needs no permission the key lacks.
  # --checksum sends an integrity checksum with the upload; AWS documents one as required for
  # uploads into an Object Lock bucket.
  if docker run --rm -v "$BACKUP_DIR/postgres:/backup:ro" \
    -e OFFSITE_BUCKET -e OFFSITE_ENDPOINT -e OFFSITE_KEY -e OFFSITE_SECRET -e OFFSITE_NAME \
    --entrypoint sh quay.io/minio/mc:latest -c '
      mc alias set offsite "$OFFSITE_ENDPOINT" "$OFFSITE_KEY" "$OFFSITE_SECRET" --api s3v4 >/dev/null &&
      mc cp --quiet --checksum CRC32C "/backup/$OFFSITE_NAME" \
        "offsite/$OFFSITE_BUCKET/postgres/$OFFSITE_NAME" >/dev/null'; then
    # The monitor reads this file's mtime as "last successful off-site upload".
    printf '%s\n' "$OFFSITE_NAME" > "$OFFSITE_STAMP"
    echo "  ✓ uploaded"
  else
    # Not fatal yet: the MinIO mirror and retention below still run, then the script exits
    # non-zero so the unit is marked failed. The local dump is kept either way.
    OFFSITE_FAILED=1
    echo "✖ off-site upload failed — the local dump is kept at ${DUMP}"
  fi
fi

# ── MinIO ───────────────────────────────────────────────────────────────────────────────
# Screenshots are retention-bounded (30d by default), so mirroring stays cheap. --remove
# keeps the mirror faithful rather than growing forever with objects retention deleted.
#
# Only while screenshots live in the bundled MinIO. On external S3 (deployment §5) the bucket is
# off this box already and S3_BUCKET names the S3 bucket — a MinIO bucket of that name would be
# empty, and --remove would then delete the mirror's contents rather than refresh them.
# `|| true` because env_value's grep exits 1 on a missing key, which set -e would treat as fatal.
S3_ENDPOINT_CFG="$(env_value S3_ENDPOINT || true)"
case "$S3_ENDPOINT_CFG" in
  '' | http://127.0.0.1:9000* | http://localhost:9000* | http://minio:9000*) MIRROR_MINIO=1 ;;
  *) MIRROR_MINIO='' ;;
esac

if [[ -z "$MIRROR_MINIO" ]]; then
  echo "→ screenshots are on external S3 (${S3_ENDPOINT_CFG}) — no MinIO mirror"
else
  S3_BUCKET="$(env_value S3_BUCKET)"
  MINIO_USER="$(env_value MINIO_ROOT_USER)"
  MINIO_PASS="$(env_value MINIO_ROOT_PASSWORD)"
  NETWORK="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
    "$("${COMPOSE[@]}" ps -q minio)")"

  echo "→ minio bucket '${S3_BUCKET}' → ${BACKUP_DIR}/minio"
  docker run --rm --network "$NETWORK" \
    -v "$BACKUP_DIR/minio:/backup" \
    -e MC_HOST_local="http://${MINIO_USER}:${MINIO_PASS}@minio:9000" \
    quay.io/minio/mc:latest \
    mirror --overwrite --remove "local/${S3_BUCKET}" /backup
  echo "  ✓ $(du -sh "$BACKUP_DIR/minio" | cut -f1) mirrored"
fi

# ── Retention ───────────────────────────────────────────────────────────────────────────
# Only prunes dumps. The MinIO mirror is a mirror, not a history — it is pruned by --remove.
PRUNED="$(find "$BACKUP_DIR/postgres" -name 'timetrack-*.sql.gz' -mtime "+${KEEP_DAYS}" -print -delete | wc -l)"
echo "→ retention: kept ${KEEP_DAYS}d, pruned ${PRUNED} dump(s)"

REMAINING="$(find "$BACKUP_DIR/postgres" -name 'timetrack-*.sql.gz' | wc -l)"
[[ -z "$OFFSITE_FAILED" ]] || { echo "✖ backup incomplete — the off-site upload failed"; exit 1; }
echo "✓ backup complete — ${REMAINING} dump(s) on disk at ${BACKUP_DIR}"

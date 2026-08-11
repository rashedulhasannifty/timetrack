#!/usr/bin/env bash
# TimeTrack backup — Postgres dump + MinIO mirror. See docs/deployment.md §6.
#
#   ./infra/backup.sh              # run a backup
#   BACKUP_DIR=/mnt/backups ./infra/backup.sh
#   KEEP_DAYS=30 ./infra/backup.sh
#
# Run from the deploy directory (the one holding .env.prod). Installed as a systemd timer by
# infra/systemd/ — see §6. Exits non-zero on any failure so the timer's unit is marked failed
# and OnFailure alerting fires; a backup that quietly produced nothing is worse than none.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-${DEPLOY_DIR}/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
ENV_FILE="${DEPLOY_DIR}/.env.prod"
COMPOSE_FILE="${DEPLOY_DIR}/infra/docker-compose.prod.yml"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"

[[ -f "$ENV_FILE" ]] || { echo "✖ no .env.prod at $ENV_FILE"; exit 1; }

# Read only the keys we need. Do NOT `source` .env.prod: MAIL_FROM contains spaces and
# angle brackets, which the shell would treat as redirection.
env_value() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
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

# ── MinIO ───────────────────────────────────────────────────────────────────────────────
# Screenshots are retention-bounded (30d by default), so mirroring stays cheap. --remove
# keeps the mirror faithful rather than growing forever with objects retention deleted.
S3_BUCKET="$(env_value S3_BUCKET)"
MINIO_USER="$(env_value MINIO_ROOT_USER)"
MINIO_PASS="$(env_value MINIO_ROOT_PASSWORD)"
NETWORK="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
  "$("${COMPOSE[@]}" ps -q minio)")"

echo "→ minio bucket '${S3_BUCKET}' → ${BACKUP_DIR}/minio"
docker run --rm --network "$NETWORK" \
  -v "$BACKUP_DIR/minio:/backup" \
  -e MC_HOST_local="http://${MINIO_USER}:${MINIO_PASS}@minio:9000" \
  minio/mc:latest \
  mirror --overwrite --remove "local/${S3_BUCKET}" /backup
echo "  ✓ $(du -sh "$BACKUP_DIR/minio" | cut -f1) mirrored"

# ── Retention ───────────────────────────────────────────────────────────────────────────
# Only prunes dumps. The MinIO mirror is a mirror, not a history — it is pruned by --remove.
PRUNED="$(find "$BACKUP_DIR/postgres" -name 'timetrack-*.sql.gz' -mtime "+${KEEP_DAYS}" -print -delete | wc -l)"
echo "→ retention: kept ${KEEP_DAYS}d, pruned ${PRUNED} dump(s)"

REMAINING="$(find "$BACKUP_DIR/postgres" -name 'timetrack-*.sql.gz' | wc -l)"
echo "✓ backup complete — ${REMAINING} dump(s) on disk at ${BACKUP_DIR}"

# These backups are ON THE SAME DISK as the data they protect. That covers the common cases
# (bad migration, accidental delete, corrupted table) but NOT losing the VM. Copying
# $BACKUP_DIR off-box — Azure Blob, another host, whatever the org already uses — is the
# remaining step, and until it is done this is not disaster recovery.

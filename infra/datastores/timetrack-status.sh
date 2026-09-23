#!/usr/bin/env bash
# Read-only status of the TimeTrack datastores, for the deploy user and the monitor workflow.
#
# Installed root-owned at /usr/local/bin/timetrack-status and allowed to `deploy` through sudo
# with NO arguments (infra/datastores/sudoers). The deploy user has no Docker access — the docker
# group is root-equivalent — so this is its one window onto the containers. It prints container
# state and BullMQ queue depths, never environment or credentials.
#
# Output is line-oriented KEY=value so .github/workflows/monitor.yml can parse it:
#   CONTAINER=postgres state=running health=healthy
#   QUEUE=screenshots wait=0 failed=0
set -euo pipefail

for svc in postgres redis minio; do
  id="$(docker ps -aq --filter "label=com.docker.compose.project=timetrack" \
    --filter "label=com.docker.compose.service=${svc}" | head -1)"
  if [[ -z "$id" ]]; then
    echo "CONTAINER=${svc} state=missing health=none"
    continue
  fi
  docker inspect "$id" \
    --format "CONTAINER=${svc} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}"
done

redis="$(docker ps -q --filter "label=com.docker.compose.project=timetrack" \
  --filter "label=com.docker.compose.service=redis" | head -1)"
[[ -n "$redis" ]] || exit 0

for q in $(docker exec "$redis" redis-cli --scan --pattern 'bull:*:meta' 2>/dev/null \
  | sed 's/^bull://; s/:meta$//' | sort -u); do
  echo "QUEUE=${q} wait=$(docker exec "$redis" redis-cli LLEN "bull:${q}:wait") failed=$(docker exec "$redis" redis-cli ZCARD "bull:${q}:failed")"
done

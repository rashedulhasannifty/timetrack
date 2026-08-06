# Deployment — self-hosted, single VM

Target (`PRD §8`): **50 users on one small VM.** Postgres, Redis, and MinIO run as containers alongside the three app images, behind an auth-gated reverse proxy with TLS. The API is stateless so it can scale horizontally later; the datastores are the only stateful pieces.

This is the operations runbook. The app images are built from `infra/{api,worker,dashboard}.Dockerfile` (repo root as build context).

---

## 1. Topology

```
                    Internet
                       │  443 (TLS)
                ┌──────▼───────┐
                │ reverse proxy│  Caddy or nginx — TLS, auth gate, routing
                └──┬────────┬──┘
        /api, /*   │        │  dashboard
             ┌─────▼──┐  ┌──▼─────────┐
             │  api   │  │ dashboard  │      (stateless — scale N replicas)
             └──┬─────┘  └────────────┘
                │ produces jobs
             ┌──▼─────┐
             │ worker │      (BullMQ consumers — separate scaling axis)
             └──┬─────┘
   ┌────────────┼───────────────┐
┌──▼───┐   ┌────▼────┐    ┌──────▼──────┐
│ pg 18│   │ redis   │    │ minio (S3)  │   (stateful — volumes + backups)
└──────┘   └─────────┘    └─────────────┘
```

- **Reverse proxy** terminates TLS, sits behind a VPN or an auth gate (`PRD §8`), routes `/api/*` → api, everything else → dashboard.
- **Buckets are never public** — the dashboard fetches screenshots via short-lived presigned URLs only.
- Postgres volume and MinIO data are encrypted at rest (host-level disk encryption or PG/MinIO SSE).

---

## 2. Production compose (shipped)

The dev `infra/docker-compose.yml` runs only the datastores. Production adds the three app
images plus a TLS-terminating Caddy reverse proxy. The files:

- **`infra/docker-compose.prod.yml`** — postgres, redis (appendonly), minio, the three app
  images, and the proxy, plus three helper services: a `createbuckets` one-shot (idempotent,
  creates the screenshots bucket so the first upload doesn't hit `NoSuchBucket`), and
  profile-gated `migrate` / `seed` one-shots.
- **`infra/Caddyfile`** — auto-TLS (Let's Encrypt) and path routing on a single public host.
- **`.env.prod.example`** — every var the stack needs, validated against `packages/config` at
  boot. Copy to `.env.prod` at the repo root, fill, `chmod 600`; never commit the filled file.

Run everything **from the repo root** (`env_file` paths are `../.env.prod`, relative to the
compose file in `infra/`):

```bash
# First deploy / every upgrade: migrate BEFORE rolling the apps (§4). First deploy also seeds.
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml --profile setup run --rm migrate
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml --profile setup run --rm seed

# Start the stack (proxy is the only service that publishes ports: 80/443):
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml up -d

# Scale the stateless API (plain compose, not Swarm — there is no deploy.replicas):
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml up -d --scale api=2
```

**Routing (Caddyfile):** `/v1/*` and `/health*` → api; everything else → dashboard. The Mac
client pins `/v1`, so that prefix must reach the API unmodified; the dashboard's own Next
`/api/*` BFF routes stay on the dashboard (do **not** route `/api/*` to the API). The dashboard
reaches the API over the internal network (`API_URL=http://api:3001`), not through the proxy.

Build the app images (repo root as context) before first `up`, or pull them from your registry:

```bash
docker build -f infra/api.Dockerfile       -t timetrack/api:$TAG .
docker build -f infra/worker.Dockerfile    -t timetrack/worker:$TAG .
docker build -f infra/dashboard.Dockerfile -t timetrack/dashboard:$TAG .
```

---

## 3. Configuration & secrets

- All config is Zod-validated at boot (`packages/config`) — a missing/invalid var fails fast, never a runtime `undefined`.
- **Secrets never enter the repo** (`CLAUDE.md §6`). Provide `.env.prod` on the host (root-owned, `chmod 600`) or via the orchestrator's secret store. Rotate `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `S3_*`, DB creds.
- `.env.prod` must set (beyond `.env.example` defaults): strong 32+ char JWT secrets, real DB/Redis/MinIO creds, `NODE_ENV=production`, `API_URL`/dashboard origin, `PRESIGNED_URL_TTL_SECONDS`.
- The dashboard reads `API_URL` **server-side** only; no credential in `NEXT_PUBLIC_*`.

---

## 4. Database migrations on deploy

- Migrations are applied with **`prisma migrate deploy`** (never `migrate dev`, never `db push` against prod — `CLAUDE.md §4`).
- Run as a one-shot step **before** rolling the api/worker: `pnpm db:deploy` (or `docker run --rm timetrack/api node ...` invoking migrate deploy).
- The **partition-provision** worker job must run (and be alerted on) — if next month's partition is missing, inserts fail. Seed initial partitions ship in the init migration; the nightly job extends them.
- Migration + schema change always ship in the same commit (already enforced by convention).

---

## 5. Release flow (runbook)

**First deploy:**

1. Provision the VM; install Docker + compose.
2. Place `.env.prod` (600) and `infra/docker-compose.prod.yml` + `Caddyfile`.
3. Build/pull images: `docker build -f infra/api.Dockerfile -t timetrack/api:$TAG .` (and worker, dashboard), or pull from your registry.
4. Start datastores; wait healthy.
5. Run `migrate deploy` (one-shot).
6. Seed the bootstrap ADMIN (`pnpm db:seed` with `SEED_ADMIN_*`), then rotate that password on first login.
7. Start api/worker/dashboard/proxy.
8. Verify `/health` (liveness) and `/health/ready` (PG+Redis+MinIO reachable).

**Upgrade:**

1. Build/pull the new `$TAG`.
2. `migrate deploy` (forward-only).
3. Roll api → worker → dashboard (api is stateless; brief overlap is fine).
4. Smoke `/health/ready` + a login + a report.

**Rollback:** redeploy the previous image `$TAG`. **Migrations are forward-only** — do not auto-revert; a bad migration needs a new corrective migration. Restore from backup only for data loss.

---

## 6. Backups & DR

- **Postgres:** nightly `pg_dump` (or WAL archiving/`pgBackRest` for PITR) to off-box storage; test restores quarterly. Time entries are the payroll record — never on a short retention.
- **MinIO:** replicate the bucket (MinIO mirror/`mc mirror`) or snapshot the volume; screenshots are retention-bounded (default 30d) so backup windows can be short.
- **Redis:** ephemeral (BullMQ queues) — no backup needed; jobs are idempotent and retried.
- Document RPO/RTO with the customer; encrypt backups at rest and in transit.

---

## 7. Observability

- **Health:** proxy/orchestrator probes `/health` (liveness) and `/health/ready` (dependencies). Unready → pulled from rotation.
- **Logs:** Pino JSON to stdout → shipped to the org's sink (Loki/ELK/CloudWatch). `requestId` on every line; redaction enforced (`authorization`, `cookie`, `*.password`, `*.refreshToken`, `*.windowTitle`, raw bytes) — verify redaction in prod config.
- **Alerts:** partition-provision failures, retention-job failures, `/health/ready` failing, queue depth/backlog, disk usage on the PG/MinIO volumes.
- **Rate limiting:** `@nestjs/throttler` on auth + batch ingest (already wired) — confirm limits for the deployment size.

---

## 8. macOS client distribution

The client is outside the pnpm graph and ships separately (`PRD §7.1.6`).

- **Build/sign/notarize:** Xcode archive → Developer ID signing → Apple **notarization** → staple. Required for Gatekeeper on employee machines.
- **Permissions:** the app requests **Screen Recording** and **Accessibility** (window titles + idle) — document the grant steps for employees; capture cannot start until granted **and** the policy is acknowledged.
- **Auto-start:** ship as a **LaunchAgent** for login start (default **off**, `PRD §6.1`).
- **Config:** the client is pointed at the deployment's API URL (build config or first-run setup).
- **Updates:** Sparkle (or MDM push). The always-visible indicator and the `AckGate` are present in **every** build — there is no target that removes them.

---

## 9. Security checklist (pre-go-live)

- [ ] TLS everywhere; HSTS at the proxy; backend not directly exposed (VPN/auth gate).
- [ ] MinIO buckets private; presigned URLs only; short TTL.
- [ ] Strong, rotated secrets; none in the repo or images; `.env.prod` 600.
- [ ] Data encrypted at rest (PG volume + MinIO).
- [ ] Deny-by-default guards live; resource-level authorization verified (the 403 tests pass).
- [ ] Redaction verified in prod logs (no passwords/tokens/window titles/bytes).
- [ ] Retention job running + alerted; erasure tooling tested.
- [ ] Legal/HR sign-off on monitoring notice per employment jurisdiction (`PRD §4`).

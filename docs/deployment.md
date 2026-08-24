# Deployment — self-hosted, single VM

Target (`PRD §8`): **50 users on one small VM.** Postgres, Redis, and MinIO run as containers alongside the three app images, behind an auth-gated reverse proxy with TLS. The API is stateless so it can scale horizontally later; the datastores are the only stateful pieces.

This is the operations runbook. The app images are built from `infra/{api,worker,dashboard}.Dockerfile` (repo root as build context).

Provisioning a VM from scratch — network rules, deploy user, SSH keys, the 29 Actions
secrets, first deploy and seeding — is a separate one-time runbook: **[`vm-setup.md`](./vm-setup.md)**.

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

The prod compose sets `name: timetrack-prod`, so its containers and volumes live in their own
namespace (`timetrack-prod_*`), isolated from the dev stack (which defaults to the `infra`
project). This matters even on a shared machine: without it both files resolve to the same
project and share `pgdata`/`miniodata`, so a `down -v` on one destroys the other's data.

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
- **`APP_URL` is the public dashboard origin** and is what every invitation email's accept
  link is built from. Boot **fails** if `NODE_ENV=production` and it is still the localhost
  default — a wrong value would otherwise mail employees an unreachable link.
- **Invitation email (`SMTP_*` + `MAIL_FROM`) is all-or-nothing**, like `OIDC_*`: set all five
  or none. Unset, invites are created but never delivered, and in production the worker logs
  an error. Port 587 uses STARTTLS (required, not opportunistic); 465 uses implicit TLS. With
  AWS SES, `SMTP_PASS` is the SES **SMTP password** — derived from an IAM secret access key,
  not the secret itself. Before go-live verify the `MAIL_FROM` identity with the provider,
  and on SES confirm the account has production access (a sandboxed account only delivers to
  individually verified recipients).
- `INVITE_TTL_DAYS` (default 7) is stamped on each invite at create time; changing it never
  extends invites already sent.

---

## 4. Database migrations on deploy

- Migrations are applied with **`prisma migrate deploy`** (never `migrate dev`, never `db push` against prod — `CLAUDE.md §4`).
- Run as a one-shot step **before** rolling the api/worker: `pnpm db:deploy` (or `docker run --rm timetrack/api node ...` invoking migrate deploy).
- The **partition-provision** worker job must run (and be alerted on) — if next month's partition is missing, inserts fail. Seed initial partitions ship in the init migration; the nightly job extends them.
- Migration + schema change always ship in the same commit (already enforced by convention).

---

## 5. Release flow (runbook)

All commands run **from the repo root** with `--env-file .env.prod` (see §2 for why). `.env.prod`
lives at the repo root, `chmod 600`.

**First deploy:**

1. Provision the VM; install Docker + compose. Point DNS for `PUBLIC_DOMAIN` at it (Caddy needs it resolving before it can issue the cert).
2. Copy `.env.prod.example` → `.env.prod`, fill it, `chmod 600`.
3. Build (or pull) the three images — the `docker build …` commands in §2.
4. Run the migrate one-shot (also seeds the datastores' health-gated startup):
   `docker compose --env-file .env.prod -f infra/docker-compose.prod.yml --profile setup run --rm migrate`
5. Seed the bootstrap ADMIN (needs `SEED_ADMIN_*` set), then rotate that password on first login:
   `docker compose --env-file .env.prod -f infra/docker-compose.prod.yml --profile setup run --rm seed`
6. Start the stack: `docker compose --env-file .env.prod -f infra/docker-compose.prod.yml up -d` (datastores → `createbuckets` → apps → proxy, gated by healthchecks).
7. Verify `/health` (liveness) and `/health/ready` (PG+Redis+MinIO reachable) via the public domain.
8. Verify invitations end-to-end: invite a real address from **Admin → Users**, confirm the
   email arrives, and that its link opens `/accept-invite` and signs the new user in. Nothing
   before this step exercises the SES credential — the unit tests all mock the transport.

**Upgrade:**

1. Build/pull the new `$TAG` (set `TAG` in `.env.prod`).
2. `--profile setup run --rm migrate` (forward-only).
3. `up -d` rolls api → worker → dashboard (api is stateless; brief overlap is fine).
4. Smoke `/health/ready` + a login + a report.

**Rollback:** redeploy the previous image `$TAG`. **Migrations are forward-only** — do not auto-revert; a bad migration needs a new corrective migration. Restore from backup only for data loss.

---

## 5b. Continuous deployment (GitHub Actions)

`.github/workflows/deploy.yml` automates the **upgrade** path only: CI succeeds on `main` (or
run it manually via `workflow_dispatch`) → build the three images and push them to GHCR →
render `.env.prod` on the host → `migrate` → `up -d` → probe the API's `/health`.

It is triggered by the CI workflow _completing_, not by the push, and runs only when that run
concluded `success` — so a red commit still cannot deploy, but the suite is paid for once
rather than twice. Everything is tagged and checked out at the exact commit CI verified
(`workflow_run.head_sha`), not at whatever `main` points to when the deploy starts.

It deliberately does **not** do first-deploy work. These stay manual, once, per §5:

1. NSG 80/443 open; public IP Static; DNS pointed at the host.
2. Docker Engine + compose v2 installed.
3. A **dedicated deploy user** with a purpose-generated SSH keypair — the private half becomes
   the `SSH_KEY` secret. Never a personal key: that secret grants a shell on production.
4. `mkdir -p <DEPLOY_PATH>/infra` — the workflow scp's `docker-compose.prod.yml` and
   `Caddyfile` into `<DEPLOY_PATH>/infra/`, and renders `.env.prod` one level up at
   `<DEPLOY_PATH>/.env.prod` (the compose file's `env_file` is `../.env.prod`).
5. The `seed` one-shot. It is first-deploy-only and is **not** in the workflow.

Because images come from GHCR, the host needs no source checkout, no repo deploy key, and no
build capacity — it only pulls. Set `IMAGE_PREFIX` to switch registries; unset, compose falls
back to the local `timetrack/*` names the `docker build` commands in §2 produce, so the manual
path still works when CI is unavailable.

**Repository secrets** (Settings → Secrets and variables → Actions):

| Group    | Secrets                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH      | `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PORT`, `DEPLOY_PATH`                                                                                          |
| Postgres | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`                                                                                   |
| Auth     | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DASHBOARD_SESSION_SECRET`                                                                                 |
| Storage  | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                                               |
| URLs     | `API_URL`, `APP_URL`, `CORS_ORIGINS`, `PUBLIC_DOMAIN`, `ACME_EMAIL`                                                                                   |
| Optional | `INVITE_TTL_DAYS`; `SMTP_HOST` + `SMTP_PORT` + `SMTP_USER` + `SMTP_PASS` + `MAIL_FROM`; `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`; the five `OIDC_*` |

`NODE_ENV`, `LOG_LEVEL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION` and
`API_PORT` are **not** secrets — the workflow hardcodes them (`S3_PUBLIC_ENDPOINT` is derived
from `PUBLIC_DOMAIN`). `NODE_ENV=production` in particular must never be omitted: the schema
defaults to `development`, and under `development` the API returns the raw invite token in its
response and the `APP_URL` guard never fires.

**`S3_ENDPOINT` vs `S3_PUBLIC_ENDPOINT`.** The API reaches MinIO over the container network
(`http://minio:9000`), but the dashboard renders screenshots from **presigned URLs the browser
fetches directly** (PRD §7.4) — so those URLs must name an origin the browser can resolve.
SigV4 signs the host, so the URL has to be _signed for_ that origin; rewriting it afterwards
yields `SignatureDoesNotMatch`. Hence two settings: `S3_ENDPOINT` for the API's own calls, and
`S3_PUBLIC_ENDPOINT` (`https://$PUBLIC_DOMAIN`) for signing browser-bound URLs, with Caddy
routing `/$S3_BUCKET/*` to minio (`infra/Caddyfile`, and `S3_BUCKET` must be in the proxy's
environment for that matcher). Get this wrong and every screenshot renders as a broken image
while the rest of the page works — that is the symptom to recognise. The bucket stays private:
without a valid, unexpired signature MinIO answers 403.

**Optional groups are emitted only when set.** `packages/config` treats an empty string as
_present_, so writing `OIDC_ISSUER=` for an unused feature fails `z.url()` and the API refuses
to boot. Leave a group's secrets unset and the workflow omits the whole block. Set them
together — the all-or-nothing refinements still apply.

`TAG` is rendered as the deployed commit SHA, so **rollback is re-running an earlier
successful workflow** (Actions → that run → Re-run jobs). The `concurrency` group serialises
deploys so two `migrate` runs can never race.

---

## 6. Backups & DR

- **Postgres:** nightly `pg_dump` (or WAL archiving/`pgBackRest` for PITR) to off-box storage; test restores quarterly. Time entries are the payroll record — never on a short retention.
- **MinIO:** replicate the bucket (MinIO mirror/`mc mirror`) or snapshot the volume; screenshots are retention-bounded (default 30d) so backup windows can be short.
- **Redis:** ephemeral (BullMQ queues) — no backup needed; jobs are idempotent and retried.
- Document RPO/RTO with the customer; encrypt backups at rest and in transit.

### Shipped: `infra/backup.sh` + a systemd timer

`infra/backup.sh` dumps Postgres and mirrors the MinIO bucket. `pg_dump` runs **inside** the
container reading its own `POSTGRES_*`, so no credential appears on the host command line or
in `ps`. The dump is verified twice — `gzip -t`, then a grep for pg_dump's own
`PostgreSQL database dump complete` marker, because a dump killed mid-stream still produces a
structurally valid gzip and that is the classic silent backup failure.

Install on the host (as the deploy user, from the deploy directory):

The deploy ships `backup.sh` and the unit files to `<DEPLOY_PATH>/infra/` and makes the
script executable, so they are already on the host after any successful deploy. Installing
the timer is the one-time manual step:

```bash
sudo cp infra/systemd/timetrack-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now timetrack-backup.timer

./infra/backup.sh          # run once by hand first — do not wait for 02:30 to find out
systemctl list-timers timetrack-backup.timer
journalctl -u timetrack-backup.service -n 50
```

Knobs: `BACKUP_DIR` (default `<deploy>/backups`), `KEEP_DAYS` (default 14). Retention prunes
dumps only; the MinIO mirror is a mirror, not a history, and tracks deletions via `--remove`.

**Restore** — the dump is `--clean --if-exists`, so it drops and recreates its own objects:

```bash
gunzip -c backups/postgres/timetrack-<stamp>.sql.gz | \
  docker compose --env-file .env.prod -f infra/docker-compose.prod.yml exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Test a restore into a scratch database quarterly. **A backup you have never restored is a
hypothesis, not a backup.**

> ⚠️ **Not yet disaster recovery.** These backups land on the **same disk** as the data they
> protect. That covers a bad migration, an accidental delete, or a corrupted table — it does
> not cover losing the VM. Copying `$BACKUP_DIR` off-box (Azure Blob, another host) is the
> remaining step and is not automated here.

---

## 7. Observability

- **Health:** proxy/orchestrator probes `/health` (liveness) and `/health/ready` (dependencies). Unready → pulled from rotation. `/health/ready` checks Postgres, Redis **and** MinIO concurrently, each with a 2s timeout so a black-holed dependency cannot hang the probe, and returns `{"status":"ok","checks":{"database":"up","redis":"up","storage":"up"}}`. On failure it is a 503 naming which dependency is down — with no driver text or connection string in the body. The **container** healthcheck deliberately uses `/health`, never this route: a transient dependency blip must not make Docker restart an otherwise-healthy process.
- **Logs:** Pino JSON to stdout → shipped to the org's sink (Loki/ELK/CloudWatch). `requestId` on every line; redaction enforced (`authorization`, `cookie`, `*.password`, `*.refreshToken`, `*.windowTitle`, raw bytes) — verify redaction in prod config.
- **Alerts:** `.github/workflows/monitor.yml` probes twice a day (00:00 and 12:00 UTC) from OUTSIDE the box (a watchdog on the VM cannot report the VM being gone) and opens a labelled GitHub issue on failure, closing it on recovery. At that cadence an outage can go unnoticed for up to 12 hours — it is a cheap daily health sweep, not an uptime monitor. It covers `/health/ready` and each dependency it names, disk usage, backup freshness and size, worker liveness, and per-queue backlog/failure depth. Not yet covered: partition-provision and retention job outcomes, and a tracking-gap check (no activity samples during work hours) — that one needs holiday/quiet-day tuning before it would be trustworthy.
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

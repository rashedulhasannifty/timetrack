# Deployment — self-hosted, single VPS

Target (`PRD §8`): **50 users on one small VPS.** The three Node apps run under **PM2** on the
host; Postgres, Redis and MinIO run as **Docker** containers beside them; the host's **Caddy**
terminates TLS. The API is stateless so it can scale later; the datastores are the only
stateful pieces.

The production VPS is shared with other PM2 apps behind the same Caddy, which shapes most of the
choices below: nothing here may publish 80/443, collide with another app's port, or reload a PM2
process that isn't ours.

This is the operations runbook. Provisioning the VPS — Docker, the datastores unit, sudoers, the
Actions secrets, the Caddy block, first deploy and seeding — is a separate one-time runbook:
**[`vm-setup.md`](./vm-setup.md)**.

---

## 1. Topology

```
                         Internet
                            │  443 (TLS)
                   ┌────────▼─────────┐
                   │ Caddy (host)     │  shared with other sites on the box
                   └──┬──────┬──────┬─┘
     /v1/*, /health*  │      │      │  everything else (incl. dashboard /api/*)
            ┌─────────▼┐     │     ┌▼────────────────┐
            │ api :3001│     │     │ dashboard :3100 │   PM2 (deploy user), 1 instance each
            └────┬─────┘     │     └─────────────────┘
                 │ jobs      │ /timetrack-screenshots/*  (presigned URLs)
            ┌────▼─────┐     │
            │ worker   │     │                            PM2 (deploy user), fork
            └────┬─────┘     │
   ┌─────────────┼───────────┼───────────┐
┌──▼──────┐ ┌────▼─────┐ ┌───▼──────────┐
│ pg 18   │ │ redis    │ │ minio (S3)   │   Docker, 127.0.0.1-published, root-owned systemd unit
│ :5432   │ │ :6379    │ │ :9000        │
└─────────┘ └──────────┘ └──────────────┘
```

- **Caddy** routes `/v1/*` and `/health*` → api, `/<S3_BUCKET>/*` → MinIO, everything else →
  dashboard. The Mac and Windows clients pin `/v1`, so that prefix must reach the API unmodified;
  the dashboard's own Next `/api/*` BFF routes stay on the dashboard (do **not** route `/api/*` to
  the API). The site block is tracked at `infra/caddy/timetrack.caddy`.
- **Every internal port is loopback-only or firewalled.** Docker-published ports bypass UFW, so
  the datastores publish on `127.0.0.1`. The dashboard binds `127.0.0.1`; the API binds
  `0.0.0.0:3001`, which UFW (22/80/443 only) keeps off the internet.
- **Buckets are never public** — the dashboard renders screenshots from short-lived presigned URLs
  only, served with `Cache-Control: private, no-store`.
- **One instance per app, deliberately.** `@nestjs/throttler` counts in process memory, so N API
  workers mean N× every rate limit; the worker owns the BullMQ schedulers. Cluster mode on the api
  and dashboard still gives a zero-downtime `pm2 reload`. Raise instance counts only together with
  the change that makes it safe (`infra/pm2/ecosystem.config.cjs`).
- **The deploy user has no Docker access.** The `docker` group is root-equivalent and `deploy`'s
  SSH key is a GitHub secret. The datastores are brought up by the root-owned
  `timetrack-datastores` systemd unit; `deploy` may only start that unit and run the read-only
  `timetrack-status` script, through `/etc/sudoers.d/timetrack` (`infra/datastores/sudoers`).

### On the host

```
/srv/timetrack/                         deploy-owned
  releases/<sha>/{api,worker,dashboard,pm2}   one per deploy, 3 kept
  current -> releases/<sha>                   flipped atomically
  shared/.env                                 rendered from secrets every deploy, mode 600
  shared/{ecosystem.config.cjs,env-file.cjs,with-env.cjs}
  tmp/                                        upload staging
/opt/timetrack/                         root-owned
  docker-compose.datastores.yml  datastores-env.sh  datastores.env (600)  backup.sh
/etc/systemd/system/timetrack-datastores.service
/usr/local/bin/timetrack-status
/etc/sudoers.d/timetrack
```

- `datastores-env.sh` (the unit's `ExecStartPre`) copies only `POSTGRES_*`, `MINIO_ROOT_*` and
  `S3_BUCKET` from `shared/.env` into `datastores.env`, single-quoted. Compose also reads
  `COMPOSE_*` from an env file, so a deploy-writable file must never be handed to a root compose
  directly — and a password containing `$` would otherwise be interpolated.
- The env file is parsed by `infra/pm2/env-file.cjs`, never by dotenv or `source`: a secret may
  contain `#` (a comment to dotenv) or `$`, and `MAIL_FROM` contains `<` and `>`.

---

## 2. Datastores

`infra/datastores/docker-compose.datastores.yml` — project name `timetrack` (volumes
`timetrack_pgdata`, `timetrack_redisdata`, `timetrack_miniodata`), isolated from the dev stack
(`infra/docker-compose.yml`, project `infra`) so a `down -v` on one can never touch the other.
Redis runs with `appendonly`. A profile-gated `createbuckets` one-shot creates the screenshots
bucket; the unit runs it after `up --wait`.

The deploy starts the unit on every run (`sudo systemctl start timetrack-datastores.service` —
a no-op when already up). It does **not** restart or reconfigure it, so a change to the compose
file is a manual root step:

```bash
install -m 644 infra/datastores/docker-compose.datastores.yml /opt/timetrack/
systemctl restart timetrack-datastores.service      # restarts the stores — plan a window
```

Status, as deploy: `sudo timetrack-status` (container state/health + BullMQ queue depths).

`POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD` are baked into the volumes at first start. Changing
the secret afterwards does **not** rotate them — it makes the apps fail to authenticate.

---

## 3. Configuration & secrets

- All config is Zod-validated at boot (`packages/config`) — a missing/invalid var fails fast, never a runtime `undefined`.
- **Secrets never enter the repo** (`CLAUDE.md §6`). They live in GitHub Actions secrets; the deploy renders them to `shared/.env` (mode 600) on every run — edit the secret and redeploy, never the file on the host (the next deploy overwrites it). Rotate `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `S3_*`, DB creds.
- The rendered file sets (beyond `.env.example` defaults): strong 32+ char JWT secrets, real DB/MinIO creds, `NODE_ENV=production`, the public origins. `.env.prod.example` lists every key.
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

### Screenshots on external S3 (AWS)

By default screenshots live in the bundled MinIO (§2) — on the VPS's own disk, mirrored nightly
by `backup.sh`. Setting `S3_ENDPOINT` moves them to a real S3 bucket instead: the disk stops
growing, and the objects are off the box without a mirror. Set these five secrets **together**
and redeploy:

| Secret          | Value                                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| `S3_ENDPOINT`   | `https://s3.<region>.amazonaws.com`                                                |
| `S3_REGION`     | the bucket's region — required with `S3_ENDPOINT`, and the deploy fails without it |
| `S3_BUCKET`     | the S3 bucket name (**overwrites** the MinIO bucket name)                          |
| `S3_ACCESS_KEY` | the bucket's access key (**overwrites** MinIO's)                                   |
| `S3_SECRET_KEY` | the bucket's secret key (**overwrites** MinIO's)                                   |

All five, because the last three are one set of credentials with two possible targets — adding
only the endpoint points the API at AWS while still holding MinIO's key, and `HeadBucket` fails
at boot. Leave `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` in place: the datastores stack still runs
MinIO, it simply stops receiving writes.

The deploy omits `S3_PUBLIC_ENDPOINT` in this mode, deliberately. A presigned URL is signed for
the bucket's own host, which the browser reaches directly; overriding the origin would break the
signature. Caddy's `/<S3_BUCKET>/*` route to MinIO goes unused.

Bucket settings — the opposite of the backup bucket in §6:

- **No versioning and no Object Lock.** Retention (default 30d) and employee erasure must really
  delete; a locked bucket would keep a copy of every screenshot an employee asked to be removed.
- Block Public Access on, default encryption SSE-S3.
- Lifecycle, if you want one: Standard-IA or Glacier **Instant** Retrieval only. Never Glacier
  Flexible Retrieval or Deep Archive — those require a restore before any GET, so the dashboard's
  presigned URL returns an error instead of an image.
- The key needs `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` and `s3:ListBucket`.
  `ListBucket` is not optional: the API calls `HeadBucket` in `onModuleInit` and will not boot
  without it.

**Verify the key before you deploy.** A wrong or mismatched credential is not a degraded
deploy, it is an outage: `HeadBucket` throws in `onModuleInit`, the API dies before it listens,
and the deploy's automatic rollback _cannot_ save you — `shared/.env` is written by the workflow
**before** `remote-deploy.sh` runs, so the previous release boots against the same bad env and
fails too ("ROLLBACK ALSO FAILED"). Prove the credential first, from anywhere with the AWS CLI:

```sh
aws s3api head-bucket --bucket "$S3_BUCKET" --endpoint-url "$S3_ENDPOINT"    # boot check
aws s3api list-objects-v2 --bucket "$S3_BUCKET" --max-items 1                # s3:ListBucket
echo probe | aws s3 cp - "s3://$S3_BUCKET/_healthcheck.txt"                  # upload path
aws s3 rm "s3://$S3_BUCKET/_healthcheck.txt"                                 # retention/erasure
```

`SignatureDoesNotMatch` on any of these means the id and secret are not a pair — an access key's
secret is shown once at creation and cannot be recovered, so issue a new key rather than hunting
for the old secret.

`backup.sh` skips the MinIO mirror once `S3_ENDPOINT` points elsewhere (§6). **Rollback:** delete
the `S3_ENDPOINT` and `S3_REGION` secrets, restore the three `S3_*` to their MinIO values, and
redeploy; screenshots written to S3 in the meantime stay there and their rows will 404. Note the
redeploy needs a **new commit** — the box refuses to re-deploy the SHA that is already live.

---

## 4. Database migrations on deploy

- Migrations are applied with **`prisma migrate deploy`** (never `migrate dev`, never `db push` against prod — `CLAUDE.md §4`), from the new release's `api/node_modules/@timetrack/db` (Prisma resolves `prisma.config.ts` from the CWD), through `with-env.cjs`.
- They run **before** the symlink flip, so a failed migration leaves the previous release serving. They are therefore also applied while the **old** code is still live: every migration must be compatible with the release before it (expand now, contract in a later deploy).
- The **partition-provision** worker job must run (and be alerted on) — if next month's partition is missing, inserts fail. Seed initial partitions ship in the init migration; the nightly job extends them.
- Migration + schema change always ship in the same commit (already enforced by convention).

---

## 5. Release flow

`.github/workflows/deploy.yml` runs when CI completes **successfully** on `main` (or by
`workflow_dispatch`). It checks out the exact commit CI verified (`workflow_run.head_sha`), then:

1. `pnpm install` + `pnpm build` on `ubuntu-latest` with Node from `.nvmrc` — the same glibc/x64/
   Node-major as the VPS, which matters because argon2 and sharp load native binaries.
2. **Assemble** `release.tar.gz`: `pnpm deploy --prod --legacy` for api and worker (a pruned,
   self-contained `node_modules`; the Prisma CLI and tsx ride along as `@timetrack/db`
   dependencies), the dashboard's Next `standalone` output + `.next/static` (`cp -a` — the tree is
   held together by pnpm symlinks), and `infra/pm2/*.cjs`. The shape is asserted before upload.
3. **Render `shared/.env`** from secrets, piped over SSH stdin (never argv), written via temp file
   - rename with umask 077. **Every** key is written on every run, blank when unused —
     `packages/config` parses a blank value as absent. Omitting a key instead is what broke the
     2026-09-21 cutover: PM2's reload overrides the variables it is given but never deletes one
     that stopped being written, so a dropped `S3_PUBLIC_ENDPOINT` stayed live in the process
     and every presigned URL kept pointing at MinIO (§3). `DATABASE_URL`'s host is
     rewritten to `127.0.0.1:5432`; `REDIS_URL`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `NODE_ENV`
     and `API_PORT` are hardcoded. `SEED_ADMIN_*` is never written.
4. **Upload** the tarball and `infra/deploy/remote-deploy.sh`, then run the script as deploy:
   unpack → start datastores → migrate → flip `current` → `pm2 startOrReload --only
timetrack-api,timetrack-worker,timetrack-dashboard` (never other apps on the daemon) →
   `pm2 save`.
5. **Smoke test:** `/health` and dashboard `/login` respond; `/health/ready` reports database,
   redis and storage `up`; after 10s every app is `online` **with its cwd inside the new
   release** (a stale process on the old release would pass every HTTP probe).
6. **Verdict:** success prunes to 3 releases. Failure prints the app logs, flips `current` back,
   reloads the previous release and exits non-zero. Migrations are forward-only, so rollback
   restores code, not schema.

The `concurrency` group `deploy-production` (shared with `ops-trim-runaway.yml`) serialises
deploys, so two migrations never race.

**Rollback / redeploy:** dispatch the workflow at the commit you want —
`gh workflow run deploy.yml --ref <branch-or-tag>` — or re-run an earlier successful run. Re-running
the SHA that is already live is refused (it would delete the serving release); deploy a different
ref instead. A bad migration needs a new corrective migration; restore from backup only for data loss.

**Rehearsing a branch:** `gh workflow run deploy.yml --ref <branch>` deploys that branch to
production. That is how this pipeline was first proven; it is still production.

`S3_ENDPOINT` vs `S3_PUBLIC_ENDPOINT`: the API reaches MinIO over loopback
(`http://127.0.0.1:9000`), but the dashboard renders screenshots from **presigned URLs the
browser fetches directly** (PRD §7.4), so those URLs must name an origin the browser can
resolve. SigV4 signs the host, so the URL has to be _signed for_ that origin; rewriting it
afterwards yields `SignatureDoesNotMatch`. Hence `S3_PUBLIC_ENDPOINT=https://$PUBLIC_DOMAIN`,
with Caddy routing `/<bucket>/*` to MinIO, path and Host untouched. Get this wrong and every
screenshot renders broken while the rest of the page works. Without a valid, unexpired
signature MinIO answers 403.

### Useful commands (as deploy)

```bash
pm2 ls                                   # every app on the box
pm2 logs timetrack-api --lines 80        # or timetrack-worker / timetrack-dashboard
pm2 reload timetrack-api                 # zero-downtime restart of one app
sudo timetrack-status                    # datastores + queues
readlink -f /srv/timetrack/current       # live release
```

---

## 6. Backups & DR

- **Postgres:** nightly `pg_dump` (or WAL archiving/`pgBackRest` for PITR) to off-box storage; test restores quarterly. Time entries are the payroll record — never on a short retention.
- **MinIO:** replicate the bucket (MinIO mirror/`mc mirror`) or snapshot the volume; screenshots are retention-bounded (default 30d) so backup windows can be short. On external S3 (§3) the bucket is already off the box, and `backup.sh` skips the mirror.
- **Redis:** ephemeral (BullMQ queues) — no backup needed; jobs are idempotent and retried.
- Document RPO/RTO with the customer; encrypt backups at rest and in transit.

### Shipped: `infra/backup.sh` + a systemd timer

`infra/backup.sh` dumps Postgres, copies the dump off-site to S3 (below), and mirrors the MinIO
bucket. `pg_dump` runs **inside** the
container reading its own `POSTGRES_*`, so no credential appears on the host command line or
in `ps`. The dump is verified twice — `gzip -t`, then a grep for pg_dump's own
`PostgreSQL database dump complete` marker, because a dump killed mid-stream still produces a
structurally valid gzip and that is the classic silent backup failure.

Install on the host, **as root** — the datastores are root-managed and `deploy` has no Docker
access. `backup.sh` lives at `/opt/timetrack/` (vm-setup §4); the timer is the one-time step:

```bash
/opt/timetrack/backup.sh   # run once by hand first — do not wait for 02:30 to find out
cp infra/systemd/timetrack-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now timetrack-backup.timer
systemctl list-timers timetrack-backup.timer
journalctl -u timetrack-backup.service -n 50
```

The deploy does not update `/opt/timetrack/backup.sh`; after changing `infra/backup.sh`,
re-install it (`install -m 700 infra/backup.sh /opt/timetrack/`).

Knobs: `BACKUP_DIR` (default `/srv/timetrack/backups`), `KEEP_DAYS` (default 14). Retention prunes
dumps only; the MinIO mirror is a mirror, not a history, and tracks deletions via `--remove`.

**Restore** — the dump is `--clean --if-exists`, so it drops and recreates its own objects:

```bash
gunzip -c /srv/timetrack/backups/postgres/timetrack-<stamp>.sql.gz | \
  docker compose --env-file /opt/timetrack/datastores.env \
    -f /opt/timetrack/docker-compose.datastores.yml exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Test a restore into a scratch database quarterly. **A backup you have never restored is a
hypothesis, not a backup.**

### Off-site copy to S3

The local dumps share a disk with the database: they cover a bad migration, an accidental
delete, or a corrupted table — not losing the VM. So after the dump verifies, `backup.sh`
uploads it to `s3://$BACKUP_S3_BUCKET/postgres/` and touches `backups/postgres/.offsite-last`.
`monitor.yml` reports a missing or stale (> 26h) stamp. Until the `BACKUP_S3_*` secrets are set
the script warns and skips the upload, and the monitor keeps saying so. A failed upload keeps
the local dump, lets the rest of the script run, then fails the unit.

One-time AWS setup. Use a **dedicated** bucket, never the screenshots one: this one is
immutable, while the screenshots bucket must be able to delete for retention and erasure.

1. **Bucket** in the region nearest the VM (e.g. `ap-southeast-1`): Block Public Access on (the
   default), default encryption SSE-S3, **versioning on**, then **Object Lock** with a default
   retention of _Compliance_, 30 days. Compliance, not Governance: a Governance lock can be
   bypassed by any key holding `s3:BypassGovernanceRetention`, while a Compliance lock cannot be
   shortened or removed by anyone, root included — so it holds even if the VM's key is broader
   than step 3's policy.
2. **Lifecycle rule** on the whole bucket: transition to Glacier Instant Retrieval after
   30 days, expire current versions after 365 days, permanently delete noncurrent versions 30
   days after they become noncurrent, and delete incomplete multipart uploads after 1 day.
   Time entries are the payroll record — set the expiry to your payroll retention requirement,
   never shorter.
3. **IAM user** `timetrack-backup`, access key only (no console), with exactly this policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:AbortMultipartUpload"],
         "Resource": "arn:aws:s3:::<backup-bucket>/postgres/*"
       }
     ]
   }
   ```

   It can upload (and abort its own failed multipart upload, which large dumps use) and nothing
   else — no list, no read, no delete — so a compromised VM can
   neither read the archive nor destroy it, and versioning + Object Lock stop an overwrite from
   destroying it either.

   **If you cannot create IAM users** and reuse an existing, broader key instead, backups still
   upload, and the Compliance lock from step 1 still keeps every locked version from being
   deleted. What you lose is containment: that key sits in `shared/.env` on the VPS, and every
   bucket it can reach in the account is exposed to anyone who compromises the box. Treat that
   as a decision for the AWS account owner, and replace it with the scoped user when you can.

4. Add the repository secrets `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY`,
   `BACKUP_S3_SECRET_KEY` and redeploy; the deploy writes them into `shared/.env`.
   `BACKUP_S3_ENDPOINT` is only for a non-AWS S3-compatible store — it defaults to
   `https://s3.<region>.amazonaws.com`.
5. On the host, run `./infra/backup.sh` once by hand and look for `✓ uploaded`, then confirm
   the object exists from your own machine.

**Restore from S3** — from a trusted machine whose credentials can read the bucket (the VM's
key cannot, by design), fetch a dump, copy it to the target host, and restore it as above:

```bash
aws s3 ls s3://<backup-bucket>/postgres/ | tail -5
aws s3 cp s3://<backup-bucket>/postgres/timetrack-<stamp>.sql.gz .
```

---

## 7. Observability

- **Health:** proxy/orchestrator probes `/health` (liveness) and `/health/ready` (dependencies). Unready → pulled from rotation. `/health/ready` checks Postgres, Redis **and** MinIO concurrently, each with a 2s timeout so a black-holed dependency cannot hang the probe, and returns `{"status":"ok","checks":{"database":"up","redis":"up","storage":"up"}}`. On failure it is a 503 naming which dependency is down — with no driver text or connection string in the body. Liveness checks use `/health`, never this route: a transient dependency blip must not get an otherwise-healthy process restarted. The deploy's smoke test is the one caller that requires `/health/ready`.
- **Logs:** Pino JSON to stdout → PM2 log files under `~deploy/.pm2/logs/`, rotated by `pm2-logrotate` → ship to the org's sink (Loki/ELK/CloudWatch). Datastore container logs are capped by `/etc/docker/daemon.json`. `requestId` on every line; redaction enforced (`authorization`, `cookie`, `*.password`, `*.refreshToken`, `*.windowTitle`, raw bytes) — verify redaction in prod config.
- **Alerts:** `.github/workflows/monitor.yml` probes twice a day (00:00 and 12:00 UTC) from OUTSIDE the box (a watchdog on the VM cannot report the VM being gone) and opens a labelled GitHub issue on failure, closing it on recovery. At that cadence an outage can go unnoticed for up to 12 hours — it is a cheap daily health sweep, not an uptime monitor. It covers `/health/ready` and each dependency it names, disk usage, backup freshness and size, worker liveness (PM2 status), datastore container health and per-queue backlog/failure depth (via `sudo timetrack-status`). Not yet covered: partition-provision and retention job outcomes, and a tracking-gap check (no activity samples during work hours) — that one needs holiday/quiet-day tuning before it would be trustworthy.
- **Rate limiting:** `@nestjs/throttler` on auth + batch ingest (already wired) — confirm limits for the deployment size.

---

## 8. macOS client distribution

The client is outside the pnpm graph and ships separately (`PRD §7.1.6`).

- **Build/sign/notarize:** Xcode archive → Developer ID signing → Apple **notarization** → staple. Required for Gatekeeper on employee machines.
- **Permissions:** the app requests **Screen Recording** and **Accessibility** (window titles + idle) — document the grant steps for employees; capture cannot start until granted **and** the policy is acknowledged.
- **Auto-start:** ship as a **LaunchAgent** for login start (default **off**, `PRD §6.1`).
- **Config:** the client is pointed at the deployment's API URL (build config or first-run setup).
- **Updates:** GitHub releases, not Sparkle — that was evaluated and abandoned. Each client polls its own distribution repository's `releases/latest`, verifies the published SHA-256 sidecar, and checks the signing identity before swapping (macOS against its designated requirement; Windows against a publisher-transition rule that refuses signed → unsigned). **The two platforms publish to SEPARATE repositories.** GitHub exposes one `releases/latest` per repository, so a Windows release published alongside the macOS one would become `latest` and every installed Mac client would go silently blind to updates. Nothing in either update path can stop tracking; the strongest state is a visible warning. The always-visible indicator and the `AckGate` are present in **every** build — there is no target that removes them.

---

## 9. Security checklist (pre-go-live)

- [ ] TLS everywhere; HSTS at the proxy; backend not directly exposed (VPN/auth gate).
- [ ] MinIO buckets private; presigned URLs only; short TTL.
- [ ] Strong, rotated secrets; none in the repo; `shared/.env` and `datastores.env` 600.
- [ ] Data encrypted at rest (PG volume + MinIO).
- [ ] Deny-by-default guards live; resource-level authorization verified (the 403 tests pass).
- [ ] Redaction verified in prod logs (no passwords/tokens/window titles/bytes).
- [ ] Retention job running + alerted; erasure tooling tested.
- [ ] Legal/HR sign-off on monitoring notice per employment jurisdiction (`PRD §4`).

# First deploy — provisioning a VPS from scratch

Everything needed to take a Linux VPS to a running TimeTrack deployment, in order, with the
commands. Written from the actual provisioning of the production VPS, which also hosts other
PM2 apps behind its own Caddy — so every step here is written to leave those untouched.

`docs/deployment.md` is the reference for the architecture, the release flow and day-2
operations. **This file is the one-time setup.** After it, deploys are automatic on CI success
on `main` (`.github/workflows/deploy.yml`).

Substitute throughout:

| Placeholder      | Value in production            |
| ---------------- | ------------------------------ |
| `<VM_IP>`        | `144.79.124.51`                |
| `<DOMAIN>`       | `timer.niftyitsolution.com`    |
| `<DEPLOY_USER>`  | `deploy`                       |
| `<DEPLOY_PATH>`  | `/srv/timetrack`               |
| `<OWNER>/<REPO>` | `rashedulhasannifty/timetrack` |

Commands marked **root** run as root on the VPS; everything else as `deploy`.

---

## 0. What you need first

- A VPS with a public, static IP. Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM minimum (production has
  4 / 8 GB and shares it). ~1 GB of disk per retained release (3 are kept) plus the datastores.
- **Node.js 24** and **PM2** installed system-wide, with a `pm2-<user>` systemd unit so PM2
  resurrects on boot (`pm2 startup systemd -u deploy --hp /home/deploy`, then `pm2 save`).
  Node must be the same major the release is built with (`.nvmrc`): argon2 and sharp ship
  native binaries keyed to the Node ABI.
- **Caddy** installed from its apt repo, running as the `caddy` systemd service.
- UFW allowing only 22, 80 and 443.
- A domain you control, pointing at the VPS.
- Push access to the repo (enough to set Actions secrets with `gh`).

Images are **not** built anywhere: Actions builds a release tarball and the VPS only unpacks it.

---

## 1. DNS

Create an **A record** for `<DOMAIN>` → `<VM_IP>` and confirm it resolves before adding the
Caddy block (§7) — Caddy cannot get a certificate for a name that doesn't point at it, and
repeated failed attempts count against Let's Encrypt's rate limit:

```bash
dig +short <DOMAIN>       # must print <VM_IP> (or Cloudflare IPs if proxied)
```

If the record is **proxied through Cloudflare**, the zone's SSL/TLS mode must be **Full** or
**Full (strict)** — Flexible sends plain HTTP to Caddy, which redirects to HTTPS, forever.
Screenshot responses carry `Cache-Control: private, no-store`, so Cloudflare will not cache them.

---

## 2. Docker (root)

For the datastores only. Use the **official Docker repo** — Ubuntu's `docker.io` ships Compose
v1, which cannot parse `name:` or `--profile`.

```bash
apt-get update && apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list

# Cap container logs before the first container exists — the default json-file log is unbounded.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version    # must report v2+
```

**Do not add `deploy` to the `docker` group.** It is root-equivalent, and `deploy`'s SSH key is
a GitHub secret. §4 gives it the two things it actually needs through sudo instead.

> Docker-published ports bypass UFW. That is why the datastores compose file publishes on
> `127.0.0.1` only — never change a port there to a bare `'5432:5432'`.

---

## 3. The deploy user and directory

If the VPS doesn't already have one (production does, for the other PM2 apps):

```bash
adduser --disabled-password --gecos "" deploy     # root; key-only login
```

The deploy root (root creates it, `deploy` owns it; `shared/` holds the env file):

```bash
install -d -m 755 -o deploy -g deploy /srv/timetrack /srv/timetrack/releases /srv/timetrack/tmp
install -d -m 700 -o deploy -g deploy /srv/timetrack/shared
```

---

## 4. Datastores unit, status script, sudoers (root)

From a checkout of the repo, copy these to the VPS (e.g. `scp -r infra root@<VM_IP>:/tmp/`), then:

```bash
cd /tmp/infra
install -d -m 755 /opt/timetrack
install -m 644 datastores/docker-compose.datastores.yml /opt/timetrack/
install -m 700 datastores/datastores-env.sh             /opt/timetrack/
install -m 700 backup.sh                                /opt/timetrack/
install -m 755 datastores/timetrack-status.sh           /usr/local/bin/timetrack-status
install -m 644 systemd/timetrack-datastores.service     /etc/systemd/system/

visudo -cf datastores/sudoers && install -m 440 datastores/sudoers /etc/sudoers.d/timetrack

systemctl daemon-reload
systemctl enable timetrack-datastores.service    # enable only — do NOT start yet
```

Don't start it: it renders its credentials from `/srv/timetrack/shared/.env`, which the first
deploy writes. The deploy then starts it through sudo.

Pre-pulling the images makes the first deploy faster (optional):

```bash
for i in postgres:18-alpine redis:8-alpine quay.io/minio/minio:latest quay.io/minio/mc:latest; do docker pull -q $i; done
```

---

## 5. SSH key for CI and the Actions secrets

A dedicated key for this repo's deploys — never a personal key, and never shared with another
app's pipeline:

```bash
ssh-keygen -t ed25519 -f ./timetrack_deploy -N "" -C "timetrack-github-actions-deploy"
cat timetrack_deploy.pub >> /home/deploy/.ssh/authorized_keys     # on the VPS, as deploy
ssh -i ./timetrack_deploy -o IdentitiesOnly=yes deploy@<VM_IP> whoami   # from your machine: "deploy"
gh secret set SSH_KEY -R <OWNER>/<REPO> < ./timetrack_deploy
rm ./timetrack_deploy        # the secret is now the only copy; rotate by repeating this section
```

Generate random values first. **Hex, not base64, for anything embedded in a URL** — a `/` inside
`DATABASE_URL`'s userinfo breaks parsing and surfaces as an opaque Prisma error:

```bash
openssl rand -hex 32      # POSTGRES_PASSWORD
openssl rand -hex 32      # MINIO_ROOT_PASSWORD
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET   (must differ)
openssl rand -base64 48   # DASHBOARD_SESSION_SECRET
```

Set each with `printf '%s' '<value>' | gh secret set <NAME> -R <OWNER>/<REPO>`.

| Group    | Secret                                                                | Value                                                                          |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Host     | `SSH_HOST`                                                            | `<VM_IP>`                                                                      |
|          | `SSH_USER`                                                            | `deploy`                                                                       |
|          | `SSH_PORT`                                                            | `22`                                                                           |
|          | `DEPLOY_PATH`                                                         | `/srv/timetrack` — no trailing slash                                           |
| Postgres | `POSTGRES_USER`, `POSTGRES_DB`                                        | `timetrack`                                                                    |
|          | `POSTGRES_PASSWORD`                                                   | the hex value                                                                  |
|          | `DATABASE_URL`                                                        | `postgresql://timetrack:<same hex>@postgres:5432/timetrack?schema=public`      |
| Auth     | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DASHBOARD_SESSION_SECRET` | the base64 values                                                              |
| Storage  | `MINIO_ROOT_USER`, `S3_ACCESS_KEY`                                    | `timetrack` (identical)                                                        |
|          | `MINIO_ROOT_PASSWORD`, `S3_SECRET_KEY`                                | the same hex value (identical)                                                 |
|          | `S3_BUCKET`                                                           | `timetrack-screenshots` — must match the path in `infra/caddy/timetrack.caddy` |
| URLs     | `API_URL`, `APP_URL`, `CORS_ORIGINS`                                  | `https://<DOMAIN>`                                                             |
|          | `PUBLIC_DOMAIN`                                                       | `<DOMAIN>` — **no scheme**                                                     |

`DATABASE_URL`'s host is rewritten to `127.0.0.1:5432` when the deploy renders the env file, so
whatever host the secret names (`postgres` historically) is fine; credentials and database are
kept exactly as given.

`APP_URL` is the base of every invitation accept link. The API **refuses to boot** if it is still
the localhost default under `NODE_ENV=production`.

**Email — SMTP (5, all-or-nothing):** `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS / 465 TLS),
`SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (`Time Tracker <noreply@example.com>`, **no quotes** —
GitHub stores values literally). With AWS SES, `SMTP_PASS` is the SES **SMTP password**, not the
IAM secret. Skip the group to deploy without email: invites are then created but never delivered.

**Do not create** `INVITE_TTL_DAYS` (unset = 7) or the five `OIDC_*` (unset = SSO off) unless you
mean it — a **partial** group is what breaks the boot; the workflow omits a group whose secrets
are empty. Also not secrets, hardcoded by the workflow: `NODE_ENV`, `LOG_LEVEL`, `REDIS_URL`,
`S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `API_PORT`. `ACME_EMAIL` and `SEED_ADMIN_*` are
no longer read by the deploy.

---

## 6. First deploy

Trigger it by hand (or merge to `main` and let CI trigger it):

```bash
gh workflow run deploy.yml -R <OWNER>/<REPO> --ref main
gh run watch -R <OWNER>/<REPO>
```

The workflow: install + build → assemble the release tarball → write `shared/.env` (mode 600) →
upload → `remote-deploy.sh`: start the datastores unit (first run initialises the volumes from
the env) → `prisma migrate deploy` → flip `current` → `pm2 startOrReload` → smoke test
`/health/ready`, the dashboard, and that every PM2 app is online on the new release.

Then confirm, as deploy on the VPS:

```bash
pm2 ls                      # timetrack-api, -worker, -dashboard online, next to the other apps
sudo timetrack-status       # postgres/redis/minio healthy, BullMQ queues listed
```

---

## 7. Caddy site block (root)

Only once DNS resolves (§1). The host's Caddyfile is shared with other sites, so append, validate
the **combined** file before installing it, and reload (graceful — other sites keep serving):

```bash
cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date -u +%Y%m%d-%H%M%S)
cat /etc/caddy/Caddyfile <(echo) /tmp/infra/caddy/timetrack.caddy > /tmp/Caddyfile.new
caddy validate --config /tmp/Caddyfile.new --adapter caddyfile
install -m 644 /tmp/Caddyfile.new /etc/caddy/Caddyfile
systemctl reload caddy
journalctl -u caddy -f | grep -i certificate     # expect "certificate obtained successfully"
```

---

## 8. Seed the first admin

The deploy deliberately does not seed — it is first-deploy-only. As deploy, with the credentials
passed through the environment (never on a command line):

```bash
read -r  -p 'admin email: '    SEED_ADMIN_EMAIL
read -rs -p 'admin password: ' SEED_ADMIN_PASSWORD; echo
export SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD
cd /srv/timetrack/current/api/node_modules/@timetrack/db
node /srv/timetrack/shared/with-env.cjs /srv/timetrack/shared/.env node_modules/.bin/tsx prisma/seed.ts
unset SEED_ADMIN_PASSWORD
```

Expect `seeded team …` and `seeded admin …`.

---

## 9. Verify

```bash
curl -sS https://<DOMAIN>/health            # {"status":"ok"}
curl -sS https://<DOMAIN>/health/ready      # database + redis + storage all "up"
curl -sSI https://<DOMAIN>/api/auth/refresh | grep -i location    # want: /login (relative)
curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/<S3_BUCKET>/    # want: 403 (private)
for p in 3001 3100 5432 6379 9000; do nc -z -G 5 <VM_IP> $p && echo "EXPOSED $p"; done   # want: nothing
```

Then in a browser: sign in as the seeded admin, **rotate that password immediately**, and invite
a real address. That is the only thing that exercises the SMTP credential — every automated test
mocks the transport. If the invite doesn't arrive, `pm2 logs timetrack-worker` distinguishes an
auth failure from an unverified `MAIL_FROM` identity.

---

## 10. Backups

Not automatic. `backup.sh` and the unit files are already under `/opt/timetrack/` from §4
(details in `docs/deployment.md` §6). As root:

```bash
/opt/timetrack/backup.sh                     # run once by hand — do not wait for 02:30 to find out
cp /tmp/infra/systemd/timetrack-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now timetrack-backup.timer
systemctl list-timers timetrack-backup.timer
```

Dumps stay on this VPS's disk until the `BACKUP_S3_*` secrets are set. Without them, losing the
VPS loses the backups too.

---

## 11. The macOS client

Packaged separately, and only once the API is confirmed up:

```bash
cd apps/client-macos && ./scripts/package-app.sh
```

It defaults to the production deployment. Then sign and notarize per `SIGNING.md`. A client
already installed keeps whatever URL it was packaged with — clients pin the hostname, which is
why a server move keeps `<DOMAIN>`.

---

## Troubleshooting

| Symptom                                                      | Cause                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy: `sudo: a password is required`                       | `/etc/sudoers.d/timetrack` missing or the unit path differs (§4). The rule allows exactly `systemctl start timetrack-datastores.service`.   |
| Deploy: `datastores-env.sh: … missing or empty`              | A required secret (`POSTGRES_*`, `MINIO_ROOT_*`, `S3_BUCKET`) is unset.                                                                     |
| Migrations: `P1000` authentication failed                    | The Postgres volume was initialised with a different password. The password lives in the volume; editing the secret does not change it.     |
| Smoke test: `a PM2 app is not online on <sha>`               | `pm2 logs timetrack-<app> --lines 80`. A Zod env error at boot names the variable. The previous release was restored.                       |
| Build: `PrismaConfigEnvError: Cannot resolve … DATABASE_URL` | `prisma generate` loads `prisma.config.ts` at build time. The workflow sets a throwaway value on the Build step; don't remove it.           |
| Boot: `Cannot find module …` in the dashboard                | The standalone tree was copied with `cp -r`, dereferencing pnpm symlinks. It must be `cp -a`.                                               |
| Screenshots render broken, rest of the page fine             | `S3_PUBLIC_ENDPOINT` wrong, or the Caddy `/<bucket>/*` path doesn't match `S3_BUCKET`. `SignatureDoesNotMatch` in the response confirms it. |
| TLS never issues                                             | Port 80 blocked, DNS not pointing here yet, or (proxied) Cloudflare SSL mode is Flexible.                                                   |
| `/health/ready` 503                                          | One of Postgres/Redis/MinIO is unreachable; the body names which. `sudo timetrack-status`.                                                  |

### Useful commands

```bash
pm2 ls                                              # every app on the box
pm2 logs timetrack-api --lines 60                   # or timetrack-worker / timetrack-dashboard
sudo timetrack-status                               # datastore health + queue depths
readlink -f /srv/timetrack/current                  # the live release
cut -d= -f1 /srv/timetrack/shared/.env | sort       # which keys rendered (names only)

# root only:
docker compose --env-file /opt/timetrack/datastores.env \
  -f /opt/timetrack/docker-compose.datastores.yml ps
```

---

## Security checklist

- [ ] Deploy key is dedicated to this repo, and `deploy` is **not** in the `docker` group
- [ ] `shared/.env` and `/opt/timetrack/datastores.env` are mode 600
- [ ] Only 22/80/443 open publicly; the datastores publish on `127.0.0.1` only (verified in §9)
- [ ] Seed admin password rotated after first login
- [ ] Secrets never committed; `.env*` is gitignored
- [ ] `POSTGRES_PASSWORD` / `MINIO_ROOT_PASSWORD` recorded somewhere safe — they are baked into
      the data volumes at initialisation and **cannot be rotated by editing a secret**
- [ ] Backups running, and a restore tested at least once

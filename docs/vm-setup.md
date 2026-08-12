# First deploy — provisioning a VM from scratch

Everything needed to take a brand-new Linux VM to a running TimeTrack deployment, in order,
with the commands. Written from an actual Azure provisioning run, so the traps called out here
are ones that really bit, not hypotheticals.

`docs/deployment.md` is the reference for the architecture, the release flow and day-2
operations. **This file is the one-time setup.** After it, deploys are automatic on push to
`main` (`.github/workflows/deploy.yml`).

Substitute throughout:

| Placeholder      | Example used here              |
| ---------------- | ------------------------------ |
| `<VM_IP>`        | `20.6.73.106`                  |
| `<DOMAIN>`       | `timer.niftyitsolution.com`    |
| `<DEPLOY_USER>`  | `deploy`                       |
| `<DEPLOY_PATH>`  | `/home/deploy/timetrack`       |
| `<OWNER>/<REPO>` | `rashedulhasansojib/timetrack` |

---

## 0. What you need first

- A VM with a **public IP**, 2 vCPU / 4 GB RAM, 30 GB+ disk. Ubuntu 24.04 LTS.
  4 GB is comfortable because images are built in CI, not on the box — see §6.
- A **domain** you control, pointing at the VM.
- Admin on the GitHub repo (to add secrets).
- If sending invitation email: SMTP credentials whose `MAIL_FROM` identity is verified with
  the provider.

> **Sizing note.** Images come from GHCR, so the VM never runs `pnpm install`/`pnpm build`.
> It needs room for the datastores and three pulled images — not the ~13 GB of build headroom
> a from-source build would need.

---

## 1. Network: open 80 and 443

A fresh cloud VM allows **SSH only**. Caddy's Let's Encrypt HTTP-01 challenge needs inbound
**80**, so this is the single most common reason a deployment ends up "healthy but no TLS".

Azure portal → VM → **Networking** → Add inbound port rule, twice:

| Priority | Port | Protocol | Name        |
| -------- | ---- | -------- | ----------- |
| 310      | 80   | TCP      | Allow-HTTP  |
| 320      | 443  | TCP      | Allow-HTTPS |

Or with the CLI:

```bash
az network nsg rule create -g <RG> --nsg-name <NSG> -n Allow-HTTP \
  --priority 310 --destination-port-ranges 80  --access Allow --protocol Tcp
az network nsg rule create -g <RG> --nsg-name <NSG> -n Allow-HTTPS \
  --priority 320 --destination-port-ranges 443 --access Allow --protocol Tcp
```

**Check for two NSGs.** One can be attached to the NIC and another to the subnet; either one
blocking is enough. The NSG blade says which — "Impacts N subnets, N network interfaces".

The `443/udp` (HTTP/3) rule in the compose file is optional. TCP 443 is sufficient.

### Verify — and read the failure mode correctly

```bash
for p in 22 80 443; do nc -z -G 8 -v <VM_IP> $p; done
```

Before the stack is running you want **`Connection refused` within ~100ms** on 80 and 443.
That means the packet reached the host and the host rejected it because nothing is listening
yet — the NSG is open. A **timeout** (~8s, no response) means the NSG is still blocking.
These look similar in a browser and are completely different problems.

### Static IP

```bash
az network public-ip show -g <RG> -n <IP_NAME> --query publicIPAllocationMethod   # want "Static"
```

A dynamic IP that changes on reboot breaks TLS renewal _and_ every shipped Mac client, which
pins the hostname.

---

## 2. DNS

Create an **A record** for `<DOMAIN>` → `<VM_IP>`, then confirm it resolves before starting
the stack — Caddy cannot get a certificate for a name that doesn't point at it:

```bash
dig +short <DOMAIN>       # must print <VM_IP>
```

Allow for propagation. If you are moving an existing domain to a new VM, this is the step
people forget: the old IP will keep answering until TTL expires.

---

## 3. Docker

Use the **official Docker repo**. Ubuntu's `docker.io` ships Compose v1, which cannot parse
this project's compose file (`name:` and `--profile` are v2 features).

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

docker compose version    # must report v2.x
```

---

## 4. The deploy user

CI logs in as this user. Give it its own account: the `SSH_KEY` secret grants a shell on
production to anyone who can write to the repo, so it must never be your personal key.

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy          # so it can talk to the Docker daemon
sudo mkdir -p /home/deploy/.ssh && sudo chmod 700 /home/deploy/.ssh
```

`--disabled-password` means key-only login — there is no password to brute-force.

### The deploy directory

The workflow scp's `docker-compose.prod.yml` and `Caddyfile` into `<DEPLOY_PATH>/infra/`, and
renders `.env.prod` one level up at `<DEPLOY_PATH>/.env.prod`. That layout is required: the
compose file references `env_file: ['../.env.prod']` and mounts `./Caddyfile`, both relative
to itself.

```bash
sudo -u deploy mkdir -p /home/deploy/timetrack/infra
```

The workflow does **not** create this. A missing directory fails the scp step.

---

## 5. SSH key for CI

Generate it on the machine that will enter the secrets (your laptop), so the private half
never has to travel.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/timetrack_deploy -N "" -C "timetrack-deploy"
cat ~/.ssh/timetrack_deploy.pub
```

Install the **public** half on the VM:

```bash
sudo tee -a /home/deploy/.ssh/authorized_keys <<< "<paste the ssh-ed25519 ... line>"
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
```

Verify from your laptop before going further — both outputs matter:

```bash
ssh -i ~/.ssh/timetrack_deploy deploy@<VM_IP> 'whoami && docker compose version && id'
```

Expect `deploy`, a Compose **v2** version, and `docker` in the group list. If `docker` is
missing, the group change hasn't applied — log out and back in, or re-run `usermod`.

> If you generate the key somewhere other than your laptop, copy it with `scp`; do not paste
> a private key through a terminal, which mangles the line breaks.

---

## 6. Do you need a git deploy key? Usually not

**No, for the normal path.** Images are built in GitHub Actions and pushed to GHCR; the VM
only pulls them, authenticating with the workflow's own `GITHUB_TOKEN`. It never sees the
source, so it needs no repo access at all.

**Yes, if you plan to build on the VM** — the fallback when Actions is unavailable (out of
minutes, an outage). Then the VM needs a checkout:

```bash
# On the VM, as deploy:
ssh-keygen -t ed25519 -C "timetrack-vm" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add that to GitHub → repo → **Settings → Deploy keys → Add deploy key**, **read-only**. Then:

```bash
ssh -T git@github.com          # expect a "successfully authenticated" greeting
git clone git@github.com:<OWNER>/<REPO>.git ~/timetrack
```

> Use `git@github.com`. If your laptop's `~/.ssh/config` defines aliases like
> `github.com-personal`, those exist only there — on the VM they resolve to nothing.

Building on the VM also wants swap on a 4 GB box:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 7. GitHub Actions secrets

29 secrets. GitHub → repo → **Settings → Secrets and variables → Actions → New repository
secret**. `GITHUB_TOKEN` is automatic — do not create it.

Generate the random values first. **Hex, not base64, for anything embedded in a URL** — a `/`
inside `DATABASE_URL`'s userinfo breaks parsing and surfaces as an opaque Prisma error:

```bash
openssl rand -hex 32      # POSTGRES_PASSWORD
openssl rand -hex 32      # MINIO_ROOT_PASSWORD
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET   (must differ)
openssl rand -base64 48   # DASHBOARD_SESSION_SECRET
```

### Host access (5)

| Secret        | Value                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| `SSH_HOST`    | `<VM_IP>`                                                              |
| `SSH_USER`    | `deploy`                                                               |
| `SSH_KEY`     | the **whole** private key file, `-----BEGIN…` to `-----END…` inclusive |
| `SSH_PORT`    | `22`                                                                   |
| `DEPLOY_PATH` | `/home/deploy/timetrack` — no trailing slash                           |

For `SSH_KEY`, pipe from the file rather than pasting: `gh secret set SSH_KEY < ~/.ssh/timetrack_deploy`.
If pasting in the browser, press Enter once after the `-----END-----` line; a missing trailing
newline reads as an invalid key.

### Postgres (4)

| Secret              | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| `POSTGRES_USER`     | `timetrack`                                                               |
| `POSTGRES_PASSWORD` | the hex value                                                             |
| `POSTGRES_DB`       | `timetrack`                                                               |
| `DATABASE_URL`      | `postgresql://timetrack:<same hex>@postgres:5432/timetrack?schema=public` |

Host is `postgres` — the compose service name, not `localhost`.

### Auth (3)

`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DASHBOARD_SESSION_SECRET` — the base64 values.

### Storage (5)

`S3_*` must equal the `MINIO_ROOT_*` pair; that is how the app authenticates to MinIO.

| Secret                                 | Value                          |
| -------------------------------------- | ------------------------------ |
| `MINIO_ROOT_USER`, `S3_ACCESS_KEY`     | `timetrack` (identical)        |
| `MINIO_ROOT_PASSWORD`, `S3_SECRET_KEY` | the same hex value (identical) |
| `S3_BUCKET`                            | `timetrack-screenshots`        |

### URLs (5)

| Secret          | Value                      |
| --------------- | -------------------------- |
| `API_URL`       | `https://<DOMAIN>`         |
| `APP_URL`       | `https://<DOMAIN>`         |
| `CORS_ORIGINS`  | `https://<DOMAIN>`         |
| `PUBLIC_DOMAIN` | `<DOMAIN>` — **no scheme** |
| `ACME_EMAIL`    | your ops email             |

`APP_URL` is the base of every invitation accept link. The API **refuses to boot** if it is
still the localhost default under `NODE_ENV=production` — deliberately, because the
alternative is silently mailing employees unreachable links.

### Bootstrap admin (2)

`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (min 8 chars). Set these **before** the first
deploy: the seed step in §9 reads them from the rendered `.env.prod`, and without them there
is no account to log in with. You can delete them after first login.

### Email — SMTP (5, all-or-nothing)

| Secret      | Value                                                |
| ----------- | ---------------------------------------------------- |
| `SMTP_HOST` | e.g. `email-smtp.ap-southeast-1.amazonaws.com`       |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (implicit TLS)             |
| `SMTP_USER` | SMTP username                                        |
| `SMTP_PASS` | SMTP password                                        |
| `MAIL_FROM` | `Time Tracker <noreply@example.com>` — **no quotes** |

Set all five or none. With AWS SES, `SMTP_PASS` is the SES **SMTP password**, which is derived
from an IAM secret key and is not the same string. Values go in unquoted: GitHub stores them
literally, unlike a `.env` file, so quotes would become part of the value.

Skip the group entirely to deploy without email — invitations are then created but never
delivered, and the worker logs an error.

### Do not create

`INVITE_TTL_DAYS` (unset = 7) and the five `OIDC_*` (unset = SSO off). A **partial** group is
what breaks the boot; the workflow omits a group entirely when its secrets are empty.

Also not secrets — the workflow hardcodes them: `NODE_ENV`, `LOG_LEVEL`, `REDIS_URL`,
`S3_ENDPOINT`, `S3_REGION`, `API_PORT`. `NODE_ENV=production` especially: the schema defaults
to `development`, where the API returns raw invite tokens in its responses.

### Verify

```bash
gh secret list --repo <OWNER>/<REPO> | wc -l    # 29 (24 without the SMTP group)
```

---

## 8. First deploy

Push to `main`, or trigger it by hand:

```bash
gh workflow run deploy.yml
gh run watch
```

The workflow: quality gate → build the three images and push to GHCR → scp compose +
Caddyfile → render `.env.prod` (mode 600) → `prisma migrate deploy` → `up -d` → probe the
API's `/health`.

Watch Caddy obtain the certificate:

```bash
ssh -i ~/.ssh/timetrack_deploy deploy@<VM_IP>
cd <DEPLOY_PATH>
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml logs -f proxy
```

---

## 9. Seed the first admin

The workflow runs migrations but **deliberately not the seed** — it is first-deploy-only.

```bash
cd <DEPLOY_PATH>
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml \
  --profile setup run --rm seed
```

> Corepack may prompt `Do you want to continue? [Y/n]` on first run. Answer `y`. In a
> non-interactive context set `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.

Expect `seeded team …` and `seeded admin …`.

---

## 10. Verify

```bash
curl -sS https://<DOMAIN>/health            # {"status":"ok"}
curl -sS https://<DOMAIN>/health/ready      # database + redis + storage all "up"
curl -sSI https://<DOMAIN>/api/auth/refresh | grep -i location   # want: /login (relative)
curl -sSL -o /dev/null -w '%{url_effective}\n' https://<DOMAIN>/   # want: https://<DOMAIN>/login
```

Then in a browser: sign in as `SEED_ADMIN_EMAIL`, **rotate that password immediately**, and
invite a real address. That last step is the only thing that exercises the SMTP credential —
every automated test mocks the transport.

If the invite doesn't arrive, `docker compose … logs worker` distinguishes an auth failure
from an unverified `MAIL_FROM` identity.

---

## 11. Backups

Not automatic. Install the timer (details in `docs/deployment.md` §6):

```bash
cd <DEPLOY_PATH>
chmod +x infra/backup.sh
./infra/backup.sh                       # run once by hand — do not wait for 02:30 to find out
sudo cp infra/systemd/timetrack-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now timetrack-backup.timer
systemctl list-timers timetrack-backup.timer
```

The unit file assumes user `deploy` and `/home/deploy/timetrack`; edit it if yours differ.

---

## 12. The macOS client

Packaged separately, and only once the API is confirmed up:

```bash
cd apps/client-macos && ./scripts/package-app.sh
```

It defaults to the production deployment. Then sign and notarize per `SIGNING.md`. A client
already installed on someone's Mac keeps whatever URL it was packaged with — this does not
retarget an existing fleet.

---

## Troubleshooting

| Symptom                                                                                | Cause                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| scp step: `can't connect without a private SSH key or password`                        | `SSH_KEY` empty or not set. Actions omits empty inputs, so the step logs no `host:`/`key:` at all.                                              |
| Deploy: `dependency failed to start: container … is unhealthy`                         | The API failed its healthcheck. Check `logs api` — if it shows `Nest application successfully started`, the app is fine and the probe is wrong. |
| Browser lands on `localhost:3000`                                                      | A redirect built its origin from `req.url`. Redirects must emit a relative `Location`.                                                          |
| Image build: `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL` | `prisma generate` loads `prisma.config.ts` at build time. The Dockerfiles set a throwaway build-stage value; don't remove it.                   |
| TLS never issues                                                                       | Port 80 blocked, or DNS not pointing here yet. Both must be true before Caddy starts.                                                           |
| `/health/ready` 503                                                                    | One of Postgres/Redis/MinIO is unreachable; the body names which.                                                                               |

### Useful commands

```bash
cd <DEPLOY_PATH>
C="docker compose --env-file .env.prod -f infra/docker-compose.prod.yml"

$C ps                                    # container status incl. health
$C logs --tail=60 api                    # or worker / dashboard / proxy
docker inspect --format '{{json .State.Health}}' timetrack-prod-api-1
cut -d= -f1 .env.prod | grep . | sort    # which keys rendered (names only, no values)
```

---

## Security checklist

- [ ] Deploy user is dedicated, key-only, and its key is not your personal key
- [ ] `.env.prod` is mode 600 (the workflow does this; verify after any manual edit)
- [ ] Only 80/443 are open publicly — Postgres, Redis and MinIO publish no ports
- [ ] Seed admin password rotated after first login
- [ ] Secrets never committed; `.env.prod` is gitignored and dockerignored
- [ ] `POSTGRES_PASSWORD` / `MINIO_ROOT_PASSWORD` recorded somewhere safe — they are baked
      into the data volumes at initialisation and **cannot be rotated by editing a secret**
- [ ] Backups running, and a restore tested at least once

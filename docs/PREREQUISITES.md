# External prerequisites — what you need, when, and why

Everything the project needs that is **not code and requires your action** — accounts,
certificates, credentials, infrastructure, third-party services. Code and local dev need
none of this; these are the things with **lead times** and/or **cost**, so procure them
_ahead_ of the milestone that needs them.

Legend: **When** is the earliest milestone that needs it (phases per `docs/ROADMAP.md`).

## Summary

| Item                          | When                                                | Lead time                            | Cost       | Why                                                          |
| ----------------------------- | --------------------------------------------------- | ------------------------------------ | ---------- | ------------------------------------------------------------ |
| Local dev (Docker)            | Now                                                 | none                                 | free       | Run api/worker/dashboard + Postgres/Redis/MinIO locally      |
| **Apple Developer Program**   | Client distribution (end of Phase 1 / pilot)        | **1–2 days (indiv), longer for org** | **$99/yr** | Required for the Developer ID cert + notarization            |
| Developer ID Application cert | Client distribution                                 | minutes (after #1)                   | free       | Signs the `.app` so Gatekeeper runs it                       |
| Notarization credentials      | Client distribution                                 | minutes                              | free       | Apple notary service accepts the build                       |
| Real bundle identifier        | Client distribution                                 | —                                    | free       | Stable app identity (replaces the placeholder)               |
| SMTP / email provider         | Invites & reminders (Phase 1 real emails → Phase 3) | mins–days (DNS/DKIM)                 | free–$     | Invite emails, weekly summaries, missing-timesheet reminders |
| A host / VM                   | First deploy                                        | minutes                              | $          | Runs the stack (PRD: one small VM for 50 users)              |
| Domain name                   | First deploy                                        | mins–hours                           | $          | TLS + a stable API/dashboard origin                          |
| TLS certificate               | First deploy                                        | automatic                            | free       | HTTPS everywhere (Caddy/Let's Encrypt auto-issues)           |
| Off-box backup target         | First deploy (before real data)                     | minutes                              | $          | Postgres dumps + MinIO mirror (payroll = system of record)   |
| Log sink (optional)           | First deploy                                        | minutes                              | free–$     | Ship Pino JSON somewhere queryable                           |
| SSO Identity Provider         | Phase 4                                             | depends on org                       | varies     | OIDC/SAML login (the customer's IdP)                         |
| Sparkle update signing        | Deferred (post-Phase 1)                             | minutes                              | free       | Signed auto-updates (EdDSA keys + appcast hosting)           |

---

## Now — local development (no external anything)

`pnpm install` + `pnpm infra:up` (Docker: Postgres 18, Redis 8, MinIO) + `pnpm dev`. The
macOS client builds and **ad-hoc signs** for local testing with no Apple account. Nothing
to procure to start Phase 1.

## Email / SMTP — invites and notifications

- **What:** an SMTP endpoint or transactional-email provider (e.g. a self-hosted relay, or
  Postmark/SES/Resend/etc.), plus the sender domain's **SPF/DKIM/DMARC** DNS records.
- **When:** Phase 1 invites work with a **dev-token fallback** (no email needed), so you can
  defer this. You need it for _real_ invite emails and definitely by **Phase 3** (weekly
  manager summaries, missing-timesheet reminders).
- **Why:** the worker's `email` queue delivers these; without SMTP they can't send.
- **Lead time:** the account is instant, but **DNS/DKIM verification can take hours–days** —
  set it up before you rely on deliverability.
- **Plugs in:** SMTP config → `packages/config` env + `.env.example`; sender/DNS is yours.

## Deployment — first deploy (staging or pilot)

Per `docs/deployment.md` (self-hosted, one VM). Procure before you put real data in:

- **A host/VM** with Docker (Linux). PRD target: one small VM for ~50 users.
- **A domain name** pointed at the VM (an A record).
- **TLS** — automatic via Caddy/Let's Encrypt once the domain resolves; nothing to buy.
- **Production secrets** — strong 32+ char `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, real
  DB/Redis/MinIO creds, in a root-owned `.env.prod` (never committed).
- **Off-box backup target** — somewhere to send nightly `pg_dump` + a MinIO mirror. Time
  entries are the payroll record — have this **before** real usage.
- **(Optional) log sink + alerting** — Loki/ELK/CloudWatch for Pino JSON; alerts on
  `/health/ready`, the retention/partition jobs, and disk usage.

## macOS client distribution — sign + notarize

Needed when you hand the client to real employees (see `apps/client-macos/SIGNING.md` for
the exact commands). **Start the Apple enrollment early — it's the longest lead time here.**

1. **Apple Developer Program** — $99/yr; Individual ~1–2 days, Organization needs a D-U-N-S
   number and can take longer.
2. **Developer ID Application** certificate (Xcode → Accounts → Manage Certificates), in your
   login keychain.
3. **Team ID** (10-char, from Membership).
4. **Notarization credentials** — either an **app-specific password** (own-Mac signing) or an
   **App Store Connect API key** (`.p8` + Key ID + Issuer ID — use this for CI).
5. **A real bundle identifier** (e.g. `com.yourorg.timetrack`) to replace the placeholder in
   `Info.plist`.

_Why each:_ the Developer ID cert + notarization are what let Gatekeeper run the app on
machines that aren't yours; without them employees get a "cannot be opened" block.

## SSO — Phase 4

- **What:** the customer's **OIDC** (preferred) or **SAML** Identity Provider — issuer URL,
  client ID/secret, and an allowed redirect URI you register with them.
- **When:** Phase 4 (`docs/plans/phase-4-sso-admin.md`).
- **Why:** enterprise login + provisioning; maps SSO identities to team/role.
- **Plugs in:** OIDC config → `packages/config` env + `.env.example`.

## Auto-updates (Sparkle) — deferred

When you add signed auto-updates: generate an **EdDSA key pair** (`generate_keys`), ship the
public key in `Info.plist` (`SUPublicEDKey`), and host a signed `appcast.xml` + release
archives somewhere reachable. Not needed for Phase 1.

---

## Start these now (longest lead times)

1. **Apple Developer Program enrollment** — even if you won't distribute the client for
   weeks; the 1–2 day (or longer, for org) wait is the critical path.
2. **A sender domain + DKIM** if you'll send real email — DNS propagation isn't instant.
3. **Decide the bundle identifier** and the production domain — cheap, and everything
   downstream references them.

Everything else can be procured just-in-time for its milestone.

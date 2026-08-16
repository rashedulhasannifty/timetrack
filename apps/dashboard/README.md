# Nifty Timer dashboard

Next.js 16 (App Router, React 19) + Tailwind 4. The manager/admin web UI.

## Environment

Server code reads three vars: `API_URL`, `DASHBOARD_SESSION_SECRET`, `NODE_ENV`.

- **`API_URL`** — base origin of the NestJS API (e.g. `http://localhost:3001`). The
  typed api-client appends `/v1`.
- **`DASHBOARD_SESSION_SECRET`** — **≥ 32 chars.** SHA-256'd into the AES-256-GCM key
  that encrypts the httpOnly session cookie (`lib/session-cookie.ts`). If it's unset or
  too short, `POST /api/auth/login` throws 500 and you bounce back to `/login` even
  though the API login itself succeeded. Never exposed to the browser; never `NEXT_PUBLIC_*`.

### Where these come from

The **repo-root `.env`** is the single source of truth, shared with `api`/`worker`.
`next.config.ts` loads it at startup and fills any var not already set, so you do **not**
keep a duplicate copy here.

Why this is needed: `next dev` runs with its cwd in `apps/dashboard`, so Next only
auto-loads env files in _this_ directory — the repo-root `.env` is otherwise invisible to
it. The loader in `next.config.ts` bridges that gap. Precedence is preserved: a var
already set in the real environment, or in a local `apps/dashboard/.env.local`, always
wins; the root `.env` only fills what's missing.

**Env changes require a dev-server restart** — Next reads env (and `next.config.ts`) only
at boot. After editing root `.env`, restart `pnpm dev` (or
`pnpm --filter @timetrack/dashboard dev`).

For local overrides you don't want in the shared file, create `apps/dashboard/.env.local`
(gitignored) — it takes precedence over root `.env`.

## Run

```bash
pnpm --filter @timetrack/dashboard dev     # :3000  (needs the API on :3001)
```

Or the whole stack from the repo root: `pnpm dev`.

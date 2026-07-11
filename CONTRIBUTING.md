# Contributing to TimeTrack

This is the human entry point. The full engineering rules live in [`CLAUDE.md`](./CLAUDE.md)
(read §0 and §1 — they're non-negotiable); the build plan is in
[`docs/ROADMAP.md`](./docs/ROADMAP.md). This file documents the **security & quality
guardrails** so they survive.

## Setup

```bash
pnpm install                 # installs deps + git hooks (husky)
brew install gitleaks        # local secret scanning (the hook uses it if present)
cp .env.example .env
pnpm infra:up                # postgres 18 · redis · minio
pnpm db:migrate && pnpm db:seed
pnpm dev                     # api :3001 (routes under /v1) · dashboard :3000
```

## The gate — run before you claim done

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

All four must be green. CI runs the same, plus a `security` job (gitleaks + prod audit)
and the `no-ai-attribution` check.

## Commits

- **Conventional Commits**: `<type>(<scope>): <summary ≤72>`; `type` ∈
  feat|fix|refactor|perf|test|docs|chore|build|ci; `scope` ∈
  api|worker|dashboard|client|db|contracts|infra.
- **No AI attribution** anywhere — author, message, or trailer (`CLAUDE.md §0`).
- One logical change per commit; if the message needs an "and", split it.
- Hooks (`.husky/`) enforce commit format, no-AI-identity, no staged `.env`, secret
  scanning, and `lint-staged` (eslint --fix + prettier). CI re-enforces them.

## Security guardrails (established; keep them)

**Secrets** — `.gitignore` blocks `.env*`; only `.env.example` (placeholders) is committed.
gitleaks scans staged changes locally and full history in CI. Never commit a real secret;
if you find one in history, **stop and rotate it** — don't just delete it (`CLAUDE.md §6`).

**Dependencies** — **ask before adding any dependency** (`CLAUDE.md §2`). The stack is
pinned; no majors as a side effect; no pre-release tags. `pnpm audit --prod --audit-level
high` fails CI on a high/critical CVE in a shipped dependency; Dependabot handles the rest.

**API baseline** (inherited by every route, set in `apps/api/src/main.ts`):

- **`/v1` versioning** — all routes are versioned (`/v1/*`); health probes are neutral
  (`/health`). A shipped Mac client pins `/v1` and can't be rolled back, so **never break
  `/v1`** — add `/v2` for breaking changes.
- **Helmet + CORS allowlist** — security headers; only `CORS_ORIGINS` may call the API.
- **Strict input** — request **bodies** are parsed in strict mode (unknown fields → 422),
  the Zod-native `whitelist + forbidNonWhitelisted`. We use **Zod, never class-validator**.

## How to add an endpoint (the patterns)

1. **Contract first** — add/adjust the Zod schema in `packages/contracts`; infer types, never
   hand-write them.
2. **Validate per parameter** — `@Body(new ZodValidationPipe(Schema))` /
   `@Query(new ZodValidationPipe(Schema))`. **Never method-level `@UsePipes`** — it validates
   `@CurrentUser`/`@Param` too and breaks the route.
3. **Authorize by annotation** — for a user-scoped route, add
   `@ResourceScope({ source: 'query'|'param', key: 'userId' })`. The global `ResourceGuard`
   enforces self / manager-of-team / admin via `ResourceAccessService` — don't hand-roll the
   check. For coarse gating use `@Roles(...)`; `@Public()` must be explicit and is reviewed.
4. **Module shape** — controller (HTTP only) → service (logic, no Prisma) → repository
   (Prisma only). Respect the CI-enforced import boundaries (`CLAUDE.md §3`).
5. **Test the 403**, not just the 200 (`CLAUDE.md §4`). TDD: failing test first.

## Testing

Vitest (unit, no DB) + Testcontainers (integration, real PG/Redis) + Playwright (e2e) +
XCTest (client). Coverage gate 80% on `apps/api` and `packages/contracts`. Every bug fix
ships a regression test that fails without the fix.

## macOS client

Signing/notarization: see [`apps/client-macos/SIGNING.md`](./apps/client-macos/SIGNING.md).
The always-visible indicator and `AckGate` are in **every** build — no stealth target,
no capture before acknowledgement, event **counts** only (never keystroke content).

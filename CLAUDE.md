# CLAUDE.md

Guidance for AI coding agents working in this repository. Read this fully before the first edit.

---

## 0. Git identity — non-negotiable

**Never attribute commits to an AI. Not in the author, not in the committer, not in the message, not in the trailers.**

- ❌ Do **not** add `Co-Authored-By: Claude <noreply@anthropic.com>` or any AI co-author trailer.
- ❌ Do **not** add `🤖 Generated with Claude Code`, `Generated with AI`, or any similar footer/banner.
- ❌ Do **not** set, override, or pass `--author` / `-c user.name=` / `-c user.email=` / `GIT_AUTHOR_*` / `GIT_COMMITTER_*`.
- ❌ Do **not** mention Claude, Anthropic, an LLM, or "AI-assisted" anywhere in a commit message, branch name, tag, PR title, or PR body.
- ✅ Commits use the repository's existing `git config user.name` / `user.email`, unchanged.
- ✅ Commit messages describe the _change_, in the format below, and nothing else.

If a commit template, hook, or default would inject an AI trailer, strip it before committing. If you cannot commit without adding attribution, **stop and tell the human instead of committing.**

Also: never run `git config --global` anything, never `git commit --amend` on a pushed commit, never force-push to `main`.

### Commit message format (Conventional Commits)

```
<type>(<scope>): <imperative summary, <=72 chars>

<optional body: why, not what>

Refs: #<issue>
```

`type` ∈ `feat | fix | refactor | perf | test | docs | chore | build | ci`
`scope` ∈ `api | worker | dashboard | client | db | contracts | infra`

Good: `feat(api): idempotent upsert for time-entry sync`
Bad: `feat(api): add endpoint 🤖 Generated with Claude Code`

---

## 1. What this project is

Self-hosted employee time tracking and workforce analytics. macOS menu bar client (Swift) + NestJS API + Next.js dashboard. See `PRD.md`.

This is **monitoring software**, which means a class of changes is off-limits regardless of how the ticket is worded:

- Never add a hidden, silent, or stealth mode. The menu bar indicator is not optional and has no kill switch.
- Never log or transmit keystroke _content_. Event **counts** only. If a task seems to require key content, it is a misread task — ask.
- Never add webcam capture, audio capture, GPS, or clipboard content capture.
- Never bypass the `monitoringAckAt` gate. If a user has not acknowledged the policy, the client does not capture. There is no admin override.
- Never make screenshot data readable without the employee also being able to read it.

If a request conflicts with the above, say so and stop. Don't implement it and flag it in a comment.

---

## 2. Stack — pinned

| Layer               | Version                       |
| ------------------- | ----------------------------- |
| Node.js             | 24.x LTS                      |
| NestJS              | 11.1.x (Fastify adapter)      |
| Prisma              | 7.8.x                         |
| PostgreSQL          | 18                            |
| Zod                 | 4.4.x                         |
| Pino                | 10.3.x (`nestjs-pino`)        |
| Next.js             | 16.2.x (App Router, React 19) |
| Tailwind            | 4.x                           |
| BullMQ + Redis      | latest stable                 |
| Vitest / Playwright | latest stable                 |
| pnpm                | 10.x                          |

Rules:

- **Never** upgrade a major version as a side effect of another task. Majors get their own PR.
- **Never** install a pre-release, canary, RC, or `next` tag. NestJS 12 is not stable yet — do not adopt it.
- Do not add a dependency that duplicates something already in the tree (no Yup/Joi/`class-validator` — we have Zod; no Winston — we have Pino; no Drizzle/TypeORM — we have Prisma).
- Before adding _any_ new dependency, ask.

---

## 3. Layout & where things go

Canonical structure lives in **`PRD.md` §7.1**. Read it before creating any new file. The rules below are what you need to place code correctly; they are not a summary of the tree.

```
apps/api            NestJS HTTP API
apps/worker         NestJS standalone — BullMQ processors
apps/dashboard      Next.js
apps/client-macos   Swift (outside the pnpm graph)
packages/contracts  Zod schemas + inferred types — shared api <-> dashboard
packages/db         Prisma schema, migrations, generated client
packages/logger     Pino config + redaction
packages/config     Zod-validated env
infra/              docker-compose, Dockerfiles
```

### Placement rules

| You are adding…                           | It goes in…                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| A request/response shape, or any DTO type | `packages/contracts/src/<domain>.ts` — **nowhere else**                                   |
| A new endpoint                            | An existing `apps/api/src/modules/<domain>/` — create a new module only if no domain fits |
| A Prisma query                            | The module's `*.repository.ts`. Never a controller, never a service                       |
| A background/scheduled job                | `apps/worker/src/processors/`                                                             |
| An env var                                | `packages/config/src/index.ts` (Zod schema) + `.env.example` — same commit                |
| A sensitive field                         | Its schema **and** the redact list in `packages/logger` — same commit                     |
| A shared UI component                     | `apps/dashboard/src/components/`                                                          |
| A schema change                           | `packages/db/prisma/schema.prisma` + a generated migration — same commit                  |

### Module shape (apps/api)

Every module is a vertical slice with the same six files. Follow it exactly; do not invent a new arrangement:

```
modules/time-entries/
├── time-entries.module.ts
├── time-entries.controller.ts       HTTP + guards + Zod pipe. No business logic.
├── time-entries.service.ts          Business logic. No Prisma.
├── time-entries.repository.ts       Prisma. No business logic.
├── time-entries.service.spec.ts
└── time-entries.e2e-spec.ts
```

### Boundaries (CI-enforced — do not work around them)

- `apps/*` may import `packages/*`. **Never the reverse.**
- `packages/*` do not import each other. The one exception: anything may import `contracts`.
- `PrismaClient` appears only in `*.repository.ts` (api) and `processors/` (worker). In a controller it fails review.
- The macOS client's `Policy/AckGate` is the single gate between capture code and the hardware APIs. Do not add a capture path that bypasses it, and do not turn it into a scattered runtime `if`.

If a change seems to require breaking one of these, you have misunderstood the task. Stop and ask.

### Build model (how packages are consumed)

- Each `packages/*` **compiles to `dist`** and is consumed as built output (its `package.json` `main`/`types` point at `dist`, not `src`). Turbo's `^build` builds packages before apps. **Do not** wire an app to import a package's `src` directly, and don't re-add a `paths` mapping to source in `tsconfig.base.json`.
- `@timetrack/db` is an **ESM** package (Prisma 7's generated client uses `import.meta`); the CJS apps consume it via Node's `require(esm)`. Leave `"type": "module"` on it.

---

## 4. Conventions

### Validation — Zod only

Every external input (HTTP body, query, params, env, webhook, JSON column) is parsed through a Zod schema. Types are **inferred** from schemas, never hand-written alongside them.

```ts
// packages/contracts/src/time-entry.ts
export const CreateTimeEntrySchema = z.object({
  id: z.uuid(), // client-minted UUIDv7 -> idempotency key
  projectId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime().nullable(),
  source: z.enum(['MANUAL', 'AUTO']),
  note: z.string().max(2000).optional(),
});
export type CreateTimeEntry = z.infer<typeof CreateTimeEntrySchema>;
```

Use Zod 4 top-level format helpers (`z.uuid()`, `z.email()`, `z.iso.datetime()`), not the deprecated `z.string().uuid()` chain.

Controllers use the shared `ZodValidationPipe`. Do not reach for `class-validator` — it is not installed and will not be.

- **Scope the pipe to the parameter**, never method-level `@UsePipes`: write `@Body(new ZodValidationPipe(Schema))` / `@Query(new ZodValidationPipe(Schema))`. Method-level `@UsePipes` also runs the pipe on `@CurrentUser`/`@Param`, validating the wrong object (this was a real bug).
- Request **bodies** are parsed in strict mode by the pipe — an unexpected field is rejected (422). That is the Zod-native `whitelist + forbidNonWhitelisted`; don't reach for class-validator to get it.

### Logging — Pino only

- `console.log` is banned outside `scripts/`. Use the injected Pino logger.
- Log objects, not string concatenation: `log.info({ userId, entryId }, 'time entry synced')`.
- **Never** log: passwords, tokens, refresh tokens, `authorization` headers, cookies, raw screenshot bytes, or `windowTitle`. Redaction is configured in `packages/logger` — if you add a sensitive field, add it to the redact list in the same commit.
- Every request carries a `requestId`; child loggers inherit it. Don't invent a second correlation id.

### Database — Prisma

- **Prisma 7 setup:** the connection URL lives in `packages/db/prisma.config.ts` (not a `datasource.url` in `schema.prisma`), and the runtime client connects through the **pg driver adapter** — construct it as `new PrismaClient({ adapter: pgAdapter(env.DATABASE_URL) })` (`pgAdapter` is exported from `@timetrack/db`). Enum values are one-per-line in the schema.
- Schema changes always go through `pnpm db:migrate` (i.e. `prisma migrate dev`). **Never** `prisma db push` against anything but a local scratch DB. Never hand-edit a committed migration.
- `activity_samples` and `screenshots` are **monthly-partitioned** via raw SQL in migrations. If you touch them, don't break the partition key (`timestamp`) and don't add a unique constraint that excludes it.
- Prefer one query over N+1: use `include` / `select`, or `$transaction` for batched writes.
- Never select `*` back to the client — always `select` the fields you need.
- Deletes on user data must write an `AuditLog` row in the same transaction.

### API

- **Versioned: all routes are under `/v1`** (URI versioning, set in `main.ts`; health probes are `VERSION_NEUTRAL` at `/health`). A shipped Mac client pins `/v1` and can't be rolled back — **never break `/v1`**; add `/v2` for breaking changes.
- Deny by default. The global `JwtAuthGuard` protects every route; `@Public()` must be explicit and is code-reviewed. Coarse role gating uses `@Roles(...)`.
- **Resource authorization by annotation, not by hand.** For a user-scoped route add `@ResourceScope({ source: 'query'|'param', key: 'userId' })`; the global `ResourceGuard` enforces self / manager-of-team / admin via `ResourceAccessService` (`common/authz/`). That service is the single place the rule lives — extend it, don't re-implement the check in a service. Write the 403 test, not just the 200.
- The security baseline (helmet, CORS allowlist from `CORS_ORIGINS`, strict-body validation) is global in `main.ts`; every route inherits it.
- Auth is Argon2id + short-lived access JWT + rotating, HMAC-hashed refresh tokens (`modules/auth`). Follow that pattern; never bcrypt.
- Errors → RFC 9457 problem+json via the global filter. Never leak stack traces or Prisma error text to clients.

### Frontend

- Server Components by default; `'use client'` only when there is real interaction.
- Types come from `packages/contracts`. Never hand-write a response interface.
- No credential in `NEXT_PUBLIC_*`. The browser never holds a long-lived token.

---

## 5. Testing

- Unit: Vitest, no DB.
- Integration: Vitest + Testcontainers with a **real** Postgres 18 and Redis. Do not mock Prisma — mocked-ORM tests pass while production breaks.
- E2E: Playwright on seeded data.
- Every bug fix ships with a regression test that fails without the fix.
- Coverage gate: 80% on `apps/api` and `packages/contracts`.

Run before you claim done:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

---

## 6. Working style

- **Ask before scope creep.** Fix the ticket. Don't reformat the file, don't "improve" adjacent code, don't rename things you weren't asked to rename. Unrelated changes make review impossible.
- **Small commits.** One logical change each. If a commit message needs an "and", split it.
- **No stubs left behind.** No `// TODO: implement`, no `throw new Error('not implemented')` on a path claimed as done. If it isn't finished, say it isn't finished.
- **No fabricated results.** Don't claim a test passed unless you ran it and saw it pass. Paste the actual output.
- **Read before writing.** Check `packages/contracts` and existing services before adding a new one — the schema you want probably exists.
- **Secrets never enter the repo.** No keys, tokens, connection strings, or `.env` files in commits. If you find one committed, stop and tell the human — do not just delete it (it's still in history and needs rotating).
- When uncertain about a product decision, ask. Do not guess and build.

---

## 7. Commands

```bash
pnpm install
pnpm dev                    # api + worker + dashboard
pnpm --filter api dev
pnpm --filter dashboard dev

pnpm db:migrate             # prisma migrate dev
pnpm db:generate            # prisma generate
pnpm db:studio
pnpm db:seed

pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm format                 # prettier --write
pnpm format:check

docker compose -f infra/docker-compose.yml up -d   # postgres, redis, minio
```

Git hooks are managed by **husky** (`.husky/`), installed by `pnpm install` (the `prepare` script). The pre-commit hook runs the AI-identity/`.env` guards, **gitleaks** (secret scan, if installed), and `lint-staged`; commit-msg enforces Conventional Commits + no-AI-attribution. CI re-enforces all of it. `brew install gitleaks` to get the local scan.

---

## 8. Pre-commit checklist

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green.
2. No new dependency added without asking.
3. No secrets, no `.env`, no `console.log` — and gitleaks is clean (CI enforces it; a high/critical CVE in a **prod** dep also fails CI).
4. Sensitive new fields added to the Pino redact list.
5. Migration committed alongside any schema change.
6. New endpoints: pipe scoped to the param, `@ResourceScope` (or an explicit reason it's not user-scoped), and the 403 test.
7. **Commit message contains no AI attribution, no co-author trailer, no generated-by footer, and the author is the repo's configured git user.**

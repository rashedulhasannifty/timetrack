# Greenfield Project Playbook — building production software with Claude Code

A reusable, step-by-step guide for standing up a **production-grade project with an AI
coding agent (Claude Code)** — distilled from how this repo (TimeTrack) was set up.

Copy this file into a new project and follow it. It is deliberately **stack-agnostic**;
TimeTrack is used only as the worked example. Replace its specifics with yours.

**How to use it:** work top-to-bottom. Phase 0 (spec → rules → scaffold → guardrails →
roadmap → readiness) happens **before any feature code**. Then build in vertical slices.

---

## 0. The operating philosophy (why this works)

These principles did the heavy lifting. Keep them.

1. **Spec first.** A precise PRD (product + **pinned** stack + architecture + data model +
   API surface + phased rollout) is the single input everything else derives from. The
   agent is only as good as the spec.
2. **Guardrails before features.** Security, CI, auth patterns, and conventions are cheap
   to set up on an empty repo and expensive to retrofit. Do them in Phase 0.
3. **A written constitution (`CLAUDE.md`).** The agent re-reads it every session. If a rule
   isn't written down, it will drift. Keep it in sync with reality.
4. **Green gate, always.** `lint + typecheck + test + build` must pass after every change.
   Never let it go red "temporarily."
5. **Verify by running, not by asserting.** Boot the app, curl the endpoint, run the flow.
   "Tests pass" is not "it works." The agent should paste real output.
6. **Vertical slices + checkpoints.** Build one feature end-to-end (schema → API → UI →
   tests), verify, commit, check in. Not layer-by-layer, not big-bang.
7. **Small commits, one logical change each.** Conventional Commits. Clean history is a
   feature.
8. **Ask before adding a dependency; flag blockers honestly.** The agent should surface
   forced choices (e.g. "this needs your Apple certificate") rather than fake progress.

---

## 1. The setup sequence (Phase 0 — before any feature code)

| Step                      | Output                                         | Prompt to use (see §4)                       |
| ------------------------- | ---------------------------------------------- | -------------------------------------------- |
| 1. Write the spec         | `PRD.md`                                       | (you write this, or co-write with the agent) |
| 2. Write the constitution | `CLAUDE.md`                                    | "Init the CLAUDE.md"                         |
| 3. Scaffold the repo      | monorepo skeleton, green gate                  | "Scaffold from the PRD"                      |
| 4. Establish guardrails   | secrets, CI, auth pattern, versioning, signing | "Set up security & quality guardrails"       |
| 5. Document the plan      | `docs/ROADMAP.md` + per-phase plans            | "Document the build phase by phase"          |
| 6. Readiness check        | drift fixed, structure confirmed               | "Are we ready to implement?"                 |
| 7. Build                  | features, slice by slice                       | "Start Slice N.M"                            |

Do them in order. Each depends on the previous.

---

## 2. What to put in the PRD (the spec)

The PRD is the north star. Make it concrete enough that an agent can scaffold from it.
Include:

- **Summary, goals, non-goals.** Non-goals matter as much as goals — they set boundaries.
- **Hard product constraints** (ethics/legal/compliance) stated as _code-enforceable rules_,
  not prose. (TimeTrack: "no stealth mode," "event counts never content," "no capture
  before acknowledgement.")
- **A locked, pinned stack** — exact major versions, and a version policy (no majors as a
  side effect, no pre-release tags). Ambiguous stacks produce ambiguous scaffolds.
- **Repository structure** — the canonical tree and where each kind of code lives.
- **Module/boundary rules** — the import direction, the layering, what's forbidden where.
- **Data model** — the schema sketch.
- **API surface** — the endpoints, and the authorization rule for each.
- **Non-functional requirements** — performance, security, observability targets.
- **A phased rollout** — MVP → later phases, with a _ship gate_ per phase.

> Keep an **"as-built refinements"** section (PRD §7.9 here) so the spec stays honest as the
> implementation refines it — don't let the PRD and the code silently diverge.

---

## 3. What to write in CLAUDE.md (the constitution)

`CLAUDE.md` is the file the agent obeys. Structure it in numbered sections so you can
reference "§4" in prompts. This is the skeleton that worked (adapt the content):

```
## 0. Git identity — non-negotiable
    - No AI attribution anywhere (author, message, trailers). Commit format
      (Conventional Commits). Never force-push main, never amend pushed commits.
## 1. What this project is
    - One paragraph. Then the HARD product constraints (the off-limits changes).
## 2. Stack — pinned
    - The version table. Rules: no side-effect majors, no pre-release, no duplicate
      deps, ASK BEFORE ADDING ANY DEPENDENCY.
## 3. Layout & where things go
    - The tree. A "placement table" (adding X → it goes in Y). The module shape.
      The CI-enforced boundaries. The build model (how packages are consumed).
## 4. Conventions
    - Validation, logging, database, API (authz + versioning), frontend. Be specific:
      name the exact pattern (e.g. "@ResourceScope, not per-route checks").
## 5. Testing
    - Unit / integration / e2e strategy. Coverage gate. The one command to run.
## 6. Working style
    - Ask before scope creep. Small commits. No stubs left on a "done" path. No
      fabricated results. Read before writing. Secrets never enter the repo.
## 7. Commands
    - The exact commands. Note the git-hook tooling.
## 8. Pre-commit checklist
    - The literal checklist to run before every commit.
```

**Rules of thumb for CLAUDE.md:**

- Write **why**, not just what — the agent generalizes better from reasons.
- Encode enforcement, not hope: "CI-enforced boundaries," "the hook rejects X."
- When you discover a gotcha (a real bug), add a rule so it can't recur (we added the
  "scope the Zod pipe per-parameter, never method-level `@UsePipes`" rule after hitting
  that bug).
- Keep it in sync. A stale constitution is worse than none — the agent will follow the
  stale rule confidently.

---

## 4. The prompts — what messages to give Claude Code

These are the actual messages that drove this build, generalized. Copy, adapt, send.
Each is followed by _why it worked_.

### 4.1 Initialize the constitution

> "Initialize a `CLAUDE.md` for this repo from the PRD: git-identity rules, the pinned
> stack, the layout and boundaries, our conventions (validation, logging, DB, API authz,
> frontend), testing strategy, working style, commands, and a pre-commit checklist. Keep
> it specific and enforcement-oriented."

_Why:_ sets the rules the agent will then follow for everything else.

### 4.2 Scaffold from the spec

> "Scaffold the monorepo structure from `PRD.md` — treat this as our starter pack. Make
> sure it's up to date, follows best developer practices and good architecture, and is
> **complete** (installs, and `lint`/`typecheck`/`test`/`build` are all green). Get a real
> understanding of the project first."

_Why:_ "complete + green gate" forces a runnable skeleton, not empty files. "Get an
understanding first" makes it read the PRD before generating.

### 4.3 Implement a component fully

> "Implement the `<X>` module fully."

_Why:_ short works when the spec + CLAUDE.md are good. The agent knows the pattern, the
schema location, the test requirements. Let it propose the design decisions and confirm.

### 4.4 Establish security & quality guardrails (do before features)

> "Before feature work, establish security and quality guardrails across the repo:
> (1) secrets hygiene — `.gitignore`, `.env.example`, a secret scanner in a pre-commit
> hook; (2) CI — lint, typecheck, tests, dependency audit, Dependabot, fail on high-sev
> CVEs; (3) a framework security baseline — input validation, security headers, CORS
> allowlist, rate limiting, structured logging with PII redaction, done globally so every
> route inherits it; (4) an authorization pattern — a guard/decorator that makes 'can THIS
> user touch THIS resource' the default; (5) API versioning (`/v1`) from the first
> endpoint; (6) client signing/notarization + a signed update channel, tested end-to-end;
> (7) a `CONTRIBUTING.md` documenting these rules. Explain each choice briefly. **Ask me
> before adding any dependency.**"

_Why:_ this exact framing produced the whole guardrail layer. "Explain each choice" +
"ask before deps" keeps you in control; "done globally so every route inherits it" gets
the baseline in the right place (bootstrap, not per-route).

### 4.5 Document the build, phase by phase

> "Document everything phase by phase, step by step, from implementation to deployment,
> in a `docs/` folder — a roadmap plus a detailed plan per phase — then we'll implement it
> slice by slice with a checkpoint after each."

_Why:_ produces `ROADMAP.md` + per-phase plans you execute against. Decide up front:
full detail for all phases now, or just-in-time per phase (both are valid).

### 4.6 Pre-implementation readiness check

> "Before we start implementation: do we have everything we need? Do we need any folder
> structure changes? Does `CLAUDE.md` need updating to match what we've actually built?"

_Why:_ catches drift between the constitution and reality before it compounds. Run it at
every major inflection point.

### 4.7 Build a slice

> "Start Slice N.M. TDD, keep the gate green, verify by running it, one commit, then check
> in before the next slice."

_Why:_ names the cadence explicitly so the agent doesn't run ahead.

### 4.8 Useful modifiers to add to any prompt

- "Verify it by actually running it (curl/click/boot), not just tests — paste the output."
- "Ask me before adding any dependency."
- "Commit per logical change with a Conventional Commit message; no AI attribution."
- "If something needs credentials/access you don't have, stop and tell me — don't fake it."
- "Keep the `lint/typecheck/test/build` gate green."

---

## 5. How to get the most out of the agent

- **Front-load context, then keep prompts short.** With a strong PRD + CLAUDE.md, "implement
  auth fully" is enough. Weak context → you'll micromanage every step.
- **Let it ask.** The best outcomes came when it surfaced a decision (which secret scanner?
  add this dependency?) instead of guessing. Answer decisively.
- **Make it verify.** Insist on real, run-it evidence. It caught its own bugs this way
  (the validation-pipe leak, the Postgres volume, the entitlements parser).
- **Checkpoint between slices.** Review at slice boundaries, not mid-slice. Big review
  surfaces are where mistakes hide.
- **Trust but verify commits.** The hooks + CI enforce the rules, but skim the diff.
- **When it hits a wall it can't pass (credentials, external services), it should scaffold
  - document + hand you the credentialed step** — not pretend it's done.

---

## 6. Decisions & rationale worth reusing

Stack-specific, but the _reasoning_ generalizes:

- **Pin the stack in the PRD and enforce "ask before deps."** Prevents drift and bloat.
- **Build shared packages to `dist`; apps consume built output** (turbo `^build`). Clean
  app builds, no source-import tangles. (Watch generated clients that ship ESM — the DB
  package had to be ESM because Prisma 7's client uses `import.meta`.)
- **One validation library, applied per-parameter.** We use Zod; the pipe is scoped to
  `@Body`/`@Query`, never method-level (which validates the wrong object).
- **API versioning from the first endpoint.** A shipped client can't be rolled back; `/v1`
  lets you evolve without breaking it.
- **Resource authorization as a reusable primitive** (a decorator + guard + one service
  holding the rule), not copy-pasted per route. Makes the 403 case structural.
- **Security baseline in the bootstrap**, so every route inherits helmet/CORS/strict input.
- **Secret scanning in both pre-commit and CI**; audit only **production** deps for the
  build-failing gate (dev-tooling CVEs never ship). Dependabot for the rest.
- **Sign/notarize native clients; scaffold it even if you can't run it** without the
  vendor account, and document exactly which credentials plug in.

---

## 7. Gotchas we hit (so you don't)

Concrete traps from this build — check for the analogous thing in your stack:

- **Package manager blocked native build scripts.** pnpm 10 ignores postinstall for native
  deps (prisma, argon2, sharp, esbuild) — add an `onlyBuiltDependencies` allowlist.
- **New major changed its config model.** Prisma 7 removed `datasource.url` (moved to
  `prisma.config.ts` + a driver adapter). Don't assume the old setup — check the current docs.
- **ESM vs CJS for generated code.** The generated DB client used `import.meta` (ESM); the
  package had to be `"type": "module"`, consumed via Node's `require(esm)`.
- **Docker image changed its expected volume path** (Postgres 18 wants the mount at
  `/var/lib/postgresql`, not `/data`). It crashed on boot until fixed.
- **Framework footgun:** method-level validation pipe ran on _every_ parameter, validating
  the auth-user object against the body schema → every authed route 422'd. Scope pipes to
  the input param.
- **Signing tool is strict:** the entitlements plist parser rejects XML comments.
- **Secret scanner false positives:** it flagged `secretAccessKey: this.env.S3_SECRET_KEY`
  (a variable reference, not a value). Allowlist env-var references + the `.env.example`.
- **CORS/headers need explicit plugins** on some adapters (Fastify needs `@fastify/cors`).
- **Env files aren't auto-loaded** by the runtime — load the repo-root `.env` explicitly
  (Node 24's `process.loadEnvFile`) or feature flags/DB URLs will be `undefined` at boot.
- **Health probes should be version-neutral** (`/health`, not `/v1/health`) so load
  balancers don't track the API version.

---

## 8. Reusable checklists

### Pre-implementation readiness

- [ ] PRD complete: goals, non-goals, hard constraints, pinned stack, structure, data
      model, API surface + per-endpoint authz, phased rollout.
- [ ] `CLAUDE.md` written and in sync with the code.
- [ ] Repo scaffolded; `install` + `lint` + `typecheck` + `test` + `build` all green.
- [ ] Guardrails: secrets scanning, CI (audit + Dependabot), security baseline, authz
      pattern, API versioning, client signing scaffold, `CONTRIBUTING.md`.
- [ ] `docs/ROADMAP.md` + per-phase plans.
- [ ] Datastore versions consistent across compose, CI, and deployment docs.
- [ ] Integration-test harness available (or scheduled as the first slice).

### Per-slice Definition of Done

- [ ] Green gate.
- [ ] The 403/negative case tested, not just the happy path.
- [ ] No stub left on a path claimed done; no fabricated results.
- [ ] Sensitive new fields redacted; new env in the config schema + `.env.example`;
      migration committed with the schema change.
- [ ] Behavior demonstrated end-to-end (run it).

### Per-commit

- [ ] One logical change; Conventional Commit; no AI attribution; repo's git user.
- [ ] Secrets clean; no `.env`; no `console.log`.
- [ ] Docs/rules updated if the change establishes a new convention.

---

_Provenance: distilled from the TimeTrack setup — see `PRD.md`, `CLAUDE.md`,
`docs/ROADMAP.md`, `CONTRIBUTING.md`, and `apps/client-macos/SIGNING.md` for the concrete
instances of every pattern above._

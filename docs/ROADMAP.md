# TimeTrack — Build Roadmap

The single source of truth for **how we build TimeTrack, phase by phase, to production.**
Read `PRD.md` for _what_ and _why_; read this for _in what order_ and _how we work_.

- Product spec: [`PRD.md`](../PRD.md)
- Engineering rules: [`CLAUDE.md`](../CLAUDE.md) — §0 (git identity) and §1 (monitoring ethics) are non-negotiable
- Deployment runbook: [`docs/deployment.md`](./deployment.md)
- Per-phase step-by-step plans: [`docs/plans/`](./plans/)

---

## 1. Where we are

**Done (foundation + first slice of Phase 1):**

- Monorepo (pnpm + turbo), pinned stack, CI, husky + lint-staged, green gate (`lint`/`typecheck`/`test`/`build`).
- `packages/`: `contracts` (Zod schemas for every domain), `db` (Prisma 7 + adapter, partitioned schema, migrations), `logger` (Pino + redaction), `config` (Zod env).
- `apps/api`: guards (JWT deny-by-default, roles), Zod pipe, RFC 9457 filter, request-id interceptor, MinIO + BullMQ infra. **Auth is fully implemented** (Argon2id login, rotating refresh tokens, logout). Other modules are typed, guarded skeletons.
- `apps/worker`: bootstrap + processors (partition-provision real; others stubbed).
- `apps/dashboard`: Next 16 App Router shell + routes (scaffold pages).
- `apps/client-macos`: SwiftPM package, `AckGate` + `PolicyClient`, app + capture stubs.

**Next:** finish **Phase 1 (MVP)**.

---

## 2. How we work (the method)

Every feature is built as a **vertical slice** and follows the same loop:

1. **Plan** — the slice is already specified in its phase plan (`docs/plans/phase-N-*.md`).
2. **Contracts first** — add/adjust the Zod schema in `packages/contracts`; types are inferred.
3. **Schema + migration** — if data changes, edit `schema.prisma` and generate a migration in the same commit.
4. **Test first (TDD)** — write the failing service/unit test (and the 403/negative case), then implement.
5. **Implement the slice** — repository → service → controller (API), or processor (worker), or route/component (dashboard), or the Swift path (client). Respect the module shape and boundaries in `CLAUDE.md §3`.
6. **Verify** — `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green, **and** drive the real behavior (curl the endpoint / click the page / run the flow), not just tests.
7. **Commit** — one logical change, Conventional Commits, no AI attribution (`CLAUDE.md §0`). The hooks enforce it.
8. **Checkpoint** — I report what shipped and what's next; you steer before the next slice.

**Definition of Done (per slice):**

- [ ] Green gate.
- [ ] The 403/authorization case is tested, not just the happy path (`CLAUDE.md §4`).
- [ ] No `TODO(scaffold)` left on the path claimed done; no fabricated results.
- [ ] Sensitive new fields added to the Pino redact list; new env in `packages/config` + `.env.example`; migration committed with the schema change.
- [ ] Behavior demonstrated end-to-end.

**Non-negotiable guardrails (apply to every slice):**

- No hidden/stealth mode; the menu-bar indicator has no kill switch.
- No keystroke **content** — event **counts** only.
- No capture path bypasses `Policy/AckGate`; no monitoring before `monitoringAckAt`.
- Nothing a manager can see about an employee that the employee cannot see about themselves.

---

## 3. Phase overview

| Phase                             | Theme                                                                           | Exit criteria (ship gate)                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **1 — MVP**                       | Auth, time tracking, projects/tasks, basic dashboard, client MVP                | An employee can install the client, acknowledge policy, track time (manual + auto), assign a project; a manager sees today's hours. |
| **2 — Monitoring + transparency** | Screenshots, activity %, idle alerts, **employee self-view**                    | Capture works end-to-end **and** the employee self-view ships in the same release (PRD §11 hard gate).                              |
| **3 — Reporting + approvals**     | Distraction alerts, reports/CSV, timesheet approvals                            | Managers export CSV and approve/flag timesheets; distraction nudges are local-only.                                                 |
| **4 — SSO + admin + retention**   | SSO (SAML/OIDC), admin settings UI, retention automation, audit-log UI, erasure | Admins configure policy, retention runs nightly (DROP PARTITION + audit), SSO login works, right-to-erasure tooling ships.          |

**Sequencing rule:** phases are ordered by dependency and by the PRD's §11 gate. Within a phase, slices are ordered so each builds on green, shippable predecessors. We do not start Phase 2 capture until the Phase 2 self-view slice is planned to ship with it.

---

## 4. Cross-cutting workstreams

These span phases; each phase plan calls out its portion.

- **Testing** (`PRD.md §9`): Vitest unit (no DB) + Testcontainers integration (real PG/Redis) + Playwright e2e + XCTest (client). Coverage gate 80% on `apps/api` and `packages/contracts`.
- **Observability** (`PRD.md §8`): `/health` + `/health/ready`, Pino JSON, `requestId` on every line.
- **Security** (`PRD.md §8`): TLS everywhere, presigned URLs only, deny-by-default guards, resource-level authorization in services.
- **Deployment** (`docs/deployment.md`): docker-compose on one VM, migrations on deploy, backups, client distribution.

---

## 5. Using these docs

- Start a phase → open its plan in `docs/plans/`.
- Each plan is a checklist of **slices**; each slice lists steps, files, tests, and its Done-when.
- Check a box only when it's true and verified. Keep the plan and reality in sync — if we deviate, edit the plan in the same commit.
- The roadmap (this file) changes rarely; the phase plans are living documents.

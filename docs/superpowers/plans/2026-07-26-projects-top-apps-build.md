# Per-project Top Apps — BUILD (Implementation Plan)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Build the per-project "Top apps" feature on `/projects/[projectId]` — a range-join of
`activity_samples` to the project's `time_entries` — **with a mandatory, visible coverage
disclosure** ("app data covers N% of this project's tracked time"). Revives the Slice-4 spike
feature the coverage caveat was the condition for un-cutting.

**Architecture:** full-stack — `db` (a `time_entries(projectId)` index) + `contracts` (response
schema) + `api` (repository range-join + service + controller) + `dashboard` (a degradeable Top-apps
section on project detail). No new dependency.

## Global Constraints

- **The coverage disclosure is NON-NEGOTIABLE.** The UI MUST render the covered-% of tracked time
  alongside the app list. Building the app list without the disclosure re-introduces exactly the
  MANUAL-blindness the spike cut this for — that is a correctness/ethics defect, not a Minor. Any
  task that renders apps without coverage fails review.
- Uses EXISTING captured data only (`activity_samples.appName`, already behind the client AckGate /
  `monitoringAckAt`). No new capture, no new client change, no webcam/etc. Pure read analytics.
- `activity_samples`/`screenshots` are monthly-partitioned on `timestamp`; the range query prunes
  partitions — keep `a.timestamp BETWEEN from AND to` in the WHERE so pruning works. Sample interval
  is **60 s** (`ACTIVITY_SAMPLE_INTERVAL_SECONDS`), so seconds = sampleCount × 60.
- Authz: MANAGER/ADMIN own-team via the existing `ProjectsService.findForActor` (404/403). `@Roles`.
- Migration hand-authored (`prisma migrate dev` can't run in this harness) + `db:deploy` +
  `db:generate` + rebuild `@timetrack/db`; e2e Testcontainers applies the migrations dir. Docker UP.
- Zod-only; types inferred; PrismaClient only in `*.repository.ts`; RFC-9457 errors; commits
  Conventional (`feat(db|contracts|api|dashboard)`) ≤72, NO AI attribution, author = repo git user.
  Stay on `feat/projects-top-apps-build`; verify branch after each commit; never main.

## Coverage semantics (get this right)

- `totalSeconds` = the project's tracked seconds in range (ALL entries, MANUAL+AUTO) — the same
  half-open windowed sum as `hoursByDay`/`tasksForProject` use.
- `coveredSeconds` = Σ(matched activity samples) × 60 = Σ of the per-app seconds (apps partition the
  matched samples). MANUAL entries contribute ~0 samples, so covered ≤ total.
- `coveragePct` = `totalSeconds > 0 ? round(coveredSeconds / totalSeconds * 100) : 0` (clamp 0–100),
  computed in the service (or a pure view helper) — the UI shows it verbatim.

---

### Task 1: DB — `time_entries(projectId)` index

**Files:** `packages/db/prisma/schema.prisma`; new `packages/db/prisma/migrations/20260726120000_add_time_entries_project_index/migration.sql`.

- [ ] Add `@@index([projectId])` to `model TimeEntry`. Hand-author `migration.sql`:
      `CREATE INDEX "time_entries_projectId_idx" ON "time_entries" ("projectId");`. Run `pnpm db:deploy`
      (or `prisma migrate deploy`) against the local scratch DB, `pnpm db:generate`, and
      `pnpm --filter @timetrack/db build`. Commit `feat(db): index time_entries(projectId)`.

### Task 2: Contracts — Top-apps response

**Files:** `packages/contracts/src/projects.ts` (+ its spec).

- [ ] Add `ProjectTopAppRowSchema = z.object({ appName: z.string(), trackedSeconds: z.number().int().nonnegative() })`;
      `ProjectTopAppsSchema = z.object({ from: z.iso.datetime(), to: z.iso.datetime(), projectId: z.uuid(),
apps: z.array(ProjectTopAppRowSchema), coveredSeconds: z.number().int().nonnegative(),
totalSeconds: z.number().int().nonnegative(), coveragePct: z.number().int().min(0).max(100) })`;
      inferred types. Reuse `ProjectDetailQuerySchema` for the query (from/to). Add tests. Commit
      `feat(contracts): add project top-apps schema`.

### Task 3: API repository — range join + e2e

**Files:** `apps/api/src/modules/projects/projects.repository.ts`; `apps/api/test/projects.e2e-spec.ts`.

- [ ] Add `topAppsForProject(projectId, from, to): Promise<{ apps: {appName;trackedSeconds}[]; totalSeconds: number }>`.
      App aggregation — **use an `EXISTS` SEMI-JOIN, NOT a plain JOIN.** A plain JOIN counts a sample
      once per containing entry, so overlapping same-project entries for one user (a retroactive
      MANUAL entry overlapping an AUTO span — nothing forbids overlap; only ONE-RUNNING-per-user is
      enforced) DOUBLE-count → `coveredSeconds` inflates past `totalSeconds` → `coveragePct` clamps to
      100% exactly when the data is messiest, overstating the ethically load-bearing number. `EXISTS`
      counts each sample at most once and keeps the `a.timestamp` range on the outer scan (partition
      pruning intact). Mirror the existing repo's `::timestamptz` + `COALESCE(endTime, now())` windowing:
  ```sql
  SELECT a."appName" AS "appName", COUNT(*) * 60 AS "trackedSeconds"
  FROM activity_samples a
  WHERE a."timestamp" >= ${from}::timestamptz
    AND a."timestamp" <  ${to}::timestamptz
    AND EXISTS (
      SELECT 1 FROM time_entries te
      WHERE te."projectId" = ${projectId}
        AND te."userId" = a."userId"
        AND a."timestamp" >= te."startTime"
        AND a."timestamp" <  COALESCE(te."endTime", now())
    )
  GROUP BY a."appName"
  ORDER BY "trackedSeconds" DESC, a."appName" ASC
  ```
  `totalSeconds` = reuse the project's windowed tracked-seconds sum (same clause as `hoursByDay`
  without the day bucket — one scalar). Return both; map bigint→Number. E2E (real PG), TWO cases:
  (a) AUTO entries + matching samples AND a MANUAL entry with NO samples → apps aggregate correctly
  AND `coveredSeconds (Σapps) < totalSeconds` (the MANUAL gap is real/measurable); (b) **overlap
  case** — one user with TWO overlapping same-project entries covering the same sample minutes →
  assert each sample counts ONCE and `coveredSeconds ≤ totalSeconds` (distinguishes the correct
  EXISTS query from the plausible-but-wrong JOIN). Commit `feat(api): project top-apps semi-join repository`.

### Task 4: API service + controller + unit

**Files:** `projects.service.ts`, `projects.controller.ts`, `projects.service.spec.ts`, `projects.controller.spec.ts`.

- [ ] Service `topApps(id, dto, actor): Promise<ProjectTopApps>` → `findForActor(id)` (404/403) →
      `repo.topAppsForProject` → compute `coveredSeconds = Σ apps.trackedSeconds`, `coveragePct` per the
      semantics above → return the full shape. Controller `@Get(':id/top-apps')` `@Roles('MANAGER','ADMIN')`
      `@Query(new ZodValidationPipe(ProjectDetailQuerySchema))`. Unit: service authz 404/403/happy +
      coverage math; controller-spec delegation. Commit `feat(api): project top-apps endpoint`.

### Task 5: Dashboard api-client

**Files:** `apps/dashboard/src/lib/api-client.ts`.

- [ ] `getProjectTopApps: (token, id, params) => get(\`/projects/${id}/top-apps?${params}\`, ProjectTopAppsSchema, token)`.
Commit `feat(dashboard): add getProjectTopApps client method`.

### Task 6: Dashboard — Top-apps section (with MANDATORY coverage disclosure)

**Files:** `apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx` (+ a small view helper if needed).

- [ ] Add a **degradeable** `getProjectTopApps` fetch (try/catch → skip section on failure, never
      blank the page — mirror the tasks-section pattern). Render a `<SectionHeader label="Top apps" />` +
      `<Card>` with: a **coverage line FIRST** — `App data covers {coveragePct}% of this project's tracked
time.` (`text-caption text-text-secondary`; if coveragePct is low, this is the honesty guardrail) —
      then the app list via `BarMeter` (label appName, value `formatDuration(trackedSeconds)`, fill pct
      normalized to the top app). Empty apps → "No app activity recorded for this project's tracked time."
      The coverage line renders whenever the section renders. Commit `feat(dashboard): project top-apps section with coverage`.

### Task 7: e2e scaffold

**Files:** new `apps/dashboard/e2e/project-top-apps.spec.ts` (skipped, append-only). Cases: top-apps
section renders with the coverage line + app bars. Skipped; curly ’. Commit `test(dashboard): scaffold project top-apps e2e cases`.

---

## Final verification

`pnpm lint && typecheck && test && build`; `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` (Docker up). Final whole-branch review (opus) — verify the coverage disclosure is present and the covered<total gap is measured. Then merge.

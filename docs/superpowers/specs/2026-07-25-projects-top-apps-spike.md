# Slice 4 — Top apps within a project (SPIKE findings)

Date: 2026-07-25
Branch: `spike/projects-top-apps`
Type: spike — investigation only, no production code. Ends with a **build-or-cut** decision for the human.

## Question

Slice 3 (project management) is complete. The Time Doctor reference screens show a per-project
**application-usage** breakdown ("top apps within a project"). Should we build it? The ledger flagged
two risks to resolve first: the **MANUAL/AUTO time-entry mix** (is the number meaningful?) and the
**range-join cost** over the monthly-partitioned `activity_samples` (is it affordable?).

## Decision: ~~CUT~~ → **BUILD with disclosed coverage** (human, revised 2026-07-26)

Originally cut (below). **Reversed 2026-07-26:** the human chose to build per-project top-apps
**on the mandatory condition** that the UI discloses coverage — a visible "app data covers N% of
this project's tracked time" figure — so the MANUAL-blindness (Finding 1) is surfaced, never hidden.
The range-join cost is a non-issue (Finding 2: ~9 ms with a `time_entries(projectId)` index).
Implementation plan: `docs/superpowers/plans/2026-07-26-projects-top-apps-build.md`. The coverage
disclosure is not optional — it is the whole reason the reversal is acceptable.

## Recommendation: **CUT** (or defer behind an explicit coverage caveat)

The recommendation rests on **semantics and product scope, not cost.** The risky axis — query cost —
came back green. The investigation surfaced a correctness/honesty defect that is the real reason to
cut.

## What "top apps within a project" would require

`activity_samples` carries `{ userId, timestamp, appName, activityPct, category }` — **no `projectId`.**
Project attribution lives only on `time_entries` (`projectId`, `userId`, `startTime`, `endTime`,
`source`). So an app sample "belongs to" a project only if its `timestamp` falls inside a same-user
time entry for that project. That is an inequality (range) join:

```
activity_samples a  JOIN  time_entries te
  ON a."userId" = te."userId"
 AND a.timestamp >= te."startTime"
 AND a.timestamp <  COALESCE(te."endTime", now())
WHERE te."projectId" = :id  AND <half-open window clamp>
```

There is no shortcut via the existing rollup: `ActivityDailySummary.byApp` is per-**user**-per-**day**,
never project-attributed, so it cannot answer "top apps in project X."

## Finding 1 — Semantics: the breakdown is silently blind to all manual time (DECISIVE, negative)

- A **MANUAL** time entry is entered retroactively/offline. It contributes hours to the project but
  usually contributes **zero activity samples** (the client wasn't in a capture session for that
  window). The range join therefore omits 100% of manually-logged time.
- The damage is not noise, it is **undisclosed under-coverage**: "Top apps: VS Code 60% / Slack 40%"
  might cover all of a project's logged hours, or half of them, and **the viewer has no signal which.**
  Sampled app-time is silently less than tracked project-time by the (invisible) MANUAL fraction.
  For a manager judging where project time goes, that is a correctness/honesty defect.
- Even for **AUTO** entries (which do coincide with samples — both come from the same capture-gated
  client session), `appName` is the **foreground** app. Cross-cutting apps (Slack, Mail, Chrome)
  dominate the breakdown regardless of which project the person was tracking, so there is little
  _project-specific_ signal unless app-mix genuinely differs per project.

## Finding 2 — Cost: affordable, index-driven, partition-pruned (GREEN)

Benchmarked on the running Postgres 18 with a synthetic dataset mirroring the shipping query shape
(`::timestamptz`, half-open `COALESCE(endTime, now())` clamp from `hoursByDay`):

- Scale: **20 users × 3 months** weekday capture → **633,600 activity samples** (per-minute during an
  8h window), **21,120 time entries** across 10 projects.
- Query: top-apps for **one project over a one-month range**.
- **Execution Time: ~9.4 ms.**
- Plan (as predicted): Bitmap Index Scan to gather the project's entries → **Nested Loop** into
  `activity_samples` via the `(userId, timestamp)` index → **only the June partition scanned**
  (partition pruning works) → HashAggregate → Sort. No full-partition materialization.

Caveat: the driving side (find a project's entries) wants a **`time_entries(projectId)` index** — the
benchmark added one; production today has only `(userId, startTime)`. Without it that step is a seq
scan of `time_entries` (trivial at 21k rows, matters at millions). That index is already on the
standing backlog. **Cost is not a blocker.**

## Finding 3 — Product scope: not specified (the human's call)

Neither `timetrack/PRD.md` nor the parent `PRD.md` specifies a per-project app breakdown. The only
"application" reference is capture (foreground app via `NSWorkspace`). Per-**user** top-apps **is
shipped** (Slice 2.3, `ActivityDailySummary.byApp`, rendered on the `/me` Activity tab and
`people/[userId]`). It is the per-**project** extension that is nowhere specified. Per CLAUDE.md §6
("ask before scope creep… when uncertain about a product decision, ask"), building invented scope is
the human's decision, not the implementer's.

## Options for the human

1. **Cut (recommended).** Don't build per-project top-apps. The number would silently misrepresent
   coverage on any team with meaningful manual entry, and the feature isn't specced. The shipped
   per-user Activity breakdown already covers the honest version of "what apps did this person use."
2. **Build with an explicit coverage caveat.** Feasible and cheap (≈a `topAppsForProject` repo method
   mirroring `tasksForProject`, plus a detail-page section). Only acceptable if the UI **also shows
   the AUTO-covered fraction** ("app data covers N% of this project's tracked time") so the omission
   is disclosed, not hidden. Would also land the `time_entries(projectId)` index. Same MANUAL-blindness
   is inherent even if precomputed by a worker — that's a "how to build," not a "whether."
3. **Reframe.** If the real goal is "what does project time look like," the existing per-task hours
   breakdown (Slice 2) is the honest, complete answer and already ships.

## Housekeeping

Spike-only. No schema, contract, API, or dashboard code changed. The benchmark ran in an isolated
scratch schema that was dropped (verified: 0 rows in `information_schema.schemata`). This document is
the only artifact; it is committed on `spike/projects-top-apps`.

# Dashboard Redesign — Slice 3: Reports reskin (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Reskin `/reports` to the mockup — header count row + Export CSV, a "By person" sortable
table (avatar + activity meter), a "By project" bar-meter list — using the Slice 1 kit + Slice 2
charts. First slice that intentionally changes a screen body.

**Architecture:** `apps/dashboard` only. Server page composes a new client sortable table + static
by-project list. Uses `SetPageTitle` (title moves into the header), `SectionHeader`, `Card`,
`Avatar`, `BarMeter`.

## Global Constraints

- `dashboard` scope only. No api/contracts/db change. No new dependency.
- **Data reconciliation (mockup vs. what we have) — decided:**
  - `TeamSummaryRow` has `activityPct` but **no productive %** → the mockup's "Productive %" column is
    **dropped** (no data source; not building a category rollup in a reskin). Columns: User ·
    Tracked time · Activity %.
  - **No archived-teams concept** in the app → the mockup's "Archived teams" empty-state section is
    **omitted** (don't fabricate a data surface).
  - `ProjectSummaryRow` = `{projectId, name, trackedSeconds}` → "By project" bar-meter uses tracked
    time, normalized to the max row.
- Preserve existing behavior: MANAGER/ADMIN gating (403 → "not permitted" state), degradeable
  load (error → message), Export CSV link, range picker, empty-range message.
- Title moves to the header via `SetPageTitle` (Slice 1 mechanism); remove the in-`main`
  `PageHeader` h1 for this page.
- Tokens/utilities only; `tt-numeric` for numbers. RSC: page stays server; only the sortable table
  is `'use client'`. Dashboard vitest node-env: unit-test pure sort/transform in `reports-view`.
- Commits `feat(dashboard)`/`refactor`/`test` ≤72, NO AI attribution, author = repo git user. Stay
  on `feat/ds-6-reports-reskin`; verify branch after each commit; never main.

## Mockup reference

`/private/tmp/claude-501/.../scratchpad/TimeTrack.dc.html` — Reports L683–748: header count row
(L686–690), by-person table (L692–723: header cells with ⇅, row = avatar chip + name, right-aligned
tracked, activity cell = inline meter + %), by-project card (L725–738: name + time + full-width
`h-[10px]` bar), archived-teams empty state (L740–747, OMITTED per above).

---

### Task 1: `reports-view` sort helpers + tests

**Files:** Modify `apps/dashboard/src/lib/reports-view.ts`, `apps/dashboard/src/lib/reports-view.spec.ts`.
**Produces:** `sortTeamRows(rows: TeamSummaryRow[], key: 'name'|'trackedSeconds'|'activityPct', dir: 'asc'|'desc'): TeamSummaryRow[]` (pure, stable; string compare for name, numeric for the rest). Also `activityMax`/normalization helper if useful for the meter (or compute inline).

- [ ] Step 1: failing tests — sort by each key asc/desc, stable for ties, does not mutate input. Step 2: implement. Step 3: `test -- reports-view` pass; typecheck clean. Step 4: commit `feat(dashboard): add reports table sort helper + tests`.

### Task 2: `ReportsByPersonTable` (client, sortable)

**Files:** Create `apps/dashboard/src/components/reports/ReportsByPersonTable.tsx`.
**Consumes:** `sortTeamRows`, `Avatar`, `BarMeter` (or inline meter), `formatDuration` from `lib/format`.

- [ ] Step 1: `'use client'` table in a `Card padding="none"` (rounded-lg overflow-hidden). Columns: **User** (Avatar size 26 + name), **Tracked time ⇅** (right, tt-numeric), **Activity % ⇅** (a `max-w-[120px]` inline meter — reuse `BarMeter` with a single accent fill, or an inline track — + right-aligned `{pct}%`). Header cells clickable to toggle sort (`useState<{key,dir}>`), showing a ⇅/↑/↓ affordance; default sort tracked desc. Each `<tr>` is clickable → navigate to `/people/${userId}` (use `useRouter().push`, and `cursor-pointer`). Match mockup L695–721 padding/borders (`px-[18px] py-[11px]`, `border-b border-separator`, header `text-caption text-text-secondary font-semibold`). Step 2: typecheck+lint clean. Step 3: commit `feat(dashboard): add sortable Reports by-person table`.

### Task 3: Reskin `reports/page.tsx`

**Files:** Modify `apps/dashboard/src/app/(app)/reports/page.tsx`.

- [ ] Step 1: keep the server data-loading (session, range, `teamSummary`/`projectSummary`, forbidden/degrade). Replace the render: add `<SetPageTitle title="Reports" />` (client component from Slice 1) and REMOVE `PageHeader`. Header count row: `Range {from} – {to} · {team.rows.length} users · {projects.rows.length} projects` (`text-label text-text-secondary tt-numeric`) with the Export CSV button pushed right (reskin the link to match mockup L689: `bg-surface-raised border-separator rounded-md border px-3 py-1.5 text-label`). Then `<ReportRangePicker>` (keep). "By person": `<SectionHeader label="By person" />` + `<ReportsByPersonTable rows={team.rows} />`. "By project": `<SectionHeader label="By project" />` + a `<Card padding="md">` with a `flex flex-col gap-3.5` list of `<BarMeter label={name} value={formatDuration} fills={[{pct: tracked/max*100, color: 'var(--tt-accent)'}]} />` per project row (compute max). Keep the forbidden + error + empty-range messages. Step 2: typecheck+lint+build clean; confirm the page is still server-rendered (only the table + SetPageTitle are client). Step 3: commit `feat(dashboard): reskin reports screen to mockup`.

### Task 4: e2e scaffold

**Files:** Create `apps/dashboard/e2e/reports.spec.ts` (skipped, append-only single new file). Cases: by-person table renders + sort toggles; by-project bars render; Export CSV link present; header shows the range/counts. Mirror existing scaffolds; curly apostrophes. Commit `test(dashboard): scaffold reports reskin e2e cases`.

---

## Final verification

`pnpm lint && typecheck && test && build` green. Final whole-branch review (opus). Visual pixel
check deferred to the user's eyeball (dev server at localhost:3000/reports) — note in review.
Old `TeamSummaryTable.tsx` is now unused by the page; leave it in place (removing it is separate
cleanup) OR delete if nothing else imports it (grep first; if unused, delete in Task 3 and note).

# Dashboard Redesign — Slice 7: Person reskin (Implementation Plan)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Reskin `/people/[userId]` to the mockup — back button + person header (avatar · name ·
tracking dot · role) + Card-wrapped Timeline and 7-day Activity — composing the already-reskinned
shared `Timeline` and `ActivitySummaryPanel`. Last screen reskin before Overview.

**Architecture:** `apps/dashboard` only. Server page; resolves the person's name via `teamOverview`
(manager-scoped) for the header. Uses `SetPageTitle`, `Card`, `SectionHeader`, `Avatar`.

## Global Constraints

- `dashboard` scope only. No api/contracts/db change. No new dependency. No console.log.
- **Preserve behavior:** manager-owns-team gating — a 403 on the entries/summaries read → the
  existing "You’re not permitted to view this person." state (curly ’). Keep the self-scoped
  `Promise.all` shape + the `activitySummaryWindow`.
- **Data reconciliation (decided):**
  - The page has only `userId`, not the person's name. Resolve name (+ live `tracking`) via
    `api.teamOverview` (manager/admin-scoped; returns `rows: {userId, name, tracking}`): find the row
    for `userId`. Wrap in try/catch → if it fails or the row is absent, fall back to name
    "Team member" and no tracking dot (never crash the page on the header lookup).
  - **Defer the net-new widgets** the mockup shows that have no ready data source: the person **KPI
    row**, the **14-day productivity-trend** card, and the **per-person screenshots** grid (manager
    view). These need new aggregations/authz work — fold into the Overview-era backend, not this
    reskin. Note them; do not fabricate.
  - The mockup's "7-day activity" card (daily bars + apps + category mix) IS covered by the existing
    reskinned `ActivitySummaryPanel` — reuse it.
- Title → header via `SetPageTitle` (the person's name once resolved, else "Person"); remove
  `PageHeader`. Back button links to `/` (Overview). Tokens/utilities; `tt-numeric`. Page stays a
  Server Component.
- Commits `feat(dashboard)`/`test` ≤72, NO AI attribution, author = repo git user. Stay on
  `feat/ds-10-person-reskin`; verify branch; never main.

## Mockup reference

`/private/tmp/.../scratchpad/TimeTrack.dc.html` Person L589–682: header L592–599 (Back · avatar ·
name · tracking dot · role); permission note L600; Timeline card L614–627; 7-day activity card
L628–650; (KPI row L603–611, productivity-trend L652–662, screenshots L666–680 → DEFERRED).

---

### Task 1: Reskin `people/[userId]/page.tsx`

**Files:** Modify `apps/dashboard/src/app/(app)/people/[userId]/page.tsx`.

- [ ] Read it first. Keep session + the `Promise.all([listTimeEntries, listActivitySummaries])`
      with the 403→not-permitted state. ADD a guarded name lookup: `let person = { name: 'Team member',
tracking: false }; try { const ov = await api.teamOverview(session.accessToken); const row =
ov.rows.find(r => r.userId === userId); if (row) person = { name: row.name, tracking: row.tracking }; }
catch {}` (place BEFORE the render; do not let it throw — it's decorative header data).
      Render:
  - `<SetPageTitle title={entries === null ? 'Person' : person.name} />`; REMOVE `PageHeader`.
  - When permitted, a `flex flex-col gap-5` column:
    - Header row (`flex flex-wrap items-center gap-3.5`): a Back `<Link href="/">` styled
      `border-separator text-text-secondary rounded-md border px-2.5 py-1.5 text-label` with "← Back";
      `<Avatar name={person.name} size={40} />`; a column with the name `text-[22px] font-semibold
tracking-[-0.02em]` and a sub-line `text-caption text-text-secondary flex items-center gap-1.5`
      showing (only if `person.tracking`) a `<span className="h-[7px] w-[7px] rounded-full bg-recording" />`
      - "Currently tracking".
    - `<section className="flex flex-col gap-3"><SectionHeader label="Timeline · today" /><Card padding="md"><Timeline entries={entries} /></Card></section>`
    - `<section className="flex flex-col gap-3"><SectionHeader label="Activity · last 7 days (UTC)" /><ActivitySummaryPanel summaries={summaries} from={from} to={to} /></section>`
  - Keep the not-permitted `<p>` for the 403 branch.
- [ ] typecheck+lint+build clean; page stays a Server Component. Commit `feat(dashboard): reskin person screen to mockup`.

### Task 2: e2e scaffold

**Files:** Create `apps/dashboard/e2e/person.spec.ts` (skipped, append-only NEW file). Cases: back
button present; person header shows a name + avatar; Timeline · today section; 7-day activity section.
Skipped; realistic selectors; curly apostrophes. Commit `test(dashboard): scaffold person reskin e2e cases`.

---

## Final verification

`pnpm lint && typecheck && test && build` green. Final whole-branch review (sonnet — small).
Visual check = user eyeball. Blast radius: person page + new e2e only (shared Timeline/Activity
already reskinned in Slice 6).

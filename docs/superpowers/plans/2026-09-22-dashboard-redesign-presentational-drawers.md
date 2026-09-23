# Dashboard redesign, Plan 3 — presentational drawers and toasts

Date: 2026-09-22
Branch: `feat/dashboard-interaction-capabilities` (stacked on `refactor/dashboard-redesign`, PR #224).
Spec: `docs/superpowers/specs/2026-09-21-dashboard-clickup-sync-redesign-design.md` §6.3(a), §6.4.

Plan 2 shipped `Drawer` and `useToast` with no caller. This plan gives them their callers, adds
the optional Reports → person drawer, and fixes the one stale e2e test. Nothing merges until this
is done (the whole redesign lands together).

## Scope

In:

1. A result-toast hook, wired to every form whose success is currently silent.
2. Approvals: a week-detail drawer with the decide controls.
3. Projects: a quick-look drawer.
4. Day panels: a time-entry detail drawer (works on `/me`, `/people/<id>`, and nested inside the
   Overview person drawer).
5. Reports: clicking a person row opens the person drawer (§6.3(b) machinery, reused).
6. `e2e/session.spec.ts:58` expects "Install the Mac app"; d76535e renamed it "Install the app".
7. E2E coverage for 2–5, and the handoff/spec docs.

Out, on purpose (each decided in an earlier plan with a reason that still holds): the project
detail drawer (spec §6.3(b) amendment), `--pill-*`, `.card-3d`, `.switch-3d`, audit on
`DataTable`, in-page Suspense boundaries.

## Global constraints

- Dashboard vitest is node-env: test pure `lib/` transforms and closed-state markup via
  `renderToStaticMarkup`. Do **not** add new `readFileSync`-the-source specs.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Conditionally spread
  optional props; guard index access. Run `pnpm --filter @timetrack/dashboard typecheck`, since
  vitest does not typecheck.
- `Button` has no `onClick`. Click triggers are raw `<button type="button">` elements.
- Pages stay Server Components and keep their fetch. Only the leaf that owns drawer state is
  `'use client'`, and it takes already-fetched rows as props. Functions cannot cross the RSC
  boundary: pre-render per-row server slots into `ReactNode`s keyed by id.
- Row-level click handlers must ignore clicks that start on an interactive descendant
  (`closest('a,button,input,select,textarea,form,label,[role="dialog"]')`), and every drawer must
  also be openable from a real `<button>` so keyboard users can reach it.
- A local `pnpm dev` is running for the user. Do **not** run `next build` (it fights the dev
  server over `.next`); the controller runs the build at the end.
- Commits: Conventional Commits, scope `dashboard`, no AI attribution. Never stage
  `apps/worker/scratch-seed-*.ts`.

---

## Task 1 — result toasts

**Create** `src/components/ui/useResultToast.ts` (`'use client'`):

```ts
export function useResultToast(
  state: { ok: boolean },
  message: string | ((state: S) => string),
): void;
```

Fires `useToast()(message)` (tone `good`) in an effect keyed on the `state` object whenever
`state.ok` is true. `useActionState` returns a fresh object per submission, and the initial
state is `{ ok: false }`, so it fires once per successful submit and never on mount. Errors stay
inline as they are today; no error toasts, to avoid reporting a failure twice.

**Wire it** into the forms whose success currently produces no visible confirmation:

| Form                                                   | Message                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `approvals/DecideForm.tsx`                             | "Timesheet approved" / "Timesheet flagged"                       |
| `me/ResolveIdleForm.tsx`                               | "Idle time kept" / "Idle time discarded"                         |
| `components/day/AddTimeEntryForm.tsx`                  | "Time entry added"                                               |
| `components/day/EntryRowActions.tsx` edit              | "Time entry updated"                                             |
| `components/day/EntryRowActions.tsx` delete            | "Time entry deleted"                                             |
| `components/projects/NewTaskForm.tsx`                  | "Task added"                                                     |
| `components/projects/ProjectArchiveToggle.tsx`         | "Project archived" / "Project restored"                          |
| `components/projects/TaskArchiveToggle.tsx`            | "Task archived" / "Task restored"                                |
| `components/projects/ProjectRecolor.tsx`               | "Colour updated"                                                 |
| `components/projects/ProjectTeamMove.tsx`              | "Project moved"                                                  |
| `admin/users/RoleSelect.tsx`                           | "Role updated"                                                   |
| `admin/users/TeamSelect.tsx`                           | "Team updated"                                                   |
| `admin/users/UserRowActions.tsx`                       | "User deactivated" / "User reactivated" / "User erased"          |
| `admin/teams/CreateTeamForm.tsx`, `RenameTeamForm.tsx` | only if success is silent today: "Team created" / "Team renamed" |

Leave `SettingsForm`, `InviteForm` and `NewProjectForm` alone if they already render a success
message inline (read each first; if one is silent, wire it).

Where the message depends on what was chosen (approve vs flag, keep vs discard, archive vs
restore), the action must say so: add a field to that action's success result (for example
`DecideState` gains `status?: 'APPROVED' | 'FLAGGED'`) rather than guessing in the client. Update
the action's spec if it has one.

**Tests:** a pure helper if any message logic is non-trivial (for example `decideToastMessage`);
existing specs stay green.

**Commit:** `feat(dashboard): confirm silent form actions with a toast`

## Task 2 — approvals week drawer

Today the approvals table is server-rendered, the flag note is never shown, and the only control
is the Decide popover.

- **Create** `src/lib/approvals-drawer-view.ts` + spec: a pure `toApprovalDetail(row, now?)` that
  derives what the drawer shows from a `TimesheetApproval`:
  - week label and the Dhaka date range (`periodStart` to `periodEnd - 1 day`)
  - tracked hours (live `trackedSeconds`) and, when decided, the snapshot (`totalSeconds`)
  - `driftSeconds`: the difference between the two when both exist and differ (time tracked or
    edited after the decision), otherwise null
  - status badge + the "automatically" flag (reuse `statusBadge`, `wasAutoDecided`)
  - decided-at label, reviewer note
  - `weekHref`: `/people/<userId>?date=<periodStart day>` (the person's day view on the week's
    first day; the week strip there covers the rest)
- **Create** `src/app/(app)/approvals/ApprovalsTable.tsx` (`'use client'`): renders the existing
  table markup from `rows: TimesheetApproval[]`, owns `openId` state, and renders one `Drawer`
  for the open row. The user's name becomes a `<button>` that opens the drawer; the row also
  opens it on click (guarded, see constraints). `DecideForm` stays in the row.
- The drawer body: avatar + name, week and range, hours (with drift called out when non-null),
  status badge, decided at, the note (or "No note"), and a link "Open <first name>'s week".
  Footer: the decide controls laid out inline (note field, Approve, Flag for payroll), using the
  same `decideAction`. Extract the shared field/button markup from `DecideForm` rather than
  copying it. On success: the Task 1 toast, and the drawer closes.
- `approvals/page.tsx` keeps its fetch and passes `rows` to `ApprovalsTable`.

**Commit:** `feat(dashboard): open an approval's week in a drawer`

## Task 3 — projects quick look

- **Widen** `ProjectIndexRow` in `src/lib/projects-index-view.ts` with
  `tasks: { id: string; name: string }[]` (the non-archived tasks, in list order; `taskCount`
  stays and equals `tasks.length`). Update its spec.
- **Create** `src/components/projects/ProjectsList.tsx` (`'use client'`): the `<ul>` from
  `projects/page.tsx` moved as-is (including the "No project" and "Projects not listed" footer
  rows, passed as props), owning `openId` and one `Drawer`. The name stays a `Link` to the full
  project page. Add a trailing icon `<button aria-label="Quick look at <name>">` per project row;
  a click elsewhere on the row (guarded) opens it too. `ProjectArchiveToggle` stays in the row.
- The drawer: colour dot + name + Archived badge, the range line from the page kicker, tracked
  time and share (with `Meter`), the task list (or "No tasks yet"), and footer links: "Open
  project" (primary, to `/projects/<id>`) and the archive toggle.
- `projects/page.tsx` keeps its fetch and renders `ProjectsList`.

**Commit:** `feat(dashboard): add a quick-look drawer to the projects list`

## Task 4 — time-entry detail drawer

- **Widen** `DayEntryRow` in `src/lib/person-day-view.ts` with:
  - `projectName: string | null`, `taskName: string | null` (from the `projects` input; null when
    unresolved)
  - `source: 'MANUAL' | 'AUTO'`
  - `activity: { activePct: number | null; mix: CategoryMix; topApps: { app: string; minutes: number }[] }`,
    computed from the day's `samples` whose timestamp falls inside the entry's `[start, end)` (an
    open entry ends at `now`). `activePct` is the mean `activityPct`; `mix` counts categories
    (same shape as `idle-view`'s `CategoryMix`); `topApps` is the five apps with the most samples,
    one sample ≈ one minute, ties by name. Only `appName`, never a window title.
  - Spec cases: entry with no samples (null / zero mix / empty apps), open entry, samples outside
    the window ignored, top-5 cut and tie order.
- **Create** `src/components/day/TimeEntriesDrawerList.tsx` (`'use client'`): the list markup from
  `TimeEntriesList`, plus `openId` state and one `Drawer`. It takes `entries: DayEntryRow[]` and
  `actions?: Record<string, ReactNode>`. `TimeEntriesList` stays a Server Component and becomes
  the adapter: it pre-renders `rowAction?.(e)` for each entry into that record, so the server
  slot keeps working.
- Each row's label becomes a `<button>` that opens the drawer; the row opens it too (guarded; the
  edit/delete controls must not open it).
- The drawer (default size): time range and duration (or "running"), project and task, note,
  "Added by hand" / "Tracked by the app", then "During this entry": active %, `CategoryMixBar`,
  and the top apps with minutes. Read-only: editing stays on the row.
- Nesting: on Overview this list already sits inside the person `RouteDrawer`. Drawer is not
  portalled, so the inner drawer renders inside the outer panel, which already treats an inner
  `[aria-modal="true"]` as owning Escape and narrows its focus trap to it. Verify in the browser:
  one Escape closes only the entry drawer, and a second closes the person drawer.

**Commit:** `feat(dashboard): open a time entry's detail in a drawer`

## Task 5 — Reports rows open the person drawer

Reuse the Overview machinery exactly (read `overview/layout.tsx`'s comment first):

- `app/(app)/reports/layout.tsx` owning a `@drawer` slot.
- Move `reports/{page,loading,error}.tsx` into `reports/(board)/` (so the segment's loading and
  error files don't also render in the slot). `reports/export/` stays where it is.
- `app/(app)/reports/@drawer/{page,default,loading,error}.tsx` and
  `@drawer/(..)people/[userId]/page.tsx`.
- Don't duplicate the intercepted page: extract its body from
  `overview/@drawer/(..)people/[userId]/page.tsx` into a shared server component (for example
  `components/people/PersonDrawerPage.tsx`) that both slots render. Same for the slot's
  `loading`/`error`/`default`/`page` if they are more than one-liners.
- Rows push `/people/<id>`, which Next now intercepts from `/reports`. Relative imports in the
  moved files get one more `../`.
- The dev server keeps stale interception rewrites: the controller restarts it after this task.

**Commit:** `feat(dashboard): open a person from reports in a drawer`

## Task 6 — e2e

- `e2e/session.spec.ts`: "Install the Mac app" → "Install the app". Commit on its own:
  `test(dashboard): follow the sidebar's renamed install link`.
- `e2e/presentational-drawers.spec.ts`, env-gated like `detail-drawer.spec.ts` (reuse its
  `signIn`/`hydrated` helpers or copy their shape):
  - Approvals (`?status=all`): clicking a name opens a drawer showing that row's week; Escape
    closes it. Don't submit a decision (it writes).
  - Projects: the quick-look button opens a drawer with the project's name and "Open project";
    Escape closes; clicking the name still navigates to `/projects/<id>`.
  - Entry drawer on `/people/<E2E_SHOT_USER_ID>?date=<E2E_SHOT_DATE>`: clicking an entry opens
    "During this entry".
  - Nested: from Overview, open a person (drawer), open an entry, Escape → entry drawer gone,
    person drawer still open; Escape again → back on `/overview`.
  - Reports: clicking a person row opens the drawer and the URL is `/people/<id>`; a reload
    renders the full page.
- **Commit:** `test(dashboard): cover the presentational drawers end to end`

## Task 7 — docs

- Spec §6.3(a): record what each drawer shows. §6.3(b): Reports is the second intercepting
  source.
- Plan 2 handoff: §1 status and §3's "Spec gap, not built" entry updated; "Known limits" loses
  the Reports line. Add a short Plan 3 section.

**Commit:** `docs(dashboard): record the presentational drawers`

## Done when

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green (build with dev stopped).
- The dashboard e2e suite passes in full against the local stack.

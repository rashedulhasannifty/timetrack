# Dashboard redesign, Plan 2 — handoff

Date: 2026-09-22
Branch: `feat/dashboard-interaction-capabilities`, stacked on `refactor/dashboard-redesign`
(Plan 1, PR #224, **not merged**). Companion to `2026-09-22-dashboard-redesign-handoff.md`.

Plan: `docs/superpowers/plans/2026-09-21-dashboard-redesign-interaction-capabilities.md`.
As with Plan 1, the execution ledger was gitignored; this file holds what it recorded.

---

## 1. Status

|                                        |                                                                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 4 — DataTable (Tasks 1–9)        | **complete**, including the DEFERRABLE Tasks 7–9                                                                                                                            |
| Phase 5 — states (Tasks 10–13)         | **complete**                                                                                                                                                                |
| Phase 6 — drawer/toast/density (14–16) | **complete**                                                                                                                                                                |
| Phase 7 — intercepting routes (17–19)  | **complete** for the person drawer; the project drawer is descoped (see §4)                                                                                                 |
| Plan 3 — presentational drawers        | **complete**: approvals, projects and time-entry drawers, action toasts, and Reports → person drawer (see §5)                                                               |
| Review                                 | every task spec+quality reviewed; a final review for Phases 4–6 and another for Phase 7, each fix wave re-reviewed                                                          |
| Gate                                   | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green — dashboard 498, api 316, worker 80                                                                          |
| E2E                                    | against the local stack: 29 passed, 1 failed (`session.spec.ts:58`, which failed before this branch too). Baseline before Phase 7: 6 failed                                 |
| PR                                     | **none yet.** Nothing merges until the whole redesign is done. Then rebase onto `origin/main` (a PR based on another feature branch reports MERGED but never reaches main). |

---

## 2. Before merging

1. **Expired-session redirect: checked, not a problem.** The concern was that a page's
   `redirect(refreshBackTo(...))` under the new `loading.tsx` would stream as a ~1s meta-refresh.
   On a hard load the page never gets that far. `getSession()` is null once the access token has
   expired, and the `(app)` layout redirects before anything streams, because the layout sits above
   every segment's `loading.tsx`. Checked with curl and a cookie re-encrypted with a past
   `accessExpiresAt`: `/overview`, `/admin/audit` and `/people/<id>` each returned a real 307 to
   `/api/auth/refresh`. The page-level redirect only runs on soft navigations, which the client
   router handles without a meta-refresh.
2. **Visual checks, never done in a browser:**
   - Overview People row height (the cell's `py-[13px]` gave way to the density variable).
   - Reports "Activity %" alignment.
   - `row-3d` hover in light and dark.
   - Empty states inside their cards on Overview, Reports and Audit.
   - The density button in the top bar, including below 900px.
   - Toggling density and reloading: no flash, rows retune, and the choice persists.
   - The error boundary under `next build && next start` (throw in `reports/page.tsx`, confirm the
     shell survives and "Try again" re-fetches).

---

## 3. Decisions taken without asking

Each could be reversed cheaply.

- **Plan text that could not work as written:**
  - PeopleTable's fixture uses `activityPct: 47`, because "50%" contains "0%" and the em-dash test
    could never pass.
  - Two expected test counts were corrected.
  - The loading.tsx import path in the plan was a placeholder; the real path is used.
  - `IconClose` and `IconRows` use the icon file's `Base` helper, not raw 16px svgs.
  - `Th` gained `style?: CSSProperties | undefined`, which `exactOptionalPropertyTypes` requires.
- **Frozen columns render at their declared width.** A sticky column without a width is now a type
  error, so frozen columns can't overlap.
- **Error boundaries** (`components/ui/SegmentError.tsx`, re-exported by 7 thin `error.tsx` files):
  - Next strips Server Component error messages in production, so any error carrying a `digest`
    shows "The page could not be loaded." instead of Next's boilerplate.
  - "Try again" uses Next 16.3's `retry`, which re-fetches, not `reset`, which only re-renders
    stale state.
- **PeopleTable has no row click.** Its name link navigates, and a `<tr onClick>` would
  double-handle that click. The overview hint now says "click a name".
- **Kept DEFERRABLE Tasks 7–9** (paging, selection, column hiding, expansion) as the earlier
  handoff intended. They have no consumer.
- **Spec gap, since closed:** spec §6.3(a)'s presentational drawers were designed and built in
  Plan 3 (§5).
- **Final-review fixes:**
  - Accessibility: indeterminate select-all, `role="group"` columns panel, `<h2>` titles on empty
    and error states, dismissible toasts with an assertive region for failures.
  - The pager clamp.
  - Reports cell alignment.

Known and left as is:

- `(app)/error.tsx` can't catch the layout's own `/me` failure (pre-existing).
- The columns panel doesn't close on Escape and would clip inside `overflow-hidden` cards. No
  adopter uses it yet.
- Report rows are only reachable through `<tr onClick>`, not by keyboard (pre-existing).
- `--row-h` is defined but unused.
- Three specs pin state-gated markup by reading the component source (`readFileSync`), because
  node-env vitest can't open the columns panel or push a toast. They prove the string exists, not
  that it is wired to the right branch. Each was checked by hand; don't extend the pattern.
- The plan's Done-when greps trip on:
  - `TableSkeleton`'s aria-hidden table, which the plan itself mandates;
  - pre-existing co-located client components under `src/app`.

---

## 4. Phase 7 — what was built

- **Clicking a person's name on Overview opens their day view in a drawer**, and the URL becomes
  `/people/<id>`.
  - Files: `overview/layout.tsx`, `overview/@drawer/(..)people/[userId]/page.tsx`, plus `page.tsx`,
    `default.tsx`, `loading.tsx` and `error.tsx` in the slot.
  - Pasting, refreshing or middle-clicking that URL gives the full page.
- **Page and drawer render the same code.** Both use `components/people/PersonDayContent.tsx`, so
  they can't disagree. The project page got the same split (`ProjectDetailContent`).
- **The drawer can't hijack the full page.** The slot lives under `overview/`, so Next only
  intercepts navigations that start on `/overview`. Changing the tab or date on a directly loaded
  `/people/<id>` never opens a drawer.
- **Close and Escape return to Overview in one step.** Inside the drawer, tab and date changes
  replace history instead of adding to it. On the full page, Back still steps through days.
- **Overview's page, loading and error files live in `overview/(board)/`.** Otherwise Next shows
  Overview's skeleton in the drawer slot as well, and "← Back" showed two skeletons.
- **Keyboard handling:**
  - The drawer takes focus when it opens, keeps Tab inside it, and hands focus back when it closes.
  - An inner dialog owns its own keys: the screenshot lightbox, or any `[aria-modal]` or
    `dialog[open]`.
  - So does an open inline form (Add time, Edit or Delete on an entry): Escape collapses the form
    and leaves the drawer open. Its typed values are still discarded.
- **Project drawer: not built.** Next matches interception by the `Next-Url` prefix, and every file
  placement that can sit over `/projects` also matches `/projects/<id>`. That page's range picker
  soft-navigates, so a drawer would open over the full project page. A `proxy.ts` that strips the
  header would work, but was declined as too much blast radius for one drawer. Spec §6.3(b) is
  amended to match.
- **E2E:**
  - `e2e/detail-drawer.spec.ts` covers the cases above. It is date- and hydration-proof and skips
    only when the `E2E_*` env is missing.
  - `e2e/screenshot-lightbox.spec.ts` now opens the Screenshots tab, waits for hydration, and
    expects login to land on `/overview`.
  - To run the suite:

    ```bash
    # repo root: docker compose -f infra/docker-compose.yml up -d && pnpm dev; then, in apps/dashboard:
    set -a; . ../../.env; set +a
    E2E_ADMIN_EMAIL="$SEED_ADMIN_EMAIL" E2E_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
      E2E_SHOT_USER_ID=<a user with screenshots> E2E_SHOT_DATE=<YYYY-MM-DD> \
      ./node_modules/.bin/playwright test --workers=1
    ```

**Left for a human to try:**

- Save an edit or add an entry inside the drawer: the drawer should stay open and show the change.
  No e2e test covers this, because it writes to the DB.
- The expired-token round trip after clicking a person. It lands on the full page, via
  `refreshBackTo`.

**Known limits:**

- Close or a backdrop click discards a half-filled form.
- One Escape collapses every open inline row.
- Next 16.3's dev server keeps stale interception rewrites. Restart it after renaming or removing an
  intercepting route.

### Pre-implementation notes (kept for the record)

1. **Don't copy the pages.** Task 17/18 say to copy the ~170-line person page and the ~240-line
   project page verbatim into the intercepted routes. Instead, extract each page body into a shared
   async Server Component that both the page and the drawer render. That also guarantees the
   plan's own goal, "drawer and full page never disagree".
2. **An (app)-level `@drawer/(.)people/[userId]` will likely intercept soft navigation from the
   hard-loaded full person page to itself.** That covers DayTabs `?panel=`, date navigation and
   WeekStrip, and would open a drawer over the full page. It would also break
   `e2e/screenshot-lightbox.spec.ts`'s date navigation. Consider scoping interception to the source
   pages (overview, reports, the projects index), and verify the behaviour empirically either way.
3. **The slot keeps its last state on a soft navigation away** (for example the page's "← Back"
   link). Add `@drawer/[...catchAll]/page.tsx` returning null.
4. **Leave out the title setter in the drawer.** The pages' `<SetPageTitle>` would retitle the
   chrome over the underlying page.
5. **Drawer needs focus management first.** It is `aria-modal` but has no initial focus, focus
   trap or focus return. Phase 7 is the first thing that mounts it, so this blocks that phase.
6. **Task 19's E2E currently can't run.**
   - Dashboard Playwright isn't in CI.
   - `e2e/person.spec.ts` is a skipped scaffold.
   - The suite needs the docker stack, a seeded DB, the API and the dashboard all running.

   Budget for standing that up; it is the phase's only safety net.

---

## 5. Plan 3 — presentational drawers and toasts

Plan: `docs/superpowers/plans/2026-09-22-dashboard-redesign-presentational-drawers.md`.

- **Toasts:** every form whose success was silent now confirms with a toast. The forms touched are
  in approvals, the day views, idle, projects, and admin users and teams. Settings and Invite
  already said so inline and are unchanged.
  - The toast is pushed from inside the action wrapper (`components/ui/useToastAction.ts`), not
    from an effect. A first version used an effect and lost exactly the toasts that matter: when
    approving on Pending, deleting an entry or archiving, the revalidated page unmounts the form
    in the same commit.
  - Where the wording depends on which button was pressed, the action's success result carries
    the choice (`status`, `resolvedAction`, `archived`, `deactivated`).
- **Approvals drawer** (`approvals/ApprovalsTable.tsx`): opened by clicking the name or the row. It
  shows tracked vs decided hours and drift, status, decided-at, the note and a link to the week,
  with the decide controls in the footer. `DecideFields` is shared with the row popover.
- **Projects quick look** (`components/projects/ProjectsList.tsx`): opened by an icon button or a
  row click. It shows hours, share and tasks, "Open project", and the archive toggle.
  `ProjectIndexRow` gained `tasks`.
- **Time-entry drawer** (`components/day/TimeEntriesDrawerList.tsx`, fed by the server adapter
  `TimeEntriesList`): `DayEntryRow` gained project and task names, source, and per-entry activity
  (active %, mix, top five apps). It nests inside the person drawer: one Escape closes it, the next
  closes the person. `Drawer` now ignores a Tab that an outer drawer has already handled.
- **Reports → person drawer:** `reports/layout.tsx` has its own `@drawer` slot. Reports'
  page, loading and error files moved to `reports/(board)/`. Both slots share
  `components/people/PersonDrawerPage` and its loading/error. Report names are now links, so the
  rows are keyboard-reachable, and `DataTable`'s row click ignores clicks that start on a link or
  control.
- **Shared row-click guard:** `lib/row-click.ts`.
- **E2E:**
  - `e2e/presentational-drawers.spec.ts` is new.
  - `session.spec.ts` now expects the sidebar's "Install the app", renamed in d76535e.

**Left for a human to try:**

- Deciding from the approvals drawer, where the toast should appear and the row leave Pending.
- Archiving from the projects drawer.
- Adding, editing or deleting an entry, and resolving idle time, each of which should toast.

None of these is covered by e2e, because they write.

# Dashboard redesign, Plan 2 — handoff

Date: 2026-09-22
Branch: `feat/dashboard-interaction-capabilities`, stacked on `refactor/dashboard-redesign`
(Plan 1, PR #224, **not merged**). Companion to `2026-09-22-dashboard-redesign-handoff.md`.

Plan: `docs/superpowers/plans/2026-09-21-dashboard-redesign-interaction-capabilities.md`.
As with Plan 1, the execution ledger was gitignored; this file holds what it recorded.

---

## 1. Status

|                                        |                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 4 — DataTable (Tasks 1–9)        | **complete**, including the DEFERRABLE Tasks 7–9                                                                                                           |
| Phase 5 — states (Tasks 10–13)         | **complete**                                                                                                                                               |
| Phase 6 — drawer/toast/density (14–16) | **complete**                                                                                                                                               |
| Phase 7 — intercepting routes (17–19)  | **not started** — deliberately; see §4                                                                                                                     |
| Review                                 | every task spec+quality reviewed; final whole-branch review done, its fix wave re-reviewed                                                                 |
| Gate                                   | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green — dashboard 490, api 316, worker 80                                                         |
| PR                                     | **none yet.** Open it only after #224 merges, then rebase onto `origin/main` (a PR based on another feature branch reports MERGED but never reaches main). |

---

## 2. Before merging

1. **Expired-session redirect (the one real behaviour change).** The new `loading.tsx` files add a
   Suspense boundary above every page. A page's `redirect(refreshBackTo(...))` on a 401 used to be a
   307; it now arrives after the skeleton has streamed, as a meta-refresh with a ~1s delay plus a
   client-side replace. To check it: keep the refresh cookie, drop the access token, hard-load
   `/overview` and `/admin/audit`. If the flash is unacceptable, the fix is a 401 probe in the
   `(app)` layout. That behaviour change was not made here.
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
- **Spec gap, not built:** spec §6.3(a) wants presentational drawers for approvals, projects and
  the day panels, and the plan never designed them. `Drawer` and `useToast` therefore ship with no
  caller.
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
- The plan's Done-when greps trip on:
  - `TableSkeleton`'s aria-hidden table, which the plan itself mandates;
  - pre-existing co-located client components under `src/app`.

---

## 4. Phase 7 — settle these before starting it

The plan says to ship Phase 7 alone, after Phase 6 is merged. Reading the code turned up the
following:

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

# Dashboard redesign — handoff

Date: 2026-09-22
Branch: `refactor/dashboard-redesign` (22 commits off `main` @ `2aebaf1`)

This file exists because the execution ledger that tracked this work lives in
`.superpowers/sdd/`, which is gitignored and therefore does **not** travel with a push.
Everything below was in that ledger.

---

## 1. Status

|                                                     |                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Spec                                                | `docs/superpowers/specs/2026-09-21-dashboard-clickup-sync-redesign-design.md`                            |
| Plan 1 — visual foundation (spec Phases 1–3)        | **complete**, all 13 tasks, every one reviewed                                                           |
| Plan 2 — interaction capabilities (spec Phases 4–7) | **not started**, 19 tasks                                                                                |
| Gate                                                | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green — dashboard 412 tests, api 316, worker 80 |
| Merged?                                             | **No.** Nothing merged to `main`.                                                                        |

Plan 1 delivered: the token layer (tighter radius scale, depth recipes, density variables,
per-destination nav hues), the shared primitives rebuilt on it (`Button`, `Card`, `TabPills`,
`StatCard`, `Table`, plus a new `Sparkline`), and the hardcoded-radius sweep. The app keeps its
teal identity, Schibsted Grotesk / IBM Plex Mono and full type scale. No dependency was added.

---

## 2. Before merging: a human visual pass is outstanding

There is no visual-regression tooling in this repo, and the subagents that executed the plan were
required to report browser steps as NOT PERFORMED rather than fabricate them. So these were never
checked by eye. **Phases 1–3 are all-or-nothing** — the original "Phase 1 is a single-file revert"
mitigation went stale at commit `213a755`, because the primitives now depend on tokens the first
phase introduced (spec §10 risk 1 has been corrected to say so).

In priority order:

1. **`/overview` in dark** — do Cards read as raised at all? Set `--tt-elevation-1: none` in
   devtools; if the page barely changes, the dark depth is still too subtle. The dark edge is
   `#3a3a40` on a `#111113` ground = 1.67:1, deliberately faint.
2. **`/overview` KPI tiles, both themes** — the 10.5px eyebrow labels, read at arm's length.
3. **The sidebar** — nav hues on icons and the tinted active row are newly wired and visibly
   different from before. The active row also lost its border and its shadow by design.
4. **`/login` and `/accept-invite`, both themes** — cards moved 16px → 12px, now sitting above
   8px buttons.
5. **`/admin/settings`** — number fields should read as recessed wells; the checkbox should
   **not** (an inset shadow on a checkbox reads as damage, which is why it is excluded).
6. **`/overview` "Apps & websites" card and `/approvals`** — active tab corners against the
   track, and in dark whether the `#232327` track reads as recessed despite being _lighter_ than
   the `#1a1a1d` card around it. This is the one place the dark depth model contradicts itself.
7. **`/me` screenshot lightbox, `/day` header nav pill, sidebar theme toggle** — these had the
   hard shadow edge removed; confirm nothing looks stranded.
8. **Keyboard-tab across `/projects`** — every focused control re-shapes to 4px (pre-existing;
   see deferred item 5).

---

## 3. Deferred findings — none blocking, all recorded

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                     | Where                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | `block()` uses a naive brace counter; would mis-parse a `{` inside a custom-property value. Guarded upstream — Tailwind v4 fails the build on malformed CSS first.                                                                                                                                                                                                                                          | `apps/dashboard/src/app/globals.spec.ts`        |
| 2   | className template collapses to consecutive spaces mid-string when `pad`/`lift` are empty and `className` is not. Harmless in HTML; would make an exact-string assertion brittle. `[...].filter(Boolean).join(' ')` is the fix.                                                                                                                                                                             | `apps/dashboard/src/components/ui/Card.tsx`     |
| 3   | The flat-series branch (`y = height/2`) skips the 2-decimal rounding the other branch applies. Only inexact for odd heights; default is 16.                                                                                                                                                                                                                                                                 | `apps/dashboard/src/lib/sparkline.ts`           |
| 4   | `TabPillTrack`'s `raised` prop has collapsed into a border toggle — both branches are now `bg-muted-bg` + `.seg-track` — and its doc comment now contradicts itself ("raised" describes a recessed thing). Either drop the prop or give the sunken variant a distinct ground. Its only `raised={false}` consumer is `AppUsageTabs.tsx`.                                                                     | `apps/dashboard/src/components/ui/TabPills.tsx` |
| 5   | **Pre-existing, now more conspicuous:** the unlayered universal `:focus-visible { border-radius: var(--radius-sm) }` overrides every Tailwind `rounded-*`, so any focused control snaps to 4px — a `rounded-full` pill becomes a rounded square, and now drags its `.btn-3d` edge with it. Modern browsers already make `outline` follow `border-radius`, so the line is unnecessary. Wants its own commit. | `apps/dashboard/src/app/globals.css`            |
| 6   | `--row-h: 48px` doesn't match its own `--pad-y: 12px` (12 + 12 + ~18px line-height ≈ 42px). Compact is self-consistent. No consumer yet; Plan 2 Phase 6 inherits it.                                                                                                                                                                                                                                        | `apps/dashboard/src/app/globals.css`            |
| 7   | Four things currently have no call site: `Card`'s `interactive` prop, `StatCard`'s `trend` prop, `Sparkline.tsx` and `lib/sparkline.ts`. `.input-3d` and `.row-3d` are also unused but are consumed by Plan 2. The sparkline has no planned consumer in **either** plan.                                                                                                                                    | various                                         |

---

## 4. Plan 2 — what to know before starting it

`docs/superpowers/plans/2026-09-21-dashboard-redesign-interaction-capabilities.md`, 19 tasks,
103 steps. It states Plan 1 must be merged first.

Two things the plan records that are easy to miss:

- **Tasks 7–9 are marked DEFERRABLE.** They build `DataTable`'s pagination, row selection,
  column hiding and expandable rows — four features with **no consumer** among the two adopters
  (`PeopleTable`, `ReportsByPersonTable`), which need only sorting and row-click. They are in
  because the spec asked for them. The intent as of this handoff was to keep them; dropping the
  three tasks costs nothing elsewhere.
- **Phase 7 (intercepting-route drawers) is the riskiest piece.** Nothing in the codebase uses
  parallel or intercepting routes. It is isolated as the last PR for that reason, and Task 19
  exists specifically to pin the regression it can silently introduce: a deep link to
  `/people/[userId]` must render the **full page**, not the drawer.

The plan's four recorded deviations from the spec (no `--pill-*` tokens, no `.card-3d`, no
`.switch-3d`, form fields via an `@layer base` rule instead of a 28-file class sweep) each remove
work the spec assumed and are explained in the plan's own "Deviations" section.

### Resuming execution

The execution workspace is gitignored and will not exist on a fresh clone. To resume, re-run the
`superpowers:subagent-driven-development` skill against the Plan 2 file; it will create its own
ledger and briefs. Plan 1's ledger is gone, which is what this document replaces.

---

## 5. Decisions taken during execution without asking

Recorded so they can be reviewed and reversed. Each cost, if wrong, is small.

**Plan defects found and corrected mid-execution (all authored in the plan itself):**

1. Expected test counts at Plan 1 Tasks 2 and 3 were each one low — corrected to 8 and 10.
2. A pre-existing `Button.spec.ts` assertion (`ghost` → `hover:bg-surface`) would have failed
   Task 4, which the plan never mentioned. Task 4 was told to update it. The change is correct:
   `bg-surface` is the page ground, so a ghost button on the page background had an invisible
   hover.
3. Task 9's spec code used `React.ReactNode` without importing the namespace — fails typecheck
   under `jsx: react-jsx`. Replaced with `import type { ReactNode }`.
4. **Seven `--tt-nav-*` tokens were specified in Task 1 and consumed by no task in either plan**,
   while spec §4 names per-destination nav hues as a deliverable. Wired into `Sidebar.tsx` rather
   than deleted. This is the one ruling that added feature code.
5. Spec §10's "Phase 1 is a single-file revert" mitigation went stale at `213a755`; corrected.

**Judgement calls against reviewer findings:**

6. Fixed a weak test in Task 2 that the plan had itself mandated, rather than dismissing the
   finding on those grounds.
7. Authorised editing `globals.css` outside Task 6's declared files to repair an accessibility
   regression properly: Task 6 had swapped `aria-pressed` for `aria-selected` on a roleless
   `<button>` to satisfy a CSS selector, which assistive tech silently drops. Restored
   `aria-pressed` and extended `.seg-tab` to match it, rather than fabricating `tablist`/`tab`
   roles on a widget with no roving tabindex or arrow-key navigation.
8. Fixed the dark-mode elevation immediately rather than after the visual pass — pure black on
   `#111113` is ~1.11:1, so the deliberate "dark gains depth" reversal was shipping inert while
   dark _buttons_ got real depth from coloured edge tokens. Now a `#3a3a40` rim at 1.67:1.
9. Swept the 13-site hover-direction split onto `hover:bg-hover` rather than merely recording it:
   in dark, a ghost button brightened on hover while the row beneath it dimmed.
10. Three instances of one defect class — "the test name promises more than the assertion
    verifies" — were fixed as one commit rather than three notes.

**Process:**

11. Worked on a dedicated branch in the main checkout rather than a git worktree; a fresh worktree
    needs a full `pnpm install` + `prisma generate` before a single test runs.
12. Subagents were required to report browser steps as NOT PERFORMED rather than fabricate them
    (CLAUDE.md §6), which is why §2 above exists.
13. Every task after Task 3 had to run `typecheck`, not just its focused test — Tasks 1 and 2 ran
    only the focused test, and a type error survived two tasks before the gate caught it.
14. Batched the three same-shape radius-sweep tasks into one dispatch, and ran the two
    verification-only tasks (8 and 10) directly, since both produced no diff to review.
15. Two commits for the sweep instead of the plan's three: `projects`, `reports` and `marketing`
    contained zero hardcoded radii, so the third commit would have been empty.

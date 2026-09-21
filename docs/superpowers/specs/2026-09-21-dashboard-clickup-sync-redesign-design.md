# Design — Dashboard redesign in the clickup-sync visual language

Date: 2026-09-21
Status: approved (pending spec review)

## 1. Problem

The `apps/dashboard` UI is the "Nifty Timer Redesign" Claude Design handoff, implemented in full:
teal accent, Schibsted Grotesk / IBM Plex Mono, 20px "pebble" cards, soft flat elevation, and — by
explicit decision — no card shadows at all in dark mode (`globals.css:76`). It is coherent and
finished.

The sibling project `clickup-sync` (`apps/web`, a Vite SPA) carries a different, also-finished design
language: tighter 8–12px radii, a pronounced skeumorphic depth system (pressable buttons, recessed
inputs, lifting rows and cards, raised segmented tabs), per-section nav hues, a density switch, and a
much richer component set — a 760-line `DataTable`, drawers, toasts, skeletons, empty states.

We want the timetrack dashboard to read as part of the same family, and to gain the interaction
capabilities it currently lacks. It is **not** a port: the two apps share no framework, no styling
convention and no component code.

### Why a straight port is impossible

|           | `apps/dashboard`                            | `clickup-sync/apps/web`              |
| --------- | ------------------------------------------- | ------------------------------------ |
| Framework | Next.js App Router, RSC                     | Vite SPA, react-router               |
| Data      | server fetch, URL state                     | TanStack Query, context              |
| Styling   | Tailwind `@theme inline` semantic utilities | raw CSS vars via inline `style={{}}` |
| Dark mode | `.dark` class                               | `data-theme` attribute               |
| Icons     | hand-rolled `ui/icons.tsx`                  | `lucide-react`                       |
| Size      | ~9.1k LOC, 17 pages, 71 components          | ~27.6k LOC, 29 pages                 |

Every page in `apps/dashboard` is a Server Component (0 of 17 carry `'use client'`); 32 of 71
components are client. Components cannot move between the two codebases — only the design language
can.

## 2. Goals / non-goals

**Goals**

- Adopt clickup-sync's _structure and depth_: radii scale, the 3D depth recipes, segmented tabs,
  density, per-section nav hues.
- Keep timetrack's _identity_: teal `--tt-accent`, Schibsted Grotesk / IBM Plex Mono, the full type
  scale, and the `recording` / `category-productive` / `category-unproductive` semantics.
- Add the four interaction capabilities the dashboard lacks: a rich data table, loading/empty/error
  states, detail drawers with toasts, and a density toggle.
- Keep every page a Server Component. Keep the session token server-side.

**Non-goals**

- No change to the macOS (`TimeTrackTokens.swift`) or Windows clients. The drift already noted at
  `globals.css:9` is accepted and stays a separate, later pass.
- No new dependency. `lucide-react` was considered and declined; `ui/icons.tsx` is extended instead.
- No purple, no Geist, no accent gradient. The brand mark, `icon.svg` and `apple-icon.png` are
  untouched.
- No TanStack Query, no client-side `FilterProvider`, no global top-bar date/space filter.
- No command palette. clickup-sync's own `GROUP_THRESHOLD = 9` says 7 destinations do not justify
  ⌘K, sidebar groups or pinnable rows.
- No API, contracts, schema, worker or migration change. This is presentational plus dashboard-local
  interaction.

## 3. Key decisions

- **Teal is kept, and this is load-bearing, not conservatism.** `--tt-accent`, `--tt-recording` and
  `--tt-category-productive` are deliberately the same teal, `--tt-category-unproductive` sits
  opposite it in amber, and the same two arcs are baked into `icon.svg` / `apple-icon.png`, which
  cannot follow a theme. Adopting purple would require reassigning `recording`, regenerating both
  icons, and splitting the dashboard from the menu-bar client's appearance.

- **The token layer carries most of the restyle.** All 21 shadow uses go through `shadow-e1`/`e2`
  and 116 radii through `rounded-lg/md/full`, against only 40 hardcoded `rounded-[Npx]`. Redefining
  `--radius-*` and `--tt-elevation-*` moves the bulk of the app from one file — which is what makes
  an inside-out sequence viable and Phase 1 a single-file revert.

- **`DataTable` is added alongside the compound `Table`, not in place of it.** The 2026-07-31 reskin
  spec §3 rejected a config-driven table because "a `columns`/`rows` config table would force
  render-props for nearly every cell and drag client concerns into a shared component". That
  reasoning still holds for the action-heavy tables and is not being reversed. Audit confirms the
  split:

  | Table                          | Interactive cells                            | Verdict          |
  | ------------------------------ | -------------------------------------------- | ---------------- |
  | `admin/users`                  | `RoleSelect`, `TeamSelect`, `UserRowActions` | compound `Table` |
  | `admin/teams`                  | inline `RenameTeamForm`                      | compound `Table` |
  | `approvals`                    | `DecideForm` per row                         | compound `Table` |
  | `admin/audit`                  | read-only cells + `DiffToggle`               | **`DataTable`**  |
  | `overview/PeopleTable`         | `Avatar`, `Link`, `Meter` — presentational   | **`DataTable`**  |
  | `reports/ReportsByPersonTable` | already client, already sortable             | **`DataTable`**  |

  The three compound tables inherit the new tokens for free and are not otherwise touched.

- **A Server Component cannot pass a function to a Client Component**, so `Column.render` /
  `onRowClick` / `onSortChange` cannot cross the boundary. Each `DataTable` adopter gets a thin
  `'use client'` wrapper owning its column definitions; the server page passes serializable rows
  only. This generalizes the existing `ReportsByPersonTable.tsx:1` pattern.

- **Table logic lives in `lib/`, not the component.** Sort, paginate and selection go in
  `lib/data-table.ts` with a `lib/data-table.spec.ts`, matching the eight existing `lib/*-view.ts`
  view-model modules. The component stays thin and the logic is testable without a DOM.

- **Dark mode gains depth.** `--tt-elevation-1` is currently `none` under `.dark` by explicit design
  (`globals.css:76`). The 3D language cannot survive that, so dark gains a black-edge treatment
  following clickup-sync. This knowingly reverses a documented decision; the stale provenance
  comment at `globals.css:1` is rewritten in the same commit.

- **Density and theme share one pre-paint script.** `layout.tsx:29` already seeds `.dark` before
  first paint; it gains one line to seed `data-density` rather than adding a second script.

- **`Button` keeps its no-`onClick` contract.** That constraint is what lets a shared button render
  inside Server pages (2026-07-31 spec §3); it survives the restyle unchanged.

## 4. Token layer (`globals.css`)

Unchanged: all colour roles, both fonts, the whole type scale, the `.dark` class strategy.

Changed:

| Token                        | Now       | Proposed                                    | Reach       |
| ---------------------------- | --------- | ------------------------------------------- | ----------- |
| `--radius-sm`                | 6px       | 4px                                         | focus rings |
| `--radius-md`                | 11px      | 8px                                         | 44 uses     |
| `--radius-lg`                | 20px      | 12px                                        | 21 uses     |
| `--tt-elevation-1`           | soft flat | `0 3px 0 border-strong, 0 9px 20px ink/13%` | 15 uses     |
| `--tt-elevation-1` (`.dark`) | `none`    | black edge + ambient                        | 15 uses     |

Added tokens: `--tt-border-strong`, `--tt-muted-bg`, `--tt-hover`, the `--b-edge` / `--b-glow` /
`--b-glow-strong` depth vars, a `--pill-*` set backing `Badge`, and seven `--nav-*` hues (one per
destination, chosen to clear 3:1 against the sidebar ground in both themes — clickup-sync uses
600-weight steps in light and 300/400 in dark for the same reason).

Added recipes, ported from `clickup-sync/apps/web/src/index.css` with timetrack's ink `#191917`
substituted for its slate `#0f172a`: `.btn-3d`, `.input-3d`, `.card-3d`, `.row-3d`,
`.seg-track` / `.seg-tab`, `.switch-3d`.

Added density: `[data-density="compact"] { --row-h: 36px; --pad-y: 8px }` and `comfortable` 48/12.

## 5. Primitives

| Component                      | Change                                                                                                        | Blast radius                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Button`                       | `rounded-full` → `rounded-md` + `.btn-3d`. `buttonClasses` export and the no-`onClick` contract preserved.    | 16 files, free                                                               |
| `Card`                         | picks up `.card-3d`; new `interactive` prop for hover-lift                                                    | 14 files, free                                                               |
| `TabPills`                     | pill track → recessed `.seg-track` + raised `.seg-tab`; stays `next/link`-based so tab state stays in the URL | 3 files                                                                      |
| `StatCard`                     | label → `tt-eyebrow`; optional sparkline beside the delta                                                     | 2 files                                                                      |
| `Table`                        | **API unchanged**; padding moves to the density vars. Becomes the shell `DataTable` renders through.          | 3 compound consumers keep it unchanged; the other 3 move to `DataTable` (§3) |
| `Badge`                        | remapped onto `--pill-*`                                                                                      | 5 files                                                                      |
| `Meter`, `HeroPanel`, `Avatar` | radii/depth retune only                                                                                       | 7 files                                                                      |

New: `DataTable`, `Skeleton` / `TableSkeleton` / `PageSkeleton`, `EmptyState`, `Drawer`,
`Toast` + provider, `DensityProvider` + toggle, `Sparkline`.

## 6. New capabilities

### 6.1 DataTable

Features: sortable headers, frozen/sticky columns, pagination, column show/hide, row selection,
expandable rows. Adopted by three tables (§3). Each gets a `'use client'` wrapper:

```
app/(app)/admin/audit/page.tsx        server — fetches, passes AuditRow[]
  └─ components/admin/AuditTable.tsx  'use client' — declares columns
       └─ components/ui/DataTable.tsx 'use client' — generic, presentational
```

`PeopleTable.tsx` converts server → client. Pages stay Server Components; only the table leaf is
client, and no data fetching moves into it.

### 6.2 Loading, empty and error states

There is no `loading.tsx` or `error.tsx` anywhere today — pages pop in, and an `ApiError` from
`api-client` on a non-401 failure reaches Next's default error page.

- `loading.tsx` per route segment rendering `PageSkeleton`.
- `Suspense` + `TableSkeleton` around slow sub-trees, following the `TrackingFooter` boundary at
  `(app)/layout.tsx:40`.
- `error.tsx` per segment rendering the RFC 9457 `title` / `detail`. This is a genuine fix, not
  chrome.

### 6.3 Drawers

Two kinds, deliberately kept apart:

**(a) Presentational** — row data already loaded on the page. Plain client component, no routing, no
fetch. Covers approvals, projects and the day panels.

**(b) Detail, needing its own fetch** — `/people/[userId]` and `/projects/[projectId]`, which are
real pages. These use Next parallel + intercepting routes:

```
app/(app)/@drawer/(.)people/[userId]/page.tsx   intercepted → drawer slot
app/(app)/people/[userId]/page.tsx              hard load → full page, unchanged
app/(app)/@drawer/default.tsx                   empty slot
```

The URL still changes, so links stay shareable, and a fresh paste gives the full page. Fetching
stays server-side.

(b) ships as its own PR after (a). Nothing in the codebase uses parallel or intercepting routes
today, and the `@drawer` slot has to be threaded through `(app)/layout.tsx` beside `children`.

### 6.4 Toasts and density

`ToastProvider` mounts in `AppShell` (already `'use client'`). Server Actions cannot call it: the
action returns a result and the client form raises the toast, the shape `ConfirmDialog` already uses.

`DensityProvider` sets `data-density` on `<html>` and persists to `localStorage['tt-density']`,
seeded by the extended pre-paint script (§3).

## 7. Phasing

| #   | Commit                                                                    | Contents                      |
| --- | ------------------------------------------------------------------------- | ----------------------------- |
| 1   | `refactor(dashboard): adopt the clickup-sync depth and radius tokens`     | §4, one file                  |
| 2   | `refactor(dashboard): rebuild the shared UI primitives on the new tokens` | §5                            |
| 3   | `refactor(dashboard): sweep hardcoded radii onto the token scale`         | 40 sites + feature components |
| 4   | `feat(dashboard): add a sortable, freezable data table`                   | §6.1 + 3 wrappers             |
| 5   | `feat(dashboard): add skeleton, empty and error states`                   | §6.2                          |
| 6   | `feat(dashboard): add detail drawers, toasts and a density toggle`        | §6.3(a), §6.4                 |
| 7   | `feat(dashboard): open person and project detail in a drawer`             | §6.3(b)                       |

Every phase is independently green and shippable.

## 8. Testing

Per CLAUDE.md §5.

- **Unit (Vitest):** `lib/data-table.spec.ts` for sort/paginate/select; a spec for the density
  reducer. Existing `Button.spec.ts`, `ConfirmDialog.spec.ts`, `PasswordField.spec.tsx` updated for
  the new classes.
- **Component:** each of the three `DataTable` wrappers gets a spec asserting columns render and
  sort toggles.
- **E2E (Playwright):** seeded-data passes over the redesigned pages, plus one test that a deep link
  to `/people/[userId]` renders the **full page**, not the drawer — the regression intercepting
  routes can silently introduce.
- **Gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green before each PR.

## 9. Files

**Modified:** `src/app/globals.css`, `src/app/layout.tsx` (pre-paint script),
`src/app/(app)/layout.tsx` (`@drawer` slot, providers), `src/components/ui/{Button,Card,TabPills,
StatCard,Table,Badge,Meter,HeroPanel,Avatar,AppShell,Sidebar,TopBar}.tsx`, the 40 hardcoded-radius
sites across `components/{day,overview,projects,reports,marketing}/`, and
`src/components/reports/ReportsByPersonTable.tsx` (already client; its hand-rolled sort moves to
`lib/data-table.ts`).

**Added:** `src/components/ui/{DataTable,Skeleton,TableSkeleton,PageSkeleton,EmptyState,Drawer,
Toast,DensityProvider,Sparkline}.tsx`, `src/components/admin/AuditTable.tsx`,
`src/lib/data-table.ts` + spec, `loading.tsx` / `error.tsx` per route segment,
`src/app/(app)/@drawer/**`.

**Converted server → client:** `src/components/overview/PeopleTable.tsx`.

**Untouched:** everything under `apps/api`, `apps/worker`, `packages/*`, `apps/client-macos`,
`apps/client-windows`.

## 10. Risks / open items

1. **No visual-regression net.** Phase 1 moves 116 radii and 21 shadows from one file and nothing
   verifies it but eyes on all 17 pages. Mitigated by Phase 1 being a single-file revert. Playwright
   screenshot baselines would be a proper net — **open item**, new scope, not currently in the plan.
2. **Dark mode gains depth**, reversing the documented `globals.css:76` decision (§3).
3. **Intercepting routes are new machinery** in this codebase; isolated to Phase 7 for that reason.
4. **One component moves server → client** (`PeopleTable`). It is a leaf; watch during
   implementation that no fetching follows it across.
5. **Divergence from the desktop clients widens** in shape even though the palette holds. Accepted
   per §2; revisit when the clients are restyled.

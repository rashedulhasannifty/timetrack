# Redesign Slice 1 — Foundation kit + app shell (design)

Date: 2026-07-25
Branch: `feat/ds-4-foundation-shell`
Scope: `dashboard` + one small `api` addition (`GET /users/me`). No `contracts`/`db`/`worker`
schema changes (the endpoint reuses `UserSchema` and the existing `UsersRepository.findUser`), no
new dependency.
Source of truth: the Claude Design mockup `TimeTrack.dc.html` (project `45314fad-…`), reconciled
against the current dashboard (see the audit in this session).

## Context & goal

The whole dashboard is being reskinned to the `TimeTrack.dc.html` mockup at **pixel-perfect**
fidelity, screen by screen. Every screen is built from the same shared card/badge/stat/avatar kit
and hangs off one app shell (sidebar + sticky header). This slice builds **that shared foundation**
so the per-screen slices that follow are pure composition. Dark mode and almost all tokens already
match the mockup (`globals.css` `--tt-*` light+dark, `.dark` class + pre-paint seed + `ThemeToggle`).
**Two tokens the mockup uses are missing** and this slice adds them: `--tt-good` (#34c759 light /
#30d158 dark) and `--tt-manual` (#ffcc00 light / #ffd60a dark), plus their `@theme` mappings
(`--color-good`, `--color-manual`) so `bg-good`/`text-good`/`bg-manual` utilities exist. Everything
else in `globals.css` is untouched.

This slice ships **no visual change to any screen's body**; it lands the primitives + the shell
chrome. Screens keep rendering as they do today until their own slice reskins them.

## Non-goals

- Any per-screen reskin (Overview/Reports/Approvals/Admin/My Time/Person) — later slices.
- Chart components (donut/line/gauge) — the next slice (Chart kit).
- A global range picker — decided **per-page**; the header shows the page title only.
- Any DB/contract/schema change, or any API change beyond the single self endpoint `GET /users/me`.

## Decisions (from brainstorming)

- **Pixel-perfect** to the mockup, **adapting only where the mockup conflicts with shipped
  features** (below). Match the mockup's exact px values, radii, shadows (already in tokens), and
  structure.
- **Nav reconciliation:** the mockup nav is Overview / Reports / Approvals / Admin / My time and
  **omits Projects**. We keep **Projects** (a shipped surface) and rename the current "Team" item to
  **"Overview"** to match the mockup label. Final primary nav: Overview (`/`) · Projects
  (`/projects`) · Reports (`/reports`) · Approvals (`/approvals`) · Admin (`/admin/settings`);
  secondary: My time (`/me`). Nav stays **not role-filtered** (unchanged; gating is per-page/API).
- **Page title lives in the sticky header** (mockup), not as a big `<h1>` in `<main>`. Implemented
  via a small client **title context** set by each page. The existing `PageHeader` (in-`main` h1)
  is **left in place untouched** this slice; migrating each page's title into the header happens in
  that page's own reskin slice. This slice only builds the mechanism + wires the header to it (the
  header shows a route-derived fallback title until pages opt in).
- **Account dropdown** replaces the current static role-badge + separate logout button: a click
  target (initials avatar) opens a menu with name · email · Sign out. The **role badge pill stays**
  next to it (mockup keeps both). Sign out keeps its current behavior (POST `/api/auth/logout`).
  Name/email are not in the JWT (claims = `sub`/`role`/`teamId`), so this slice adds a small
  self endpoint **`GET /v1/users/me`** — the layout fetches the current user server-side and passes
  name/email/role into the shell. See "Backend" below.
- **"N clients tracking now"** sidebar footer: real count of team members with an open time entry,
  derived from `api.teamOverview`. Fetched **server-side in the layout** and passed to the Sidebar.
  If the caller is not permitted (`ApiError` 403 for a plain EMPLOYEE) or the call fails, the footer
  is **omitted** (no error surfaced).

## Exact shell values (from the mockup)

- Sidebar base: `width:240px;flex:none;background:var(--tt-surface-raised);border-right:1px solid
var(--tt-separator);display:flex;flex-direction:column` (current `w-60` == 240px ✓).
- Responsive: at `< 900px` (`narrow`) the sidebar becomes a fixed overlay
  (`position:fixed;inset:0 auto 0 0;z-index:70;box-shadow:var(--tt-elevation-2)`) that slides via
  `transform:translateX(0 | -105%)` with `transition:transform .2s ease`, toggled by a header
  hamburger; at `≥ 900px` it is `position:sticky;top:0;height:100vh`. Overlay closes on nav-item
  click and on resize back to wide.
- Header: `position:sticky;top:0;z-index:30;background:var(--tt-surface-raised);border-bottom:1px
solid var(--tt-separator);min-height:60px;padding:12px 24px;display:flex;align-items:center;
gap:16px`. Left→right: hamburger (narrow only) · page title `<h1>` (22px/600/-0.02em, truncating)
  · flex spacer · theme toggle (existing) · role-badge pill · account avatar+dropdown.

## Design — files

### Backend — `GET /v1/users/me` (`apps/api/src/modules/users/`)

- **Controller** (`users.controller.ts`): add `@Get('me')` → `service.me(user)` using
  `@CurrentUser()`. No `@Roles` (any authenticated user reads their own record); no `@ResourceScope`
  (inherently self — there is no id param, so no cross-user access and no 403 case to test). Safe
  route ordering: there is **no** `@Get(':id')`, so `@Get('me')` collides with nothing.
- **Service** (`users.service.ts`): `me(user: SessionUser): Promise<User>` → `this.repo.findUser(
user.id)`; if null (should never happen for a valid session) throw the standard NotFound problem.
- **Repository:** **no change** — reuse the existing `findUser(id)` (selects `USER_SELECT`, no
  sensitive fields).
- **Contracts:** **no change** — the response is the existing `UserSchema`.
- **Tests:** unit — add `me` to the controller-spec delegation and a `UsersService.me` spec
  (returns `repo.findUser` result; NotFound when null). E2E (`users.e2e-spec.ts`, real PG): an
  authenticated user GETs `/v1/users/me` and receives their own record (id === caller); unauth → 401.

### Dashboard API client (`apps/dashboard/src/lib/api-client.ts`)

- Add `getCurrentUser: (token: string): Promise<User> => get('/users/me', UserSchema, token)`
  (import `UserSchema`, `type User` if not already imported).

### Shared kit (`apps/dashboard/src/components/ui/`)

1. **`Card.tsx`** (exists) — keep as the canonical raised surface (`bg-surface-raised
border-separator rounded-lg border shadow-e1`). Add an optional `padding` prop (`'md'` default =
   the current 18px feel via `p-[18px]`/existing scale, `'none'` for tables). No behavior change to
   existing callers. This slice does **not** refactor other pages onto it (that happens as each
   screen is reskinned) — it only makes `Card` ready.
2. **`StatCard.tsx`** (new) — the KPI tile (mockup L160–181). Props: `label: string`,
   `value: string`, `info?: boolean` (the ⓘ affordance), and an optional
   `bar?: { pct: number; color: string; caption: string; href?: string }`. Renders: label row +
   optional ⓘ, big value (`text-[28px]/600/-0.02em tt-numeric`), and when `bar` present a
   `min-height:118px` tile with a 5px track + fill (`width:{pct}%`, `background:{color}`), the
   `"{pct}% of tracked time"` caption, and an optional "View details" link. Presentational only.
3. **`Badge.tsx`** (new) — status pill. Props: `tone: 'neutral'|'accent'|'good'|'warning'|
'destructive'`, `children`. One `TONE` map (bg/border/text via tokens). Replaces the two
   duplicated `BADGE_TONE` literals (in `approvals/page.tsx` and `me/ApprovalsPanel.tsx`) — **this
   slice adds the component and migrates those two call sites** (they render the same pills, so it's
   a safe like-for-like swap with existing behavior preserved).
4. **`SectionHeader.tsx`** (new) — the section label row (mockup L150–158): an uppercase 12px/600/
   `letter-spacing:.06em` label, a `flex:1` hairline rule, and an optional `action?: ReactNode`
   slot on the right. Props: `label: string`, `action?: ReactNode`.
5. **`Avatar.tsx`** (new) — the initials chip used everywhere (sidebar account, person header,
   report/approval rows, gauges). Props: `name: string`, `size?: number` (default 30), optional
   `initials?` override. Deterministic background/foreground derived from `name` via a small hash
   (mirror the existing `project-color` hashing approach; put the palette + `initialsFor(name)` in a
   new pure lib `lib/avatar.ts` with unit tests). Renders a round chip, centered initials.

### Shell (`apps/dashboard/src/components/ui/` + `app/(app)/layout.tsx`)

6. **`PageTitleContext.tsx`** (new, client) — `TitleProvider` + `useSetPageTitle(title)` +
   `usePageTitle()`. A tiny context holding the current title. `SetPageTitle` is a client component a
   page can render to set it (used by later slices, not wired to pages here).
7. **`Sidebar.tsx`** (modify) — data-drive the nav from the reconciled list above (Team→Overview,
   keep Projects); make it responsive per the values above (accept `narrow`/`open`/`onNavigate`
   from a shell controller); render the **"N clients tracking now"** footer when a `trackingCount`
   prop is provided (omit when undefined). Keep brand lockup + icons.
8. **`TopBar.tsx`** (modify) — render the hamburger (narrow only), the page title (`usePageTitle()`,
   falling back to a route→label map so it's never blank), the theme toggle (unchanged), the role
   badge pill (unchanged label map), and the new **`AccountMenu`**.
9. **`AccountMenu.tsx`** (new, client) — initials `Avatar` button that toggles a dropdown with the
   user's name · email · a Sign out button (POST `/api/auth/logout`, as today). Closes on outside
   click / Escape. `name`/`email`/`role` come from props (the layout fetches `api.getCurrentUser`
   server-side and passes them through `AppShell`).
10. **`AppShell.tsx`** (new, client) — owns the responsive state (`narrow` via a resize listener at
    the 900px breakpoint, `sidebarOpen`) and composes `TitleProvider` → `Sidebar` + a column of
    `TopBar` over `<main>`. The server `(app)/layout.tsx` becomes: resolve `session` (unchanged
    redirect), fetch the tracking count (guarded), and render `<AppShell role={…} name={…}
email={…} trackingCount={…}>{children}</AppShell>`. `<main>` keeps `p-8` (unchanged) so screen
    bodies are visually untouched this slice.

### Data / auth flow

```
(app)/layout.tsx  (server): getSession() → null ? redirect /api/auth/refresh
                            me = await api.getCurrentUser(token)   → name/email/role
                            trackingCount = try api.teamOverview → count rows where r.tracking
                                            catch ApiError/any → undefined (footer hidden)
                            render <AppShell role={me.role} name={me.name} email={me.email}
                                             trackingCount>{children}</AppShell>
AppShell (client): narrow = innerWidth < 900 (resize-tracked); sidebarOpen state
                   <TitleProvider><Sidebar …/><TopBar …/><main class=p-8>{children}</main></TitleProvider>
```

## Testing

- **Pure libs (Vitest, node-env):** `lib/avatar.ts` — `initialsFor` (1/2/3-word names, extra
  whitespace, single name) and deterministic color selection (same name → same index; different
  names spread). This is the only logic worth unit-testing; the rest is presentational.
- **Components:** the dashboard vitest is node-env (no jsdom) — do **not** attempt to render
  components. Verify via `pnpm --filter dashboard typecheck` + `lint` + `build` (per the repo's
  existing dashboard convention). A route that fetches must stay dynamic.
- **E2E (Playwright, `*.spec.ts` skipped scaffold):** add scaffold cases for the shell — sidebar
  nav present, account dropdown opens/closes, mobile hamburger toggles the sidebar, page title in
  the header. Skipped (consistent with existing scaffolds); real assertions when the suite is wired.
- **Regression guard:** existing pages must render unchanged — the two `Badge` migrations
  (approvals + ApprovalsPanel) must produce the same pills; verify by typecheck/build + a visual
  read of the diff.
- Gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (dashboard-scoped is sufficient
  since only `apps/dashboard` changes, but run the full gate before merge).

## Risks / notes

- **Title mechanism unused by pages this slice** — the header shows the route-fallback title until
  each page opts in via `SetPageTitle` in its reskin slice. Intentional: keeps this slice from
  touching every page. Confirm the fallback map covers all current routes so no header is blank.
- **`teamOverview` scope:** it is MANAGER/ADMIN-scoped. For a plain EMPLOYEE it 403s → the footer is
  simply hidden. Verify the layout swallows that (no error page).
- **Name/email source:** the JWT carries only `sub`/`role`/`teamId`, so `AccountMenu` gets real
  name/email from the new `GET /users/me` (fetched once in the layout). This is the single API
  addition in the slice; keep it self-scoped and reuse `UserSchema`.
- **Layout adds a blocking fetch:** the layout now awaits `getCurrentUser` before render. It's a
  cheap self lookup, but if it throws the app shell can't render — unlike `trackingCount`, do **not**
  swallow it (a failed self-fetch means the session is unusable; let it surface / redirect like a
  null session). Only `trackingCount` is the guarded/optional fetch.
- **No screen body changes** — if a screen looks different after this slice, that's a bug.
- **CLAUDE.md:** dashboard scope; types from `@timetrack/contracts`; no hand-written response
  types; Server Components by default, `'use client'` only where there's interaction (AppShell,
  AccountMenu, ThemeToggle, PageTitleContext, Sidebar). Commits Conventional (`feat(dashboard): …`
  ≤72 chars), no AI attribution.

## Definition of done

- `GET /v1/users/me` live (self, reuses `UserSchema`/`findUser`; unit + e2e); `api.getCurrentUser`
  added to the dashboard client.
- `Card` extended (non-breaking); `StatCard`, `Badge`, `SectionHeader`, `Avatar` +
  `lib/avatar.ts` added with tests; `Badge` adopted at the two existing pill call sites.
- App shell: responsive sidebar (overlay < 900px), header with page title + hamburger + account
  dropdown + role badge + theme toggle; "N clients tracking now" footer (guarded). Title context in
  place; no page wired to it yet.
- Every existing screen renders **visually unchanged**. `lint/typecheck/test/build` green.
  Committed on `feat/ds-4-foundation-shell`, Conventional Commits, no AI attribution.

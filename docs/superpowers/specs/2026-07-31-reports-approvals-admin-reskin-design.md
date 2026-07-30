# Design — Reports / Approvals / Admin reskin (manager dashboard, sub-project C)

Date: 2026-07-31
Status: approved (pending spec review)

## 1. Problem

Sub-projects A (team analytics backend) and B (Overview flagship reskin) are merged. The Overview page
now establishes the dashboard's visual vocabulary: a header row (`ReportRangePicker` + actions), then
`<section>` blocks led by `<SectionHeader>`, each holding `<Card>`-wrapped widgets built from shared UI
and chart primitives, with calm `text-text-secondary` empty/forbidden states and tabular numerals on
every figure.

The other three manager pages — **Reports** (`/reports`), **Approvals** (`/approvals`), and **Admin**
(`/admin/settings`, `/admin/users`, `/admin/audit`) — are **functionally complete** but predate that
vocabulary. Each hand-rolls its own `<table>` markup (repeating the same header-cell classes), and
buttons are raw Tailwind (`bg-accent` / `bg-good` / bordered-surface) copy-pasted across Export CSV,
the decide/invite/settings forms, and the audit filter. There is no shared `Table` or `Button`
component. The result is visual drift from the flagship and duplicated markup that will keep drifting.

This is **sub-project C** of the three-part redesign (A = analytics backend, B = Overview flagship,
C = this spec). It is the last piece: bring these three pages into visual alignment with the flagship
and DRY up the duplication by extracting two shared primitives.

## 2. Goals / non-goals

**Goals**

- Extract two shared, presentational primitives — `Button` and a `Table` compound — and apply them
  across the three pages, replacing the hand-rolled table markup and scattered raw-Tailwind buttons.
- Align each page's header, spacing, section headers, tabular numerals, card treatment, and
  empty/forbidden/error states to the flagship Overview.
- Keep every page's existing data flow, Server/Client split, Server Actions, auth (403) paths, and
  api-client calls exactly as they are — this is a presentational change.

**Non-goals**

- No new analytics widgets, KPI rows, or charts on these pages. The redesign prompt states these pages
  "can be a touch simpler" than Overview; enrichment is explicitly out.
- No change to Overview (`/`), My time (`/me`), or Person (`/people/:id`) — already reskinned or not
  part of C.
- No API / contracts / schema change, no new endpoint, no worker change.
- No new charting or UI dependency — primitives are plain SVG/CSS/Tailwind on the existing tokens.
- No widgets drawer on these pages — that shell is Overview-only.
- No data-driven table abstraction (see §3).

## 3. Key decisions

- **`Table` is a compositional compound, not a data-driven config table.** These tables have
  avatar cells, status `Badge`s, inline `<select>`s (RoleSelect), and per-row action forms
  (`DecideForm`, `UserRowActions`) — a `columns`/`rows` config table would force render-props for
  nearly every cell and drag client concerns into a shared component. Instead export thin styled
  wrappers (`Table`, `THead`, `Th`, `Tbody`, `Tr`, `Td`) around native table elements. Pages compose
  their own rows; the one sortable table (`ReportsByPersonTable`) layers its client sort state on the
  same shell. All four tables stay as they are today re: Server/Client — only the markup is unified.
- **`Button` is one polymorphic Server Component** rendering `<a>` when `href` is present, else
  `<button>`. It takes no function props (no `onClick`), so it can be rendered inside the existing
  `'use client'` action forms: submit buttons use `type="submit"` + `disabled={pending}`, and the
  client wrapper owns any interactivity. This is the constraint that keeps it a shared Server Component.
- **Flag is `secondary`, not destructive.** In `DecideForm`, "Flag for payroll" routes a timesheet to
  payroll review — it is not a destructive action. Approve = `primary`, Decide = `secondary`,
  Flag = `secondary`; the Flagged state is communicated by the existing warning `Badge`. Only genuinely
  destructive actions (erase user) use `variant="destructive"`.
- **The Reports by-person activity meter switches to `BarMeter`.** `ReportsByPersonTable` currently
  hand-rolls an inline activity-% mini-meter; replace it with the shared single-segment `BarMeter` for
  consistency. This is presentational; the sort logic (`sortTeamRows`) is untouched.
- **Settings form field controls stay local.** `SettingsForm`'s `NumberField`/`Toggle`/select wrappers
  are form-specific, not general primitives — keep them local, just give them consistent
  focus/border treatment. Do not over-extract a form-control library this slice (YAGNI).

## 4. The primitives

### `components/ui/Button.tsx` — Server Component

Polymorphic button/anchor. Props:

- `variant?: 'primary' | 'secondary' | 'destructive'` (default `'secondary'`)
- `size?: 'sm' | 'md'` (default `'md'`)
- `href?: string` — when present, renders `<a>` (with any `download`); else `<button>`.
- Passes through native attributes: `type`, `disabled`, `formAction`, `className` (merged), `children`,
  `aria-*`. **No `onClick`** — it is a Server Component.

Token-driven styling:

- shared: `inline-flex items-center gap-2 rounded-md font-medium focus-visible:outline-2
focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none`
- `size`: `sm` → `text-label px-3 py-1.5`; `md` → `text-body px-4 py-2`
- `primary`: `bg-accent text-white hover:bg-accent-hover`
- `secondary`: `bg-surface border border-separator text-text hover:border-text-secondary`
- `destructive`: `bg-destructive text-white hover:opacity-90`

### `components/ui/Table.tsx` — Server Component compound

Exports `Table`, `THead`, `Th`, `Tbody`, `Tr`, `Td` — presentational wrappers, no state, no data.

- `Table`: `<table className="w-full border-collapse">`; placed inside a `<Card padding="none">` by the
  caller (as pages do today).
- `Th`: `text-caption text-text-secondary border-separator border-b px-[18px] py-3 font-medium` with
  `align?: 'left' | 'right'` (right → `text-right`). Optional `sortable?: boolean` + `sortDirection?:
'asc' | 'desc' | null` renders a caret affordance; the sort **state and handler stay with the
  caller** (the compound emits the markup, the client table owns the behavior).
- `Tbody`, `Tr`: `Tr` supports an optional `interactive` flag (adds `hover:bg-surface cursor-pointer`
  styling only — the click handler stays with the caller, e.g. the Reports row navigation).
- `Td`: `border-separator border-b px-[18px] py-3 text-body` with `align?: 'left' | 'right'`. When
  `align === 'right'`, `Td` itself applies `text-right tt-numeric` so every numeric column is
  right-aligned with tabular figures without the caller repeating it.

Both primitives are verified by typecheck + build (no logic to unit-test), same bar as the existing
`Card` / `SectionHeader` / `StatCard`.

## 5. Page-by-page changes

Data flow, Server/Client split, Server Actions, api-client calls, and 403 handling are unchanged on
every page. Only markup and styling change.

### Reports — `/reports`

- Header aligned to flagship: title (`SetPageTitle`) + a right-aligned action cluster
  (`ReportRangePicker` + Export CSV as `<Button variant="secondary" href={…} download>`).
- **By person:** `ReportsByPersonTable` (client, keeps `useState` sort + row→`/people/[userId]`
  navigation) re-composed on the `Table` compound; its inline activity-% meter → single-segment
  `BarMeter`.
- **By project:** unchanged structurally — `SectionHeader` + `Card` with `BarMeter` rows (these already
  are the prompt's horizontal length-bars).
- Empty / forbidden / error states restyled to calm `text-text-secondary` copy.
- Files: `reports/page.tsx`, `reports/ReportsByPersonTable.tsx`.

### Approvals — `/approvals`

- Hand-rolled `<table>` → `Table` compound inside the existing `Card padding="none"`.
- `DecideForm` buttons → `Button`: Decide = `secondary`, Approve = `primary`, Flag = `secondary`.
- Status `Badge` tones unchanged (Pending neutral / Approved good / Flagged warning).
- Files: `approvals/page.tsx`, `approvals/DecideForm.tsx`.

### Admin — Settings `/admin/settings`

- `SettingsForm`'s four `Card`s kept; local `NumberField`/`Toggle`/select controls get consistent
  focus/border treatment (`bg-surface border-separator focus:border-accent`). Submit → `Button
variant="primary"`. "Effective policy" read-only card unchanged structurally.
- Files: `admin/settings/SettingsForm.tsx`.

### Admin — Users `/admin/users`

- Hand-rolled `<table>` → `Table` compound. `InviteForm` submit + "Invite user" → `Button primary`;
  `UserRowActions` → `Button` (`secondary` for deactivate/reactivate, `destructive` for erase);
  `RoleSelect` gets the shared field treatment.
- Files: `admin/users/page.tsx`, `admin/users/InviteForm.tsx`, `admin/users/RoleSelect.tsx`,
  `admin/users/UserRowActions.tsx`.

### Admin — Audit `/admin/audit`

- Filter `<form method="get">` inputs get consistent field styling; Filter button → `Button primary`;
  hand-rolled `<table>` → `Table` compound; "Next →" cursor link → `<Button variant="secondary"
href={…}>`. `DiffToggle` unchanged.
- Files: `admin/audit/page.tsx`.

## 6. Testing

- **Unit (Vitest, node-env — no jsdom):** no new transforms are introduced, so no new `*-view.spec.ts`.
  `Button` and `Table` are presentational Server Components with no logic — verified by typecheck +
  build, the same bar as `Card` / `SectionHeader`. The existing `reports-view` / `approvals-view` /
  `audit-view` specs stay green (their transforms are untouched); the Reports meter swap is
  presentational and `sortTeamRows` coverage is unaffected.
- **E2E (Playwright, `*.spec.ts`):** keep the existing skip-scaffold specs; update any selector that the
  table-markup swap moves (same commit as the page change). No new live-app assertions this slice.
- **Gate before done:** `pnpm --filter dashboard typecheck && pnpm --filter dashboard test &&
pnpm --filter dashboard build`, all green. (No Docker needed — the dashboard suite runs locally.)

## 7. Files

**Create**

- `apps/dashboard/src/components/ui/Button.tsx`
- `apps/dashboard/src/components/ui/Table.tsx`

**Modify**

- `apps/dashboard/src/app/(app)/reports/page.tsx`
- `apps/dashboard/src/components/reports/ReportsByPersonTable.tsx`
- `apps/dashboard/src/app/(app)/approvals/page.tsx`
- `apps/dashboard/src/app/(app)/approvals/DecideForm.tsx`
- `apps/dashboard/src/app/(app)/admin/settings/SettingsForm.tsx`
- `apps/dashboard/src/app/(app)/admin/users/page.tsx`
- `apps/dashboard/src/app/(app)/admin/users/InviteForm.tsx`
- `apps/dashboard/src/app/(app)/admin/users/RoleSelect.tsx`
- `apps/dashboard/src/app/(app)/admin/users/UserRowActions.tsx`
- `apps/dashboard/src/app/(app)/admin/audit/page.tsx`

**Reuse unchanged**: `Card`, `SectionHeader`, `Avatar`, `Badge`, `BarMeter`, `ReportRangePicker`,
`AdminTabs`, `Forbidden`, `SetPageTitle`; all `lib/*-view.ts` transforms; all Server Actions
(`decideAction`, `updateSettingsAction`, `inviteUserAction`, `setUserActiveAction`, `setUserRoleAction`,
`eraseUserAction`) and api-client methods; both export route handlers.

## 8. Risks / open items

- **Server `Button` inside client forms.** Works only while `Button` takes no function props. Submit
  buttons use `type="submit"` + `disabled={pending}` from the client form's `useActionState`; the
  client wrapper owns any `onClick`. An implementer must not add an `onClick` prop to the shared Button
  — that would force it client and defeat the shared-primitive goal. Called out per task.
- **Sortable `Th` boundary.** The compound emits the caret/button markup but holds no sort state; the
  Reports client table keeps `sortTeamRows` + `useState`. Keep the state in the caller so `Table` stays
  a Server Component.
- **Selector drift in e2e.** Swapping hand-rolled `<table>` for the compound may change DOM structure;
  the existing skip-scaffold e2e selectors are updated in the same commit as each page.
- **Task decomposition** (for the plan): ~4 tasks — (1) `Button` + `Table` primitives, (2) Reports,
  (3) Approvals, (4) Admin (settings + users + audit) — each independently testable.
- **Branch:** `dashboard/reskin-reports-approvals-admin`, off `main` (A and B already merged).

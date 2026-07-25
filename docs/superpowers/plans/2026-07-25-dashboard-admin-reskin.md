# Dashboard Redesign — Slice 5: Admin reskin (Implementation Plan)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Reskin the Admin area to the mockup's tabbed layout — a shared **AdminTabs** bar
(Settings · Users · Audit) across the three existing `/admin/*` routes, plus a visual reskin of each
page body (policy cards, users Card-table with Avatar/Badge, audit filter+table). Keep ALL existing
server logic, forms, and Server Actions.

**Architecture:** `apps/dashboard` only. Approach A — **keep the 3 routes** (`/admin/settings`,
`/admin/users`, `/admin/audit`); add one shared client `AdminTabs` (active via `usePathname`) each
page renders at the top; reskin bodies with the kit. No route restructure.

## Global Constraints

- `dashboard` scope only. No api/contracts/db change. No new dependency. No console.log.
- **Preserve behavior:** ADMIN gate (`session.role !== 'ADMIN'` → `<Forbidden/>`) on all three; the
  `SettingsForm` + its Server Action + audit; `InviteForm`, `RoleSelect`, `UserRowActions` +
  their actions; the audit filter form + cursor pagination + `DiffToggle`. Reskin PRESENTATION only —
  do not rewrite form/action logic.
- **Data reconciliation:** `TeamSettings.screenshotBlur` is an ENUM (`'NONE'|...`), NOT the mockup's
  boolean "Blur screenshots" checkbox → keep the SettingsForm's real control for it (don't force a
  checkbox). The mockup's "Effective policy" summary card is a nice-to-have read-only mirror of the
  saved settings — include it (derives from the same `team.settings`, no new data).
- Title → header via `SetPageTitle` (per page: "Admin"); remove each page's in-`main` `PageHeader`.
- Kit: `AdminTabs` (new), `Card`, `SectionHeader`, `Avatar`, `Badge`. Tokens/utilities; `tt-numeric`.
- Commits `feat(dashboard)`/`refactor`/`test` ≤72, NO AI attribution, author = repo git user. Stay
  on `feat/ds-8-admin-reskin`; verify branch after each commit; never main.

## Mockup reference

`/private/tmp/claude-501/.../scratchpad/TimeTrack.dc.html` Admin L794–960: tab bar (L797–801);
Settings = monitoring-policy card + effective-policy card (L803–856); Users = count row + Invite
button + Card table Name/Email/Role/Status/Actions (L858–905); Audit tab (further down).

---

### Task 1: `AdminTabs` shared component

**Files:** Create `apps/dashboard/src/components/ui/AdminTabs.tsx`.

- [ ] `'use client'` (uses `usePathname`). Renders a tab bar `flex gap-1 border-b border-separator`;
      three `<Link>` tabs: Settings→`/admin/settings`, Users→`/admin/users`, Audit→`/admin/audit`.
      Active tab (pathname starts with its href) styled per mockup L797–800 (active = `text-text
border-b-2 border-accent -mb-px`, inactive = `text-text-secondary hover:text-text`, each `px-3 py-2
text-label font-medium`). Commit `feat(dashboard): add AdminTabs nav`.

### Task 2: Reskin `admin/settings`

**Files:** Modify `admin/settings/page.tsx`; reskin `admin/settings/SettingsForm.tsx` presentation.

- [ ] Read both first. Page: keep session/ADMIN gate + `getCurrentTeam`; add `<SetPageTitle
title="Admin" />` + `<AdminTabs />`, remove `PageHeader`. Wrap in the tabbed layout. SettingsForm:
      reskin its controls into a `<Card padding="md">` "Monitoring policy" panel (label + description +
      the existing fields as rows matching mockup styling: range/number/select/checkbox rows with the
      Save button + save-note footer) — KEEP the form's existing field set, Server Action wiring, and
      validation; only restyle. Add a read-only `<Card>` "Effective policy" summary listing the saved
      values (screenshot interval, blur, retention, idle) in a 2-column grid, per mockup L843–855. Two
      cards in a `grid gap-4 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]`. typecheck+lint clean.
      Commit `feat(dashboard): reskin admin settings to mockup`.

### Task 3: Reskin `admin/users`

**Files:** Modify `admin/users/page.tsx` (+ read `InviteForm`/`RoleSelect`/`UserRowActions`, restyle only if needed).

- [ ] Keep session/ADMIN gate + `listUsers`. Add `<SetPageTitle title="Admin" />` + `<AdminTabs />`,
      remove `PageHeader`. A count row `{n} users · {active} active` + the Invite affordance (keep
      `InviteForm`; can present its trigger as a right-aligned button row). Card-wrapped table
      (`Card padding="none" overflow-hidden`): columns Name (Avatar + name) / Email / Role (`RoleSelect`) /
      Monitoring (keep existing ack text) / Status (`Badge`: active→`good`, deactivated→`neutral`) /
      Actions (`UserRowActions`). Reskin header/cell padding to mockup (`px-[18px] py-[11px]`, `text-caption`
      headers). Keep the empty state. typecheck+lint clean. Commit `feat(dashboard): reskin admin users to mockup`.

### Task 4: Reskin `admin/audit`

**Files:** Modify `admin/audit/page.tsx` (read it + `DiffToggle` first).

- [ ] Keep session/ADMIN gate + the filter form (targetType/id/from/to) + cursor "Next" pagination +
      `DiffToggle`. Add `<SetPageTitle title="Admin" />` + `<AdminTabs />`, remove `PageHeader`. Reskin
      the filter into a `Card` and the log into a Card-wrapped table matching mockup table styling. Keep
      all query/pagination behavior. typecheck+lint+build clean. Commit `feat(dashboard): reskin admin audit to mockup`.

### Task 5: e2e scaffold

**Files:** Create `apps/dashboard/e2e/admin.spec.ts`? NOTE: an `admin.spec.ts` ALREADY EXISTS — do NOT
create a duplicate. Instead APPEND a new skipped `test.describe.skip('admin reskin', …)` block to the
existing file? NO — appending edits an existing e2e file (violates append-only). Decision: create
`apps/dashboard/e2e/admin-reskin.spec.ts` (distinct new file, append-only). Cases: AdminTabs shows
Settings/Users/Audit and highlights the active tab; settings shows policy + effective-policy cards;
users table renders with role/status. Skipped; curly apostrophes. Commit `test(dashboard): scaffold admin reskin e2e cases`.

---

## Final verification

`pnpm lint && typecheck && test && build` green. Final whole-branch review (opus — 4 pages touched).
Visual check = user eyeball (localhost:3000/admin/settings). Blast radius: admin pages + AdminTabs +
new e2e file only; no other screen touched.

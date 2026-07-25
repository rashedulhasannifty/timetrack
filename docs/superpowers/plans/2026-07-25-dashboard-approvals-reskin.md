# Dashboard Redesign — Slice 4: Approvals reskin (Implementation Plan)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Reskin `/approvals` to the mockup — intro line + a Card table (Avatar + Week + Hours +
`Badge` status + a Decide→popover action), adopting the shared `Badge` (the deferred Slice-1
migration lands here). Keep all decide behavior + the reviewer note.

**Architecture:** `apps/dashboard` only. Server page + a reskinned client `DecideForm` (popover).
Uses `SetPageTitle`, `Card`, `Avatar`, `Badge`, `SectionHeader` (optional).

## Global Constraints

- `dashboard` scope only. No api/contracts/db change. No new dependency. No console.log.
- Preserve behavior: EMPLOYEE self / MANAGER own-team / ADMIN any gating (403 → "not permitted"),
  error + empty states, the status searchParam filter, the decide Server Action + inline error, and
  the optional reviewer **note** (do NOT drop it — it's a real feature; move it into the popover).
- Adopt `Badge`: map `statusBadge(status).tone` (`neutral|positive|warning`) → Badge tone
  (`neutral→'neutral'`, `positive→'good'`, `warning→'warning'`). Remove the local `BADGE_TONE`
  literal in `approvals/page.tsx`. (This is the deferred Slice-1 migration for THIS file; the
  `me/ApprovalsPanel.tsx` copy migrates in the My-Time slice.)
- Title → header via `SetPageTitle`; remove the in-`main` `PageHeader`.
- Tokens/utilities; `tt-numeric`. Server page; `DecideForm` is the only client island.
- Commits `feat(dashboard)`/`refactor`/`test` ≤72, NO AI attribution, author = repo git user. Stay
  on `feat/ds-7-approvals-reskin`; verify branch after each commit; never main.

## Mockup reference

`/private/tmp/claude-501/.../scratchpad/TimeTrack.dc.html` — Approvals L751–792: intro line (L754),
table in a surface card (L755–790) with columns User / Week / Hours / Status / Action; row =
avatar chip + name; status = pill; Action = a "Decide" button (L777) that toggles a popover
(L778–783) with **Approve** (green `var(--tt-good)`) + **Flag for payroll** (warning) buttons.

---

### Task 1: Reskin `DecideForm` → Decide-popover

**Files:** Modify `apps/dashboard/src/app/(app)/approvals/DecideForm.tsx`.

- [ ] Step 1: keep `useActionState(decideAction)` + the hidden `id` + the two submit buttons
      (`status=APPROVED`/`FLAGGED`) + the inline error. Restructure to the mockup pattern: a **"Decide"**
      toggle button (`useState(open)`; `bg-surface border-separator text-accent rounded-md px-3 py-1
text-caption`) that reveals a popover (`bg-surface-raised border-separator shadow-e2 rounded-[10px]
p-2 flex flex-col gap-2`, positioned near the button). Inside the popover: keep the optional
      `note` text input (small, full-width), then a row with **Approve** (`bg-good text-white rounded-md
px-3 py-1.5 text-caption font-medium`, submit `status=APPROVED`) and **Flag for payroll**
      (`bg-surface border-separator text-category-unproductive …`, submit `status=FLAGGED`). Disable while
      `pending`; show `state.message` on error. Close the popover on outside-click/Escape (like
      AccountMenu) — reuse that pattern (`useRef`+`useEffect`). Keep `'use client'`.
- [ ] Step 2: typecheck+lint clean. Step 3: commit `feat(dashboard): reskin approvals decide popover`.

### Task 2: Reskin `approvals/page.tsx`

**Files:** Modify `apps/dashboard/src/app/(app)/approvals/page.tsx`.

- [ ] Step 1: keep the server load (session, status param, `listApprovals`, forbidden/error/empty
      states). Render: `<SetPageTitle title="Approvals" />` (remove `PageHeader`); an intro `<p
className="text-label text-text-secondary">Weekly timesheets awaiting a manager decision. Flagged
weeks are held back from payroll export.</p>`; then a `<Card padding="none" className="overflow-hidden">`
      wrapping the `<table className="w-full text-[13px]">`. Header row (`px-[18px] py-3 text-caption
font-semibold text-text-secondary border-b border-separator`): User / Week / Hours (right) /
      Status / Action (right). Body rows (`px-[18px] py-[11px] border-b border-separator`): User =
      `<span className="inline-flex items-center gap-2"><Avatar name={row.userName} size={26}/>{row.userName}</span>`;
      Week = `weekLabel(row.periodStart)` (tt-numeric text-secondary); Hours right tt-numeric =
      `formatHours(row.totalSeconds ?? row.trackedSeconds)`; Status = `<Badge tone={TONE[statusBadge(row.status).tone]}>{statusBadge(row.status).label}</Badge>` with `const TONE = {neutral:'neutral', positive:'good', warning:'warning'} as const`; Action right = `<DecideForm approvalId={row.id} />`. Remove the local `BADGE_TONE`. Keep forbidden ("You’re not permitted to view approvals." curly) / error / empty ("No timesheets in this filter.") messages.
- [ ] Step 2: typecheck+lint+build clean; page stays a Server Component. Step 3: commit `feat(dashboard): reskin approvals screen to mockup`.

### Task 3: e2e scaffold

**Files:** Create `apps/dashboard/e2e/approvals.spec.ts` (skipped, append-only single new file).
Cases: table renders rows with status badges; Decide opens a popover with Approve + Flag; intro line
present. Mirror existing scaffolds; curly apostrophes. Commit `test(dashboard): scaffold approvals reskin e2e cases`.

---

## Final verification

`pnpm lint && typecheck && test && build` green. Final whole-branch review (opus). Visual check =
user eyeball (localhost:3000/approvals).

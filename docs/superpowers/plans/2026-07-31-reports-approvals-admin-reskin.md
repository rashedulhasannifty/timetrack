# Reports / Approvals / Admin Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Reports, Approvals, and Admin (Settings/Users/Audit) pages into visual alignment with the flagship Overview by extracting two shared presentational primitives — `Button` and a `Table` compound — and applying them across those pages.

**Architecture:** Two new presentational Server Components in `apps/dashboard/src/components/ui/` (`Button.tsx`, `Table.tsx`) replace hand-rolled `<table>` markup and repeated raw-Tailwind buttons. Each page keeps its exact data flow, Server/Client split, Server Actions, api-client calls, and 403 handling — only markup and styling change. No API, contracts, schema, or dependency changes.

**Tech Stack:** Next.js 16 (App Router, React 19 Server Components), Tailwind 4, TypeScript (strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest (node-env, no jsdom), Playwright.

## Global Constraints

- **Presentational only.** No change to any page's data flow, Server/Client boundary, Server Action, api-client method, export route, or 403/empty/error state logic. This is a reskin.
- **`Button` takes NO function props (no `onClick`).** It is a shared component used inside Server pages and client action forms; it renders `<a>` when `href` is present, else `<button>`. Submit buttons use `type="submit"` + `disabled={pending}`. Interactive toggle buttons that need `onClick` (DecideForm's "Decide" trigger; UserRowActions' "Erase…"/"Cancel" toggles) stay raw `<button onClick>` — do NOT route them through `Button`, and do NOT add `onClick` to `Button`.
- **No new dependency, no charting library, no widgets drawer** on these pages (drawer is Overview-only).
- **Tokens only:** styling derives from existing Tailwind token classes (`bg-accent`, `bg-surface`, `border-separator`, `text-text`, `text-text-secondary`, `bg-destructive`, `text-white`, `tt-numeric`, etc.). No new brand colors.
- **Verification model (repo convention):** the dashboard Vitest is node-env with no jsdom, so presentational components are NOT unit-tested — they are verified by `pnpm --filter dashboard typecheck` + `pnpm --filter dashboard build`, and existing view-transform specs must stay green (`pnpm --filter dashboard test`, currently 170 passing). No new `*-view.ts` transforms are introduced, so no new unit specs.
- **Commits:** Conventional Commits, scope `dashboard`. No AI attribution of any kind (no co-author trailer, no "generated with" footer). The husky pre-commit hook (gitleaks + lint-staged eslint/prettier) runs on every commit; let it reformat.
- **Branch:** `dashboard/reskin-reports-approvals-admin` (already created off `main`; A and B are merged).

---

### Task 1: Shared `Button` and `Table` primitives

**Files:**

- Create: `apps/dashboard/src/components/ui/Button.tsx`
- Create: `apps/dashboard/src/components/ui/Table.tsx`

**Interfaces:**

- Consumes: nothing (foundational).
- Produces (exact signatures the later tasks import):
  - `Button` — props: `variant?: 'primary' | 'secondary' | 'destructive'` (default `'secondary'`), `size?: 'sm' | 'md'` (default `'md'`), `href?: string`, `className?: string`, `children: ReactNode`, plus native `<button>`/`<a>` attributes (`type`, `disabled`, `download`, `aria-*`). When `href` is set, renders `<a>`; else `<button>`. **No `onClick`.**
  - `Table` — `{ children, className? }` → styled `<table>`.
  - `THead` — `{ children }` → `<thead>`.
  - `Tbody` — `{ children }` → `<tbody>`.
  - `Tr` — `{ children, interactive?: boolean, className? }` + native `<tr>` attributes (incl. `onClick`, `key`) → `<tr>`; `interactive` adds hover/cursor styling only.
  - `Th` — `{ children, align?: 'left' | 'right' (default 'left'), sortable?: boolean, sortDirection?: 'asc' | 'desc' | null, onSortClick?: () => void, className? }` → `<th scope="col">`; when `sortable`, wraps children in a `<button onClick={onSortClick}>` with a caret from `sortDirection`.
  - `Td` — `{ children, align?: 'left' | 'right' (default 'left'), className? }` + native `<td>` attributes → `<td>`; `align="right"` applies `text-right tt-numeric`.

- [ ] **Step 1: Create `Button.tsx`**

```tsx
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';
export type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'bg-surface border-separator text-text hover:border-text-secondary border',
  destructive: 'bg-destructive text-white hover:opacity-90',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'text-label px-3 py-1.5',
  md: 'text-body px-4 py-2',
};

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'> & {
    href: string;
  };

/**
 * The one button primitive: renders `<a>` when `href` is set (links, downloads), else `<button>`
 * (form submits). Presentational and function-prop-free by design so it can be dropped into both
 * Server pages and `'use client'` action forms. Interactive toggles that need `onClick` keep their
 * own raw markup — this component does not take `onClick`.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonAsButton | ButtonAsLink) {
  const cls = `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim();
  if ('href' in rest && rest.href !== undefined) {
    return (
      <a className={cls} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Create `Table.tsx`**

```tsx
import type { HTMLAttributes, ReactNode, TdHTMLAttributes } from 'react';

/** Full-width table shell; place inside a `<Card padding="none">`. */
export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <table className={`w-full border-collapse text-[13px] ${className}`.trim()}>{children}</table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/** Row; `interactive` adds hover/cursor styling only (any click handler stays with the caller). */
export function Tr({
  children,
  interactive = false,
  className = '',
  ...rest
}: {
  children: ReactNode;
  interactive?: boolean;
  className?: string;
} & HTMLAttributes<HTMLTableRowElement>) {
  const hover = interactive ? 'hover:bg-surface cursor-pointer' : '';
  return (
    <tr className={`${hover} ${className}`.trim()} {...rest}>
      {children}
    </tr>
  );
}

const HEAD_ALIGN = { left: 'text-left', right: 'text-right' } as const;

/**
 * Header cell. Unifies the header styling that was copy-pasted across the tables. When `sortable`,
 * wraps children in a button and shows a caret from `sortDirection` (↑ asc / ↓ desc / ⇅ inactive);
 * the sort state + handler stay with the caller (used only by the client Reports table).
 */
export function Th({
  children,
  align = 'left',
  sortable = false,
  sortDirection = null,
  onSortClick,
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  sortable?: boolean;
  sortDirection?: 'asc' | 'desc' | null;
  onSortClick?: () => void;
  className?: string;
}) {
  const base =
    `text-caption text-text-secondary border-separator border-b px-[18px] py-3 font-semibold ${HEAD_ALIGN[align]} ${className}`.trim();
  if (!sortable) {
    return (
      <th scope="col" className={base}>
        {children}
      </th>
    );
  }
  const caret = sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '⇅';
  return (
    <th scope="col" className={base}>
      <button type="button" onClick={onSortClick} className="inline-flex items-center gap-1">
        {children} <span aria-hidden="true">{caret}</span>
      </button>
    </th>
  );
}

/** Body cell. `align="right"` right-aligns and applies tabular numerals for numeric columns. */
export function Td({
  children,
  align = 'left',
  className = '',
  ...rest
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
} & TdHTMLAttributes<HTMLTableCellElement>) {
  const alignCls = align === 'right' ? 'text-right tt-numeric' : 'text-left';
  return (
    <td
      className={`border-separator border-b px-[18px] py-[11px] ${alignCls} ${className}`.trim()}
      {...rest}
    >
      {children}
    </td>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter dashboard typecheck`
Expected: PASS (both files compile; the `ButtonAsButton | ButtonAsLink` union and the `'href' in rest` narrowing type-check under strict settings).

- [ ] **Step 4: Build**

Run: `pnpm --filter dashboard build`
Expected: PASS. (No unit test — per the repo convention presentational components with no logic are verified by typecheck + build, the same bar as `Card`/`SectionHeader`/`StatCard`. They have no consumer yet; consumers arrive in Tasks 2–4.)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/ui/Button.tsx apps/dashboard/src/components/ui/Table.tsx
git commit -m "feat(dashboard): shared Button and Table UI primitives"
```

---

### Task 2: Reskin the Reports page

**Files:**

- Modify: `apps/dashboard/src/app/(app)/reports/page.tsx`
- Modify: `apps/dashboard/src/components/reports/ReportsByPersonTable.tsx`

**Interfaces:**

- Consumes: `Button` (secondary, `href`, `download`), `Table`/`THead`/`Tbody`/`Tr`/`Th`/`Td` from Task 1; existing `BarMeter` (`{ label, value, fills }`), `Card`, `Avatar`, `SectionHeader`, `ReportRangePicker`, `formatDuration`, `formatDate`, `sortTeamRows`.
- Produces: nothing new.

- [ ] **Step 1: Rewrite `reports/page.tsx`** — replace the raw Export-CSV `<a>` with `Button`, and move the range picker + export into a right-aligned header cluster aligned to the flagship. Full new file:

```tsx
import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { SectionHeader } from '../../../components/ui/SectionHeader';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { BarMeter } from '../../../components/charts/BarMeter';
import { ReportsByPersonTable } from '../../../components/reports/ReportsByPersonTable';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { defaultReportRange, hasReportData } from '../../../lib/reports-view';
import { formatDuration, formatDate } from '../../../lib/format';
import type { ProjectSummary, TeamSummary } from '@timetrack/contracts';

// Next 16 — searchParams is async.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; teamId?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const fallback = defaultReportRange(new Date());
  const from = sp.from ?? fallback.from;
  const to = sp.to ?? fallback.to;

  const params = new URLSearchParams({ from, to });
  if (sp.teamId) params.set('teamId', sp.teamId);

  let team: TeamSummary | null = null;
  let projects: ProjectSummary | null = null;
  let forbidden = false;
  try {
    // API enforces MANAGER/ADMIN + team scope; a 403 becomes the not-authorized state.
    [team, projects] = await Promise.all([
      api.teamSummary(session.accessToken, params),
      api.projectSummary(session.accessToken, params),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden = true;
    team = null;
    projects = null;
  }

  const projectsMax = projects ? Math.max(1, ...projects.rows.map((r) => r.trackedSeconds)) : 1;

  return (
    <>
      <SetPageTitle title="Reports" />
      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view reports.</p>
      ) : team === null || projects === null ? (
        <p className="text-text-secondary text-body">
          Something went wrong loading reports. Please try again.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-label text-text-secondary tt-numeric">
              Range {formatDate(from)} – {formatDate(to)} · {team.rows.length} users ·{' '}
              {projects.rows.length} projects
            </span>
            <div className="flex items-center gap-3">
              <ReportRangePicker from={from} to={to} />
              <Button
                variant="secondary"
                size="sm"
                href={`/reports/export?${params.toString()}`}
                download
              >
                Export CSV
              </Button>
            </div>
          </div>
          {hasReportData(team.rows, projects.rows) ? (
            <>
              <section className="flex flex-col gap-3">
                <SectionHeader label="By person" />
                <ReportsByPersonTable rows={team.rows} />
              </section>
              <section className="flex flex-col gap-3">
                <SectionHeader label="By project" />
                <Card padding="md">
                  <div className="flex flex-col gap-3.5">
                    {projects.rows.map((p) => (
                      <BarMeter
                        key={p.projectId ?? 'none'}
                        label={p.name}
                        value={formatDuration(p.trackedSeconds)}
                        fills={[
                          {
                            pct: (p.trackedSeconds / projectsMax) * 100,
                            color: 'var(--tt-accent)',
                          },
                        ]}
                      />
                    ))}
                  </div>
                </Card>
              </section>
            </>
          ) : (
            <p className="text-text-secondary text-body">No data in this range.</p>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Rewrite `ReportsByPersonTable.tsx`** — compose on the `Table` primitives; keep the client sort state + row navigation; swap the hand-rolled activity meter for `BarMeter`. Full new file:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TeamSummaryRow } from '@timetrack/contracts';
import { Card } from '../ui/Card';
import { Avatar } from '../ui/Avatar';
import { Table, THead, Tbody, Tr, Th, Td } from '../ui/Table';
import { BarMeter } from '../charts/BarMeter';
import { formatDuration } from '../../lib/format';
import { sortTeamRows } from '../../lib/reports-view';

type SortKey = 'name' | 'trackedSeconds' | 'activityPct';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Sortable, clickable "By person" table for the Reports page. Rows navigate to /people/[userId]. */
export function ReportsByPersonTable({ rows }: { rows: TeamSummaryRow[] }) {
  const [sort, setSort] = useState<Sort>({ key: 'trackedSeconds', dir: 'desc' });
  const router = useRouter();
  const sorted = sortTeamRows(rows, sort.key, sort.dir);

  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    );
  }

  const dirFor = (key: SortKey): 'asc' | 'desc' | null => (sort.key === key ? sort.dir : null);

  return (
    <Card padding="none" className="overflow-hidden">
      <Table>
        <THead>
          <Tr>
            <Th sortable sortDirection={dirFor('name')} onSortClick={() => handleSort('name')}>
              User
            </Th>
            <Th
              align="right"
              sortable
              sortDirection={dirFor('trackedSeconds')}
              onSortClick={() => handleSort('trackedSeconds')}
            >
              Tracked time
            </Th>
            <Th
              align="right"
              sortable
              sortDirection={dirFor('activityPct')}
              onSortClick={() => handleSort('activityPct')}
            >
              Activity %
            </Th>
          </Tr>
        </THead>
        <Tbody>
          {sorted.map((row) => (
            <Tr key={row.userId} interactive onClick={() => router.push(`/people/${row.userId}`)}>
              <Td>
                <span className="inline-flex items-center gap-2">
                  <Avatar name={row.name} size={26} />
                  {row.name}
                </span>
              </Td>
              <Td align="right">{formatDuration(row.trackedSeconds)}</Td>
              <Td align="right" className="w-[220px]">
                <BarMeter
                  label=""
                  value={`${row.activityPct}%`}
                  fills={[{ pct: row.activityPct, color: 'var(--tt-accent)' }]}
                />
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck + existing tests + build**

Run: `pnpm --filter dashboard typecheck && pnpm --filter dashboard test && pnpm --filter dashboard build`
Expected: typecheck PASS; test PASS (170 — `reports-view.spec` transforms untouched); build PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(app\)/reports/page.tsx apps/dashboard/src/components/reports/ReportsByPersonTable.tsx
git commit -m "refactor(dashboard): reskin Reports onto shared Table and Button"
```

---

### Task 3: Reskin the Approvals page

**Files:**

- Modify: `apps/dashboard/src/app/(app)/approvals/page.tsx`
- Modify: `apps/dashboard/src/app/(app)/approvals/DecideForm.tsx`

**Interfaces:**

- Consumes: `Table`/`THead`/`Tbody`/`Tr`/`Th`/`Td`, `Button` from Task 1; existing `Card`, `Avatar`, `Badge`, view-transforms `weekLabel`/`formatHours`/`statusBadge`, Server Action `decideAction`.
- Produces: nothing new.
- Note: `DecideForm`'s "Decide" trigger has an `onClick` toggle → it stays a raw `<button>` (Global Constraints). Only the Approve/Flag **submit** buttons become `Button`.

- [ ] **Step 1: Rewrite `approvals/page.tsx`** — swap the hand-rolled `<table>` for the `Table` compound. Full new file:

```tsx
import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { Card } from '../../../components/ui/Card';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../components/ui/Table';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { weekLabel, formatHours, statusBadge } from '../../../lib/approvals-view';
import { DecideForm } from './DecideForm';
import type { TimesheetApproval, ApprovalStatus } from '@timetrack/contracts';

// Maps statusBadge's tone vocabulary onto the shared Badge component's tone vocabulary.
const TONE: Record<'neutral' | 'positive' | 'warning', BadgeTone> = {
  neutral: 'neutral',
  positive: 'good',
  warning: 'warning',
} as const;

// Next 16 — searchParams is async.
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; teamId?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const status = (sp.status ?? 'PENDING') as ApprovalStatus;

  const params = new URLSearchParams({ status });
  if (sp.teamId) params.set('teamId', sp.teamId);

  let rows: TimesheetApproval[] | null = null;
  let forbidden = false;
  try {
    // API enforces EMPLOYEE self-only / MANAGER own-team / ADMIN any; a 403 becomes the
    // not-authorized state.
    rows = await api.listApprovals(session.accessToken, params);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden = true;
    rows = null;
  }

  return (
    <>
      <SetPageTitle title="Approvals" />
      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view approvals.</p>
      ) : rows === null ? (
        <p className="text-text-secondary text-body">
          Something went wrong loading approvals. Please try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-text-secondary text-body">No timesheets in this filter.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-label text-text-secondary">
            Weekly timesheets awaiting a manager decision. Flagged weeks are held back from payroll
            export.
          </p>
          <Card padding="none" className="overflow-hidden">
            <Table>
              <THead>
                <Tr>
                  <Th>User</Th>
                  <Th>Week</Th>
                  <Th align="right">Hours</Th>
                  <Th>Status</Th>
                  <Th align="right">Action</Th>
                </Tr>
              </THead>
              <Tbody>
                {rows.map((row) => {
                  const badge = statusBadge(row.status);
                  return (
                    <Tr key={row.id}>
                      <Td>
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={row.userName} size={26} />
                          {row.userName}
                        </span>
                      </Td>
                      <Td className="text-text-secondary tt-numeric">
                        {weekLabel(row.periodStart)}
                      </Td>
                      <Td align="right">{formatHours(row.totalSeconds ?? row.trackedSeconds)}</Td>
                      <Td>
                        <Badge tone={TONE[badge.tone]}>{badge.label}</Badge>
                      </Td>
                      <Td align="right">
                        <DecideForm approvalId={row.id} />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Update `DecideForm.tsx`** — replace the Approve (submit) and Flag (submit) buttons with `Button`; keep the "Decide" toggle as a raw `<button>` (it has `onClick`). Full new file:

```tsx
'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { decideAction, type DecideState } from './actions';

const INITIAL: DecideState = { ok: false };

/**
 * Approve/Flag controls for one pending (or already-decided, for re-decision) row. Client
 * component so a rejection (e.g. a manager outside the timesheet's team, 403) shows inline
 * instead of throwing. Posts to the decide Server Action, which holds the access token —
 * no token ever reaches this component.
 */
export function DecideForm({ approvalId }: { approvalId: string }) {
  const [state, formAction, pending] = useActionState(decideAction, INITIAL);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-surface border-separator text-accent cursor-pointer rounded-md border px-3 py-1 text-caption"
      >
        Decide
      </button>
      {open ? (
        <form
          action={formAction}
          className="bg-surface-raised border-separator shadow-e2 absolute right-0 z-40 mt-2 flex w-[220px] flex-col gap-2 rounded-[10px] border p-2"
        >
          <input type="hidden" name="id" value={approvalId} />
          <input
            type="text"
            name="note"
            placeholder="Note (optional)"
            maxLength={2000}
            className="bg-surface border-separator text-text focus:border-accent w-full rounded-md border px-2 py-1 text-caption outline-none"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              name="status"
              value="APPROVED"
              variant="primary"
              size="sm"
              disabled={pending}
            >
              Approve
            </Button>
            <Button
              type="submit"
              name="status"
              value="FLAGGED"
              variant="secondary"
              size="sm"
              disabled={pending}
            >
              Flag for payroll
            </Button>
          </div>
          {state.message ? (
            <span className="text-destructive text-caption">{state.message}</span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + existing tests + build**

Run: `pnpm --filter dashboard typecheck && pnpm --filter dashboard test && pnpm --filter dashboard build`
Expected: all PASS (170 tests; `approvals-view.spec` untouched).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(app\)/approvals/page.tsx apps/dashboard/src/app/\(app\)/approvals/DecideForm.tsx
git commit -m "refactor(dashboard): reskin Approvals onto shared Table and Button"
```

---

### Task 4: Reskin the Admin pages (Settings · Users · Audit)

**Files:**

- Modify: `apps/dashboard/src/app/(app)/admin/settings/SettingsForm.tsx`
- Modify: `apps/dashboard/src/app/(app)/admin/users/page.tsx`
- Modify: `apps/dashboard/src/app/(app)/admin/users/InviteForm.tsx`
- Modify: `apps/dashboard/src/app/(app)/admin/users/UserRowActions.tsx`
- Modify: `apps/dashboard/src/app/(app)/admin/audit/page.tsx`

**Interfaces:**

- Consumes: `Table`/`THead`/`Tbody`/`Tr`/`Th`/`Td`, `Button` from Task 1; existing `Card`, `Avatar`, `Badge`, `Forbidden`, `AdminTabs`, `formatDate`, `actorLabel`/`formatDiff`/`toIso`/`buildAuditParams`, `DiffToggle`, `RoleSelect`, and all admin Server Actions.
- Produces: nothing new.
- Notes:
  - `RoleSelect.tsx` already uses the shared field classes (`bg-surface border-separator focus:border-accent`) and has no button — **leave it unchanged.**
  - `UserRowActions`: the Deactivate/Reactivate (submit) and Confirm-erase (submit) buttons and the Export link become `Button`; the "Erase…" and "Cancel" toggles have `onClick` → stay raw `<button>`.
  - Audit filter inputs currently lack `focus:border-accent`; add it so they match the Settings/Invite fields.

- [ ] **Step 1: Update `SettingsForm.tsx` submit button** — replace the raw submit `<button>` (the four `Card` sections and the local `NumberField`/`Toggle`/select controls are unchanged; those field controls already carry `bg-surface border-separator focus:border-accent`). Change only the final submit block:

Replace:

```tsx
<button
  type="submit"
  disabled={pending}
  className="bg-accent hover:bg-accent-hover text-label rounded-md px-4 py-2 font-medium text-white transition-colors disabled:opacity-50"
>
  {pending ? 'Saving…' : 'Save settings'}
</button>
```

with:

```tsx
<Button type="submit" variant="primary" disabled={pending}>
  {pending ? 'Saving…' : 'Save settings'}
</Button>
```

And add the import after the existing `Card` import at the top of the file:

```tsx
import { Button } from '../../../../components/ui/Button';
```

- [ ] **Step 2: Rewrite `admin/users/page.tsx`** — swap the hand-rolled `<table>` for the `Table` compound. Full new file:

```tsx
import { Forbidden } from '../../../../components/ui/Forbidden';
import { Card } from '../../../../components/ui/Card';
import { Avatar } from '../../../../components/ui/Avatar';
import { Badge } from '../../../../components/ui/Badge';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { AdminTabs } from '../../../../components/ui/AdminTabs';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { formatDate } from '../../../../lib/format';
import { InviteForm } from './InviteForm';
import { UserRowActions } from './UserRowActions';
import { RoleSelect } from './RoleSelect';

/**
 * Slice 1.2 — the admin's workforce screen: list the team, invite new members, and
 * deactivate/reactivate. ADMIN-only; a non-admin sees the Forbidden view (the API would 403
 * on GET /users anyway). Server Component — the API scopes the list to the caller's team.
 */
export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) return null; // the layout already gated; this satisfies type-narrowing.
  if (session.role !== 'ADMIN') return <Forbidden />;

  const users = await api.listUsers(session.accessToken);
  const activeCount = users.filter((u) => u.deactivatedAt === null).length;

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="text-label text-text-secondary tt-numeric flex-1">
            {users.length} users · {activeCount} active
          </span>
        </div>
        <InviteForm />

        {users.length === 0 ? (
          <p className="text-text-secondary text-body">
            No users yet. Invite your first teammate above.
          </p>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <Table>
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Monitoring</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <Tbody>
                {users.map((u) => {
                  const deactivated = u.deactivatedAt !== null;
                  return (
                    <Tr key={u.id}>
                      <Td>
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={u.name} size={26} />
                          {u.name}
                        </span>
                      </Td>
                      <Td className="text-text-secondary">{u.email}</Td>
                      <Td>
                        <RoleSelect userId={u.id} role={u.role} />
                      </Td>
                      <Td className="text-text-secondary">
                        {u.monitoringAckAt ? (
                          `Acknowledged ${formatDate(u.monitoringAckAt)}`
                        ) : (
                          <span className="text-text-secondary">Not acknowledged</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={deactivated ? 'neutral' : 'good'}>
                          {deactivated ? 'Deactivated' : 'Active'}
                        </Badge>
                      </Td>
                      <Td align="right">
                        <UserRowActions userId={u.id} name={u.name} deactivated={deactivated} />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Update `InviteForm.tsx` submit button** — replace the raw submit `<button>` (fields unchanged; they already carry the shared classes). Add the import after the `useActionState` import:

```tsx
import { Button } from '../../../../components/ui/Button';
```

Replace:

```tsx
<button
  type="submit"
  disabled={pending}
  className="bg-accent hover:bg-accent-hover text-body rounded-md px-3 py-2 font-medium text-white transition-colors disabled:opacity-50"
>
  {pending ? 'Inviting…' : 'Invite'}
</button>
```

with:

```tsx
<Button type="submit" variant="primary" disabled={pending}>
  {pending ? 'Inviting…' : 'Invite'}
</Button>
```

- [ ] **Step 4: Update `UserRowActions.tsx`** — convert the Deactivate/Reactivate submit, the Export link, and the Confirm-erase submit to `Button`; keep the "Erase…" and "Cancel" toggles raw (they use `onClick`). Full new file:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { setUserActiveAction, eraseUserAction, type RowState } from './actions';

const INITIAL: RowState = { ok: false };

/**
 * Per-row admin controls. Client component so an API rejection (last-active-admin 409,
 * cross-team 403) is shown next to the button instead of throwing. Erase uses inline disclosure
 * with a required reason — irreversible, so it never fires from a single click.
 */
export function UserRowActions({
  userId,
  name,
  deactivated,
}: {
  userId: string;
  name: string;
  deactivated: boolean;
}) {
  const [state, formAction, pending] = useActionState(setUserActiveAction, INITIAL);
  const [eraseState, eraseAction, erasing] = useActionState(eraseUserAction, INITIAL);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="deactivated" value={deactivated ? 'false' : 'true'} />
          <Button
            type="submit"
            variant={deactivated ? 'secondary' : 'destructive'}
            size="sm"
            disabled={pending}
          >
            {deactivated ? 'Reactivate' : 'Deactivate'}
          </Button>
        </form>
        <Button href={`/admin/users/${userId}/export`} variant="secondary" size="sm">
          Export
        </Button>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="border-destructive/30 text-destructive hover:bg-destructive/10 rounded-md border px-2.5 py-1 text-caption font-medium transition-colors"
          >
            Erase…
          </button>
        ) : null}
      </div>

      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}

      {open ? (
        <form action={eraseAction} className="flex flex-col items-end gap-1">
          <input type="hidden" name="userId" value={userId} />
          <span className="text-category-unproductive text-caption">
            ⚠ Permanently deletes all data for {name}. This cannot be undone.
          </span>
          <input
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason (required)…"
            aria-label="Erasure reason"
            className="bg-surface border-separator text-text focus:border-accent rounded border px-1.5 py-1 text-caption outline-none transition-colors"
          />
          {eraseState.message ? (
            <span className="text-destructive text-caption">{eraseState.message}</span>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={erasing || reason.trim().length === 0}
            >
              {erasing ? 'Erasing…' : 'Confirm erase'}
            </Button>
            <button
              type="button"
              disabled={erasing}
              onClick={() => {
                setOpen(false);
                setReason('');
              }}
              className="border-separator text-text hover:bg-surface rounded border px-2 py-1 text-caption transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `admin/audit/page.tsx`** — swap the hand-rolled `<table>` for the `Table` compound, the Filter button for `Button variant="primary"`, the "Next →" link for `Button variant="secondary"`, and add `focus:border-accent` to the four filter inputs. Full new file:

```tsx
import { Forbidden } from '../../../../components/ui/Forbidden';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { AdminTabs } from '../../../../components/ui/AdminTabs';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';
import { actorLabel, formatDiff, toIso, buildAuditParams } from '../../../../lib/audit-view';
import { DiffToggle } from './DiffToggle';

// Next 16 — searchParams is async.
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    targetType?: string;
    targetId?: string;
    from?: string;
    to?: string;
    cursor?: string;
  }>;
}) {
  const session = await getSession();
  if (!session) return null; // layout already redirected
  if (session.role !== 'ADMIN') return <Forbidden />;

  const sp = await searchParams;
  // The URL carries the raw <input type="date"> values; normalize only at the API boundary.
  // (exactOptionalPropertyTypes: only spread a key in when its value is defined.)
  const fromIso = toIso(sp.from);
  // `to` maps to end-of-day so an inclusive lte covers that whole day's rows (not just its midnight).
  const toIsoVal = toIso(sp.to, 'end');
  const apiParams = buildAuditParams(
    {
      ...(sp.targetType ? { targetType: sp.targetType } : {}),
      ...(sp.targetId ? { targetId: sp.targetId } : {}),
      ...(fromIso ? { from: fromIso } : {}),
      ...(toIsoVal ? { to: toIsoVal } : {}),
    },
    sp.cursor,
  );

  let page: Awaited<ReturnType<typeof api.listAudit>> | null = null;
  let forbidden = false;
  try {
    page = await api.listAudit(session.accessToken, apiParams);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden = true;
    page = null;
  }

  // "Next" and re-filter links keep the raw (URL-format) filter values; only the cursor advances.
  const nextHref =
    page?.nextCursor != null ? `?${buildAuditParams(sp, page.nextCursor).toString()}` : null;

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />

      <div className="flex flex-col gap-4">
        <Card padding="md">
          <form method="get" className="flex flex-wrap items-end gap-3 text-label">
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">Target type</span>
              <input
                name="targetType"
                defaultValue={sp.targetType ?? ''}
                placeholder="e.g. user"
                className="bg-surface border-separator focus:border-accent text-label rounded-md border px-3 py-2 outline-none transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">Target id</span>
              <input
                name="targetId"
                defaultValue={sp.targetId ?? ''}
                className="bg-surface border-separator focus:border-accent text-label rounded-md border px-3 py-2 outline-none transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">From</span>
              <input
                type="date"
                name="from"
                defaultValue={sp.from ?? ''}
                className="bg-surface border-separator focus:border-accent text-label rounded-md border px-3 py-2 outline-none transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">To</span>
              <input
                type="date"
                name="to"
                defaultValue={sp.to ?? ''}
                className="bg-surface border-separator focus:border-accent text-label rounded-md border px-3 py-2 outline-none transition-colors"
              />
            </label>
            <Button type="submit" variant="primary" size="sm">
              Filter
            </Button>
          </form>
        </Card>

        {forbidden ? (
          <p className="text-text-secondary text-body">
            You’re not permitted to view the audit log.
          </p>
        ) : page === null ? (
          <p className="text-text-secondary text-body">
            Something went wrong loading the audit log.
          </p>
        ) : page.items.length === 0 ? (
          <p className="text-text-secondary text-body">No audit entries in this filter.</p>
        ) : (
          <>
            <Card padding="none" className="overflow-hidden">
              <Table>
                <THead>
                  <Tr>
                    <Th>Time</Th>
                    <Th>Actor</Th>
                    <Th>Action</Th>
                    <Th>Target</Th>
                    <Th>Diff</Th>
                  </Tr>
                </THead>
                <Tbody>
                  {page.items.map((item) => (
                    <Tr key={item.id}>
                      <Td className="tt-numeric whitespace-nowrap">{item.timestamp}</Td>
                      <Td>{actorLabel(item)}</Td>
                      <Td className="text-caption font-mono">{item.action}</Td>
                      <Td className="text-text-secondary">
                        {item.targetType}
                        <span className="text-text-secondary"> · {item.targetId}</span>
                      </Td>
                      <Td>
                        <DiffToggle json={formatDiff(item.diff)} />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
            {nextHref ? (
              <div>
                <Button href={nextHref} variant="secondary" size="sm">
                  Next →
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 6: Typecheck + existing tests + build**

Run: `pnpm --filter dashboard typecheck && pnpm --filter dashboard test && pnpm --filter dashboard build`
Expected: all PASS (170 tests; `audit-view.spec` untouched).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/app/\(app\)/admin
git commit -m "refactor(dashboard): reskin Admin pages onto shared Table and Button"
```

---

## Final verification (after all tasks)

Run the full dashboard gate once more on the integrated branch:

```bash
pnpm --filter dashboard typecheck && pnpm --filter dashboard test && pnpm --filter dashboard build
```

All green means the reskin is complete: two shared primitives in use across all three pages, no behavior/auth/data-flow change, existing tests intact. (Playwright e2e for these pages are skip-scaffolds per repo convention; if any existing `*.spec.ts` selector asserts on the old `<table>`/button DOM, update it in the same task that moved it — none run in CI unseeded.)

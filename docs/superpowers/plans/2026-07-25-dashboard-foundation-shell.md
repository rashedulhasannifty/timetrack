# Dashboard Redesign — Slice 1: Foundation kit + app shell (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the shared UI kit (Card/StatCard/Badge/SectionHeader/Avatar), the redesigned app
shell (responsive sidebar + header with page title, hamburger, account dropdown), the two missing
design tokens, and a `GET /users/me` endpoint — with **zero visual change to any screen body**.

**Architecture:** `apps/dashboard` (Next 16 App Router, RSC-first, Tailwind v4 token utilities) +
one self endpoint in `apps/api`'s users module. The shell becomes a client `AppShell` (owns
responsive state + title context) composed by the server `(app)/layout.tsx`, which resolves the
session, fetches the current user (`GET /users/me`) and a guarded live-tracking count.

**Tech Stack:** NestJS 11 (Fastify), Zod 4 contracts (reuse `UserSchema`), Next.js 16 / React 19,
Tailwind v4, Vitest (node-env for dashboard; unit + Testcontainers e2e for api), Playwright.

## Global Constraints

- **Scope:** `dashboard` + one `api` self endpoint (`GET /users/me`). **No** `contracts`/`db`/`worker`
  schema change (endpoint reuses `UserSchema` + existing `UsersRepository.findUser`). **No** new
  dependency.
- **No screen-body visual change.** Only chrome (sidebar/header) changes visually. Every new kit
  component (Badge included) is **additive** — added to the tree, wired to zero existing pages this
  slice. If any screen's content renders differently, it's a bug.
- **Pixel-perfect is verified, not assumed.** The chrome must be screenshot-compared to the mockup's
  shell (see "Visual verification" at the end). `typecheck/lint/build` proves compilation, not
  appearance — it is necessary but not sufficient for done.
- **Pixel-perfect to the mockup** for the chrome + kit: match the exact px/radii/weights quoted per
  task. Radii map to token utilities: 14px = `rounded-lg`, 10px = `rounded-md`, 6px = `rounded-sm`.
- **Tokens:** use the utility classes (`bg-surface-raised`, `border-separator`, `text-text`,
  `text-text-secondary`, `bg-accent`, `text-accent`, `shadow-e1`, `shadow-e2`, `tt-numeric`). After
  Task 3, `bg-good`/`text-good`/`bg-manual`/`text-manual` also exist. Do not hardcode hex except
  inside `lib/avatar.ts`'s palette and the mockup's per-segment inline chart colors (none here).
- **RSC:** Server Components by default; `'use client'` only where there is interaction —
  `AppShell`, `AccountMenu`, `Sidebar` (already client), `TopBar` (becomes client), `PageTitleContext`,
  `ThemeToggle` (already). Types come from `@timetrack/contracts`; never hand-write a response type.
- **Dashboard tests are node-env Vitest (no jsdom):** unit-test only pure logic (`lib/avatar.ts`).
  Components are verified by `pnpm --filter dashboard typecheck && lint && build`. A page/layout that
  fetches must stay dynamic.
- **Commits:** Conventional Commits, `feat(dashboard|api): …` / `test(...)` / `refactor(...)`,
  summary ≤72 chars, body optional. **No AI attribution, no co-author trailer, author = repo git
  user.** Stay on branch `feat/ds-4-foundation-shell`; verify HEAD after each commit.
- **Git discipline (prior-slice incident):** implementer/fix subagents must stay on
  `feat/ds-4-foundation-shell`; never commit to `main`; verify `git branch --show-current` after
  committing.

---

### Task 1: `GET /v1/users/me` (api)

**Files:**

- Modify: `apps/api/src/modules/users/users.controller.ts`
- Modify: `apps/api/src/modules/users/users.service.ts`
- Modify: `apps/api/src/modules/users/users.controller.spec.ts` (delegation)
- Modify: `apps/api/src/modules/users/users.service.spec.ts`
- Modify: `apps/api/test/users.e2e-spec.ts`

**Interfaces:**

- Consumes: existing `UsersRepository.findUser(id): Promise<User | null>`, `@CurrentUser()
SessionUser` (`{ id, role, teamId }`), `UserSchema`/`User` from `@timetrack/contracts`.
- Produces: `GET /users/me` returning the caller's own `User`. Dashboard Task 2 consumes it.

- [ ] **Step 1: Write the failing service unit test.** In `users.service.spec.ts`, add a `me` block
      mirroring the existing mock setup:

```ts
describe('me', () => {
  it('returns the caller’s own user', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.co',
      name: 'Ann Lee',
      role: 'EMPLOYEE',
    } as unknown as User;
    repo.findUser = vi.fn().mockResolvedValue(user);
    await expect(service.me({ id: 'u1', role: 'EMPLOYEE', teamId: 't1' })).resolves.toBe(user);
    expect(repo.findUser).toHaveBeenCalledWith('u1');
  });

  it('throws NotFound when the record is missing', async () => {
    repo.findUser = vi.fn().mockResolvedValue(null);
    await expect(service.me({ id: 'x', role: 'EMPLOYEE', teamId: 't1' })).rejects.toThrow();
  });
});
```

(Match the file's existing `service`/`repo` construction and `User` import — reuse them, don't
re-scaffold.)

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter @timetrack/api test -- users.service.spec`
      → FAIL (`service.me` is not a function).

- [ ] **Step 3: Implement `me` in `users.service.ts`.** Add after `list`:

```ts
/** Self-read: any authenticated user fetches their own record. */
async me(user: SessionUser): Promise<User> {
  const found = await this.repo.findUser(user.id);
  if (!found) {
    throw new NotFoundException({
      type: 'https://timetrack.internal/errors/not-found',
      title: 'User not found',
      status: 404,
    });
  }
  return found;
}
```

(`NotFoundException` is already imported.)

- [ ] **Step 4: Add the controller route.** In `users.controller.ts`, add **above** `@Get()` list
      (order is cosmetic here since `me` is a static segment and there is no `@Get(':id')`):

```ts
@Get('me')
me(@CurrentUser() user: SessionUser): Promise<User> {
  return this.service.me(user);
}
```

- [ ] **Step 5: Extend the controller-spec delegation.** In `users.controller.spec.ts`, add `me` to
      the delegation coverage in the same style the file already uses for `list`/`update` (assert
      `controller.me(user)` calls `service.me(user)`).

- [ ] **Step 6: Run unit tests, verify green** — `pnpm --filter @timetrack/api test -- users`
      → PASS.

- [ ] **Step 7: Add the e2e case.** In `apps/api/test/users.e2e-spec.ts`, follow the file's existing
      auth/setup helpers: an authenticated user `GET`s `/v1/users/me` → 200 with `body.id` === the
      caller's id and `body.email` present; an unauthenticated request → 401.

- [ ] **Step 8: Run e2e, verify green** —
      `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/users.e2e-spec.ts` (Docker up) → PASS.

- [ ] **Step 9: Commit** — `feat(api): add self endpoint GET /users/me`

---

### Task 2: `api.getCurrentUser` (dashboard client)

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts`

**Interfaces:**

- Consumes: `GET /users/me` (Task 1), existing `UserSchema`/`type User` (already imported here).
- Produces: `api.getCurrentUser(token): Promise<User>` — consumed by the layout (Task 11).

- [ ] **Step 1: Add the method.** In the `api` object, alongside `getCurrentTeam`:

```ts
getCurrentUser: (token: string): Promise<User> => get('/users/me', UserSchema, token),
```

(`UserSchema` and `type User` are already imported in this file.)

- [ ] **Step 2: Typecheck** — `pnpm --filter dashboard typecheck` → clean.

- [ ] **Step 3: Commit** — `feat(dashboard): add api.getCurrentUser client method`

---

### Task 3: Missing design tokens `--tt-good` / `--tt-manual`

**Files:**

- Modify: `apps/dashboard/src/app/globals.css`

**Interfaces:**

- Produces: `bg-good`/`text-good`/`border-good` and `bg-manual`/`text-manual` utilities used by
  `Badge` (Task 6) and `StatCard` callers (later slices).

- [ ] **Step 1: Add raw tokens to `:root`** (after `--tt-recording: #30b0c7;`):

```css
--tt-good: #34c759;
--tt-manual: #ffcc00;
```

- [ ] **Step 2: Add dark values to `.dark`** (after `--tt-recording: #40cbe0;`):

```css
--tt-good: #30d158;
--tt-manual: #ffd60a;
```

- [ ] **Step 3: Map them in `@theme inline`** (after `--color-recording: var(--tt-recording);`):

```css
--color-good: var(--tt-good);
--color-manual: var(--tt-manual);
```

- [ ] **Step 4: Verify** — `pnpm --filter dashboard build` succeeds (Tailwind picks up the new
      color roles; no error). No visual change yet (nothing consumes them until Task 6).

- [ ] **Step 5: Commit** — `feat(dashboard): add good/manual color tokens`

---

### Task 4: `lib/avatar.ts` + `Avatar` component

**Files:**

- Create: `apps/dashboard/src/lib/avatar.ts`
- Create: `apps/dashboard/src/lib/avatar.spec.ts`
- Create: `apps/dashboard/src/components/ui/Avatar.tsx`

**Interfaces:**

- Produces: `initialsFor(name: string): string`, `avatarColors(name: string): { bg: string; fg:
string }`, and `<Avatar name size? initials? className? />`. Consumed by `AccountMenu` (Task 8)
  and later screens.

- [ ] **Step 1: Write failing tests** (`avatar.spec.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { initialsFor, avatarColors, AVATAR_PALETTE } from './avatar';

describe('initialsFor', () => {
  it('takes first+last initials for multi-word names', () => {
    expect(initialsFor('John Doe')).toBe('JD');
    expect(initialsFor('  mary  jane  watson ')).toBe('MW');
  });
  it('takes up to two letters for a single name', () => {
    expect(initialsFor('Ann')).toBe('AN');
    expect(initialsFor('x')).toBe('X');
  });
  it('falls back to ? for empty input', () => {
    expect(initialsFor('')).toBe('?');
    expect(initialsFor('   ')).toBe('?');
  });
});

describe('avatarColors', () => {
  it('is deterministic per name', () => {
    expect(avatarColors('John Doe')).toEqual(avatarColors('John Doe'));
  });
  it('always returns a palette pair', () => {
    const c = avatarColors('Zoe Q');
    expect(AVATAR_PALETTE).toContainEqual(c);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter dashboard test -- avatar` → FAIL (no module).

- [ ] **Step 3: Implement `lib/avatar.ts`:**

```ts
/** Deterministic initials + chip colors for people avatars (no PII beyond the name). */
export const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#cfe4ff', fg: '#0b3d80' },
  { bg: '#ede0ff', fg: '#4b2673' },
  { bg: '#d3f2e3', fg: '#0f5132' },
  { bg: '#ffe6cc', fg: '#8a4b00' },
  { bg: '#ffd9e0', fg: '#8a1030' },
  { bg: '#d9f0f5', fg: '#0a4d5c' },
  { bg: '#fff3cc', fg: '#7a5900' },
  { bg: '#e3e6ea', fg: '#3a3f47' },
];

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarColors(name: string): { bg: string; fg: string } {
  return AVATAR_PALETTE[hash(name) % AVATAR_PALETTE.length]!;
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter dashboard test -- avatar` → PASS.

- [ ] **Step 5: Implement `Avatar.tsx`** (presentational, no `'use client'` needed):

```tsx
import { avatarColors, initialsFor } from '../../lib/avatar';

/** Round initials chip. Deterministic color from the name (see lib/avatar). */
export function Avatar({
  name,
  size = 30,
  initials,
  className = '',
}: {
  name: string;
  size?: number;
  initials?: string;
  className?: string;
}) {
  const { bg, fg } = avatarColors(name);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-none items-center justify-center rounded-full font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initials ?? initialsFor(name)}
    </span>
  );
}
```

- [ ] **Step 6: Typecheck** — `pnpm --filter dashboard typecheck` → clean.

- [ ] **Step 7: Commit** — `feat(dashboard): add Avatar + avatar helpers`

---

### Task 5: `Card` (extend) + `StatCard` + `SectionHeader`

**Files:**

- Modify: `apps/dashboard/src/components/ui/Card.tsx`
- Create: `apps/dashboard/src/components/ui/StatCard.tsx`
- Create: `apps/dashboard/src/components/ui/SectionHeader.tsx`

**Interfaces:**

- Produces: `<Card padding? className>`, `<StatCard label value info? bar? />`,
  `<SectionHeader label action? />`. Consumed by later screen slices (not wired to pages here).

- [ ] **Step 1: Extend `Card.tsx`** (non-breaking — default keeps today's behavior of "no built-in
      padding", callers pass their own):

```tsx
import type { ReactNode } from 'react';

/**
 * The raised surface of the design system: rounded-lg (14px), hairline separator border,
 * elevation-1 shadow, surface-raised background. `padding='md'` applies the standard 18px panel
 * padding; `padding='none'` (default) preserves the existing behavior where callers pass their own.
 */
export function Card({
  children,
  className = '',
  padding = 'none',
}: {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'md';
}) {
  const pad = padding === 'md' ? 'p-[18px]' : '';
  return (
    <div
      className={`bg-surface-raised border-separator rounded-lg border shadow-e1 ${pad} ${className}`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create `StatCard.tsx`** (mockup L160–181):

```tsx
import { Card } from './Card';
import { IconInfo } from './icons';

type Bar = { pct: number; color: string; caption: string; href?: string };

/** KPI tile: label (+optional ⓘ), big tabular value, optional progress bar with caption/link. */
export function StatCard({
  label,
  value,
  info = false,
  bar,
}: {
  label: string;
  value: string;
  info?: boolean;
  bar?: Bar;
}) {
  return (
    <Card padding="none" className="flex min-h-[118px] flex-col gap-2.5 p-4">
      <div className="flex items-start gap-1.5">
        <div className="text-label text-text-secondary flex-1">{label}</div>
        {info ? (
          <IconInfo
            width={13}
            height={13}
            className="text-text-secondary mt-[3px] flex-none opacity-60"
          />
        ) : null}
      </div>
      <div className="tt-numeric text-[28px] font-semibold leading-[1.1] tracking-[-0.02em]">
        {value}
      </div>
      {bar ? (
        <div className="mt-auto flex flex-col gap-1.5">
          <div className="bg-separator h-[5px] overflow-hidden rounded-[3px]">
            <div
              className="h-full rounded-[3px]"
              style={{ width: `${bar.pct}%`, background: bar.color }}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-caption text-text-secondary tt-numeric">{bar.caption}</span>
            {bar.href ? (
              <a href={bar.href} className="text-caption ml-auto">
                View details
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 3: Add `IconInfo` to `icons.tsx`** if absent — a circle with an `i` (mockup uses
      `<circle r=9/><path d="M12 11v5.5M12 7.6v.6"/>`), matching the existing icon signature
      `(props: SVGProps<SVGSVGElement>)` with `stroke="currentColor"`, `strokeWidth={1.8}`,
      `strokeLinecap="round"`, `fill="none"`, `viewBox="0 0 24 24"`.

- [ ] **Step 4: Create `SectionHeader.tsx`** (mockup L150–158):

```tsx
import type { ReactNode } from 'react';

/** Uppercase section label + hairline rule + optional right-aligned action. */
export function SectionHeader({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-caption text-text-secondary m-0 font-semibold uppercase tracking-[0.06em]">
        {label}
      </h2>
      <div className="bg-separator h-px flex-1" />
      {action}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + build** — `pnpm --filter dashboard typecheck && pnpm --filter dashboard build`
      → clean (existing `Card` callers unaffected; new components unused so far).

- [ ] **Step 6: Commit** — `feat(dashboard): add StatCard, SectionHeader; extend Card`

---

### Task 6: `Badge` (additive only)

**Files:**

- Create: `apps/dashboard/src/components/ui/Badge.tsx`

**Interfaces:**

- Produces: `<Badge tone children />`, `tone: 'neutral'|'accent'|'good'|'warning'|'destructive'`.

**Note:** This task **only adds the component** — it is wired to zero pages this slice. The two
existing pill call sites (`approvals/page.tsx`, `me/ApprovalsPanel.tsx`) are **not** migrated here:
swapping them is a visible change to screen bodies that node-env tests cannot verify, so it is
deferred to the Approvals and My-Time reskin slices (where those pages get eyes-on visual review
anyway). This keeps Slice 1 additive + chrome-only.

- [ ] **Step 1: Create `Badge.tsx`:**

```tsx
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warning' | 'destructive';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface border-separator text-text-secondary',
  accent: 'bg-accent/12 border-transparent text-accent',
  good: 'bg-good/15 border-transparent text-good',
  warning: 'bg-manual/20 border-transparent text-category-unproductive',
  destructive: 'bg-destructive/12 border-transparent text-destructive',
};

/** Status pill (mockup: rounded-full, caption weight-600). */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`text-caption inline-flex items-center rounded-full border px-3 py-1 font-semibold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck + lint + build** — `pnpm --filter dashboard typecheck && lint && build`
      → clean. (No page imports `Badge` yet — it is additive.)

- [ ] **Step 3: Commit** — `feat(dashboard): add Badge status-pill component`

---

### Task 7: `PageTitleContext`

**Files:**

- Create: `apps/dashboard/src/components/ui/PageTitleContext.tsx`

**Interfaces:**

- Produces: `TitleProvider` (wraps the shell), `useSetPageTitle(title)` + `SetPageTitle` (for pages,
  used in later slices), `usePageTitle(): string | null` (read by `TopBar`, Task 9).

- [ ] **Step 1: Implement:**

```tsx
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Ctx = { title: string | null; setTitle: (t: string | null) => void };
const PageTitleCtx = createContext<Ctx | null>(null);

export function TitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return <PageTitleCtx.Provider value={{ title, setTitle }}>{children}</PageTitleCtx.Provider>;
}

export function usePageTitle(): string | null {
  return useContext(PageTitleCtx)?.title ?? null;
}

/** Pages render <SetPageTitle> to drive the header title (used by later reskin slices). */
export function SetPageTitle({ title }: { title: string }) {
  const ctx = useContext(PageTitleCtx);
  useEffect(() => {
    ctx?.setTitle(title);
    return () => ctx?.setTitle(null);
  }, [ctx, title]);
  return null;
}
```

- [ ] **Step 2: Typecheck** — `pnpm --filter dashboard typecheck` → clean.

- [ ] **Step 3: Commit** — `feat(dashboard): add page-title context for the header`

---

### Task 8: `AccountMenu`

**Files:**

- Create: `apps/dashboard/src/components/ui/AccountMenu.tsx`

**Interfaces:**

- Consumes: `Avatar` (Task 4). Props: `{ name: string; email: string; role: string }`.
- Produces: `<AccountMenu name email role />` — used by `TopBar` (Task 9).

- [ ] **Step 1: Implement** (mockup L124–134 — dropdown with name/email/Sign out; closes on outside
      click + Escape):

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';

export function AccountMenu({ name, email }: { name: string; email: string; role: string }) {
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
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={name} size={30} />
      </button>
      {open ? (
        <div className="bg-surface-raised border-separator shadow-e2 absolute right-0 top-[38px] z-40 w-[200px] rounded-md border p-2.5">
          <div className="text-label font-semibold">{name}</div>
          <div className="text-caption text-text-secondary">{email}</div>
          <div className="bg-separator -mx-2.5 my-2 h-px" />
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="text-label text-destructive cursor-pointer py-1.5">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
```

(The `role` prop is part of the interface for later use; it's fine to leave it unrendered here —
the role badge lives in `TopBar`. Keep it in the signature so `TopBar` passes a consistent set.)

- [ ] **Step 2: Typecheck + lint** — clean. (No jsdom render; behavior verified in the e2e scaffold.)

- [ ] **Step 3: Commit** — `feat(dashboard): add account dropdown menu`

---

### Task 9: `Sidebar` — nav reconcile + responsive + footer slot

**Files:**

- Modify: `apps/dashboard/src/components/ui/Sidebar.tsx`

**Interfaces:**

- Consumes: nothing new. Props (new): `{ narrow: boolean; open: boolean; onNavigate: () => void;
footer?: ReactNode }`.
- Produces: the responsive sidebar consumed by `AppShell` (Task 11). The **footer is a slot** (a
  `ReactNode`), not a count — the layout passes a Suspense-wrapped async server component so the
  heavy `teamOverview` fetch stays off the first-paint path (Task 11).

- [ ] **Step 1: Rename the first primary item** `{ href: '/', label: 'Team', … }` → `label:
'Overview'` (keep `Icon: IconTeam`, `exact: true`). Keep Projects/Reports/Approvals/Admin and the
      `SECONDARY` "My time" item unchanged.

- [ ] **Step 2: Accept props and drive responsive positioning.** Change the signature to
      `export function Sidebar({ narrow, open, onNavigate, footer }: SidebarProps)` (import
      `type ReactNode`). The `<aside>` keeps `bg-surface-raised border-separator flex w-60 shrink-0
    flex-col border-r px-4 py-5` and adds, when `narrow`, the fixed-overlay classes + slide
      transform; when wide, sticky full-height:

```tsx
const positionClass = narrow
  ? 'fixed inset-y-0 left-0 z-[70] shadow-e2 transition-transform duration-200'
  : 'sticky top-0 h-screen';
const transform = narrow ? { transform: `translateX(${open ? '0' : '-105%'})` } : undefined;
// <aside className={`${base} ${positionClass}`} style={transform} aria-label="Primary"> …
```

Call `onNavigate()` from each `NavLink`'s `onClick` (so clicking a link closes the overlay on
narrow). Add `onClick={onNavigate}` to the `Link` in `NavLink` (harmless when wide).

- [ ] **Step 3: Render the footer slot** at the bottom of the `<aside>` (mockup L88–91). The
      `<div>` wrapper (with `mt-auto` so it sits at the bottom) renders only when `footer` is
      provided; the footer's actual markup (recording dot + "N clients tracking now") lives in the
      `TrackingFooter` server component (Task 11):

```tsx
{
  footer ? <div className="mt-auto px-2 pt-4">{footer}</div> : null;
}
```

- [ ] **Step 4: Typecheck + lint + build** — clean. (Sidebar now requires props; the only current
      caller is the layout, updated in Task 11 — expect a transient type error in the layout until then;
      note it, don't "fix" the layout here.)

- [ ] **Step 5: Commit** — `feat(dashboard): responsive sidebar + footer slot`

---

### Task 10: `TopBar` — client chrome (title, hamburger, account menu)

**Files:**

- Modify: `apps/dashboard/src/components/ui/TopBar.tsx`

**Interfaces:**

- Consumes: `usePageTitle` (Task 7), `AccountMenu` (Task 8), `ThemeToggle` (existing).
- Props (new): `{ role: string; name: string; email: string; narrow: boolean; onToggleSidebar:
() => void }`. Drops the `date` prop.
- Produces: the header consumed by `AppShell` (Task 11).

- [ ] **Step 1: Rewrite `TopBar.tsx` as a client component** matching the mockup header (L95–135).
      Keep the `ROLE_LABEL` map and the role-badge pill; replace the date with the page title (from
      `usePageTitle()`, falling back to a route→label map so it's never blank); add the narrow-only
      hamburger and the `AccountMenu`. Remove the old inline sign-out form (now in `AccountMenu`):

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { AccountMenu } from './AccountMenu';
import { usePageTitle } from './PageTitleContext';
import { IconMenu } from './icons';

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
};

const ROUTE_TITLES: { prefix: string; title: string; exact?: boolean }[] = [
  { prefix: '/', title: 'Overview', exact: true },
  { prefix: '/projects', title: 'Projects' },
  { prefix: '/reports', title: 'Reports' },
  { prefix: '/approvals', title: 'Approvals' },
  { prefix: '/admin', title: 'Admin' },
  { prefix: '/me', title: 'My time' },
  { prefix: '/people', title: 'Team' },
];

function fallbackTitle(pathname: string): string {
  const hit = ROUTE_TITLES.find((r) =>
    r.exact ? pathname === r.prefix : pathname.startsWith(r.prefix),
  );
  return hit?.title ?? 'TimeTrack';
}

export function TopBar({
  role,
  name,
  email,
  narrow,
  onToggleSidebar,
}: {
  role: string;
  name: string;
  email: string;
  narrow: boolean;
  onToggleSidebar: () => void;
}) {
  const ctxTitle = usePageTitle();
  const pathname = usePathname();
  const title = ctxTitle ?? fallbackTitle(pathname);

  return (
    <header className="border-separator bg-surface-raised sticky top-0 z-30 flex min-h-[60px] items-center gap-4 border-b px-6 py-3">
      {narrow ? (
        <button
          type="button"
          aria-label="Toggle navigation"
          onClick={onToggleSidebar}
          className="border-separator text-text grid h-8 w-8 flex-none place-items-center rounded-sm border"
        >
          <IconMenu width={16} height={16} />
        </button>
      ) : null}
      <h1 className="m-0 truncate text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
      <div className="flex-1" />
      <ThemeToggle />
      <span className="text-caption text-text-secondary border-separator whitespace-nowrap rounded-full border px-2.5 py-[3px] font-semibold">
        {ROLE_LABEL[role] ?? role}
      </span>
      <AccountMenu name={name} email={email} role={role} />
    </header>
  );
}
```

- [ ] **Step 2: Add `IconMenu`** to `icons.tsx` if absent (three lines: `M4 7h16M4 12h16M4 17h16`),
      same signature/props as the other icons.

- [ ] **Step 3: Typecheck + lint** — clean (the layout still passes the old props → transient type
      error there until Task 11; note it, don't patch the layout here).

- [ ] **Step 4: Commit** — `feat(dashboard): header with page title + account menu`

---

### Task 11: `AppShell` + wire `(app)/layout.tsx`

**Files:**

- Create: `apps/dashboard/src/components/ui/AppShell.tsx`
- Create: `apps/dashboard/src/components/ui/TrackingFooter.tsx`
- Modify: `apps/dashboard/src/app/(app)/layout.tsx`

**Interfaces:**

- Consumes: `Sidebar` (Task 9), `TopBar` (Task 10), `TitleProvider` (Task 7), `api.getCurrentUser`
  (Task 2), `api.teamOverview` + `ApiError` (existing).
- Produces: the composed authenticated shell. This task resolves all transient type errors from
  Tasks 9–10.
- **Footer is a Suspense slot, not a blocking count** (per review): the heavy `teamOverview` fetch
  lives in an async server component (`TrackingFooter`) wrapped in `<Suspense fallback={null}>`, so
  first paint never waits on it and a failure/403 renders nothing.

- [ ] **Step 1: Create `AppShell.tsx`** (client — owns responsive + sidebar-open state):

```tsx
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { TitleProvider } from './PageTitleContext';

export function AppShell({
  role,
  name,
  email,
  footer,
  children,
}: {
  role: string;
  name: string;
  email: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const apply = () => {
      const n = window.innerWidth < 900;
      setNarrow(n);
      if (!n) setOpen(false);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  return (
    <TitleProvider>
      <div className="flex min-h-screen">
        <Sidebar narrow={narrow} open={open} onNavigate={() => setOpen(false)} footer={footer} />
        {narrow && open ? (
          <div
            className="fixed inset-0 z-[60] bg-black/30"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            role={role}
            name={name}
            email={email}
            narrow={narrow}
            onToggleSidebar={() => setOpen((v) => !v)}
          />
          <main className="flex-1 p-8">{children}</main>
        </div>
      </div>
    </TitleProvider>
  );
}
```

- [ ] **Step 2: Create `TrackingFooter.tsx`** — an async **server** component that runs the heavy
      `teamOverview` fetch off the first-paint path and renders the footer markup (mockup L88–91), or
      `null` on 403/any failure:

```tsx
import { api } from '../../lib/api-client';

/** Async server slot: live-tracking count. Rendered inside <Suspense fallback={null}>. */
export async function TrackingFooter({ token }: { token: string }) {
  let count: number;
  try {
    const overview = await api.teamOverview(token);
    count = overview.rows.filter((r) => r.tracking).length;
  } catch {
    return null; // employees (403) or any failure → no footer
  }
  return (
    <div className="text-caption text-text-secondary flex items-center gap-2">
      <span className="bg-recording h-[7px] w-[7px] flex-none rounded-full" />
      <span>
        {count} {count === 1 ? 'client' : 'clients'} tracking now
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `(app)/layout.tsx`.** Resolve the session; fetch the current user for the
      header (name/email/role); on an `ApiError` 401 redirect to refresh (matching the null-session
      path) rather than throwing the whole shell; pass the footer as a Suspense-wrapped
      `TrackingFooter` so the shell never blocks on the team query:

```tsx
import { Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { api, ApiError } from '../../lib/api-client';
import { AppShell } from '../../components/ui/AppShell';
import { TrackingFooter } from '../../components/ui/TrackingFooter';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/api/auth/refresh');

  let me;
  try {
    me = await api.getCurrentUser(session.accessToken);
  } catch (err) {
    // An expired/invalid token surfaces as 401 → reissue like a null session. Anything
    // else is a genuine server error and should surface (not silently blank the shell).
    if (err instanceof ApiError && err.status === 401) redirect('/api/auth/refresh');
    throw err;
  }

  return (
    <AppShell
      role={me.role}
      name={me.name}
      email={me.email}
      footer={
        <Suspense fallback={null}>
          <TrackingFooter token={session.accessToken} />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
```

(Drop the old server-side `date` computation — the header no longer shows it. Note `redirect()`
throws internally, so it must be outside the `try`/`catch` that rethrows — it is.)

- [ ] **Step 4: Full gate** — `pnpm --filter dashboard typecheck && lint && build` → all clean
      (Sidebar/TopBar prop errors from Tasks 9–10 are now resolved).

- [ ] **Step 5: Manual smoke (read-only reasoning):** confirm every existing route still renders its
      body unchanged (only chrome differs) and the header title falls back correctly per route.

- [ ] **Step 6: Commit** — `feat(dashboard): compose responsive AppShell in the app layout`

---

### Task 12: E2E scaffold for the shell

**Files:**

- Create: `apps/dashboard/e2e/shell.spec.ts`

**Interfaces:** none (skipped scaffold, consistent with existing `*.spec.ts` e2e files).

- [ ] **Step 1: Add a skipped scaffold** (`test.describe.skip`) with cases: sidebar shows the nav
      items (Overview/Projects/Reports/Approvals/Admin/My time); the account avatar opens a dropdown
      with Sign out and closes on Escape/outside-click; on a narrow viewport the hamburger toggles the
      sidebar overlay; the header shows the page title. Use straight structure mirroring the existing
      scaffolds; any apostrophes in copy must be the curly `’` (U+2019) to match rendered text. **Append
      a new file only — do not modify other e2e files.**

- [ ] **Step 2: Verify Playwright collects it without running** —
      `pnpm --filter dashboard exec playwright test shell.spec.ts --list` (or the repo's list command)
      shows the cases as skipped.

- [ ] **Step 3: Commit** — `test(dashboard): scaffold app-shell e2e cases`

---

## Final verification (whole branch, before finishing)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/users.e2e-spec.ts   # Docker up
```

### Visual verification (pixel-perfect — REQUIRED, the user's explicit constraint)

`typecheck/lint/build` prove the chrome compiles, not that it matches the mockup. Before declaring
the slice done, the controller (not a node-env subagent) runs an eyes-on comparison of the **shell**
against `TimeTrack.dc.html`:

1. Start the stack (`docker compose … up -d`, then `pnpm dev`) and sign in to the dashboard.
2. Using the Chrome MCP browser tools, capture the chrome in each state and compare to the mockup:
   - **wide (≥900px)** — sidebar (brand, nav order Overview·Projects·Reports·Approvals·Admin·My
     time, footer) + header (title, theme toggle, role pill, account avatar);
   - **account dropdown open** (name·email·Sign out);
   - **narrow (<900px)** — hamburger visible, sidebar collapsed → overlay on toggle;
   - **dark mode** — toggle flips every `--tt-*` and the chrome still matches the mockup's `.dark`.
3. For each: note any px/spacing/weight/color drift from the mockup and file it as a fix before
   merge. A screen **body** looking different from _today_ (not the mockup) is a regression — also a
   fix. Record the screenshots/observations in the ledger.

This is a controller step in the final review, not a per-task gate (per-task screenshotting needs an
authed running session and isn't practical). If the dev server or auth can't be brought up in this
environment, say so explicitly in the ledger rather than marking visual verification passed.

All green + visual check clean. Then run the final whole-branch review, then
superpowers:finishing-a-development-branch.

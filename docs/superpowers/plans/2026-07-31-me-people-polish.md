# /me & /people Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the `/me` and `/people/[userId]` pages — dedup the `/people` identity header, label `ApprovalsPanel`'s prior-weeks list, and make the raw `onClick`/link buttons visually consistent with the `Button` primitive via a shared `buttonClasses()` styling helper.

**Architecture:** Extract a pure `buttonClasses(variant, size)` helper from the C-era `Button.tsx` (Button consumes it internally, public behavior unchanged) and add an `xs` size. The two kinds of control that can't be a `Button` component — `onClick` toggles and `next/link` links — apply the helper to their own `className`. Give the shared `DayHeader` an optional `avatar` slot (forwarded through `PersonDayView`) so it owns the single name + recording indicator, and delete the `/people` page's duplicate name heading and live tracking dot.

**Tech Stack:** Next.js 16 (App Router, React 19 Server Components), Tailwind 4, TypeScript (strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest (node-env, no jsdom — `include: src/**/*.spec.ts`).

## Global Constraints

- **Presentational only**, with ONE exception: dropping the now-unused `person.tracking` field on `/people` (the removed dot's data source). No other data-flow, api-client, Server-Action, or 403/empty/error-state change on either page.
- **`buttonClasses` is a pure string function** (`base + variant + size`). `Button`'s public contract is unchanged — still `variant`/`size`/`href`, still renders `<a>` when `href` is set, still **no `onClick`**. Adding `xs` only widens the `size` union.
- **`onClick` toggles and `next/link` links do NOT adopt the `Button` component** — they keep their `onClick`/client-side navigation and only take `buttonClasses(...)` for styling. Do not route them through `<Button>`, and do not add `onClick` to `Button`.
- **`DayHeader` is shared by `/me` and `/people`.** The new `avatar` prop is optional; `/me` passes nothing, so `/me`'s header must render identically — the only header change is on `/people`.
- **No `Table` swap**, no new charting/UI dependency, no change to `TimeRibbon`/`ActivityBars`/`DayStats`.
- **Tokens only:** existing Tailwind token classes; no new brand colors.
- **Verification (repo convention):** presentational components have no unit tests (node-env Vitest, no jsdom); they are verified by `pnpm --filter dashboard typecheck` + `pnpm --filter dashboard build`. The one genuinely unit-testable unit added is `buttonClasses` (pure string). Existing specs (170 passing) stay green.
- **Commits:** Conventional Commits, scope `dashboard`. No AI attribution/co-author trailer. The husky pre-commit hook (gitleaks + lint-staged) runs and may reformat.
- **Branch:** `dashboard/reskin-me-people` (already created off `main`; A/B/C merged).

---

### Task 1: Extract `buttonClasses` helper + `xs` size

**Files:**

- Modify: `apps/dashboard/src/components/ui/Button.tsx`
- Create (test): `apps/dashboard/src/components/ui/Button.spec.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `buttonClasses(variant?: ButtonVariant, size?: ButtonSize): string` — returns `` `${BASE} ${VARIANTS[variant]} ${SIZES[size]}` `` (base + variant + size, NO trailing className). Defaults `variant='secondary'`, `size='md'`.
  - `ButtonSize` widened to `'xs' | 'sm' | 'md'`; `SIZES.xs = 'text-caption px-2.5 py-1'`.
  - `Button` component unchanged in behavior (now builds its class via `buttonClasses`).

- [ ] **Step 1: Write the failing test** — create `apps/dashboard/src/components/ui/Button.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buttonClasses } from './Button';

describe('buttonClasses', () => {
  it('composes base + variant + size', () => {
    const cls = buttonClasses('primary', 'sm');
    expect(cls).toContain('bg-accent'); // primary variant
    expect(cls).toContain('text-label px-3 py-1.5'); // sm size
    expect(cls).toContain('rounded-md'); // base
  });

  it('supports the xs size for compact contexts', () => {
    expect(buttonClasses('secondary', 'xs')).toContain('text-caption px-2.5 py-1');
  });

  it('renders each variant', () => {
    expect(buttonClasses('primary', 'md')).toContain('bg-accent');
    expect(buttonClasses('secondary', 'md')).toContain('border-separator');
    expect(buttonClasses('destructive', 'md')).toContain('bg-destructive');
  });

  it('defaults to secondary + md', () => {
    expect(buttonClasses()).toBe(buttonClasses('secondary', 'md'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter dashboard test -- src/components/ui/Button.spec.ts`
Expected: FAIL — `buttonClasses` is not exported from `./Button` yet (import error / undefined).

- [ ] **Step 3: Implement** — rewrite `apps/dashboard/src/components/ui/Button.tsx` to this (extracts `buttonClasses`, adds `xs`; the `Button` component keeps its exact prior behavior):

```tsx
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';
export type ButtonSize = 'xs' | 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'bg-surface border-separator text-text hover:border-text-secondary border',
  destructive: 'bg-destructive text-white hover:opacity-90',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'text-caption px-2.5 py-1',
  sm: 'text-label px-3 py-1.5',
  md: 'text-body px-4 py-2',
};

/**
 * The shared button styling recipe: base + variant + size. Exported so the two kinds of control that
 * cannot adopt the `Button` component itself — interactive `onClick` toggles and `next/link` links —
 * can render the exact same look by applying this to their own `className`.
 */
export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'className' | 'children' | 'onClick' | 'onClickCapture'
  > & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    'className' | 'children' | 'onClick' | 'onClickCapture'
  > & {
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
  const cls = `${buttonClasses(variant, size)} ${className}`.trim();
  if ('href' in rest && rest.href !== undefined) {
    return (
      <a className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter dashboard test -- src/components/ui/Button.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm --filter dashboard typecheck && pnpm --filter dashboard test && pnpm --filter dashboard build`
Expected: typecheck PASS; test PASS (was 170 → now 174, the 4 new `buttonClasses` tests collected — confirm the count went UP, proving the new spec is picked up); build PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/ui/Button.tsx apps/dashboard/src/components/ui/Button.spec.ts
git commit -m "refactor(dashboard): extract buttonClasses helper with xs size"
```

---

### Task 2: Apply — header dedup, section label, consistent buttons

**Files:**

- Modify: `apps/dashboard/src/components/day/DayHeader.tsx`
- Modify: `apps/dashboard/src/components/day/PersonDayView.tsx`
- Modify: `apps/dashboard/src/app/(app)/people/[userId]/page.tsx`
- Modify: `apps/dashboard/src/app/(app)/me/ApprovalsPanel.tsx`
- Modify: `apps/dashboard/src/app/(app)/me/ScreenshotsPanel.tsx`

**Interfaces:**

- Consumes: `buttonClasses` from Task 1; existing `Avatar`, `SectionHeader`, `DayHeader`, `PersonDayView`.
- Produces: `DayHeader` gains optional `avatar?: ReactNode`; `PersonDayView` gains optional `avatar?: ReactNode` (forwarded to `DayHeader`).

- [ ] **Step 1: Add the `avatar` slot to `DayHeader`** — modify `apps/dashboard/src/components/day/DayHeader.tsx`.

Add a `ReactNode` type import at the top (after the existing imports):

```tsx
import type { ReactNode } from 'react';
```

Add `avatar` to the props (signature + type):

```tsx
export function DayHeader({
  date,
  subjectName,
  isSelf,
  isToday,
  recordingNow,
  avatar,
}: {
  date: string;
  subjectName: string;
  isSelf: boolean;
  isToday: boolean;
  recordingNow: boolean;
  avatar?: ReactNode;
}) {
```

Wrap the name/date block so the avatar sits beside it. Replace:

```tsx
<div>
  <h1 className="text-h1 font-display font-semibold">{subjectName}</h1>
  <p className="text-text-secondary text-label mt-0.5">{formatDayLabel(date)}</p>
</div>
```

with:

```tsx
<div className="flex items-center gap-3.5">
  {avatar}
  <div>
    <h1 className="text-h1 font-display font-semibold">{subjectName}</h1>
    <p className="text-text-secondary text-label mt-0.5">{formatDayLabel(date)}</p>
  </div>
</div>
```

(When `avatar` is undefined — the `/me` case — `{avatar}` renders nothing and the single-child flex wrapper is visually identical to the prior plain `<div>`.)

- [ ] **Step 2: Forward `avatar` through `PersonDayView`** — modify `apps/dashboard/src/components/day/PersonDayView.tsx`.

Add `avatar` to the props (signature + type):

```tsx
export function PersonDayView({
  model,
  avatar,
  screenshots,
}: {
  model: PersonDayViewModel;
  avatar?: ReactNode;
  screenshots: ReactNode;
}) {
```

Pass it to `DayHeader`:

```tsx
<DayHeader
  date={model.date}
  subjectName={model.subjectName}
  isSelf={model.isSelf}
  isToday={model.isToday}
  recordingNow={model.recordingNow}
  avatar={avatar}
/>
```

(`PersonDayView` already imports `ReactNode`. `/me`'s page renders `<PersonDayView>` with no `avatar` → `undefined` → `/me` header unchanged.)

- [ ] **Step 3: Dedup the `/people` header** — modify `apps/dashboard/src/app/(app)/people/[userId]/page.tsx`.

Add the `buttonClasses` import (after the `Avatar` import):

```tsx
import { buttonClasses } from '../../../../components/ui/Button';
```

Reduce `person` to just the name (drop the unused `tracking` field). Replace:

```tsx
let person = { name: 'Team member', tracking: false };
try {
  const ov = await api.teamOverview(session.accessToken);
  const row = ov.rows.find((r) => r.userId === userId);
  if (row) person = { name: row.name, tracking: row.tracking };
} catch {
  /* decorative — never crash the header */
}
```

with:

```tsx
let person = { name: 'Team member' };
try {
  const ov = await api.teamOverview(session.accessToken);
  const row = ov.rows.find((r) => r.userId === userId);
  if (row) person = { name: row.name };
} catch {
  /* decorative — never crash the header */
}
```

Replace the whole authorized-branch block (the `<div className="flex flex-col gap-5">…</div>` containing the old header row + `PersonDayView`) with:

```tsx
<div className="flex flex-col gap-5">
  <div>
    <Link href="/" className={buttonClasses('secondary', 'sm')}>
      ← Back
    </Link>
  </div>

  <PersonDayView
    model={model}
    avatar={<Avatar name={person.name} size={40} />}
    screenshots={<ScreenshotsPanel shots={screenshots.map(toScreenshotView)} />}
  />
</div>
```

(This deletes the page's own `text-[22px]` name heading and the "Currently tracking" dot block — `DayHeader` now renders the single name + "Recording now" indicator, with the avatar in its new slot. The Back `<Link>` stays a `next/link` for client-side nav, styled via `buttonClasses`.)

- [ ] **Step 4: Label the prior-weeks list in `ApprovalsPanel`** — modify `apps/dashboard/src/app/(app)/me/ApprovalsPanel.tsx`.

Add the `SectionHeader` import (after the `Badge` import):

```tsx
import { SectionHeader } from '../../../components/ui/SectionHeader';
```

Wrap the prior-weeks list with a section header. Replace:

```tsx
      {rest.length > 0 && (
        <div className="flex flex-col gap-2">
          {rest.map((row) => {
```

with:

```tsx
      {rest.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionHeader label="Earlier weeks" />
          <div className="flex flex-col gap-2">
            {rest.map((row) => {
```

and close the extra wrapping `<div>` — replace the list's closing:

```tsx
          })}
        </div>
      )}
```

with:

```tsx
            })}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Consistent buttons in `ScreenshotsPanel`** — modify `apps/dashboard/src/app/(app)/me/ScreenshotsPanel.tsx`.

Add the `buttonClasses` import (after the existing imports at the top):

```tsx
import { buttonClasses } from '../../../components/ui/Button';
```

Replace the **Redact** trigger's `className` (keep `type`, `onClick`, and the absolute-positioning classes):

```tsx
className =
  'bg-surface-raised border-separator text-text hover:bg-surface text-caption absolute right-1.5 bottom-1.5 rounded-full border px-2.5 py-0.5 transition-colors';
```

with:

```tsx
            className={`${buttonClasses('secondary', 'xs')} absolute right-1.5 bottom-1.5`}
```

Replace the **Confirm** button's `className` (keep `type`, `disabled`, `onClick`):

```tsx
className =
  'bg-accent hover:bg-accent-hover text-caption rounded px-2 py-1 text-white transition-colors disabled:opacity-50';
```

with:

```tsx
              className={buttonClasses('primary', 'xs')}
```

Replace the **Cancel** button's `className` (keep `type`, `disabled`, `onClick`):

```tsx
className =
  'border-separator text-text hover:bg-surface text-caption rounded border px-2 py-1 transition-colors';
```

with:

```tsx
              className={buttonClasses('secondary', 'xs')}
```

- [ ] **Step 6: Full gate**

Run: `pnpm --filter dashboard typecheck && pnpm --filter dashboard test && pnpm --filter dashboard build`
Expected: typecheck PASS; test PASS (174 — no new tests this task, existing stay green; `me/screenshot-view.spec.ts` and `me/actions.spec.ts` untouched); build PASS.

- [ ] **Step 7: Manual sanity (read the rendered intent)**

Confirm from the code: on `/people`, the person name now appears exactly once (`DayHeader`'s `h1`) with the `Avatar` beside it and a single "Recording now" pill; on `/me`, `PersonDayView` is rendered with no `avatar` prop, so its header is byte-identical to before.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/components/day/DayHeader.tsx apps/dashboard/src/components/day/PersonDayView.tsx apps/dashboard/src/app/\(app\)/people apps/dashboard/src/app/\(app\)/me/ApprovalsPanel.tsx apps/dashboard/src/app/\(app\)/me/ScreenshotsPanel.tsx
git commit -m "refactor(dashboard): dedup person header and unify me/people buttons"
```

---

## Final verification (after both tasks)

Run the full dashboard gate on the integrated branch:

```bash
pnpm --filter dashboard typecheck && pnpm --filter dashboard test && pnpm --filter dashboard build
```

All green means: `buttonClasses` is the single source of truth for button styling (used by the `Button` component, the `ScreenshotsPanel` `onClick` toggles, and the `/people` Back link); `/people` shows one name + one recording indicator with the avatar in `DayHeader`'s slot; `/me` is unchanged; and `ApprovalsPanel`'s history is labeled. (Any `/me` / `/people` Playwright specs are skip-scaffolds; update selectors only if the header dedup moved an asserted element — none run in CI unseeded.)

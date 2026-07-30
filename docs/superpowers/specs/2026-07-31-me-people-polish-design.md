# Design — /me & /people polish pass (manager dashboard, sub-project D)

Date: 2026-07-31
Status: approved (pending spec review)

## 1. Problem

Sub-projects A (team analytics backend), B (Overview flagship reskin), and C (Reports/Approvals/Admin
reskin) are merged. The redesign prompt (`docs/dashboard-redesign-prompt.md`) also names two more
pages: **`/me`** (employee self-view) and **`/people/[userId]`** (manager per-person deep-dive).

Unlike the C pages, these two were **already built on the flagship vocabulary** during the day-view
work: both render the shared `PersonDayView` composition (`components/day/`), which already uses
`Card`, `SectionHeader`, `StatCard`, and bespoke day charts (`TimeRibbon`, `ActivityBars`). So there is
no reskin backlog here of the C kind — no hand-rolled tables, and the shared body is on-vocabulary.

Two facts shape this sub-project:

- **The two pages share their entire body** via `PersonDayView`, and `/people` reuses `/me`'s
  `ScreenshotsPanel`. Fixing a shared component fixes both pages at once.
- **The shared `Button` primitive (from C) mostly does not fit here.** Nearly every button/link on
  these pages is one of two kinds that must _not_ become `Button`: `onClick` toggles (ScreenshotsPanel's
  Redact/Confirm/Cancel — `Button` has no `onClick` by design) or `next/link` client-navigation links
  (the Back link, the day-nav) — swapping those for `Button`'s plain `<a>` would trade fast client-side
  navigation for full-page reloads.

What remains is a small, targeted polish pass: three concrete gaps plus one enabling refactor.

This is **sub-project D** — the final piece of the redesign.

## 2. Goals / non-goals

**Goals**

- Remove a real duplication on `/people`: the page renders its own name heading + live tracking dot,
  while the shared `DayHeader` inside `PersonDayView` already renders an `h1` name + a "Recording now"
  pill. Reconcile to a single header.
- Give `/me`'s `ApprovalsPanel` prior-weeks list a `SectionHeader` (it is currently unlabeled).
- Make `ScreenshotsPanel`'s raw `onClick` buttons and the `/people` Back link visually consistent with
  the `Button` primitive **without** adopting the `Button` component (which they can't), by extracting a
  shared `buttonClasses()` styling helper they can all draw from.

**Non-goals**

- No adoption of the `Button` _component_ by `onClick` toggles or `next/link` links (see §1).
- No change to the shared day charts (`TimeRibbon`, `ActivityBars`), `DayStats`, `PersonDayView`
  structure, or the `TimeEntriesList` / `ApprovalsPanel` div-list markup (no `Table` swap — these are
  compact lists, not tabular data worth a table).
- No API / contracts / schema / dependency change, no new endpoint.
- No data-flow, Server-Action, or auth (403) change. The one small logic change is dropping the
  now-unused `person.tracking` field on `/people` (the removed dot's data source).

## 3. Key decisions

- **Extract `buttonClasses(variant, size)` from `Button.tsx`.** `Button` already builds its class string
  from `BASE + VARIANTS[variant] + SIZES[size]`; lift that into an exported pure helper that `Button`
  consumes internally (its public behavior, including no `onClick`, is unchanged). This is the single
  source of truth that the things which _can't_ be a `Button` — `onClick` toggles and `next/link` links —
  share for identical styling. Add an **`xs`** size (`text-caption px-2.5 py-1`) for compact contexts
  like the 160px screenshot tiles, where `Button`'s `sm` (`text-label px-3 py-1.5`) is too large.
- **`DayHeader` owns the identity header; the `/people` page stops duplicating it.** Add an optional
  `avatar?: ReactNode` slot to `DayHeader` (rendered beside its `h1`). `/people` moves its `Avatar` into
  that slot and deletes its own `text-[22px]` name heading. `/me` passes no avatar, so its header is
  unchanged.
- **Drop `/people`'s live "Currently tracking" dot; `DayHeader`'s "Recording now" pill is the single
  indicator.** Two different tracking signals in one header is the confusion being removed, and a live
  "Currently tracking" label shown next to a _past-day_ view is misleading (it is not day-scoped, the
  pill is). Live "who is tracking now" already lives on the Overview. This removes the only use of
  `person.tracking`; the `teamOverview` fetch stays (it still supplies the subject name).
- **The Back link stays a `next/link`** (page-specific manager navigation, client-side nav preserved),
  restyled via `buttonClasses('secondary', 'sm')`.
- **`ScreenshotsPanel`'s three buttons stay raw `<button onClick>`** (they need `onClick`), restyled via
  `buttonClasses` at `xs` scale: Redact = `secondary`, Confirm = `primary`, Cancel = `secondary`. The
  one-off `rounded-full` pill on Redact becomes the standard `rounded-md` from the shared recipe. The
  reason `<input>` keeps its current token-correct treatment (no shared field primitive exists — YAGNI).
- **No `Table` swap.** `ApprovalsPanel`'s prior-weeks rows and `TimeEntriesList` are compact div/`ul`
  lists, not tabular data that benefits from the `Table` compound. Only add the missing `SectionHeader`.

## 4. The `buttonClasses` helper

`components/ui/Button.tsx` — export a pure function; `Button` uses it internally:

```ts
export type ButtonVariant = 'primary' | 'secondary' | 'destructive';
export type ButtonSize = 'xs' | 'sm' | 'md';

export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
): string; // returns `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`
```

- `BASE`, `VARIANTS` unchanged from the current `Button.tsx`.
- `SIZES` gains `xs: 'text-caption px-2.5 py-1'`; `sm`/`md` unchanged.
- `Button`'s render becomes `className={\`${buttonClasses(variant, size)} ${className}\`.trim()}`— no
behavior change, still no`onClick`, still `<a>`when`href` is set.

Consumers of the helper (NOT the component):

- `/people` Back `<Link>` → `buttonClasses('secondary', 'sm')`.
- `ScreenshotsPanel` Redact `<button>` → `buttonClasses('secondary', 'xs')`.
- `ScreenshotsPanel` Confirm `<button>` → `buttonClasses('primary', 'xs')`.
- `ScreenshotsPanel` Cancel `<button>` → `buttonClasses('secondary', 'xs')`.

## 5. Component changes

Data flow, Server/Client split, Server Actions, api-client calls, and 403/empty/error states are
unchanged except the single noted `person.tracking` removal.

### `components/ui/Button.tsx` — modify

Extract + export `buttonClasses`; add the `xs` size; `Button` consumes the helper. Public `Button`
behavior unchanged.

### `components/ui/Button.spec.ts` — create

Unit tests for `buttonClasses`: composes base + variant + size for each variant and each size (incl.
`xs`); defaults are `secondary` + `md`.

### `components/day/DayHeader.tsx` — modify

Add optional `avatar?: ReactNode` prop; render it beside the `h1`/date block (e.g. wrap the name block
in a `flex items-center gap-3.5` with `{avatar}` first). All existing props/behavior (`recordingNow`
pill, day-nav, `isSelf` banner) unchanged. When `avatar` is omitted the header renders as today.

### `app/(app)/people/[userId]/page.tsx` — modify

- Move the `Avatar` into `DayHeader`'s new `avatar` slot (pass `avatar={<Avatar name={person.name} size={40} />}`).
- Delete the page's own `text-[22px]` name heading and the "Currently tracking" dot block (page.tsx
  lines ~86–94).
- Reduce `person` to just the name (drop the unused `.tracking` field); keep the `teamOverview` fetch
  for the name with its existing try/catch fallback.
- Restyle the Back `<Link>` with `className={buttonClasses('secondary', 'sm')}` (import `buttonClasses`).
- Keep the Back link in the page header row (page-specific nav, above `PersonDayView`).

### `app/(app)/me/ApprovalsPanel.tsx` — modify

Add `SectionHeader label="Earlier weeks"` immediately above the prior-weeks list (`rest.length > 0`
block). Import `SectionHeader`. Hero this-week `Card` and row markup unchanged.

### `app/(app)/me/ScreenshotsPanel.tsx` — modify

Replace the three raw button `className`s with `buttonClasses(...)` calls (Redact/Cancel = secondary,
Confirm = primary, all `xs`), keeping each button's `type`, `onClick`, `disabled`, and label. Import
`buttonClasses`. The reason `<input>` is unchanged.

## 6. Testing

- **Unit (Vitest, node-env):** `Button.spec.ts` covers `buttonClasses` (pure string composition). No
  other new unit tests — the rest are presentational components (no jsdom to render them).
- **Verification:** `pnpm --filter dashboard typecheck && pnpm --filter dashboard test &&
pnpm --filter dashboard build`, all green. Existing specs (`me/screenshot-view.spec.ts`,
  `me/actions.spec.ts`, and all others) stay green — their logic is untouched.
- **Manual/visual note for review:** confirm `/me`'s header renders identically (it passes no `avatar`),
  and `/people` now shows exactly one name + one recording indicator.
- **E2E:** any `/me` / `/people` Playwright specs are skip-scaffolds; update selectors only if the header
  dedup moves an asserted element (same commit).

## 7. Files

**Create**

- `apps/dashboard/src/components/ui/Button.spec.ts`

**Modify**

- `apps/dashboard/src/components/ui/Button.tsx`
- `apps/dashboard/src/components/day/DayHeader.tsx`
- `apps/dashboard/src/app/(app)/people/[userId]/page.tsx`
- `apps/dashboard/src/app/(app)/me/ApprovalsPanel.tsx`
- `apps/dashboard/src/app/(app)/me/ScreenshotsPanel.tsx`

**Reuse unchanged**: `Avatar`, `SectionHeader`, `Card`, `Badge`, `PersonDayView`, `DayStats`,
`TimeRibbon`, `ActivityBars`, `TimeEntriesList`, all `lib/*` transforms, the `redactScreenshotAction`
Server Action, both pages' data fetching.

## 8. Risks / open items

- **`DayHeader` is shared by both pages.** The `avatar` prop is optional and `/me` passes nothing, so
  `/me`'s header must render identically — the only header change is on `/people`. The reviewer verifies
  `/me` is unchanged.
- **`buttonClasses` is additive** to the C-merged `Button`. The `Button` component's public contract
  (variants, `href`→`<a>`, no `onClick`) is untouched; `xs` widens the `size` union but only the new raw
  consumers pass it.
- **Presentational-only** apart from dropping the unused `person.tracking` field on `/people`. No
  auth/data-flow/Server-Action change; the 403 "not permitted" wall on `/people` and every empty state
  are untouched.
- **Task decomposition** (for the plan): ~2 tasks — (1) `buttonClasses` + `xs` + `Button.spec.ts`;
  (2) apply across `DayHeader` + `/people` header dedup + `ApprovalsPanel` + `ScreenshotsPanel`.
- **Branch:** `dashboard/reskin-me-people`, off `main` (A, B, C merged).

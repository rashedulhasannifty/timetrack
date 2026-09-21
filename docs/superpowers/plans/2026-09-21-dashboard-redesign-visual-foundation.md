# Dashboard Redesign — Visual Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `apps/dashboard` into clickup-sync's structural and depth language — tighter radii, pressable/recessed depth, segmented tabs, density vars, per-section nav hues — while keeping timetrack's teal identity, fonts and type scale exactly as they are.

**Architecture:** Inside-out. The token layer in `globals.css` carries most of the restyle because all 21 shadow uses go through `shadow-e1`/`e2` and 116 radii through `rounded-lg/md/full`; redefining those moves the bulk of the app from one file. Then the eight shared primitives are rebuilt on the new tokens, then the 40 hardcoded `rounded-[Npx]` sites are swept onto the scale. Every page stays a Server Component; nothing moves across the RSC boundary in this plan.

**Tech Stack:** Next.js 16 App Router (React 19, RSC), Tailwind CSS v4 (`@theme inline`), TypeScript, Vitest (**node environment, no DOM**), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-dashboard-clickup-sync-redesign-design.md`

## Global Constraints

- **No new dependency.** `lucide-react` was considered and declined; extend `src/components/ui/icons.tsx` instead. CLAUDE.md §2 requires asking before adding any dependency.
- **Teal stays.** `--tt-accent` `#0f766e` light / `#43c0af` dark. Do not introduce purple, Geist, or an accent gradient. `icon.svg`, `apple-icon.png`, `--tt-mark-remaining`, `--tt-mark-elapsed` are untouched.
- **Fonts and type scale are unchanged.** Schibsted Grotesk / IBM Plex Mono; every `--text-*` value stays.
- **Dark mode uses the `.dark` class**, never a `data-theme` attribute. The pre-paint script at `src/app/layout.tsx:29` is not modified in this plan.
- **No page becomes a Client Component.** No `'use client'` is added to anything under `src/app/`.
- **No API, contracts, schema, worker, or migration change.** No files outside `apps/dashboard/` are touched.
- **Tests run with no DOM.** Vitest is node-environment; use `renderToStaticMarkup` from `react-dom/server` (see `src/components/ui/PasswordField.spec.tsx`) or pure functions. No testing-library, no click simulation.
- **Commits:** Conventional Commits, `type(dashboard): summary` ≤72 chars. **No AI attribution, no co-author trailer, no generated-by footer** (CLAUDE.md §0).
- **Gate before each phase's final commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

---

## Deviations from the spec (decided during planning)

Two refinements, both of which shrink the diff. Recorded here so the spec and plan do not silently disagree.

1. **No `--pill-*` token set.** Spec §4 proposed adding ~12 pill tokens to back `Badge`. But `Badge.tsx:7` already derives its washes via `color-mix` from the tone's own token, with a comment explaining that a token retune carries the wash automatically. Hand-picked pill hexes would _regress_ that property and duplicate twelve values. `Badge` keeps `color-mix` and only has its radius reviewed. **Task 8 is therefore a no-op check, not a rewrite.**

2. **No `.card-3d` class.** Spec §4 listed `.card-3d` alongside a redefined `--tt-elevation-1`. Those overlap: if `--tt-elevation-1` _is_ the two-layer 3D shadow, all 15 existing `shadow-e1` call sites become 3D with no component change, and only the hover-lift needs a class. So only `.card-3d-interactive` is added, and `Card` keeps `shadow-e1`.

3. **No `.switch-3d`.** Spec §4 listed it by analogy with clickup-sync, which has a custom `Switch` component. timetrack has none — the only two toggles are native `<input type="checkbox">` (`app/(app)/admin/settings/SettingsForm.tsx:73`, `components/overview/WidgetsDrawer.tsx:74`). Porting the recipe would add CSS with no consumer.

4. **Form fields get a base-layer element rule, not a class sweep.** clickup-sync applies `.input-3d` per element, but it has a shared `Input`/`Select` primitive to apply it in. timetrack has **28 files containing `<input>`/`<select>`/`<textarea>` and no field primitive at all**, so a class sweep would touch 28 files to no benefit. Instead a `@layer base` rule recesses text fields globally, and the `.input-3d` class stays for explicit opt-in (Plan 2's `DataTable` filter inputs use it). Building a shared `Field` primitive is a worthwhile refactor but is **not** this redesign's job.

A further simplification worth knowing: clickup-sync needs `.btn-3d:focus-visible` to re-state its shadows because its focus ring is a `box-shadow`. timetrack's ring is an `outline` (`globals.css:207`), which does not clobber `box-shadow` — so that workaround is **not** ported.

---

## File Structure

**Modified**

- `src/app/globals.css` — all token and recipe work (Tasks 1–3)
- `src/components/ui/Button.tsx` + `Button.spec.ts` — radius + pressable depth (Task 4)
- `src/components/ui/Card.tsx` + new `Card.spec.tsx` — interactive lift (Task 5)
- `src/components/ui/TabPills.tsx` + new `TabPills.spec.tsx` — segmented control (Task 6)
- `src/components/ui/StatCard.tsx` — eyebrow label + sparkline slot (Task 7)
- `src/components/ui/Badge.tsx` — radius review only (Task 8)
- `src/components/ui/Table.tsx` — density-driven padding (Task 9)

**Verified unchanged** (Task 10): `src/components/ui/{Meter,Avatar,HeroPanel}.tsx` — already correct under the new scale.

- `src/components/{day,overview}/**` (Task 11), `src/components/{projects,reports}/**` (Task 12), `src/components/{marketing,ui}/**` + `src/app/**` (Task 13) — hardcoded-radius sweep

**Created**

- `src/app/globals.spec.ts` — token/dark-parity guard (Task 1)
- `src/lib/sparkline.ts` + `src/lib/sparkline.spec.ts` — pure path geometry (Task 7)
- `src/components/ui/Sparkline.tsx` — presentational SVG (Task 7)

---

# Phase 1 — Token layer (`refactor(dashboard): adopt the clickup-sync depth and radius tokens`)

### Task 1: Structural tokens + dark-parity guard

**Files:**

- Modify: `src/app/globals.css` (header comment lines 1–14; `:root` block; `.dark` block; `@theme inline` block)
- Create: `src/app/globals.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: CSS custom properties `--tt-border-strong`, `--tt-muted-bg`, `--tt-hover`, `--tt-glow`, `--tt-glow-strong`, `--tt-accent-edge`, `--tt-destructive-edge`, `--tt-nav-{overview,projects,reports,approvals,admin,me,install}`, `--tt-nav-active-mix`; Tailwind colour utilities `bg-muted-bg`, `border-border-strong`, `bg-hover`; radii `--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 12px`. Task 4 consumes `--tt-accent-edge` / `--tt-destructive-edge` / `--tt-glow*`; Task 6 consumes `--tt-muted-bg`.

- [ ] **Step 1: Write the failing test**

Create `src/app/globals.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

/** Extract the body of a top-level rule, e.g. block(':root') or block('.dark'). */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated ${selector} block`);
}

const declared = (body: string) =>
  new Set(Array.from(body.matchAll(/(--tt-[a-z0-9-]+)\s*:/g), (m) => m[1]));

/**
 * Tokens that are the same value in both themes ON PURPOSE. The hero family is a fixed
 * dark-teal ground in both themes, and the two mark arcs are baked into icon.svg /
 * apple-icon.png, which cannot follow a theme (see the comments in globals.css).
 */
const THEME_INVARIANT = new Set([
  '--tt-hero',
  '--tt-hero-2',
  '--tt-hero-text',
  '--tt-hero-dim',
  '--tt-mark-remaining',
  '--tt-mark-elapsed',
]);

describe('globals.css token parity', () => {
  it('gives every themed :root token a .dark counterpart', () => {
    const light = declared(block(':root'));
    const dark = declared(block('.dark'));
    const missing = [...light].filter((t) => !THEME_INVARIANT.has(t) && !dark.has(t));
    expect(missing).toEqual([]);
  });

  it('declares the structural tokens the depth recipes depend on', () => {
    const light = declared(block(':root'));
    for (const token of [
      '--tt-border-strong',
      '--tt-muted-bg',
      '--tt-hover',
      '--tt-glow',
      '--tt-glow-strong',
      '--tt-accent-edge',
      '--tt-destructive-edge',
    ]) {
      expect(light.has(token), `${token} missing from :root`).toBe(true);
    }
  });

  it('declares one nav hue per sidebar destination', () => {
    const light = declared(block(':root'));
    for (const dest of ['overview', 'projects', 'reports', 'approvals', 'admin', 'me', 'install']) {
      expect(light.has(`--tt-nav-${dest}`), `--tt-nav-${dest} missing`).toBe(true);
    }
  });

  it('tightens the radius scale to the clickup-sync steps', () => {
    expect(css).toMatch(/--radius-sm:\s*4px/);
    expect(css).toMatch(/--radius-md:\s*8px/);
    expect(css).toMatch(/--radius-lg:\s*12px/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- globals`
Expected: FAIL — `--tt-border-strong missing from :root`, and the radius assertions fail (currently 6px/11px/20px).

- [ ] **Step 3: Add the tokens**

In `src/app/globals.css`, inside `:root`, after the `--tt-hairline` line, add:

```css
/* --- Structure adopted from clickup-sync ------------------------------
     Ink here is timetrack's #191917, not clickup-sync's slate #0f172a, so the
     depth reads warm against our surfaces instead of blue. */
--tt-border-strong: #d8d7d2;
--tt-muted-bg: #efeeea;
--tt-hover: rgba(25, 25, 23, 0.04);

/* Pressable-button depth. --b-edge is set per variant by Button.tsx; these
     are the shared glow layers under it. */
--tt-glow: rgba(25, 25, 23, 0.12);
--tt-glow-strong: rgba(25, 25, 23, 0.2);
--tt-accent-edge: #0a544e;
--tt-destructive-edge: #8a1717;

/* One hue per sidebar destination: the icon carries it, the label stays
     neutral. Light values are 600-weight steps — the 500s sit near 2:1 on the
     sidebar ground, under the 3:1 wanted for meaningful graphics. */
--tt-nav-overview: #0f766e;
--tt-nav-projects: #2563eb;
--tt-nav-reports: #7c3aed;
--tt-nav-approvals: #d97706;
--tt-nav-admin: #0891b2;
--tt-nav-me: #059669;
--tt-nav-install: #475569;
/* How much of a row's hue tints it when it is the current page. */
--tt-nav-active-mix: 16%;
```

Inside `.dark`, after its `--tt-hairline` line, add:

```css
--tt-border-strong: #3a3a40;
--tt-muted-bg: #232327;
--tt-hover: rgba(255, 255, 255, 0.04);

--tt-glow: rgba(0, 0, 0, 0.45);
--tt-glow-strong: rgba(0, 0, 0, 0.6);
--tt-accent-edge: #2b7f74;
--tt-destructive-edge: #a83c3c;

/* Lighter steps against the near-black rail. */
--tt-nav-overview: #43c0af;
--tt-nav-projects: #60a5fa;
--tt-nav-reports: #c4b5fd;
--tt-nav-approvals: #fbbf24;
--tt-nav-admin: #22d3ee;
--tt-nav-me: #34d399;
--tt-nav-install: #94a3b8;
--tt-nav-active-mix: 26%;
```

- [ ] **Step 4: Expose the new colours and tighten the radii**

In the `@theme inline` block, add beside the other `--color-*` lines:

```css
--color-muted-bg: var(--tt-muted-bg);
--color-border-strong: var(--tt-border-strong);
--color-hover: var(--tt-hover);
```

and replace the three radius lines:

```css
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
```

- [ ] **Step 5: Rewrite the stale provenance comment**

Replace lines 1–14 of `src/app/globals.css` (the `Nifty Timer — dashboard design tokens` header) with:

```css
/* ============================================================================
   Nifty Timer — dashboard design tokens (Tailwind CSS v4).

   Colour, type and the type scale come from the "Nifty Timer Redesign" Claude
   Design handoff: teal accent, Schibsted Grotesk / IBM Plex Mono. Structure and
   depth — the radius scale, the pressable/recessed recipes, density and the nav
   hues — are adopted from the sibling clickup-sync dashboard so the two read as
   one family. Ink is #191917 throughout, not clickup-sync's slate, so the depth
   stays warm.

   Semantic names are unchanged: --tt-accent, --tt-recording and
   --tt-category-productive are deliberately the same teal, and the two mark arcs
   are theme-invariant because icon.svg / apple-icon.png cannot follow a theme.

   Dark uses the CLASS strategy (.dark on <html>) so the manual toggle wins in
   both directions; the root-layout inline script seeds .dark from the stored
   preference before first paint.

   NOTE: these values differ from the macOS client's TimeTrackTokens.swift and
   from the Windows client. Restyling the clients is a separate, later pass and
   is deliberately out of scope here.

   See docs/superpowers/specs/2026-09-21-dashboard-clickup-sync-redesign-design.md
   ============================================================================ */
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- globals`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/app/globals.css apps/dashboard/src/app/globals.spec.ts
git commit -m "refactor(dashboard): add the structural depth and nav-hue tokens"
```

---

### Task 2: Depth recipe classes

**Files:**

- Modify: `src/app/globals.css` (append after the `.tt-pulse` block, before `:focus-visible`)
- Modify: `src/app/globals.spec.ts`

**Interfaces:**

- Consumes: `--tt-border-strong`, `--tt-glow`, `--tt-glow-strong` (Task 1).
- Produces: classes `.btn-3d` (Task 4), `.card-3d-interactive` (Task 5), `.seg-track` / `.seg-tab` (Task 6), `.input-3d`, `.row-3d`. Reads per-element `--b-edge`, `--b-glow`, `--b-glow-strong`.

**On the two classes with no consumer in this plan:** `.input-3d` and `.row-3d` are defined here
but first _applied_ in Plan 2, by `DataTable`'s filter inputs and hoverable rows. They are not the
dead-CSS mistake that deviation 3 avoids — `.switch-3d` was dropped because nothing will _ever_
use it, whereas these two have a named consumer one plan away, and splitting the depth recipes
across two commits would leave the recipe block incoherent. Text fields get their recess from the
`@layer base` rule below, not from `.input-3d`.

- [ ] **Step 1: Write the failing test**

Append to `src/app/globals.spec.ts`:

```ts
describe('globals.css depth recipes', () => {
  it('defines every recipe class the primitives rely on', () => {
    for (const cls of [
      '.btn-3d',
      '.input-3d',
      '.card-3d-interactive',
      '.row-3d',
      '.seg-track',
      '.seg-tab',
    ]) {
      expect(css.includes(`${cls} {`) || css.includes(`${cls}:`), `${cls} missing`).toBe(true);
    }
  });

  /**
   * The light recipes use warm-ink shadows that vanish on a near-black ground, so each
   * depth class that hardcodes an ink shadow needs a .dark override. Dark deliberately
   * gains depth here — it previously set --tt-elevation-1: none.
   */
  it('overrides the ink-shadow recipes under .dark', () => {
    for (const cls of ['.input-3d', '.row-3d', '.seg-track']) {
      expect(css.includes(`.dark ${cls}`), `${cls} has no .dark override`).toBe(true);
    }
  });

  it('no longer disables elevation in dark', () => {
    expect(block('.dark')).not.toMatch(/--tt-elevation-1:\s*none/);
  });

  /**
   * There is no shared Field primitive — 28 files declare their own inputs — so the recess
   * is applied to the elements in @layer base. Checkboxes and radios must stay excluded: an
   * inset shadow on a checkbox reads as damage, not depth.
   */
  it('recesses text fields globally while sparing checkboxes and radios', () => {
    expect(css).toMatch(/input:not\(\[type='checkbox'\]\)/);
    expect(css).toContain('textarea');
    const rule = css.slice(css.indexOf("input:not([type='checkbox'])"));
    expect(rule.slice(0, 400)).toContain('inset');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- globals`
Expected: FAIL — `.btn-3d missing`, and `--tt-elevation-1: none` is still present in `.dark`.

- [ ] **Step 3: Redefine elevation so `shadow-e1` becomes the card depth**

In `:root`, replace the `--tt-elevation-1` line with:

```css
--tt-elevation-1: 0 3px 0 0 var(--tt-border-strong), 0 9px 20px rgba(25, 25, 23, 0.13);
```

In `.dark`, replace the block that currently sets `--tt-elevation-1: none` (and its comment about the mockup dropping card shadows) with:

```css
/* Dark gains depth in this redesign. The previous handoff dropped card shadows
     entirely in dark and leaned on the raised surface; the 3D language cannot
     survive that, so the edge goes black and the ambient layer deepens. */
--tt-elevation-1: 0 3px 0 0 #000000, 0 9px 22px rgba(0, 0, 0, 0.6);
```

Leave `--tt-elevation-2` in both blocks exactly as it is.

- [ ] **Step 4: Append the recipe classes**

Add to `src/app/globals.css`, after the `.tt-pulse` rule:

```css
/* ── 3D · pressable buttons ──────────────────────────────────────────────────
   The face sits on a darker bottom "edge" (shadow #1) lifted by a soft glow
   (#2). Hover raises it 2px, pressing sinks it 3px onto its edge. Per-variant
   colours arrive as --b-edge / --b-glow / --b-glow-strong from Button.tsx, so
   one class serves every variant.

   Unlike clickup-sync, no :focus-visible re-statement is needed: our focus ring
   is an outline (see below), which does not clobber box-shadow. */
.btn-3d {
  transform: translateY(0);
  box-shadow:
    0 4px 0 0 var(--b-edge),
    0 7px 12px var(--b-glow);
  transition:
    transform 90ms ease,
    box-shadow 90ms ease,
    background 100ms;
}
.btn-3d:not(:disabled):hover {
  transform: translateY(-2px);
  box-shadow:
    0 6px 0 0 var(--b-edge),
    0 13px 22px var(--b-glow-strong);
}
.btn-3d:not(:disabled):active {
  transform: translateY(3px);
  box-shadow:
    0 1px 0 0 var(--b-edge),
    0 2px 5px var(--b-glow);
}
/* Keep the resting depth while disabled, dimmed by the component's own opacity. */
.btn-3d:disabled {
  box-shadow:
    0 4px 0 0 var(--b-edge),
    0 7px 12px var(--b-glow);
}

/* ── 3D · inset fields ───────────────────────────────────────────────────────
   The counterpart to .btn-3d: where buttons pop out, inputs press in. */
.input-3d {
  box-shadow:
    inset 0 2px 4px rgba(25, 25, 23, 0.16),
    inset 0 1px 1px rgba(25, 25, 23, 0.1);
  transition:
    box-shadow 120ms,
    border-color 120ms;
}
.dark .input-3d {
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.55),
    inset 0 1px 1px rgba(0, 0, 0, 0.4);
}

/* ── 3D · interactive cards ──────────────────────────────────────────────────
   Static cards get their depth from --tt-elevation-1 via `shadow-e1`; this adds
   only the hover lift for cards that are themselves clickable. */
.card-3d-interactive {
  transition:
    box-shadow 140ms ease,
    transform 140ms ease;
}
.card-3d-interactive:hover {
  transform: translateY(-3px);
  box-shadow:
    0 6px 0 0 var(--tt-border-strong),
    0 18px 32px rgba(25, 25, 23, 0.18);
}
.dark .card-3d-interactive:hover {
  box-shadow:
    0 6px 0 0 #000000,
    0 20px 36px rgba(0, 0, 0, 0.65);
}

/* ── 3D · liftable rows ──────────────────────────────────────────────────────
   Deliberately NO transform: a transformed <tr> becomes the containing block for
   its position:sticky cells and breaks frozen columns. position:relative +
   z-index lets the shadow paint over adjacent rows. */
.row-3d {
  transition:
    box-shadow 120ms,
    background 120ms;
}
.row-3d:hover {
  position: relative;
  z-index: 1;
  box-shadow:
    0 5px 16px rgba(25, 25, 23, 0.22),
    0 2px 0 0 var(--tt-border-strong);
}
.dark .row-3d:hover {
  box-shadow:
    0 6px 18px rgba(0, 0, 0, 0.65),
    0 2px 0 0 #000000;
}

/* ── 3D · segmented tabs ─────────────────────────────────────────────────────
   A recessed track with the selected tab raised out of it. Our tabs are <a>
   elements carrying aria-current="page" (they map to URLs), so the selected
   rule keys on BOTH aria-current and aria-selected — clickup-sync only needed
   the latter because its tabs are buttons. */
.seg-track {
  box-shadow: inset 0 1px 3px rgba(25, 25, 23, 0.13);
}
.dark .seg-track {
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.55);
}
.seg-tab {
  transition:
    transform 90ms ease,
    box-shadow 90ms ease,
    background 100ms,
    color 100ms;
}
.seg-tab:not([aria-current='page']):not([aria-selected='true']):active {
  transform: translateY(1px);
}
.seg-tab[aria-current='page'],
.seg-tab[aria-selected='true'] {
  transform: translateY(-1px);
  box-shadow:
    0 2px 0 0 var(--tt-border-strong),
    0 4px 8px rgba(25, 25, 23, 0.16);
}
.dark .seg-tab[aria-current='page'],
.dark .seg-tab[aria-selected='true'] {
  box-shadow:
    0 2px 0 0 #000000,
    0 4px 10px rgba(0, 0, 0, 0.55);
}
```

Then, so the recess actually reaches the app's 28 form-field files without touching any of
them, add this to the existing `@layer base` block (the one holding the `a` rules):

```css
/* Text fields are recessed to match the pressable buttons. This lives in @layer base,
     applied to the elements directly, because the dashboard has no shared Field primitive
     to hang a class on — 28 files declare their own inputs. Checkboxes, radios and colour
     swatches are excluded: they are not wells, and an inset shadow on them reads as damage.
     A Tailwind utility at a call site still wins, since utilities are a later layer. */
input:not([type='checkbox']):not([type='radio']):not([type='color']):not([type='range']),
select,
textarea {
  box-shadow:
    inset 0 2px 4px rgba(25, 25, 23, 0.16),
    inset 0 1px 1px rgba(25, 25, 23, 0.1);
  transition:
    box-shadow 120ms,
    border-color 120ms;
}

.dark input:not([type='checkbox']):not([type='radio']):not([type='color']):not([type='range']),
.dark select,
.dark textarea {
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.55),
    inset 0 1px 1px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- globals`
Expected: PASS, 7 tests.

- [ ] **Step 6: Confirm reduced-motion still disarms the new transitions**

Read the `@media (prefers-reduced-motion: reduce)` block at the end of `globals.css`. It already zeroes `animation-duration` and `transition-duration` on `*`, which covers every recipe added above. No change needed — but confirm the block is still last in the file so it is not overridden.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/app/globals.css apps/dashboard/src/app/globals.spec.ts
git commit -m "refactor(dashboard): add the pressable and recessed depth recipes"
```

---

### Task 3: Density custom properties

**Files:**

- Modify: `src/app/globals.css`
- Modify: `src/app/globals.spec.ts`

**Interfaces:**

- Produces: `--row-h`, `--pad-y`, with comfortable defaults on `:root` and a `[data-density]` override. Task 9 consumes `--pad-y`. The `DensityProvider` that sets the attribute is Phase 6 (Plan 2) — this task only makes the vars exist and default correctly.

- [ ] **Step 1: Write the failing test**

Append to `src/app/globals.spec.ts`:

```ts
describe('globals.css density', () => {
  /**
   * The attribute is set by a client provider that does not exist until Phase 6, and it
   * is absent during SSR and in tests. Tables read var(--pad-y) unconditionally, so the
   * comfortable values MUST be the :root default or every table collapses to zero padding.
   */
  it('defaults to comfortable on :root so tables work with no attribute set', () => {
    const root = block(':root');
    expect(root).toMatch(/--row-h:\s*48px/);
    expect(root).toMatch(/--pad-y:\s*12px/);
  });

  it('defines both density modes', () => {
    expect(css).toMatch(/\[data-density=['"]compact['"]\]/);
    expect(css).toMatch(/\[data-density=['"]comfortable['"]\]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- globals`
Expected: FAIL — no `--row-h` in `:root`.

- [ ] **Step 3: Add the density vars**

In `:root`, after the nav-hue block from Task 1, add:

```css
/* Row metrics. Comfortable is the :root default so tables render correctly
     during SSR and before the Phase-6 density provider sets [data-density]. */
--row-h: 48px;
--pad-y: 12px;
```

After the `.dark` block, add:

```css
/* --- Density ------------------------------------------------------------- */
[data-density='compact'] {
  --row-h: 36px;
  --pad-y: 8px;
}

[data-density='comfortable'] {
  --row-h: 48px;
  --pad-y: 12px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- globals`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. `build` is the real check here — Tailwind v4 fails the build on a malformed `@theme` block.

- [ ] **Step 6: Visual smoke check**

Run `pnpm --filter @timetrack/dashboard dev` and load `/overview`, `/reports` and `/admin/users` in **both** light and dark. Confirm: cards now sit on a visible edge rather than floating flat, corners are noticeably tighter, and dark mode has depth where it previously had none. Nothing should be unreadable or clipped. This is the only verification the token change has — there is no visual-regression net (spec §10 risk 1).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/app/globals.css apps/dashboard/src/app/globals.spec.ts
git commit -m "refactor(dashboard): add density row metrics"
```

---

# Phase 2 — Primitives (`refactor(dashboard): rebuild the shared UI primitives on the new tokens`)

### Task 4: Button — tighter radius and pressable depth

**Files:**

- Modify: `src/components/ui/Button.tsx:8-23`
- Modify: `src/components/ui/Button.spec.ts`

**Interfaces:**

- Consumes: `.btn-3d` (Task 2), `--tt-accent-edge`, `--tt-destructive-edge`, `--tt-border-strong`, `--tt-glow`, `--tt-glow-strong` (Task 1).
- Produces: `buttonClasses(variant?: ButtonVariant, size?: ButtonSize): string` — **signature unchanged**, and `Button` still accepts no `onClick`. 16 files depend on both. `ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost'`, `ButtonSize = 'xs' | 'sm' | 'md'`.

- [ ] **Step 1: Update the spec to the new expectations**

In `src/components/ui/Button.spec.ts`, replace the first test and add three:

```ts
it('composes base + variant + size', () => {
  const cls = buttonClasses('primary', 'sm');
  expect(cls).toContain('bg-accent'); // primary variant
  expect(cls).toContain('text-caption px-[13px] py-[6px]'); // sm size
  expect(cls).toContain('rounded-md'); // base — tightened from rounded-full
});

/** The three solid/raised variants are pressable; ghost is flat by design — a
 *  borderless text control with a 3D edge reads as a floating artefact. */
it('makes the raised variants pressable and leaves ghost flat', () => {
  expect(buttonClasses('primary', 'md')).toContain('btn-3d');
  expect(buttonClasses('secondary', 'md')).toContain('btn-3d');
  expect(buttonClasses('destructive', 'md')).toContain('btn-3d');
  expect(buttonClasses('ghost', 'md')).not.toContain('btn-3d');
});

/** .btn-3d reads --b-edge off the element; a variant that forgets it renders
 *  with an invisible edge and silently loses its depth. */
it('gives every pressable variant its own edge colour', () => {
  for (const v of ['primary', 'secondary', 'destructive'] as const) {
    expect(buttonClasses(v, 'md'), v).toContain('[--b-edge:');
  }
});

it('is no longer a pill', () => {
  expect(buttonClasses()).not.toContain('rounded-full');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- Button`
Expected: FAIL — `expected '...rounded-full...' to contain 'rounded-md'`.

- [ ] **Step 3: Implement**

In `src/components/ui/Button.tsx`, replace the `BASE` and `VARIANTS` constants (lines 8–23) with:

```ts
// The redesign's controls are tightened from pills to the 8px radius step and sit on a
// pressable edge. `ghost` stays flat: a borderless text control with a 3D edge reads as a
// floating artefact rather than a button.
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none';

// .btn-3d reads these three per-element; without --b-edge the depth is invisible.
const GLOW = '[--b-glow:var(--tt-glow)] [--b-glow-strong:var(--tt-glow-strong)]';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: `bg-accent text-white hover:bg-accent-hover btn-3d [--b-edge:var(--tt-accent-edge)] ${GLOW}`,
  secondary: `bg-surface-raised border-separator text-text-secondary hover:text-text hover:border-text-secondary border btn-3d [--b-edge:var(--tt-border-strong)] ${GLOW}`,
  destructive: `bg-destructive text-white hover:opacity-90 btn-3d [--b-edge:var(--tt-destructive-edge)] ${GLOW}`,
  ghost: 'text-text-secondary hover:text-text hover:bg-hover',
};
```

Note the `ghost` hover changes from `hover:bg-surface` to `hover:bg-hover`, using the token added in Task 1 — `bg-surface` was the _page_ ground, which made a ghost button on the page background invisible on hover.

Also update the comment on line 7 (`// Every control in the redesign is a pill...`) — it is now wrong. Replace it with the comment block above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- Button`
Expected: PASS, 9 tests.

- [ ] **Step 5: Check the ghost-hover change did not break the existing variant-distinctness test**

Run: `pnpm --filter @timetrack/dashboard test -- Button`
The existing `gives every variant a distinct look` test must still pass — confirm `hover:bg-surface` appearing nowhere else. Run: `grep -rn "hover:bg-surface\b" apps/dashboard/src` and confirm any remaining hits are intentional (they are page-level, not button).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/ui/Button.tsx apps/dashboard/src/components/ui/Button.spec.ts
git commit -m "refactor(dashboard): make buttons pressable at the tighter radius"
```

---

### Task 5: Card — interactive hover lift

**Files:**

- Modify: `src/components/ui/Card.tsx:14-27`
- Create: `src/components/ui/Card.spec.tsx`

**Interfaces:**

- Consumes: `.card-3d-interactive` (Task 2), the redefined `--tt-elevation-1` (Task 2).
- Produces: `Card({ children, className?, padding?: 'none' | 'md', interactive?: boolean })`. `CardHeader` and `CardTitle` are unchanged. 14 files depend on `Card`; `interactive` defaults to `false` so every existing call site is unaffected.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Card.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from './Card';

/** No DOM in this vitest environment — pin the emitted classes (see PasswordField.spec.tsx). */
const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<Card {...props}>body</Card>);

describe('Card', () => {
  /** Static depth comes from the elevation token, not a class, so all 15 existing
   *  shadow-e1 call sites picked up the new depth without being touched. */
  it('carries the elevation token by default', () => {
    expect(render()).toContain('shadow-e1');
  });

  it('is flat-hovering unless told it is interactive', () => {
    expect(render()).not.toContain('card-3d-interactive');
  });

  it('adds the hover lift when interactive', () => {
    expect(render({ interactive: true })).toContain('card-3d-interactive');
  });

  it('applies the standard panel padding only when asked', () => {
    expect(render({ padding: 'md' })).toContain('px-[26px]');
    expect(render()).not.toContain('px-[26px]');
  });

  it('keeps caller classes', () => {
    expect(render({ className: 'mt-4' })).toContain('mt-4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- Card`
Expected: FAIL — `adds the hover lift when interactive` fails; `interactive` is not a prop yet.

- [ ] **Step 3: Implement**

Replace the `Card` function in `src/components/ui/Card.tsx` with:

```tsx
export function Card({
  children,
  className = '',
  padding = 'none',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'md';
  /** Adds the hover lift. Set this when the card itself is clickable — it is a visual
   *  affordance only; the click handler stays with the caller, which keeps Card
   *  function-prop-free and therefore usable from Server Components. */
  interactive?: boolean;
}) {
  const pad = padding === 'md' ? 'px-[26px] py-[22px]' : '';
  const lift = interactive ? 'card-3d-interactive' : '';
  return (
    <div
      className={`bg-surface-raised border-separator shadow-e1 rounded-lg border ${pad} ${lift} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
```

Update the doc comment above it: `rounded-lg` is now 12px, not 20px.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- Card`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/ui/Card.tsx apps/dashboard/src/components/ui/Card.spec.tsx
git commit -m "refactor(dashboard): give clickable cards a hover lift"
```

---

### Task 6: TabPills — segmented control

**Files:**

- Modify: `src/components/ui/TabPills.tsx:14-34`
- Create: `src/components/ui/TabPills.spec.tsx`

**Interfaces:**

- Consumes: `.seg-track`, `.seg-tab` (Task 2), `--tt-muted-bg` via `bg-muted-bg` (Task 1).
- Produces: `tabPillClasses(active: boolean): string`, `TabPillTrack({ children, raised?, className? })`, `TabPills({ tabs, activeHref, raised?, className?, ariaLabel })` — all signatures unchanged. 3 files depend on them.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/TabPills.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabPills, tabPillClasses, TabPillTrack } from './TabPills';

describe('tabPillClasses', () => {
  it('marks every tab as a segment', () => {
    expect(tabPillClasses(true)).toContain('seg-tab');
    expect(tabPillClasses(false)).toContain('seg-tab');
  });

  it('raises only the active tab out of the track', () => {
    expect(tabPillClasses(true)).toContain('bg-surface-raised');
    expect(tabPillClasses(false)).not.toContain('bg-surface-raised');
  });

  it('uses the tightened radius, not a pill', () => {
    expect(tabPillClasses(false)).toContain('rounded-md');
    expect(tabPillClasses(false)).not.toContain('rounded-full');
  });
});

describe('TabPillTrack', () => {
  it('is a recessed track when raised', () => {
    const html = renderToStaticMarkup(<TabPillTrack>x</TabPillTrack>);
    expect(html).toContain('seg-track');
    expect(html).toContain('bg-muted-bg');
  });
});

describe('TabPills', () => {
  const tabs = [
    { href: '/a', label: 'A' },
    { href: '/b', label: 'B' },
  ];

  /**
   * The .seg-tab selected rule keys on aria-current="page" as well as aria-selected,
   * because these tabs are links that map to URLs. If the component stopped emitting
   * aria-current the active tab would render flush with the track — visually broken and
   * unannounced to assistive tech.
   */
  it('marks the active tab with aria-current so the raised rule matches', () => {
    const html = renderToStaticMarkup(
      <TabPills tabs={tabs} activeHref="/b" ariaLabel="Sections" />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- TabPills`
Expected: FAIL — `seg-tab` is absent; `tabPillClasses` still emits `rounded-full`.

- [ ] **Step 3: Implement**

In `src/components/ui/TabPills.tsx`, replace `tabPillClasses` and `TabPillTrack`:

```tsx
/**
 * One segment. The selected state is raised out of the track by the `.seg-tab` rule in
 * globals.css, which keys on `aria-current="page"` (these tabs are links) as well as
 * `aria-selected`. The classes here only supply colour and metrics.
 */
export function tabPillClasses(active: boolean): string {
  return `seg-tab rounded-md px-[13px] py-[5px] text-caption font-bold ${
    active ? 'bg-surface-raised text-accent' : 'text-text-secondary hover:text-text'
  }`;
}

export function TabPillTrack({
  children,
  raised = true,
  className = '',
}: {
  children: ReactNode;
  /** Raised = the bordered, recessed track (page-level tabs). Sunken = inside a card header. */
  raised?: boolean;
  className?: string;
}) {
  const shell = raised ? 'bg-muted-bg border-separator border' : 'bg-muted-bg';
  return (
    <div
      className={`seg-track inline-flex gap-0.5 rounded-md p-[3px] ${shell} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
```

Also update the block comment at the top of the file — it describes "a pill track holding one pill per option, the active one filled with the accent tint", which no longer matches.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- TabPills`
Expected: PASS, 5 tests.

- [ ] **Step 5: Check the one non-link call site still reads correctly**

Run: `grep -rn "tabPillClasses" apps/dashboard/src --include='*.tsx' | grep -v TabPills`
For each hit, confirm the element sets `aria-selected` (buttons) or `aria-current` (links) — otherwise its active state will not raise. Fix any that set neither by adding `aria-selected={active}`.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/ui/TabPills.tsx apps/dashboard/src/components/ui/TabPills.spec.tsx
git commit -m "refactor(dashboard): turn the tab pills into a segmented control"
```

---

### Task 7: Sparkline + StatCard eyebrow

**Files:**

- Create: `src/lib/sparkline.ts`, `src/lib/sparkline.spec.ts`
- Create: `src/components/ui/Sparkline.tsx`
- Modify: `src/components/ui/StatCard.tsx:41-48` (label row) and the delta row

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `sparklinePath(values: number[], width: number, height: number): string` (SVG `d` attribute, empty string for fewer than 2 points); `Sparkline({ data, color?, width?, height? })`; `StatCard` gains an optional `trend?: number[]` prop. Plan 2's `DataTable` does not use these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sparkline.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sparklinePath } from './sparkline';

describe('sparklinePath', () => {
  it('returns nothing for fewer than two points', () => {
    expect(sparklinePath([], 60, 16)).toBe('');
    expect(sparklinePath([5], 60, 16)).toBe('');
  });

  it('spans the full width from first to last point', () => {
    const d = sparklinePath([0, 10], 60, 16);
    expect(d.startsWith('M 0')).toBe(true);
    expect(d).toContain('L 60');
  });

  /** y is inverted: the largest value must sit at the TOP of the box (y=0). */
  it('puts the maximum at the top and the minimum at the bottom', () => {
    const d = sparklinePath([0, 10], 60, 16);
    expect(d).toBe('M 0 16 L 60 0');
  });

  /**
   * A flat series has no range to normalise against. Dividing by a zero range would
   * emit NaN and silently blank the SVG, so it must pin to the vertical middle.
   */
  it('draws a flat series through the middle instead of emitting NaN', () => {
    const d = sparklinePath([7, 7, 7], 60, 16);
    expect(d).not.toContain('NaN');
    expect(d).toBe('M 0 8 L 30 8 L 60 8');
  });

  it('spaces points evenly across the width', () => {
    expect(sparklinePath([0, 5, 10], 100, 10)).toBe('M 0 10 L 50 5 L 100 0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- sparkline`
Expected: FAIL — `Failed to resolve import "./sparkline"`.

- [ ] **Step 3: Implement the geometry**

Create `src/lib/sparkline.ts`:

```ts
/**
 * Build the `d` attribute for a sparkline polyline.
 *
 * Points are spaced evenly across `width`; `y` is inverted so the largest value sits at the
 * top of the box. A flat series (every value equal) has no range to normalise against, so it
 * pins to the vertical middle rather than dividing by zero and emitting NaN.
 *
 * Returns '' for fewer than two points — one point is not a trend, and callers render nothing.
 */
export function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const stepX = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = Math.round(i * stepX * 100) / 100;
      const y = range === 0 ? height / 2 : Math.round(((max - v) / range) * height * 100) / 100;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- sparkline`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the presentational component**

Create `src/components/ui/Sparkline.tsx`:

```tsx
import { sparklinePath } from '../../lib/sparkline';

/**
 * A bare trend line for KPI tiles. Decorative: the number beside it carries the meaning, so
 * it is hidden from assistive tech rather than given a label nobody can act on.
 */
export function Sparkline({
  data,
  color = 'var(--tt-accent)',
  width = 60,
  height = 16,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const d = sparklinePath(data, width, height);
  if (!d) return null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 6: Wire it into StatCard**

In `src/components/ui/StatCard.tsx`, add `import { Sparkline } from './Sparkline';`, add `trend?: number[];` to the props type with the doc comment `/** Optional trend line rendered beside the delta. */`, accept `trend` in the destructured params, then change the label div to the eyebrow voice and the delta row to hold the sparkline:

```tsx
<div className="tt-eyebrow text-neutral flex-1 self-center">{label}</div>
```

```tsx
{
  delta || trend ? (
    <div className="mt-1.5 flex items-center justify-between gap-2">
      {delta ? (
        <span className={`tt-numeric text-caption font-semibold ${deltaTone}`}>{delta.text}</span>
      ) : (
        <span />
      )}
      {trend ? <Sparkline data={trend} /> : null}
    </div>
  ) : null;
}
```

(This replaces the existing `{delta ? ... : null}` block. The empty `<span />` keeps the sparkline right-aligned when there is no delta.)

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm --filter @timetrack/dashboard test && pnpm --filter @timetrack/dashboard typecheck`
Expected: all PASS. `trend` is optional, so the two existing `StatCard` call sites still typecheck.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/lib/sparkline.ts apps/dashboard/src/lib/sparkline.spec.ts apps/dashboard/src/components/ui/Sparkline.tsx apps/dashboard/src/components/ui/StatCard.tsx
git commit -m "feat(dashboard): add an optional trend line to the KPI tiles"
```

---

### Task 8: Badge — confirm the radius reads correctly

**Files:**

- Modify: `src/components/ui/Badge.tsx:18-20` (only if the check below fails)

**Interfaces:**

- Produces: `Badge({ tone, children })`, `CountBadge({ children })` — unchanged. 5 files depend on them.

Per the deviation note at the top of this plan, `Badge` is **not** being moved onto a `--pill-*` token set: its `color-mix` derivation is a better property than hand-picked hexes and already tracks token retunes. This task exists only to confirm the pill shape still belongs.

- [ ] **Step 1: Check the rendered shape against the new language**

Run `pnpm --filter @timetrack/dashboard dev` and load `/approvals` and `/admin/users`, which render `Badge` in table cells beside the now-8px controls.

- [ ] **Step 2: Decide and record**

`rounded-full` on a short status word is a _chip_, not a control — clickup-sync keeps its `Pill` fully rounded too (`--radius` is for controls, pills are separate). **Expected outcome: leave `Badge` exactly as it is.** If the check in Step 1 shows the chips reading as visually foreign beside the tightened controls, change only the radius to `rounded-md` and note why in the commit body. Do not touch the `TONE` map either way.

- [ ] **Step 3: Commit only if something changed**

If unchanged, skip the commit entirely and move to Task 9. If changed:

```bash
git add apps/dashboard/src/components/ui/Badge.tsx
git commit -m "refactor(dashboard): tighten the status chip radius"
```

---

### Task 9: Table — density-driven vertical padding

**Files:**

- Modify: `src/components/ui/Table.tsx:44` (`Th` base) and `:95` (`Td`)
- Create: `src/components/ui/Table.spec.tsx`

**Interfaces:**

- Consumes: `--pad-y` (Task 3).
- Produces: `Table`, `THead`, `Tbody`, `Tr`, `Th`, `Td` — **all signatures unchanged**. 6 files depend on them, three of which (`admin/users`, `admin/teams`, `approvals`) keep using them permanently; the other three move to `DataTable` in Plan 2.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Table.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Table, THead, Tbody, Tr, Th, Td } from './Table';

const render = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('Table cells', () => {
  /**
   * Vertical padding comes from --pad-y so the Phase-6 density toggle can retune every
   * table at once. Horizontal padding stays fixed: density changes row height, not gutters.
   */
  it('drives body-cell vertical padding from the density var', () => {
    const html = render(<Td>x</Td>);
    expect(html).toContain('py-[var(--pad-y)]');
    expect(html).toContain('px-[26px]');
  });

  it('drives header-cell vertical padding from the density var', () => {
    expect(render(<Th>x</Th>)).toContain('py-[var(--pad-y)]');
  });

  it('keeps tabular numerals on right-aligned cells', () => {
    expect(render(<Td align="right">1</Td>)).toContain('tt-numeric');
  });

  it('still marks sortable headers with aria-sort', () => {
    expect(
      render(
        <Th sortable sortDirection="asc">
          n
        </Th>,
      ),
    ).toContain('aria-sort="ascending"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- Table`
Expected: FAIL — `Td` emits `py-[13px]`, not `py-[var(--pad-y)]`.

- [ ] **Step 3: Implement**

In `src/components/ui/Table.tsx`:

- In `Th`, change the `base` constant from `px-[26px] py-3` to `px-[26px] py-[var(--pad-y)]`.
- In `Td`, change `px-[26px] py-[13px]` to `px-[26px] py-[var(--pad-y)]`.

Add above `Th`:

```tsx
/* Vertical padding is --pad-y so one [data-density] switch retunes every table. Horizontal
   gutters stay fixed at 26px: density is about row height, not column spacing. */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- Table`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the default renders unchanged**

`--pad-y` defaults to `12px` (Task 3) against the previous `13px` body / `12px` header. Load `/admin/users` in dev and confirm rows look essentially identical — a 1px body-cell change is the intended, deliberate cost of unifying the two.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/ui/Table.tsx apps/dashboard/src/components/ui/Table.spec.tsx
git commit -m "refactor(dashboard): drive table row padding from the density var"
```

---

### Task 10: Verify the remaining primitives and the field recess

**Files:** none modified — this task is a verification gate. It exists because the spec listed
`Meter`, `Avatar` and `HeroPanel` as "radius retune", and inspection showed all three are
already correct. Recording _why_ they need no change is the deliverable; changing them anyway
would be churn.

**Interfaces:**

- Consumes: everything from Tasks 1–9.
- Produces: nothing. No signature changes.

- [ ] **Step 1: Confirm `Avatar` needs no change**

Run: `grep -n 'rounded' apps/dashboard/src/components/ui/Avatar.tsx`
Expected: exactly one hit, `rounded-full`, on line 19. Avatars are always circular and there is
no square variant. **Leave the file alone.**

- [ ] **Step 2: Confirm `HeroPanel` needs no change**

Run: `grep -n 'rounded' apps/dashboard/src/components/ui/HeroPanel.tsx`
Expected: `rounded-lg` on the panel (line 25) and `rounded-full` on its inline chip (line 41).
The panel already tightened from 20px to 12px via Task 1; the chip is a pill by intent.
**Leave the file alone.**

- [ ] **Step 3: Confirm `Meter` / `SplitMeter` need no change**

Run: `grep -n 'rounded' apps/dashboard/src/components/ui/Meter.tsx`
Expected: three `rounded-[2px]` hits. The rail is `h-1` (4px), so a 2px radius is already fully
rounded ends. Moving them to `rounded-sm` (4px) would change nothing visually and lose the
intent. **Leave the file alone.**

- [ ] **Step 4: Verify the base-layer field recess reached real forms**

Run `pnpm --filter @timetrack/dashboard dev` and load:

- `/login` — the email and password fields should read as recessed wells.
- `/admin/settings` — number fields recessed; the **checkbox must NOT be** (it is excluded by
  the `:not([type='checkbox'])` guard; an inset shadow on it reads as damage).
- `/projects` — the new-project text input and its `<select>` both recessed.

Check both light and dark.

- [ ] **Step 5: Verify buttons and fields read as opposites**

On `/projects`, the "New project" button should pop _out_ while the field beside it presses
_in_. If both read flat, the `@layer base` rule is being beaten by a Tailwind `shadow-*`
utility at the call site — find it with
`grep -rn --include='*.tsx' 'shadow-' apps/dashboard/src/components/projects` and remove the
conflicting utility rather than escalating the CSS specificity.

- [ ] **Step 6: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 7: No commit**

Nothing changed in this task. Do not create an empty commit. Phase 2's last commit is Task 9's.

---

# Phase 3 — Hardcoded-radius sweep (`refactor(dashboard): sweep hardcoded radii onto the token scale`)

The audit found 40 hardcoded `rounded-[Npx]` sites. The mapping rule, applied consistently:

| Found                                               | Becomes             | Why                                                         |
| --------------------------------------------------- | ------------------- | ----------------------------------------------------------- |
| `rounded-[2px]`, `rounded-[3px]`                    | **unchanged**       | meter/bar rails where the radius is half the element height |
| `rounded-[4px]`, `rounded-[6px]`                    | `rounded-sm` (4px)  |                                                             |
| `rounded-[9px]`, `rounded-[10px]`, `rounded-[11px]` | `rounded-md` (8px)  |                                                             |
| `rounded-[14px]`, `rounded-[18px]`                  | `rounded-lg` (12px) |                                                             |

### Task 11: Sweep `day/` and `overview/`

**Files:** `src/components/day/**`, `src/components/overview/**`

- [ ] **Step 1: List the sites**

Run: `grep -rn --include='*.tsx' 'rounded-\[[0-9]*px\]' apps/dashboard/src/components/day apps/dashboard/src/components/overview`

- [ ] **Step 2: Apply the mapping table**

Edit each hit per the table above. Leave every `rounded-[2px]` and `rounded-[3px]` alone.

- [ ] **Step 3: Verify only the intended radii remain**

Run: `grep -rno --include='*.tsx' 'rounded-\[[0-9]*px\]' apps/dashboard/src/components/day apps/dashboard/src/components/overview | grep -v 'rounded-\[[23]px\]'`
Expected: no output.

- [ ] **Step 4: Test and eyeball**

Run: `pnpm --filter @timetrack/dashboard test && pnpm --filter @timetrack/dashboard typecheck`
Load `/me` and `/overview` in dev, light and dark.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/day apps/dashboard/src/components/overview
git commit -m "refactor(dashboard): sweep day and overview radii onto the scale"
```

### Task 12: Sweep `projects/` and `reports/`

**Files:** `src/components/projects/**`, `src/components/reports/**`

- [ ] **Step 1: List the sites**

Run: `grep -rn --include='*.tsx' 'rounded-\[[0-9]*px\]' apps/dashboard/src/components/projects apps/dashboard/src/components/reports`

- [ ] **Step 2: Apply the mapping table**

Edit each hit per the table above. `ProjectColorPicker` swatches are a likely `rounded-full` — leave those.

- [ ] **Step 3: Verify**

Run: `grep -rno --include='*.tsx' 'rounded-\[[0-9]*px\]' apps/dashboard/src/components/projects apps/dashboard/src/components/reports | grep -v 'rounded-\[[23]px\]'`
Expected: no output.

- [ ] **Step 4: Test and eyeball**

Run: `pnpm --filter @timetrack/dashboard test && pnpm --filter @timetrack/dashboard typecheck`
Load `/projects` and `/reports` in dev.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/projects apps/dashboard/src/components/reports
git commit -m "refactor(dashboard): sweep project and report radii onto the scale"
```

### Task 13: Sweep `marketing/`, remaining `ui/`, and `app/`

**Files:** `src/components/marketing/**`, any remaining `src/components/ui/**`, `src/app/**`

- [ ] **Step 1: List every remaining site**

Run: `grep -rn --include='*.tsx' 'rounded-\[[0-9]*px\]' apps/dashboard/src | grep -v 'rounded-\[[23]px\]'`

- [ ] **Step 2: Apply the mapping table**

Edit each remaining hit. The install pages under `src/app/install/` are public marketing pages outside the app shell — they follow the same scale.

- [ ] **Step 3: Verify the whole dashboard**

Run: `grep -rno --include='*.tsx' 'rounded-\[[0-9]*px\]' apps/dashboard/src | grep -v 'rounded-\[[23]px\]'`
Expected: no output.

- [ ] **Step 4: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 5: Final visual pass — all 17 pages, both themes**

This is the last checkpoint before the redesign's foundation is done, and the only verification the token change gets (spec §10 risk 1). In dev, walk: `/`, `/login`, `/accept-invite`, `/install`, `/install/macos`, `/install/windows`, `/overview`, `/me`, `/projects`, `/projects/[id]`, `/people/[id]`, `/reports`, `/approvals`, `/admin/settings`, `/admin/users`, `/admin/teams`, `/admin/audit` — in light **and** dark. Check for: clipped corners, invisible borders, controls that lost their edge, and any card that reads flat in dark.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src
git commit -m "refactor(dashboard): sweep the remaining radii onto the scale"
```

---

## Done when

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` is green.
- `grep -rno --include='*.tsx' 'rounded-\[[0-9]*px\]' apps/dashboard/src | grep -v 'rounded-\[[23]px\]'` returns nothing.
- All 17 pages render correctly in light and dark.
- No file outside `apps/dashboard/` has changed.
- No new dependency in `apps/dashboard/package.json`.

## Not in this plan

Phases 4–7 of the spec — `DataTable`, skeleton/empty/error states, drawers, toasts and the density _toggle_ — are covered by a second plan. Phase 1–3 leaves the density CSS vars in place and defaulted to comfortable, so nothing here depends on that toggle existing.

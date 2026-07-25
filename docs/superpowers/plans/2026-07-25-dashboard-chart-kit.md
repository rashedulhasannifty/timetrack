# Dashboard Redesign — Slice 2: Chart kit (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add the reusable, pixel-perfect SVG chart primitives the redesigned screens need — donut,
interactive line, gauge, stacked day-bars, bar-meter list, category-mix bar — plus a unit-tested
pure-geometry lib. **Additive**: wired to zero screens this slice (screens compose them in their
reskins).

**Architecture:** `apps/dashboard` only. Pure geometry in `lib/charts.ts` (node-env unit-tested,
like `lib/avatar.ts`); components in `components/charts/` consume it. Interactive charts (line hover,
donut hover) are `'use client'`; static ones are server-renderable. Match the mockup
`TimeTrack.dc.html` exactly (values quoted per task).

## Global Constraints

- `dashboard` scope only. No api/contracts/db. No new dependency (hand-rolled SVG — NOT Recharts;
  the mockup uses raw SVG and we match it). No `console.log`.
- **Additive.** No screen/page file changed. No existing component modified. New files only. If a
  screen renders differently, it's a bug.
- Tokens: use utility classes / CSS vars (`var(--tt-accent)` etc. in inline SVG styles is fine —
  the mockup does this). `tt-numeric` for numbers.
- RSC: `'use client'` only on interactive charts (LineChart, DonutChart). Gauge/StackedDayBars/
  BarMeter/CategoryMixBar are server-renderable (no interaction) — no `'use client'`.
- Dashboard vitest = node-env: unit-test ONLY the pure geometry in `lib/charts.ts`; components via
  typecheck/lint/build.
- Commits: `feat(dashboard): …` ≤72, NO AI attribution, author = repo git user. Stay on
  `feat/ds-5-chart-kit`; verify branch after each commit; never commit to main.

## Design reference (from the mockup)

- **Donut** (L192–215, JS L1157–1167): `r=66`, `C=2πr`; each segment `stroke-dasharray="{len-2} {C-len+2}"`,
  `stroke-dashoffset="-{acc}"`, `transform="rotate(-90 90 90)"`, width 28 (34 on hover); track circle
  `stroke=var(--tt-separator) opacity=.35 width=28`; center shows big value + label.
- **Line** (L244–291, JS L1089–1122): viewBox `0 0 640 170`, plot area `W=600 H=170`,
  `y(v)=H-(v/max)*(H-12)-4`, `step=W/(n-1)`; `<polyline stroke={color} stroke-width=2>` + per-node
  `<circle r=2.5 fill=surface-raised stroke=color>`; horizontal grid lines at
  `gy=8+i*((H-12)/(axis.length-1))`; on mousemove compute nearest index → dashed cursor line +
  tooltip (date + formatted value). Day letters row beneath (weekends tinted destructive).
- **Stacked day-bars** (productivity %) (L258–267, JS L1179–1194): per day a green (good) bar stacked
  under a red (destructive) remainder; `bw=600/n`, bar x `i*bw+bw*0.2`, width `bw*0.6`.
- **Gauge** (L326–339, JS L1203–1206): arc `131.9` of full `175.9`; two `<circle r=28 stroke-width=6
stroke-linecap=round transform="rotate(135 36 36)">` (track + value), value dash
  `"{(pct/100)*131.9} 175.9"`; center shows pct.
- **Bar-meter row** (L351–367): label + value + a `h-[6px] rounded-[3px] bg-separator` track with one
  or two colored fills (supports a 2-segment split, e.g. manual/mobile).
- **Category-mix bar** (L533–542): a `h-[10px]` flex bar of productive/neutral/unproductive widths +
  a legend row.

---

### Task 1: `lib/charts.ts` geometry + tests

**Files:** Create `apps/dashboard/src/lib/charts.ts`, `apps/dashboard/src/lib/charts.spec.ts`.

**Interfaces — Produces:**

- `donutSegments(items: {value:number}[], opts?: {r?:number; gap?:number}): {dash:string; offset:string; frac:number}[]` — computes dasharray/offset per segment (r default 66, gap 2). Zero-total → all zero-length.
- `linePoints(vals:number[], max:number, w?:number, h?:number): {points:string; nodes:{x:number;y:number;v:number}[]}` (w=600,h=170; `y=h-(v/max)*(h-12)-4`, `step=w/(n-1)`, n>1).
- `lineGrid(axis:string[], h?:number): {y:number; label:string}[]` (`y=8+i*((h-12)/(axis.length-1))`).
- `nearestIndex(ratio:number, n:number): number` (`round(clamp(ratio,0,1)*(n-1))`).
- `gaugeArc(pct:number): {dash:string; track:string}` (`value = (clamp(pct,0,100)/100)*131.9`, `dash = "{value} 175.9"`, track `"131.9 175.9"`).

- [ ] **Step 1: failing tests** covering: donut two equal segments each get ~half of `C=2π·66` (minus gap) and cumulative offsets; zero-total → zero dashes; `linePoints` maps `v=max`→`y=8`(top) and `v=0`→`y=h-4`(bottom), correct node count + `points` string; `lineGrid` first y=8 last y=h-4 for a 4-label axis; `nearestIndex(0.5, 30)` etc.; `gaugeArc(0)`→`"0 175.9"`, `gaugeArc(100)`→`"131.9 175.9"`, clamps >100. Run → FAIL.
- [ ] **Step 2:** implement `lib/charts.ts` with those pure functions (`noUncheckedIndexedAccess`-safe). Run tests → PASS.
- [ ] **Step 3:** `pnpm --filter dashboard typecheck` clean.
- [ ] **Step 4: commit** `feat(dashboard): add chart geometry helpers + tests`.

### Task 2: `DonutChart` (client)

**Files:** Create `apps/dashboard/src/components/charts/DonutChart.tsx`.
**Interfaces — Consumes:** `donutSegments`. Props `{ items: {label:string; value:number; color:string}[]; centerValue: string; centerLabel: string }`.

- [ ] **Step 1:** `'use client'` component: 180×180 SVG, track circle (`r=66 stroke=var(--tt-separator) opacity=.35 stroke-width=28`), one `<circle>` per segment from `donutSegments` (`transform="rotate(-90 90 90)"`, hovered segment width 34 else 28, `useState` for hover index), centered value/label overlay; a legend `<ul>` (dot + label + value) beside it. Match mockup L189–213 classes.
- [ ] **Step 2:** typecheck+lint clean. **Step 3: commit** `feat(dashboard): add DonutChart`.

### Task 3: `LineChart` (client, interactive)

**Files:** Create `apps/dashboard/src/components/charts/LineChart.tsx`.
**Interfaces — Consumes:** `linePoints`, `lineGrid`, `nearestIndex`. Props `{ values:number[]; max:number; axis:string[]; dayLetters:{letter:string;weekend:boolean}[]; color:string; format:(v:number)=>string; labels:string[] }` (`labels` = per-point date string for the tooltip).

- [ ] **Step 1:** `'use client'` component matching mockup L244–288: viewBox `0 0 640 170`, grid lines, polyline + node circles, onMouseMove → `nearestIndex` → dashed cursor + tooltip (date + `format(value)`), onMouseLeave clears; axis labels (absolute, right-aligned) + day-letter row (weekend tinted `var(--tt-destructive)`). `useState` for the hovered index.
- [ ] **Step 2:** typecheck+lint clean. **Step 3: commit** `feat(dashboard): add interactive LineChart`.

### Task 4: `StackedDayBars` + `Gauge` (static)

**Files:** Create `apps/dashboard/src/components/charts/StackedDayBars.tsx`, `apps/dashboard/src/components/charts/Gauge.tsx`.
**Interfaces — Consumes:** `gaugeArc`. `StackedDayBars` props `{ values:number[]; dayLetters:{letter:string;weekend:boolean}[] }` (values 0–100 productive %; renders green base + destructive remainder per mockup L258–267). `Gauge` props `{ pct:number; color:string; label?:string }` (mockup L326–332).

- [ ] **Step 1:** implement both (server-renderable, no `'use client'`). **Step 2:** typecheck+lint clean. **Step 3: commit** `feat(dashboard): add StackedDayBars + Gauge charts`.

### Task 5: `BarMeter` + `CategoryMixBar` (static)

**Files:** Create `apps/dashboard/src/components/charts/BarMeter.tsx`, `apps/dashboard/src/components/charts/CategoryMixBar.tsx`.
**Interfaces:** `BarMeter` props `{ label:ReactNode; value:string; fills:{pct:number;color:string}[] }` (1- or 2-segment track, mockup L351–364). `CategoryMixBar` props `{ productive:number; neutral:number; unproductive:number }` (h-[10px] stacked bar + legend, mockup L533–542).

- [ ] **Step 1:** implement both (server-renderable). **Step 2:** typecheck+lint+build clean. **Step 3: commit** `feat(dashboard): add BarMeter + CategoryMixBar`.

### Task 6: e2e scaffold (skipped)

**Files:** Create `apps/dashboard/e2e/charts.spec.ts` (skipped scaffold; APPEND-ONLY single new file). Cases: donut renders segments + center; line shows tooltip on hover; gauge shows pct. Mirror existing scaffolds; curly apostrophes. **Commit** `test(dashboard): scaffold chart-kit e2e cases`.

---

## Final verification

`pnpm lint && typecheck && test && build` green. Then final whole-branch review (opus), then merge.
Charts are additive (no screen imports them yet) — the visual pixel check happens when each screen
reskin composes them; note that in the review rather than re-running the browser here.

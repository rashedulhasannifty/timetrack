# Design — Overview flagship reskin (manager dashboard, sub-project B)

Date: 2026-07-30
Status: approved (pending spec review)

## 1. Problem

The manager Overview (`apps/dashboard/src/app/(app)/page.tsx`, "Slice 8") renders only what the API
could already produce — 3 KPIs, the top-projects donut, haven't-tracked, and two leaderboards
(tracked-hours, activity %) — and ends with a placeholder note: _"Meeting-time, app-usage and trend
widgets appear once their data sources are connected."_ Sub-project A connected those sources by
adding three team-scoped endpoints (`/reports/trends`, `/reports/team-activity`, `/reports/app-usage`).
This sub-project rebuilds Overview into the flagship page the redesign prompt
(`docs/dashboard-redesign-prompt.md`) specifies — richer KPIs, both trend charts, the full leaderboard
grid, the website/app breakdown, and a widgets drawer — consuming A's endpoints plus existing data.

This is **sub-project B** of the three-part redesign (A = analytics backend, shipped on this branch;
B = this spec; C = Reports/Approvals/Admin reskin, later).

## 2. Goals / non-goals

**Goals**

- Rebuild the Overview page to the prompt's section layout: KPIs / Trends / Latest data / Top users /
  Websites & applications, plus a widgets drawer.
- Add three dashboard API-client methods for A's endpoints, and pure view-transforms for every new
  widget. Keep all logic in transforms; keep components presentational.
- Reuse the existing chart/UI components; add only what genuinely doesn't exist.
- Ship the widgets drawer: a client-side panel that toggles each card on/off, persisted per-browser.

**Non-goals**

- No meeting-time or mobile-time widget (no product concept — dropped from the prompt).
- No API/contracts/schema change — A's endpoints and contracts are complete and consumed as-is.
- No changes to Reports / Approvals / Admin (sub-project C).
- No new charting dependency — SVG/CSS components only, per the existing dashboard.

## 3. Key decisions

- **Category-% KPIs come from `trends`, idle-% from `team-activity`.** `team-activity` rows carry
  percentages + `activeMinutes`/`idleMinutes`, not raw category minutes, so averaging their pcts would
  be imprecise. Instead: team **productive/unproductive %** = summed raw `productiveSeconds` /
  `neutralSeconds` / `unproductiveSeconds` across all `trends` days (exact); team **idle %** =
  `Σ idleMinutes / (Σ idleMinutes + Σ activeMinutes)` across `team-activity` rows (exact). This is
  the accurate sourcing, refined from the design sketch's "aggregate team-activity" wording.
- **One `appUsage` call feeds three cards.** `appUsage` returns rows with a dominant `category`; the
  page splits them client-side: _Top used_ = all rows; _Top unproductive_ = `category === 'UNPRODUCTIVE'`;
  _Top unrated_ = `category === 'NEUTRAL'`. No extra endpoint calls.
- **Widgets drawer = server-rendered cards + a client visibility shell** (chosen over client-registry
  or cookie-server approaches). Cards stay Server Components (data server-side, no browser tokens); a
  thin client context reads/writes a `{widgetId: boolean}` map in `localStorage` and hides toggled-off
  cards via CSS. Toggling never refetches. Accepted trade-off: a previously-hidden card flashes on
  first paint before hydration applies the saved map — acceptable per the prompt's "remembered on this
  browser only" framing; no pre-hydration inline script (YAGNI).
- **`StatCard` already supports the progress bar** (`bar: {pct, color, caption, href}`) — the 6-up KPI
  row needs no component change, only the new transforms.
- **`LineChart` and `StackedDayBars` already exist** and match the two trend charts exactly; the
  transforms adapt `trends` days to their props.

## 4. Data flow

`page.tsx` (Server Component) resolves the session, reads the `from`/`to` range (existing
`defaultReportRange` + `ReportRangePicker`), and fetches in one `Promise.all`:

- existing: `teamSummary`, `projectSummary`, `teamOverview`
- new: `trends`, `teamActivity`, `appUsage`

A 403 from the team-scoped calls yields the existing "not permitted" state; an all-empty result yields
the existing no-data state. Each result is passed through a pure transform, then rendered into the
section grid. Every card is wrapped in `<Widget id="…">`; the whole grid sits inside the visibility
provider so the drawer can toggle cards.

## 5. Widgets & sources

| Section         | Card                                             | Component            | Transform / source                             |
| --------------- | ------------------------------------------------ | -------------------- | ---------------------------------------------- |
| KPIs            | Time tracked · Active users · Currently tracking | `StatCard`           | existing `overviewKpis`                        |
| KPIs            | Productive % · Unproductive %                    | `StatCard` (bar)     | NEW `teamCategoryKpis(trends)`                 |
| KPIs            | Idle %                                           | `StatCard` (bar)     | NEW `teamIdleKpi(teamActivity)`                |
| Trends          | Hours tracked                                    | `LineChart`          | NEW `trendsToHoursLine(trends)`                |
| Trends          | Productivity % per day                           | `StackedDayBars`     | NEW `trendsToProductivityBars(trends)`         |
| Latest data     | Top projects donut · Haven't tracked             | `DonutChart` / list  | existing `donutFromProjects` / `haventTracked` |
| Top users       | Tracked most hours · Highest activity %          | `BarMeter` / `Gauge` | existing `topByHours` / `topByActivity`        |
| Top users       | Highest productive % · Highest unproductive %    | `Gauge`              | NEW `topByProductive` / `topByUnproductive`    |
| Top users       | Highest idle %                                   | `BarMeter`           | NEW `topByIdle`                                |
| Websites & apps | Top used · Top unproductive · Top unrated        | NEW `AppUsageList`   | NEW `appUsageByCategory(appUsage)`             |

## 6. Architecture & files

**Add / modify**

- `lib/api-client.ts` — **modify**: add `trends`, `teamActivity`, `appUsage` (each one line: `get('/reports/…?'+params, Schema, token)`, mirroring `teamSummary`).
- `lib/overview-view.ts` — **modify**: add the new pure transforms (`teamCategoryKpis`, `teamIdleKpi`, `trendsToHoursLine`, `trendsToProductivityBars`, `topByProductive`, `topByUnproductive`, `topByIdle`, `appUsageByCategory`). No React, no I/O.
- `lib/overview-view.spec.ts` — **modify**: unit tests for every new transform.
- `components/overview/AppUsageList.tsx` — **create**: presentational icon · name · length-bar · tabular time list (Server Component).
- `components/overview/WidgetVisibilityProvider.tsx` — **create** (`'use client'`): context + `localStorage` map.
- `components/overview/Widget.tsx` — **create** (`'use client'`): per-card wrapper, hides via CSS when off.
- `components/overview/WidgetsDrawer.tsx` — **create** (`'use client'`): grouped checkboxes + "⚙ Widgets" trigger.
- `app/(app)/page.tsx` — **modify**: recompose into the prompt's labelled sections, wrapped by the shell.
- `apps/dashboard/e2e/overview-flagship.spec.ts` — **create**: renders the new sections + drawer toggle persistence. The existing `apps/dashboard/e2e/overview.spec.ts` and `overview-reskin.spec.ts` must be kept green — update their selectors if the recompose moves/renames the widgets they assert on (same commit as the page change).

**Reuse unchanged**: `LineChart`, `StackedDayBars`, `DonutChart`, `Gauge`, `BarMeter`, `StatCard`,
`Card`, `SectionHeader`, `Avatar`, `ReportRangePicker`, `charts.ts` helpers, `format.ts`.

## 7. Testing

- **Unit (Vitest, node-env — no jsdom, so transforms only, not components):** every new transform —
  KPI category-% math (from `trends` seconds) and idle-% math (from `team-activity` minutes), the
  `appUsage` category split, leaderboard ordering + top-N, and empty-range → zeros / empty lists.
- **E2E (Playwright, `*.spec.ts` naming so it isn't silently skipped):** Overview renders the new
  KPI tiles, both trend charts, the new leaderboards, and the app-usage cards on seeded data; opening
  the widgets drawer and toggling a card off hides it and the choice **persists across reload**
  (`localStorage`).
- **Empty/permission states:** each widget degrades to a per-card "No data in this range"; the page
  keeps the existing `forbidden` (403) and no-data states.

## 8. Risks / open items

- **Pre-hydration flash** of a previously-hidden card (Section 3 trade-off) — accepted, documented, no
  mitigation this slice.
- **Trends inclusive-`to` day convention** (from A): `trends` emits a row for `date(to)`. The
  hours-line and productivity-bars transforms render exactly the days returned; the x-axis labels come
  from each day's date, so the extra trailing day (for a midnight-aligned `to`) simply appears as the
  last, near-zero point. No special handling needed; noted so it isn't mistaken for a bug.
- **Vitest is node-env** — components can't be unit-tested here; the drawer's toggle/persistence
  behavior is covered by the Playwright e2e, not a unit test.
- **Branch:** stacks on `dashboard/team-analytics-backend` (A, unmerged) via a new branch
  `dashboard/overview-flagship`, so B can call A's endpoints before A merges.

# TimeTrack Dashboard — Design Prompt (paste into Claude)

> Copy everything below the line into a new Claude conversation and ask for an artifact.
> It is self-contained: product context, exact design tokens, page-by-page widget specs,
> chart specs, and sample data are all included.

---

You are a senior product designer. Build a **high-fidelity, interactive HTML mockup** of a workforce time-tracking & analytics **web dashboard** called **TimeTrack**. Deliver it as a single self-contained HTML artifact.

## What TimeTrack is

Self-hosted employee time-tracking and workforce analytics. There's a macOS menu-bar client that captures time entries, activity level (keyboard/mouse), app/website usage, and periodic screenshots; a backend API; and this web dashboard where **managers and admins** review the workforce and **employees** review their own data. The visual language is **Apple-system / macOS native** — calm, precise, lots of whitespace, hairline borders, tabular numerals for every duration and percentage.

The reference product for feature richness is **Time Doctor** — match its analytics depth (KPI tiles, top-users leaderboards, productivity trends, website/app breakdowns). But render it in TimeTrack's clean Apple aesthetic below, **not** Time Doctor's visual style.

## Hard output requirements

1. **One self-contained HTML file.** All CSS and JS inline. No external stylesheets, fonts, scripts, images, or network calls. Use inline SVG for all icons and charts (or lightweight hand-built SVG/CSS charts — do not pull in a charting library).
2. **Light AND dark mode**, both fully styled. Add a working theme toggle in the top bar. Use the exact tokens below for each mode. Default to light; remember the toggle in `localStorage`.
3. **Responsive.** Sidebar collapses gracefully below ~900px; card grids reflow to 1–2 columns; nothing scrolls the page horizontally.
4. **Multi-page via client-side routing.** Build the sidebar nav so clicking an item swaps the main content region (show/hide sections or a tiny hash router). All pages live in the one file. Overview is the default.
5. **Realistic sample data** throughout (provided below) — never "Lorem ipsum" or empty charts.
6. **Accessible:** semantic HTML, `aria-current` on the active nav item, visible focus rings (2px accent outline), sufficient contrast in both themes, `prefers-reduced-motion` respected.

## Design tokens — use these EXACTLY

Drop these into `:root` / `.dark` and drive everything off the semantic names. Dark mode is a `.dark` class on `<html>` (class strategy, not media query).

```css
:root {
  --tt-surface: #f4f4f6; /* page background */
  --tt-surface-raised: #ffffff; /* cards, sidebar, topbar */
  --tt-separator: #d6d6db; /* hairline borders */
  --tt-text: #1d1d1f;
  --tt-text-secondary: #6e6e73;
  --tt-accent: #007aff; /* primary actions, active nav, links */
  --tt-accent-hover: #0063cc;
  --tt-destructive: #d70015;
  --tt-category-productive: #5e5ce6; /* indigo */
  --tt-category-neutral: #8e8e93; /* gray */
  --tt-category-unproductive: #ff9500; /* orange */
  --tt-recording: #30b0c7; /* teal "currently tracking" dot */
  --tt-elevation-1: 0 1px 2px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08);
  --tt-elevation-2: 0 8px 24px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.1);
}
.dark {
  --tt-surface: #1c1c1e;
  --tt-surface-raised: #2c2c2e;
  --tt-separator: #3a3a3c;
  --tt-text: #f5f5f7;
  --tt-text-secondary: #a1a1a6;
  --tt-accent: #0a84ff;
  --tt-accent-hover: #409cff;
  --tt-destructive: #ff453a;
  --tt-category-productive: #7d7aff;
  --tt-category-neutral: #98989d;
  --tt-category-unproductive: #ff9f0a;
  --tt-recording: #40cbe0;
  --tt-elevation-1: 0 0 0 1px rgba(255, 255, 255, 0.06);
  --tt-elevation-2: 0 8px 30px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.08);
}
```

**Chart / status colors** (derive tints/shades as needed): productive = indigo `--tt-category-productive`, unproductive = orange `--tt-category-unproductive`, neutral = gray `--tt-category-neutral`. For the "productive vs unproductive" bars in trends, use **green `#34c759` / `#30d158`** for productive and the destructive red for unproductive — matching Time Doctor's green/red trend bars but with Apple system greens.

**Type:** system font stack — `-apple-system, "SF Pro Text", ui-sans-serif, system-ui, sans-serif`; headings use the SF Pro Display end of the stack. Scale: caption 12px / label 13px / body 15px / h2 22px / h1 32px / display 48px. Line-height 1.5 body, tight (1.1–1.2) for large numbers.
**Every duration, %, timestamp, and date range uses `font-variant-numeric: tabular-nums`** and is right-aligned in tables.
**Spacing:** 4pt base (gaps of 8/12/16/24). **Radii:** sm 6px, md 10px, lg 14px. **Cards:** `--tt-surface-raised` background, 1px `--tt-separator` border, `--tt-elevation-1`, radius-lg, ~16–20px padding.

## Global layout (persistent chrome on every page)

- **Left sidebar**, 240px, `--tt-surface-raised`, right hairline border. Top: a 32px rounded-square accent logo tile (clock glyph) + "TimeTrack" wordmark. Nav group: **Overview** (default, clock/grid icon), **Reports**, **Approvals**, **Admin**. A hairline divider, then a secondary group: **My time**. Active item: `--tt-surface` pill background, `--tt-text`, accent-colored icon, `aria-current="page"`.
- **Top bar**, sticky, `--tt-surface-raised`, bottom hairline. Left: page title + a **date-range picker** control reading "Jun 25 – Jul 24" with a dropdown affordance. Right: theme toggle (sun/moon), a role badge ("Manager"), and an avatar with a sign-out affordance.
- **Sample-data banner** (Overview only): a dismissible info strip at the top — "You're viewing the team dashboard with sample data. It's replaced automatically once your team starts tracking time." with a subtle "Clear sample data" secondary button. Style it as a light-tinted card, not alarming.

## Pages & widgets

### 1. Overview `/` — the flagship page (build this the richest)

Group into labeled sections with small uppercase section headers (Overview / Trends / Top users / Websites & applications), exactly like Time Doctor.

**a) KPI stat-tile row** — a 6-up responsive row of stat tiles, each: small label + optional info "ⓘ", a large tabular value, and a slim horizontal progress bar with a % caption. Tiles:

- Time tracked — **490h 33m** (no bar; headline metric)
- Meeting time — **98h 06m** · 20% (accent/indigo bar) · "View details" link
- Manual time — **73h 35m** · 15% (yellow bar)
- Mobile time — **49h 03m** · 10% (blue bar)
- Unproductive website & app usage — **58h 52m** · 12% (red bar)
- Active users — **6**

**b) Top projects + Haven't-tracked panel** — two cards side by side.

- _Top projects:_ a legend list (colored dot · name · tabular hours) beside a **donut chart** with the total ("490h 33m / Total") in the center hole. Projects & values: General Work 73h 35m, Marketing Campaign 122h 38m, UI/UX Redesign 49h 03m, Backend Migration 147h 10m, Customer Onboarding 98h 06m. "Projects report" link bottom-right.
- _Haven't tracked time yet:_ a person row ("Rashedul Test · Never tracked time") with a "Hide from reports" pill. "Manage users" link bottom-right.

**c) Trends** — three cards.

- _Hours tracked:_ a **line chart**, ~30 daily points hovering 12–18h, right-axis 0/6/12/18, weekday letters (T F S S M …) on the x-axis with weekends in red. "Hours Tracked report" link.
- _Productivity % per day:_ **stacked vertical bars**, each day mostly green (productive) with a thin red base (unproductive). Subtitle "Based on web & app usage". "Web & App Usage" link.
- _Meeting time:_ a **line chart** in indigo/accent, daily points around 3–4h. "Meeting Insights" link.

**d) Top users** — the leaderboard grid (match Time Doctor fully). Each card lists the 6 sample people with avatar initials chips.

- _Most work-life-balance potential issues:_ six people with a small face icon + an issue count (Alex Johnson 14, Michael Brown 13, John Doe 9, Sarah Wilson 9, Chris Martinez 7, Jane Smith 4). Sub-line "3 minimum issues · Adjust rules".
- _Highest % time on productive websites & apps:_ **radial gauge** per person, green arc — John Doe 75, Jane Smith 95, Alex Johnson 79, Sarah Wilson 71, Michael Brown 87, Chris Martinez 79.
- _Highest % on unproductive:_ red radial gauges — John 25, Jane 5, Alex 21, Sarah 29, Michael 13, Chris 21.
- _Tracked most hours_ / _Tracked least hours:_ horizontal bar list (green for most, red for least). Most: Jane 90h42, Alex 82h36, John 82h07, Michael 77h44, Sarah 74h19. Least: Jane 29h05, John 26h38, Alex 25h53, Sarah 25h45, Michael 24h29.
- _Highest % of idle minutes:_ dark bars — John 12% (57m), Alex 9% (42m), Sarah 8% (39m), Jane 8% (36m), Michael 2% (11m).
- _Highest % of manual & mobile time:_ two-segment bars (yellow manual + blue mobile) — Sarah 27%, Michael 26%, John 26%, Jane 26%, Alex 26%.
- _Highest % of time in meetings_ / _Lowest %:_ vertical bar-per-person with 0/33/66/100 axis, indigo bars, ~19–22%.
- _User activity level:_ a "Very High" green pill followed by a wrapped list of names (based on keyboard & mouse activity).

**e) Websites & applications** — three cards.

- _Top used websites & applications:_ icon (app vs globe) · name · horizontal length-bar · tabular time. Microsoft Word 7h03, gitlab.com 5h26, slack.com 2h11, Microsoft PowerPoint 2h07, office.com 1h05.
- _Top used unproductive:_ Netflix 12m, instagram.com 7m, youtube.com 6m, Spotify 6m, Epic Games Launcher 3m.
- _Top used unrated:_ Chrome 7h41, calendar.google.com 6h56, weather.com 5h55, Opera 3h37, Safari 2h32. Include a "Rate unrated websites & apps" pill.

**f) Widgets drawer** — a "⚙ Widgets" button top-right of the Overview header opens a right-hand panel with grouped checkboxes (Overview / Latest data / Trends / Top users / Websites & applications) letting the user toggle each widget on/off. Toggling actually shows/hides the corresponding card. Note: "remembered on this browser only."

### 2. My time `/me` — employee self-view

Header "My time". A **timesheet-status** card (this week: Pending / Approved / Flagged badge). Then a tabbed panel: **Timeline** (today's time entries as a vertical list — time range · project · note), **Activity** (an active-minutes headline, a daily activity-% bar chart for the last 7 days, a top apps/sites bar list, and a category-mix stacked bar Productive/Neutral/Unproductive), **Screenshots** (a grid of blurred screenshot thumbnails with timestamps and a "redact" affordance — employee can see their own), **Idle** (a list of idle periods with a "resolve" action). Frame everything as the employee's own data.

### 3. Person `/people/:id` — one-person deep-dive (manager view)

Header with the person's name + avatar + a "currently tracking" teal dot. Their own KPI mini-row (today's hours, activity %, productive %, idle %), a **timeline** for today, a 7-day **activity summary** (daily bar chart + top apps/sites + category mix), a small **productivity trend** line, and a **screenshots** grid. A 403-style "You're not permitted to view this person" empty state variant shown as a note.

### 4. Reports `/reports`

Date-range picker + "Export CSV" button. Two blocks: **By person** — a table (User · Tracked time · Activity % with an inline bar · Productive %), sortable-looking headers, tabular figures right-aligned. **By project** — a horizontal bar chart of hours per project using the project colors from Overview. Distinct empty state ("No data in this range").

### 5. Approvals `/approvals`

A table: User · Week · Hours · Status badge (Pending = neutral, Approved = green, Flagged = orange) · a "Decide" action that opens a small approve / flag-for-payroll control. Show a mix of statuses across the 6 people.

### 6. Admin (tabs: Settings · Users · Audit)

- _Settings:_ a monitoring-policy editor form — screenshot interval (slider/select), screenshot blur (toggle), retention days (number), idle threshold (minutes). Save button. A calm note that these apply org-wide.
- _Users:_ a workforce table — Name · Email · Role (Employee/Manager/Admin) · Status (Active/Deactivated) · row actions (invite / deactivate / change role). An "Invite user" primary button.
- _Audit:_ an audit-log table — Timestamp · Actor · Action · Target · a "view diff" toggle. Filter controls at top; cursor-style "Load more".

## Chart specs

- **Donut:** SVG, ~180px, ~28px stroke ring, each project a segment in its legend color, total centered. Subtle hover lift on segments.
- **Line charts:** smooth or straight polyline, 2px stroke, small circle nodes, faint horizontal gridlines, right-side y-axis labels, weekday x-axis with weekends tinted red. Themed tooltip on hover (a small `--tt-surface-raised` card with elevation-2, tabular value) — **must be legible in dark mode** (this is a known weak spot; do not use a default white tooltip).
- **Stacked/segmented bars:** rounded top corners (2px), category colors, thin.
- **Radial gauges:** 270° arc, track in `--tt-separator`, value arc in green (productive) or red (unproductive), big % in the center, name + avatar chip below.
- **Horizontal length-bars** (websites, tracked-hours): full-width track, colored fill, value right-aligned in tabular figures.

## Sample data (people)

Six teammates with avatar initials chips (give each a soft distinct pastel background): **John Doe (JD)**, **Jane Smith (JS)**, **Alex Johnson (AJ)**, **Sarah Wilson (SW)**, **Michael Brown (MB)**, **Chris Martinez (CM)**. Date range everywhere: **Jun 25 – Jul 24**. Use the exact per-widget numbers listed above so the leaderboards are internally consistent.

## Aesthetic direction — do / don't

- **Do** keep it calm and Apple-native: generous whitespace, hairline separators, `--tt-elevation-1` on cards, restrained accent use (nav active state, links, primary buttons only), tabular numerals everywhere numbers appear.
- **Do** make the two themes feel intentional — dark mode is true dark (`#1c1c1e` page, `#2c2c2e` cards), not gray-on-gray; borders become faint white insets.
- **Don't** use drop shadows heavier than the tokens, gradients, glassmorphism, or more than the palette colors above.
- **Don't** letter-space body text or center-align long tables.
- **Don't** invent new brand colors — everything derives from the tokens.

## Deliverable

Return the complete single-file HTML artifact, opening on the **Overview** page in **light** mode, with the sidebar navigation, theme toggle, date-range picker affordance, and the widgets drawer all functional. Prioritize the Overview page's fidelity; the other five pages should be complete and consistent but can be a touch simpler.

# TimeTrack — Claude Design Prompt

Paste the relevant block into Claude (Artifacts / Claude Code / claude.ai). §0 is shared
identity — always include it. Then add §1 (dashboard) **or** §2 (macOS client). They are
built to produce **one product**, not two unrelated UIs.

---

## §0 — Shared design brief (always include)

You are the design lead for **TimeTrack**, a self-hosted employee time-tracking and
workforce-analytics product. Two surfaces: a **Next.js web dashboard** (managers, admins,
and employees viewing their own data) and a **macOS menu-bar client** (employees). Design
them as one coherent identity.

**The thesis — read this before choosing a single color.**
This is monitoring software. Its stated success metric is _employee-reported trust_ — if
that tanks, the product has failed regardless of everything else. So the design's job is the
opposite of what "monitoring dashboard" usually summons. **Do not** design a surveillance
control room: no threat-level reds, no alarm density, no "ops center" dark glass, no gauges
that imply someone is a risk to be watched. Design for **honesty and symmetry**: the employee
sees the _exact same lens_ the manager sees. The product's most trust-defining fact — "here
is precisely what is and isn't recorded about you" — should be visible, calm, and legible,
never buried. Aim for the feeling of a **well-kept public record**: precise, plain, mutual.
Institutional in the trustworthy sense, warm in the human sense.

**Signature element (make this the one thing the product is remembered by).**
A single honest **time ribbon** — a horizontal day-timeline of tracked entries, activity
level, and capture moments — that is rendered _identically_ whether a manager is viewing an
employee or an employee is viewing themselves. Same component, same detail, same nothing-
hidden. Symmetry is the brand. Spend your boldness here; keep everything around it quiet.

**Identity source — derive from macOS, don't invent from scratch.**
The macOS client is the anchor of the identity, and the web dashboard is its sibling that
**inherits the same tokens**. Ground the whole system in native Apple conventions: **SF Pro**
(Text/Display) as the primary face — on the web use the system stack
(`-apple-system, "SF Pro Text", ui-sans-serif`) so the two surfaces read as one product;
lean on **macOS system grays and native materials** for surfaces and separators; and treat the
**macOS system accent (blue)** as the default active/trust color. The goal is that both
surfaces feel like they belong next to Apple's own apps, not like a generic SaaS theme. You
still get one deliberate typographic move of your own — a restrained display treatment for
headings/hero numbers — but it sits on top of the native base, it doesn't replace it.

**Typography — this is a product made of numbers.**
Hours, minutes, activity percentages, timestamps, and date ranges are everywhere and are
constantly compared column-to-column. Treat numerals as a first-class decision: use SF Pro's
**tabular / monospaced figures** (`font-variant-numeric: tabular-nums`; on macOS the
monospaced-digit system font) for every duration, %, and time, right-aligned in tables. Set a
clear type scale with intentional weights and spacing. Do **not** drift into the AI-cliché
looks: (a) cream + high-contrast serif + terracotta, (b) near-black + one acid-green/vermilion
accent, (c) broadsheet hairline-rule newspaper columns.

**Palette.** Derive it from macOS, then name 5–6 hex values so the web can reproduce it: a
calm base built on system grays (with a true dark-mode set, not just inverted); the **system
accent (blue)** as the default active/trust color; reserve **red strictly** for genuine
destructive actions (delete, erase) and never for ordinary activity or low-productivity
states. Category colors (Productive / Neutral / Unproductive) must be distinguishable
**without** a green-good / red-bad morality binary — unproductive is not sinful; pick hues
that read as neutral categories (system palette is a good source), and stay colorblind-safe.

**Must be encoded in the UI (product constraints, not decoration):**

- An **always-visible "you are being recorded" state**. It has no hide/kill switch by design.
  On the web it appears in any self-view; on macOS it is the menu-bar status icon.
- **Symmetric transparency:** anywhere data about a person is shown, that person can see the
  same thing. The employee self-view is not a lesser view.
- **No stealth affordances.** Nothing in the UI should imply covert capture.
- Screenshots are shown as thumbnails via short-lived URLs; an employee can **flag/redact**
  their own screenshot with a reason, and a redacted shot reads as _"redacted by employee:
  <reason>"_ — visibly present, never silently gone.

**Quality floor (non-negotiable, don't announce it):** responsive to mobile; light **and**
dark themes, both first-class; visible keyboard focus; `prefers-reduced-motion` respected;
WCAG AA contrast; every chart legible in grayscale.

**Voice of the copy.** Plain, active, sentence case. Name things by what the person controls,
not how the system is built. Errors state what happened and how to fix it, without apology or
vagueness. Empty states are invitations to act. An action keeps its name through the whole
flow ("Approve" → toast "Approved"). Given the subject, tone should feel candid and
respectful — never coy about what's being captured.

**Deliverable format.** First give me a compact design plan: palette (named hex), type
(faces + roles + scale), layout concept (one-sentence prose + ASCII wireframe), and the
signature element. Critique it against the thesis above and revise anything that reads as a
generic default. **Then** build.

---

## §T — Token plan only (run this FIRST, then lock it)

Use this **instead of** asking for a built UI when you want to nail down the shared design
system before either surface exists. It produces tokens only — no screens — so the client and
dashboard can both derive from the identical source and never drift. Include **§0**, then this.

---

Do **not** build any UI yet. Produce **only** the shared design-system tokens for TimeTrack,
derived from the identity in §0 (native-macOS anchored, calm / trust-first). I will lock these
and feed them into the dashboard (§1) and macOS client (§2) so both surfaces are identical.

Deliver all of the following, and nothing else:

1. **Palette** — 5–6 named roles, each with a **light** and **dark** hex value:
   - `surface`, `surface-raised`, `separator` (from macOS system grays; a true dark set, not
     an inversion)
   - `text`, `text-secondary`
   - `accent` (macOS system blue — the active/trust color) + `accent-hover`
   - `destructive` (red — used _only_ for delete/erase)
   - `category-productive`, `category-neutral`, `category-unproductive` — three neutral,
     colorblind-safe hues that are **not** a green-good / red-bad binary
   - `recording` — the always-visible "being recorded" state color (calm, not alarm-red)
     For each, one line on where it's used. State the contrast ratio of `text` on `surface` in
     both themes (must pass WCAG AA).

2. **Typography** — the type scale as a table: role (display / h1 / h2 / body / label /
   caption / **numeric**), size, weight, line-height, letter-spacing. Primary face SF Pro via
   the system stack; call out the **tabular-figures** rule for the numeric role (durations, %,
   timestamps) and your one deliberate display treatment.

3. **Spacing, radius, elevation** — a spacing scale, corner-radius steps (match macOS metrics),
   and 2–3 elevation/material levels (how surfaces separate in light vs dark).

4. **Output the tokens in two consumable forms:**
   - **Tailwind CSS 4** `@theme { … }` block (CSS custom properties, light + dark via a
     `prefers-color-scheme` / `.dark` strategy) — ready to drop into the dashboard's
     `globals.css`.
   - **SwiftUI** — a `Color` set with the same semantic names (asset-catalog names or a
     `Color` extension), so the client references the identical roles, plus the SF Pro text
     styles mapped to the scale.

5. A **one-screen swatch/type specimen** (a single static preview) so I can eyeball the system
   — palette chips with names, both themes side by side, the type scale rendered, and a row of
   tabular numerals aligned in a column. No product screens.

Before finalizing, critique the palette against §0: confirm nothing reads as a surveillance
"alarm" aesthetic, red is confined to destructive actions, and the category colors carry no
good/bad morality. Revise and note what you changed.

---

## §1 — Web dashboard (Next.js)

Add this to §0 when designing the dashboard.

**Tech constraints (match the codebase — don't fight it):**

- Next.js 16 App Router, **React 19 Server Components by default**; `'use client'` only where
  there's real interaction (filters, dropdowns, redaction, approvals).
- **Tailwind CSS 4** (CSS-first `@theme`, not a JS config). Express the whole token system as
  Tailwind theme variables so it's reusable; no inline magic hex values scattered in JSX.
- **Recharts** for all charts.
- Design for typed data from a shared contracts layer — assume every list can be empty,
  loading, or forbidden (403). Design those states, not just the happy path.

**Screens to design (consistent system across all):**

1. **Login** — single calm entry point. Email/password. This is the first trust impression.
2. **Team overview (home)** — who's tracking right now, today's hours per person. Glanceable,
   not a leaderboard; avoid ranking people against each other.
3. **Person timeline** (`/people/[id]`) — the signature time ribbon: entries, app breakdown,
   activity %, screenshot thumbnails. This exact layout is reused for the employee self-view.
4. **Employee self-view** (`/me`) — same components as #3, plus the recorded-state banner and
   the screenshot redaction control. Must not feel downgraded.
5. **Project view** (`/projects/[id]`) — hours per project across the team.
6. **Reports** — date-range filters, per user/project/team, CSV export.
7. **Approvals** — approve or flag timesheets for payroll; clear pending → resolved states.
8. **Admin** — settings (screenshot interval, idle threshold, blur mode, retention days,
   capture on/off), users (invite/deactivate/roles), and an audit-log viewer.

**Layout system.** Propose the shell: primary nav, page header pattern, and how the recorded-
state indicator persists. Density should suit tables of durations and timestamps (tabular
figures, right-aligned numbers, quiet row rules) without feeling like a spreadsheet.

**Charts.** Activity-% over time and per-app/per-project breakdowns via Recharts. Muted,
consistent with the palette, legible in grayscale and dark mode, category colors that aren't a
good/bad binary. Tooltips and axes in the product's plain voice.

Produce a working, responsive prototype with real-feeling copy (invent realistic names,
projects, and durations — not lorem). Show the time ribbon, one data table, one chart, and at
least one empty state and one 403/"you can only see your own data" state.

---

## §2 — macOS menu-bar client (SwiftUI + AppKit)

Add this to §0 when designing the client. This is a **native macOS** app — design to the
platform, not a web page in a window.

**Tech constraints:** Swift 6 / SwiftUI + AppKit, macOS 14+ target. Use SF Pro / SF Symbols,
native materials/vibrancy, standard macOS control metrics and menu-bar behavior. It should
feel like it belongs next to Apple's own menu-bar apps — but carry TimeTrack's accent and the
same trust posture as the web.

**The anchor is the status item.** `NSStatusItem` in the menu bar with three visibly distinct
states — **idle**, **tracking**, **capturing** — using SF Symbols. It is always visible and
has **no hide/kill switch**; design the icon set so a glance tells the employee exactly what's
happening right now. This is the product's central honesty affordance.

**Surfaces to design:**

1. **Menu-bar dropdown** (the primary UI, compact) — current state + timer, start / stop /
   pause, a searchable project/task picker, optional note. Glanceable, one-hand, calm.
2. **Idle resume prompt** — "You were away for X min — keep or discard?" **Discard is the
   default/primary action.** Honest and low-pressure, never guilt-inducing.
3. **"My Data" self-view** — the employee browsing everything recorded about them: time
   entries, activity samples, and their own screenshots, with the flag/redact control. This is
   the macOS sibling of the web self-view and must feel equally complete and reassuring.
4. **Settings** — auto-start on login (**defaults off**), idle threshold, and a plain,
   non-alarming restatement of the active monitoring policy. No dark patterns; opting out of
   optional capture is easy to find.
5. **First-run policy acknowledgement** — capture cannot begin until the user acknowledges the
   monitoring policy. Design this as a clear, respectful consent moment, not fine print. It is
   a structural gate; make it read like one.

Deliver: the status-item state set, the dropdown, the idle prompt, and the My-Data view, with
realistic sample content and both light and dark appearance.

---

### How to use

- **Recommended flow:** run **§0 + §T** first to lock the shared token system, paste the
  resulting Tailwind `@theme` block + SwiftUI `Color` set back into §0 (replacing "propose a
  palette" with "use these exact tokens"), then run **§0 + §2** (client) and **§0 + §1**
  (dashboard) in separate sessions. This guarantees the two surfaces can't drift.
- **Skip §T** only if you'd rather let the first surface you build define the palette; if so,
  build the **macOS client (§2) first** since it's the identity anchor, then reuse its tokens.
- **One surface at a time** always gives the best results — don't ask for both in one session.
- Locked decisions in this version: **identity derived from native macOS** (SF Pro, system
  accent, system grays/materials — the client is the anchor, the web inherits); **calm /
  trust-first** direction; light-first with full dark support; symmetry / the honest time
  ribbon as the signature. To change course, edit §0's identity + palette paragraphs; the
  rest of the prompt still holds.

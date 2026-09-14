# Gap analysis: TimeTrack vs Time Doctor 2

_Written 2026-09-14. Time Doctor facts come from timedoctor.com, support.timedoctor.com and api2.timedoctor.com as of that date. TimeTrack facts come from reading `main` at `fc82936`._

## Summary

TimeTrack's core already matches Time Doctor 2's Basic tier and parts of its higher tiers: tracking, screenshots with blur, idle prompts, app categories, weekly approvals, the audit log and OIDC.

What we are missing is mostly what Time Doctor's **Standard** tier ($14/user/mo) layers on top of tracking: schedules, attendance, leave, payroll and manager alerts. The second biggest gap is **Windows parity**. The Windows client lacks two features the macOS client has.

## Time Doctor 2 at a glance

| Tier       | Price (monthly / annual per user per month) | What it adds                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic      | $8 / $6.67                                  | Online and offline tracking, projects and tasks, screenshots, Timeline report. Keeps 3 months of data.                                                                                                                                                  |
| Standard   | $14 / $11.67                                | Schedules, attendance, leave, break tracking, payroll, time approvals, Activity Summary, Web & App Usage, productivity ratings, inactivity alerts, work-life balance, 60+ integrations. Keeps 6 months of data.                                         |
| Premium    | $20 / $16.70                                | Video screen recording, Unusual Activity (jiggler detection), Benchmarks AI, Office vs Remote, Meeting Insights, Software Cost Insights, Internet Connectivity report, public API, SSO, SCIM, client login, Executive Dashboard. Keeps 2 years of data. |
| Enterprise | Custom                                      | Private cloud, custom BI, BigQuery, HRIS integrations.                                                                                                                                                                                                  |

Sources: [pricing plans](https://support.timedoctor.com/knowledge/time-doctor-pricing-plans-and-features), [pricing page](https://www.timedoctor.com/pricing).

What else Time Doctor 2 offers:

- **Tracking modes.** An Interactive app, and an **Automatic** app that has no interface, cannot be paused, and can be deployed silently through Group Policy. Automatic is not sold in the EU. Manual time can be set to need approval. Offline tracking is included.
- **Activity.** It counts keystrokes and mouse activity, never content. It records apps and URLs and rates each productive, unproductive or neutral. After a timeout with no input it asks "Are you working?". Idle time is reported but never deducted.
- **Screenshots.** Taken at a random point in each 3–30 minute interval. They can be blurred, and blurring cannot be undone. Employees can be allowed to delete their own. Video recording is Premium only.
- **Reports.**
  - Report list: Activity Summary, Hours Tracked, Projects & Tasks, Timeline, Web & App Usage, Attendance, Unusual Activity, Custom Export (PDF, XLS or CSV), Benchmarks AI, Meeting Insights, Office vs Remote, Software Cost, Internet Connectivity.
  - Dashboards: Executive, Team and User.
- **Attendance.** Schedules can be set per user, per day and per time zone. Statuses: Present, Late, Absent, Partially Absent, On Leave, Shift Underway. A 5-minute grace period applies, and employees can give a reason for being late or absent.
- **Leave.** Paid or unpaid requests, approved by a manager. Paid leave flows into payroll.
- **Payroll.** Pay rates and currencies per user. Payroll exports for PayPal, Wise, Payoneer, Gusto, ADP, Deel and Xero. A client-login role. No native invoicing.
- **Approvals.** Manual time can require approval, and unapproved time is hidden from reports. Entries under a threshold (up to 15 minutes) are approved automatically. Leave requests use the same page.
- **Alerts.** Daily, weekly and real-time emails for unproductive time, late start, manual time, idle time and attendance.
- **Integrations.** A browser extension adds a timer button to about 40 tools, including Jira (two-way worklogs), Asana, Trello, ClickUp, GitHub and Salesforce. HRIS integrations: ADP, BambooHR, Rippling, Workday. Public API (5,000 requests per hour). SAML SSO plus SCIM provisioning.
- **Platforms.**
  - Desktop tracking on Windows, macOS and Ubuntu.
  - A ChromeOS app.
  - Mobile apps on iOS and Android, which are a manual timer only: no screenshots and no GPS.
- **Fraud and wellbeing.** "Unusual Activity" flags mouse movement with no clicks, extreme click counts, input that is suspiciously regular, and long keyboard use with no mouse. A "work-life balance" widget flags long days, late hours, work outside the schedule, and weekend work.

## Where TimeTrack stands

| Area                                   | TimeTrack today                                                                             | Gap                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Time tracking, projects and tasks      | ✅ Start, pause and stop; hotkey; offline buffer; crash recovery                            | none                                                                              |
| Screenshots                            | ✅ Interval 5–60 min, server-side blur, multiple monitors, employee redaction with a reason | Time Doctor randomises the shot within the interval                               |
| Activity and apps                      | ✅ Counts only; app and window title; productive and unproductive lists per team            | **Windows has no browser-site categorization**                                    |
| Idle                                   | ✅ "Keep or discard" prompt, idle events, idle nudge                                        | none                                                                              |
| Distraction nudge                      | ✅ macOS only (local)                                                                       | **Missing on Windows**                                                            |
| Approvals                              | ✅ Weekly timesheets, approve or flag, auto-approve                                         | Manual entries are audited, not approved one by one                               |
| Reports and export                     | ✅ Overview, trends, team, projects, app usage, CSV                                         | No PDF or XLS, no scheduled reports, no attendance report                         |
| Attendance and schedules               | ❌                                                                                          | Missing                                                                           |
| Leave / time off                       | ❌                                                                                          | Missing                                                                           |
| Payroll, rates, billable time, clients | ❌                                                                                          | Missing. A PRD §2 goal is "defensible time records for billing/payroll"           |
| Manager alerts                         | Two weekly emails                                                                           | Limited on purpose (PRD §6.4). Needs a product decision                           |
| Integrations, API, webhooks            | ❌                                                                                          | JWT-authenticated `/v1` only                                                      |
| SSO                                    | One OIDC provider                                                                           | No SAML, no SCIM                                                                  |
| Platforms                              | macOS, Windows (unsigned pilot)                                                             | No Linux, no browser extension                                                    |
| Unusual activity                       | ❌                                                                                          | `ActivitySample` stores only `activityPct`. Needs separate key and pointer counts |
| Work-life balance                      | ❌                                                                                          | Could be built from data we already store                                         |

## Recommended order

### 0. Finish what is half-shipped

- **The Phase 2 release gate.** Apple signing, notarization and the manual end-to-end run (`docs/phase-2-release-checklist.md`). There is no production deploy yet.
- **Windows parity with macOS.** Browser-site categorization and the distraction nudge. The code signing certificate and the open manual rows in `apps/client-windows/ROADMAP.md` are also outstanding.
- **Login item** on macOS (PR #168) has never been verified on real hardware.

### 1. High value, fits the current architecture

1. **Schedules and attendance.** A `Schedule` model, a daily worker job that assigns statuses, and an attendance report.
2. **Leave / time off**, going through the existing `/approvals` flow.
3. **Per-entry approval of manual time**, with an auto-approve threshold.
4. **Pay rates and a payroll CSV**, plus a billable flag and clients on projects.
5. **Configurable manager alerts** and daily digests. Needs a product decision against PRD §6.4 first.
6. **PDF and XLS export and scheduled emailed reports.** PDF would need a new dependency, which needs approval first.

### 2. Cheap, and consistent with our employee-first positioning

- **Work-life balance widget.** Long days, late hours and weekend work, computed from data we already have.
- **Unusual activity (jiggler) detection.** Needs a schema change and a contract change to store separate key and pointer counts. Shipped clients pin `/v1`, so the new fields must be optional.

### 3. Later / enterprise

- A public API with API keys and webhooks, or a Jira worklog integration.
- SAML and SCIM.
- A Linux client and a browser extension.

## What we will not copy

- **The "Automatic" app (no interface, cannot be paused, silent deployment).** This is forbidden by CLAUDE.md §1: the indicator is mandatory and there is no stealth mode.
- **Benchmarks AI and AI productivity scoring.** A non-goal in PRD §3. Peer benchmarks also need data from many companies, which a self-hosted single-tenant product does not have.
- **GPS on mobile.** Forbidden by CLAUDE.md §1.
- **Continuous video recording.** Not forbidden, but it needs a product decision about privacy and making sure the employee can always see it too.

## Where we are already ahead

- Employees can redact a screenshot and give a reason. Time Doctor only allows deletion, and only if the employer turns it on.
- The monitoring-acknowledgement gate is enforced in code, with no admin override.
- URLs and hosts are never stored. They are used only to categorize activity on the client.
- It is self-hosted, so the data stays on the customer's own infrastructure.

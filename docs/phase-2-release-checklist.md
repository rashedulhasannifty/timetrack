# Phase 2 — Release-gate checklist (self-view + capture)

The PRD §11 hard gate: **Phase 2 does not ship until the employee self-view ships _with_
capture.** All the automatable gates are green; what remains is a manual GUI-login E2E that
needs a real macOS session, plus the pre-distribution signing work. This doc is the pre-ship
runbook.

Companion to [`docs/plans/phase-2-monitoring.md`](./plans/phase-2-monitoring.md) (slice 2.4 +
the §11 gate line).

---

## 1. Automatable gates — ✅ verified on current `main` (`2a28f50`, 2026-08-18)

Server-side gates cite the CI run rather than a hand-copied count, so this table cannot go
stale again the way it did between 2026-08-06 and 2026-08-18.

| Gate                                                           | Result                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Monorepo `pnpm lint && typecheck && test && build`             | green — CI run [32135018994][ci] (`verify`, 2m25s)                      |
| API + contracts coverage gates (Testcontainers, real PG/Redis) | green — same run; ≥80% enforced, build fails below it                   |
| Worker e2e (BullMQ processors, real PG/Redis/MinIO)            | ⚠️ **not covered by CI** — see the note below                           |
| Client `swift build -c release` (Xcode toolchain)              | clean, ~20s from cold                                                   |
| Client `swift test`                                            | **294/294**, 0 failures                                                 |
| `scripts/package-app.sh` → `dist/Nifty Timer.app` assembles    | ✓ — bundle id `com.niftyitsolution.niftytimer`, production URLs stamped |
| Bundle launch smoke (starts, stays alive, no startup crash)    | ✓                                                                       |

[ci]: https://github.com/rashedulhasannifty/timetrack/actions/runs/32135018994

> ⚠️ **Worker e2e never runs in CI.** Every worker e2e spec is `describe.runIf(RUN_E2E)`, and
> no workflow sets `RUN_E2E=1` outside the api's own `test:coverage` script — so `pnpm test`
> skips all of them and the run still reports green. They have to be run by hand:
> `RUN_E2E=1 pnpm --filter @timetrack/worker test:e2e` (needs Docker). Treat the worker as
> unverified by CI until that is wired up.

> Build note: on a dev Mac `xcode-select -p` often points at CommandLineTools, which has no
> XCTest, so local runs need `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. CI
> runners default to a full Xcode and need no override.

The 2026-07/08 dependency upgrades (eslint 10, boundaries 7, testcontainers 12, aws-sdk, CI
actions) do **not** touch the Swift client — it is outside the pnpm graph.

---

## 2. Manual GUI-login E2E — ⬜ the human-only gate (you run this)

Needs a logged-in macOS desktop session (notifications + a visible menu bar). Steps come from
slice 2.4 and PRD §10.

### 2a. Environment to stand up first

- [ ] Backend up: `docker compose -f infra/docker-compose.yml up -d` (postgres, redis, minio),
      then `pnpm dev` (api + worker + dashboard).
- [ ] A seeded user; **acknowledge the monitoring policy in the client** so `monitoringAckAt`
      is set (capture cannot start before this — that is the whole point of `AckGate`).
- [ ] Launch `apps/client-macos/dist/Nifty Timer.app`; grant **Screen Recording**,
      **Accessibility**, and **Notifications** when prompted.

### 2b. Idle & focus nudges (slice 2.4)

- [ ] **Idle nudge (auto mode)** — with auto-tracking on, leave the machine idle past
      `idleThresholdMinutes`: an "Idle for X min — still working?" notification appears **as the
      menu-bar clock auto-stops**.
- [ ] **Forgot-to-start (manual mode)** — in manual mode, be active without tracking for ~10 min:
      the "forgot to start tracking" reminder fires.
- [ ] **Manual-idle (manual mode)** — while tracking manually, go idle: a "still tracking?"
      **notify-only** nudge appears and the **menu-bar clock keeps running** (it must never stop
      the clock in manual mode).
- [ ] **End-of-day summary** — at 18:00 local, a "Today: ~Xh Ym tracked" notification fires.
- [ ] ⚠️ **Sign-out clears Notification Center** — the cross-user-leak class. Sign out and confirm
      **all pending + delivered notifications are cleared**, so nothing from the prior user
      surfaces in the next session. This has regressed twice historically — observe it live.
- [ ] Documented boundary (expected, not a bug): a manual **Start** under an
      `autoStartOnLogin = true` config gets **no** manual-idle nudge.

### 2c. Self-view WITH capture (the §11 gate itself)

- [ ] **Ack gate holds** — a user who has **not** acknowledged: no screenshots, no activity
      samples captured. After ack: capture starts.
- [ ] **Screenshots end-to-end** — a captured screenshot uploads and appears in the employee's
      **own** `/me` → Screenshots tab (presigned, readable by the employee).
- [ ] **Activity end-to-end** — activity samples roll up and render in `/me` → Activity
      (per-day %, top apps, category mix).
- [ ] **Transparency parity** — everything a manager can see about the employee
      (`people/[userId]`), the employee sees about themselves. No manager-only surface.
- [ ] **Ethics live-check** — the menu-bar indicator is always visible (no stealth); confirm logs
      carry **no** raw screenshot bytes and **no** `windowTitle` (redaction in `packages/logger`).

---

## 3. Pre-distribution blockers — ⬜ before shipping to employees

Two of the three original blockers are now closed; the remaining one is an account problem,
not a repo problem:

- [x] **Real bundle id.** `Info.plist` carries `com.niftyitsolution.niftytimer` (was the
      `com.example.timetrack` placeholder), and `package-app.sh` defaults to it. TCC grants key
      off bundle id + signing identity, so this had to land before any signing.
- [ ] **Real signing + notarization.** ⛔ Blocked on the **expired Apple Developer membership**
      (`SIGNING.md`) — an expired membership can issue neither a Developer ID Application
      certificate nor a notarization ticket. Until it is renewed the pilot ships unnotarized on
      an _Apple Development_ identity. Note that the cutover cannot be delivered by auto-update:
      `UpdateInstaller` checks a candidate against the running app's designated requirement,
      which pins the leaf certificate CN, so an identity change requires a manual reinstall.
- [x] **Stable dev signing for the §2 dry-run.** `package-app.sh` now auto-selects a stable
      identity deterministically (Developer ID first, else Apple Development, fingerprints
      sorted) instead of falling back to ad-hoc, so a granted permission survives a rebuild.
      With more than one identity installed it prints which it picked — pin the intended one
      with `CODESIGN_IDENTITY`, since switching identity between rebuilds re-triggers the TCC
      prompt on its own.

Build → sign → notarize → staple (full runbook:
[`apps/client-macos/SIGNING.md`](../apps/client-macos/SIGNING.md)):

```bash
cd apps/client-macos
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer ./scripts/package-app.sh
DEVELOPER_ID_APP="Developer ID Application: <Org> (TEAMID)" NOTARY_PROFILE=timetrack \
  ./scripts/sign-and-notarize.sh
```

---

## 4. Flip the gate

When §2 and §3 are all checked:

- [ ] Tick **"Release bundles self-view with capture (PRD §11 gate)"** in
      `docs/plans/phase-2-monitoring.md` and flip slice **2.4** from `[~]` to `[x]`.

(The previously-stale 2.2 box — the screenshot pipeline was in fact shipped — has already been
corrected to `[x]`, so the §11 gate box is the only one left open in that plan.)

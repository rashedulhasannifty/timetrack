# Phase 2 — Release-gate checklist (self-view + capture)

The PRD §11 hard gate: **Phase 2 does not ship until the employee self-view ships _with_
capture.** All the automatable gates are green; what remains is a manual GUI-login E2E that
needs a real macOS session, plus the pre-distribution signing work. This doc is the pre-ship
runbook.

Companion to [`docs/plans/phase-2-monitoring.md`](./plans/phase-2-monitoring.md) (slice 2.4 +
the §11 gate line).

---

## 1. Automatable gates — ✅ verified on current `main` (`673e96b`, 2026-08-06)

| Gate                                                        | Result                                  |
| ----------------------------------------------------------- | --------------------------------------- |
| Monorepo `pnpm lint && typecheck && test && build`          | green                                   |
| API integration/e2e (Testcontainers, real PG/Redis/MinIO)   | 139/139                                 |
| Worker e2e                                                  | 16/16                                   |
| Client `swift build -c release` (Xcode toolchain)           | clean (only `#selector` style warnings) |
| Client `swift test`                                         | **232/232**, 0 failures                 |
| `scripts/package-app.sh` → `dist/TimeTrack.app` assembles   | ✓                                       |
| Bundle launch smoke (starts, stays alive, no startup crash) | ✓                                       |

> Build note: `xcode-select -p` points at CommandLineTools; the client needs the full SDK, so
> build with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

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
- [ ] Launch `apps/client-macos/dist/TimeTrack.app`; grant **Screen Recording**,
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

The built bundle is a **dev** bundle. Two things must change before it goes to real machines:

- [ ] **Bundle id is a placeholder.** `apps/client-macos/Info.plist:13` is
      `com.example.timetrack`. Change it to a real reverse-DNS id owned by the team **before**
      signing — TCC permission grants (Screen Recording, etc.) key off bundle id + signing
      identity, and notarization requires a real one.
- [ ] **Real signing + notarization.** The machine currently has only _Apple Development_
      identities; distribution needs a **Developer ID Application** certificate and a `notarytool`
      keychain profile, then:
      `bash
    cd apps/client-macos
    DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer ./scripts/package-app.sh
    DEVELOPER_ID_APP="Developer ID Application: <Org> (TEAMID)" NOTARY_PROFILE=timetrack \
      ./scripts/sign-and-notarize.sh
    `
      Full runbook: [`apps/client-macos/SIGNING.md`](../apps/client-macos/SIGNING.md).
- [ ] For a smoother multi-run E2E in §2, sign the dev bundle with a **stable**
      `CODESIGN_IDENTITY` (either _Apple Development_ identity from
      `security find-identity -v -p codesigning`) so macOS doesn't re-prompt for Screen Recording
      on every rebuild. Ad-hoc (the default) re-prompts each rebuild.

---

## 4. Flip the gate

When §2 and §3 are all checked:

- [ ] Tick **"Release bundles self-view with capture (PRD §11 gate)"** in
      `docs/plans/phase-2-monitoring.md` and flip slice **2.4** from `[~]` to `[x]`.
- [ ] Also correct the two stale `[ ]` boxes in that plan — 2.2 (screenshot pipeline) is in fact
      shipped (`apps/api/src/modules/screenshots`, worker `screenshot-process`/`screenshot-derive`).

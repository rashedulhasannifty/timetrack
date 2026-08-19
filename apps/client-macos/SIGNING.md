# Signing, notarization & distribution — macOS client

The client is distributed outside the App Store as a **Developer ID**, **notarized**,
**Hardened Runtime** app so Gatekeeper runs it on employee machines without warnings.

> **Scope:** signing + notarization are wired now. The **auto-update channel has since
> shipped** — not the Sparkle/EdDSA design once planned here, but a GitHub-releases feed
> verified by SHA-256 **and** the running app's designated requirement
> (`Sources/TimeTrack/Update/`). See "Auto-update channel" below.

Team: **Nifty IT Solution Ltd.** — Team ID **`4XCMVF4S5P`**, enrolled as an **Organization**
(account holder: AHMAD SYED ANWAR). Bundle id **`com.niftyitsolution.niftytimer`** (the committed
default in `Info.plist`; overridable at package time via `BUNDLE_ID`).

> **Account status — the membership is EXPIRED.** Its renewal date was **28 August 2023**. An
> expired membership cannot issue a Developer ID certificate and cannot notarize, so everything
> from "Prerequisites" onward is blocked until it is renewed (US$99/yr).
>
> Until then the pilot ships **unnotarized** — follow
> **[Pilot distribution](#pilot-distribution--current-mode)** below. Everything _except_ the
> certificate (bundle id, URLs, the package/sign scripts, entitlements) is already wired and
> needs no account.

> **Two different teams — don't mix them up.** The org membership above (`4XCMVF4S5P`) is the
> one that matters for distribution, and it is currently dormant. The **Apple Development**
> certificates installed on the dev Macs are a separate personal team, **`S38GJ3X9AR`**
> (`O=AHMAD SYED ANWAR`), on the account holder's individual Apple ID. The pilot is signed with
> that personal team; production will be signed with the org team. They are unrelated
> identities, which is exactly why the cutover re-prompts every machine — see
> [The cutover costs one re-grant per Mac](#the-cutover-costs-one-re-grant-per-mac).

## Pilot distribution — current mode

Testing on ~10–20 internal Macs before committing to the membership renewal. The pilot build is
signed with the team's **Apple Development** certificate and is **not notarized**.

### What that signature does and does not buy

|                                           | Apple Development (pilot) | Developer ID + notarized (later) |
| ----------------------------------------- | ------------------------- | -------------------------------- |
| App runs                                  | ✅                        | ✅                               |
| Screen Recording grant survives a rebuild | ✅ stable identity        | ✅                               |
| First launch after a download             | ⚠️ blocked once           | ✅ silent                        |

The block is Gatekeeper, and **only notarization clears it** — self-signing does not, and neither
does adding a self-signed root to the System keychain as "Always Trust". `spctl --add`
allowlisting is Recovery-gated and not an option either. The workaround is the one-time step in
[Installing on a pilot Mac](#installing-on-a-pilot-mac-send-this-to-the-tester).

### The cutover costs one re-grant per Mac

TCC stores the app's _designated requirement_, which pins the signing identity — not just the
bundle id:

```bash
$ codesign -d -r- "dist/Nifty Timer.app"
designated => identifier "com.niftyitsolution.niftytimer" and anchor apple generic
  and certificate leaf[subject.CN] = "Apple Development: developers@niftyitsolution.com (DUGT7JB37J)"
  and certificate 1[field.1.2.840.113635.100.6.2.1]
```

Re-signing with Developer ID changes that leaf CN, so **every pilot Mac re-grants Screen
Recording when the notarized build lands**. That is accepted here: the cutover coincides with
starting on a fresh production database, so pilot machines are being reset anyway.

The rule that follows: **do not change signing identity mid-pilot.** Swapping certs (or letting
the auto-pick drift) spends that same re-grant for nothing.

### Build the pilot artifact

Pin the identity by fingerprint. `package-app.sh` auto-picks deterministically, but the pick
changes if a certificate is added to or removed from the signing host's keychain — and a changed
identity re-prompts every tester.

```bash
cd apps/client-macos

# Sign with "Apple Development: developers@niftyitsolution.com (DUGT7JB37J)".
# Confirm the fingerprint still matches: security find-identity -v -p codesigning
CODESIGN_IDENTITY=18FCAD844204EED21C099C0A90E762106D55264F ./scripts/package-app.sh

# Pack the zip AND the .sha256 sidecar the updater verifies against. Both asset names are
# part of the contract: GitHubReleaseFeed looks for NiftyTimer-pilot.zip and refuses a release
# that has no matching .sha256, so a hand-rolled zip under any other name publishes a release
# that is invisible to every installed client.
./scripts/release-assets.sh
```

The packaging defaults already point at the pilot deployment
(`https://timer.niftyitsolution.com/v1`); override `API_BASE_URL` / `DASHBOARD_URL` only to aim a
build at a local stack.

Verify before you send it out:

```bash
codesign --verify --deep --strict "dist/Nifty Timer.app"   # → valid on disk
codesign -dvv "dist/Nifty Timer.app" 2>&1 | grep Timestamp # → secure timestamp present
```

`spctl -a -vvv --type exec` reports **`rejected`** on a pilot build. That is expected, not a
defect — it is the notarization check, and it is exactly what the tester's one-time step clears.

Then actually launch it — `codesign` only proves the bundle is _signed_, not that it _runs_.
This matters more than it looks: `package-app.sh` hand-assembles the bundle from a SwiftPM
binary, and a real bundle exercises code paths `swift run` and `swift test` never reach (a
bundle id exists, so `UNUserNotificationCenter` behaves differently). Smoke-test before sending:

```bash
open "dist/Nifty Timer.app" && sleep 5 && pgrep -lf "Nifty Timer.app"   # → still running, menu bar item visible
log show --last 1m --predicate 'process == "TimeTrack"' | grep -iE 'error|fault|abort'
```

### Installing on a pilot Mac (send this to the tester)

1. Unzip the file — but **don't open the app yet**.
2. Clear the download quarantine flag _before_ moving or launching it:
   ```bash
   xattr -dr com.apple.quarantine "~/Downloads/Nifty Timer.app"
   ```
   Adjust the path to wherever you unzipped it. Harmless if the flag was never set.
3. Drag **Nifty Timer.app** into **/Applications** and launch it.
4. **If you see "Nifty Timer cannot be opened because the developer cannot be verified"** — the
   flag was still set. Open **System Settings → Privacy & Security**, scroll to the Security
   section, click **Open Anyway** next to Nifty Timer, and launch again. On macOS 15+ the old
   Ctrl-click → Open shortcut no longer works. Once per machine.
5. Sign in, then **acknowledge the monitoring policy**. Nothing is captured until you do — that
   gate has no admin override (`Policy/AckGate`).
6. Grant **Screen Recording** when prompted. This is the only permission the app asks for; it
   does not use Accessibility or Input Monitoring. Until it is granted the menu bar item shows a
   visible warning and time tracking continues without screenshots.

Shipping the zip over Slack/Drive/Mail sets the quarantine flag, which is what step 2 removes.
`scp`/`rsync` does not set it.

### At cutover (membership renewed)

1. **Renew the membership** — it lapsed on 28 August 2023. Renew the **organization** account
   (Nifty IT Solution Ltd., `4XCMVF4S5P`), not the account holder's personal team; a Developer ID
   certificate can only be issued under the org enrollment.
2. Issue the **Developer ID Application** certificate under `4XCMVF4S5P` and run the full
   `package-app.sh` → `sign-and-notarize.sh` path below. Its identity string will carry the legal
   entity name, i.e. `Nifty IT Solution Ltd.` — copy it verbatim from `security find-identity`
   rather than typing it, since `codesign` matches the CN exactly.
3. Keep the bundle id `com.niftyitsolution.niftytimer` unchanged.
4. Warn testers to expect one Screen Recording re-prompt, and to delete any stale Nifty Timer row
   left behind in System Settings → Privacy & Security → Screen Recording.
5. **Ship the cutover build manually — auto-update cannot carry it.** `UpdateInstaller` validates
   a candidate against the _running_ app's designated requirement, and that requirement pins the
   leaf certificate CN. A Developer ID-signed build therefore fails `signatureRejected` on every
   pilot Mac running an Apple Development-signed one. The identity change has to be a reinstall;
   auto-update resumes for releases after it.

---

## Prerequisites (yours to provide — never committed)

1. **Active Apple Developer Program** membership — currently **expired**, see the note above.
2. A **Developer ID Application** certificate created in the Apple Developer portal and
   installed in your login keychain. Find its identity string with:
   ```bash
   security find-identity -v -p codesigning
   # → "Developer ID Application: Nifty IT Solution Ltd. (4XCMVF4S5P)"
   ```
   (The org name must match the certificate exactly — copy it from the command's output. Note
   the legal entity is `Nifty IT Solution Ltd.`, with the `Ltd.`)
3. **Xcode command line tools** (`codesign`, `xcrun notarytool`, `stapler`).
4. A **notarytool keychain profile** (store your Apple ID + team + app-specific password
   once, so the script never sees a raw secret):
   ```bash
   xcrun notarytool store-credentials timetrack \
     --apple-id developers@niftyitsolution.com --team-id 4XCMVF4S5P --password <app-specific-password>
   ```
   Generate the `<app-specific-password>` at appleid.apple.com → Sign-In & Security.

> **Sign once, centrally.** Developer ID signing + notarization are team-scoped (Team ID
> `4XCMVF4S5P`), not per-person — so even though the dev Macs share the
> `developers@niftyitsolution.com` Apple ID, you sign and notarize the bundle on **one** machine
> (or CI) and distribute that artifact. You do not sign per developer machine; only the signing
> host needs the Developer ID Application certificate's private key in its keychain.

## Build → sign → notarize → staple

```bash
cd apps/client-macos

# 1. Build a release binary and assemble "dist/Nifty Timer.app". The committed defaults ALREADY
#    point at production (package-app.sh: a build that silently talks to 127.0.0.1 is the worse
#    failure), so these are only needed to override them:
BUNDLE_ID=com.niftyitsolution.niftytimer \
API_BASE_URL=https://<your-prod-domain>/v1 \
DASHBOARD_URL=https://<your-prod-domain> \
./scripts/package-app.sh

# 2. Sign (Developer ID + hardened runtime + entitlements), notarize, staple
DEVELOPER_ID_APP="Developer ID Application: Nifty IT Solution Ltd. (4XCMVF4S5P)" \
NOTARY_PROFILE=timetrack \
./scripts/sign-and-notarize.sh

# 3. Confirm Gatekeeper acceptance
spctl -a -vvv --type exec "dist/Nifty Timer.app"
codesign --verify --deep --strict --verbose=2 "dist/Nifty Timer.app"
```

The bundle id is baked into TCC permission grants, so keep it fixed once employees have
granted Screen Recording — changing it later re-prompts everyone. So does changing the signing
identity; see [the cutover cost](#the-cutover-costs-one-re-grant-per-mac).

## Why these choices

- **Hardened Runtime** (`codesign --options runtime`) is required for notarization.
- **Not App-Sandboxed** (`TimeTrack.entitlements`): the sandbox would block ScreenCaptureKit
  and `CGWindowListCopyWindowInfo`. Developer ID distribution does not require the sandbox.
- **`--timestamp`**: a secure timestamp so signatures remain valid after the cert expires.
  Both `package-app.sh` and `sign-and-notarize.sh` pass it (ad-hoc signing skips it — no cert).
- **Screen Recording** is the _only_ TCC permission the client needs — granted in System
  Settings at first use, not an Info.plist string. It does **not** use Accessibility or Input
  Monitoring: `Activity/EventCounter` reads `CGEventSource.counterForEventType` (passive
  counters, no event tap), which is why counts-not-content is enforced by the API choice and not
  just by policy. Capture never starts until Screen Recording is granted **and** the policy is
  acknowledged (`Policy/AckGate`).

## What has been verified here vs. what needs your account

- ✅ `package-app.sh` builds the release binary and assembles a valid `.app` bundle.
- ✅ `BUNDLE_ID` / `API_BASE_URL` / `DASHBOARD_URL` injection verified: a plain build keeps the
  committed defaults (`com.niftyitsolution.niftytimer` + the production URLs), and an
  env-overridden build stamps the bundle's `Info.plist` with the values passed in.
- ✅ The `codesign` invocation + entitlements were validated with an **ad-hoc** signature
  (`codesign --sign -`) — the bundle is well-formed and signable (`--verify --strict` passes).
- ⛔ **Developer ID signing, notarization, and `spctl` acceptance require your certificate
  and notary credentials** and must be run by you — they cannot be produced or tested
  without an Apple Developer account.

## CI (later)

Signing/notarization runs on a **macOS runner** with the certificate imported into a
temporary keychain and `DEVELOPER_ID_APP` / notary credentials provided as encrypted
secrets. This is intentionally **not** part of the Linux `verify` job.

## Auto-update channel — shipped (not Sparkle)

Sparkle + an EdDSA-signed appcast was the original plan. What shipped instead is in
`Sources/TimeTrack/Update/`: `UpdateFeed` reads the newest release from the public
distribution repo over the unauthenticated GitHub API (no token ships inside a binary that
sits on employee laptops), and `UpdateInstaller` gates the swap on two independent checks —
the published SHA-256, and the running app's designated requirement. `release-assets.sh`
publishes `NiftyTimer-pilot.zip` alongside its `.sha256`; a release missing the digest is
refused rather than trusted.

The always-visible indicator and `AckGate` remain in every build — there is no update or
target that removes them.

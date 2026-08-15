# Signing, notarization & distribution — macOS client

The client is distributed outside the App Store as a **Developer ID**, **notarized**,
**Hardened Runtime** app so Gatekeeper runs it on employee machines without warnings.

> **Scope (per the current decision):** signing + notarization are wired now; the signed
> **auto-update channel (Sparkle + EdDSA appcast) is deferred** to a later slice. See the
> "Deferred" section for where it plugs in.

Team: **Nifty IT Solution** — Team ID **`4XCMVF4S5P`**. Bundle id **`com.niftyitsolution.timetrack`**
(the committed default in `Info.plist`; overridable at package time via `BUNDLE_ID`).

> **We are not there yet.** The membership is not currently active, so the pilot ships
> **unnotarized**, signed with the team's Apple Development certificate. See
> **[Pilot distribution](#pilot-distribution--current-mode)** below — that is the section to
> follow today. Everything from "Prerequisites" onward is the post-renewal path.

> **Account status:** signing + notarization require an **active** Apple Developer Program
> membership. If the membership has lapsed, **renew it first** — an expired account cannot
> issue a Developer ID certificate or notarize. Everything _below the certificate_ (bundle id,
> URLs, the package/sign scripts, entitlements) is already wired and needs no account.

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
$ codesign -d -r- dist/TimeTrack.app
designated => identifier "com.niftyitsolution.timetrack" and anchor apple generic
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

# ditto, not zip — it preserves the bundle's signature
( cd dist && ditto -c -k --keepParent TimeTrack.app TimeTrack-pilot.zip )
```

The packaging defaults already point at the pilot deployment
(`https://timer.niftyitsolution.com/v1`); override `API_BASE_URL` / `DASHBOARD_URL` only to aim a
build at a local stack.

Verify before you send it out:

```bash
codesign --verify --deep --strict dist/TimeTrack.app   # → valid on disk
codesign -dvv dist/TimeTrack.app 2>&1 | grep Timestamp # → secure timestamp present
```

`spctl -a -vvv --type exec` reports **`rejected`** on a pilot build. That is expected, not a
defect — it is the notarization check, and it is exactly what the tester's one-time step clears.

### Installing on a pilot Mac (send this to the tester)

1. Unzip and drag **TimeTrack.app** into **/Applications**.
2. Clear the download quarantine flag:
   ```bash
   xattr -dr com.apple.quarantine /Applications/TimeTrack.app
   ```
   Harmless if the flag was never set. Doing this means you can skip step 3.
3. _Only if you skipped step 2_ — launch fails with "cannot be opened because the developer
   cannot be verified". Open **System Settings → Privacy & Security**, scroll to the Security
   section, and click **Open Anyway** next to TimeTrack. On macOS 15+ the old Ctrl-click → Open
   shortcut no longer works. Once per machine.
4. Launch it, sign in, and **acknowledge the monitoring policy**. Nothing is captured until you
   do — that gate has no admin override (`Policy/AckGate`).
5. Grant **Screen Recording** when prompted. This is the only permission the app asks for; it
   does not use Accessibility or Input Monitoring. Until it is granted the menu bar item shows a
   visible warning and time tracking continues without screenshots.

Shipping the zip over Slack/Drive/Mail sets the quarantine flag, which is what step 2 removes.
`scp`/`rsync` does not set it.

### At cutover (membership renewed)

1. Check which team the renewed membership is under. The certs installed today are team
   `S38GJ3X9AR` (`O=AHMAD SYED ANWAR`) — **not** the `4XCMVF4S5P` recorded at the top of this
   file. Reconcile that before issuing the certificate, and correct this file to match.
2. Issue the **Developer ID Application** certificate and run the full
   `package-app.sh` → `sign-and-notarize.sh` path below.
3. Keep the bundle id `com.niftyitsolution.timetrack` unchanged.
4. Warn testers to expect one Screen Recording re-prompt, and to delete any stale TimeTrack row
   left behind in System Settings → Privacy & Security → Screen Recording.

---

## Prerequisites (yours to provide — never committed)

1. **Active Apple Developer Program** membership (see the note above).
2. A **Developer ID Application** certificate created in the Apple Developer portal and
   installed in your login keychain. Find its identity string with:
   ```bash
   security find-identity -v -p codesigning
   # → "Developer ID Application: Nifty IT Solution (4XCMVF4S5P)"
   ```
   (The org name must match the certificate exactly — copy it from the command's output.)
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

# 1. Build a release binary and assemble dist/TimeTrack.app. For a DISTRIBUTION build, point
#    it at the production deployment (defaults are the dev/localhost values in Info.plist):
BUNDLE_ID=com.niftyitsolution.timetrack \
API_BASE_URL=https://<your-prod-domain>/v1 \
DASHBOARD_URL=https://<your-prod-domain> \
./scripts/package-app.sh

# 2. Sign (Developer ID + hardened runtime + entitlements), notarize, staple
DEVELOPER_ID_APP="Developer ID Application: Nifty IT Solution (4XCMVF4S5P)" \
NOTARY_PROFILE=timetrack \
./scripts/sign-and-notarize.sh

# 3. Confirm Gatekeeper acceptance
spctl -a -vvv --type exec dist/TimeTrack.app
codesign --verify --deep --strict --verbose=2 dist/TimeTrack.app
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
  committed dev defaults (`com.niftyitsolution.timetrack` + localhost), and an env-overridden
  build stamps the bundle's `Info.plist` with the distribution values.
- ✅ The `codesign` invocation + entitlements were validated with an **ad-hoc** signature
  (`codesign --sign -`) — the bundle is well-formed and signable (`--verify --strict` passes).
- ⛔ **Developer ID signing, notarization, and `spctl` acceptance require your certificate
  and notary credentials** and must be run by you — they cannot be produced or tested
  without an Apple Developer account.

## CI (later)

Signing/notarization runs on a **macOS runner** with the certificate imported into a
temporary keychain and `DEVELOPER_ID_APP` / notary credentials provided as encrypted
secrets. This is intentionally **not** part of the Linux `verify` job.

## Deferred — signed auto-update channel (Sparkle)

When we add updates: integrate **Sparkle**, host an **appcast** signed with an **EdDSA**
key, ship the public key in `Info.plist` (`SUPublicEDKey`), and have `sign-and-notarize.sh`
also sign the update archive. The always-visible indicator and `AckGate` remain in every
build — there is no update or target that removes them.

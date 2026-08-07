# Signing, notarization & distribution — macOS client

The client is distributed outside the App Store as a **Developer ID**, **notarized**,
**Hardened Runtime** app so Gatekeeper runs it on employee machines without warnings.

> **Scope (per the current decision):** signing + notarization are wired now; the signed
> **auto-update channel (Sparkle + EdDSA appcast) is deferred** to a later slice. See the
> "Deferred" section for where it plugs in.

Team: **Nifty IT Solution** — Team ID **`4XCMVF4S5P`**. Bundle id **`com.niftyitsolution.timetrack`**
(the committed default in `Info.plist`; overridable at package time via `BUNDLE_ID`).

> **Account status:** signing + notarization require an **active** Apple Developer Program
> membership. If the membership has lapsed, **renew it first** — an expired account cannot
> issue a Developer ID certificate or notarize. Everything _below the certificate_ (bundle id,
> URLs, the package/sign scripts, entitlements) is already wired and needs no account.

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
granted Screen Recording / Accessibility — changing it later re-prompts everyone.

## Why these choices

- **Hardened Runtime** (`codesign --options runtime`) is required for notarization.
- **Not App-Sandboxed** (`TimeTrack.entitlements`): the sandbox would block ScreenCaptureKit
  and the Accessibility API. Developer ID distribution does not require the sandbox.
- **`--timestamp`**: a secure timestamp so signatures remain valid after the cert expires.
- **Screen Recording / Accessibility** are TCC permissions the user grants in System
  Settings at first use — not Info.plist strings. Capture never starts until granted **and**
  the policy is acknowledged (`Policy/AckGate`).

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

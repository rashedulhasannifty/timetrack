# Code signing — Nifty Timer for Windows

**The pilot ships unsigned.** This document is what to do about that, and how to switch signing on
without rewriting the release pipeline.

## What unsigned costs, concretely

- **SmartScreen warns on first run.** The person sees "Windows protected your PC" and has to click
  **More info → Run anyway**. The dashboard's Windows install page walks through this, because a
  security warning with no explanation is exactly the thing that makes people abandon an install —
  or, worse, teaches them to click through warnings.
- **Some enterprise AV and EDR treat unsigned binaries more harshly**, particularly one that
  registers for raw input. That is a friction the macOS client never had.
- **The updater is stricter, not laxer, because of it.** `UpdateInstaller` verifies the published
  SHA-256 and then applies a publisher **transition** rule: unsigned may replace unsigned, and a
  publisher may replace itself. Signed → unsigned is refused outright, so a swap can never be the
  moment somebody downgrades a signed install.

## Switching it on

`scripts/sign.ps1` is already wired into the release flow and is a **no-op with a warning** until a
certificate is configured. That shape is deliberate: a step that failed hard on a missing
certificate would have been commented out, and a commented-out step never gets switched back on.

Set either of these and it starts signing — no pipeline change:

```powershell
# A PFX file (CI: store as a secret, write to a temp path, delete after).
$env:NIFTYTIMER_SIGN_PFX      = 'C:\path\to\cert.pfx'
$env:NIFTYTIMER_SIGN_PASSWORD = '<password>'

# Or a certificate already in the machine store (an HSM or token-backed cert).
$env:NIFTYTIMER_SIGN_THUMBPRINT = '<sha1 thumbprint>'
```

Then:

```powershell
./scripts/package-app.ps1
./scripts/sign.ps1
./scripts/release-assets.ps1
```

Sign **before** `release-assets.ps1`, always. The zip's SHA-256 is computed from its contents, so
signing after it would publish a digest for an unsigned binary and every update would fail its own
checksum check.

## Which certificate

- **OV (Organisation Validation)** — cheaper, but SmartScreen reputation is earned per certificate
  over time and downloads. Early installs will still see the warning.
- **EV (Extended Validation)** — carries SmartScreen reputation immediately, requires a hardware
  token or cloud HSM, and costs more. If the warning is the thing you are buying away, this is the
  one that actually does it.

## The reputation caveat, and why it constrains the certificate

Renewing to a **new** certificate resets SmartScreen reputation. More importantly for us, the
updater's transition rule means a **change of signing identity cannot be delivered by the updater
at all** — the new build would be refused as a different publisher, which is the whole point.

That is not a bug to work around. It is the same trade the macOS client makes, where the designated
requirement pins identity and a signing change requires a manual reinstall. Plan a signing-identity
change as a re-download, and say so in the release notes.

## First real signing run

1. Sign a build and verify it: `signtool verify /pa /v dist\NiftyTimer\NiftyTimer.exe`.
2. Confirm the timestamp is present — without `/tr` the signature stops validating the day the
   certificate expires, including on copies installed long before.
3. Publish it as a normal release. Existing **unsigned** installs will refuse to auto-update to it,
   by design. Tell people to re-download once; after that the updater works normally.

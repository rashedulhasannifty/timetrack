# Publishing the Windows client

How a Windows release gets out, and the one mistake that would break the Mac client for everyone.

Run `./scripts/verify-release-feeds.ps1` before and after any release. Everything below is the
reasoning behind what that script checks.

---

## The trap, first

GitHub exposes exactly **one `releases/latest` per repository**. Three things resolve through the
macOS one and all three require an asset named literally `NiftyTimer-pilot.zip`:

| What                                 | Where                           |
| ------------------------------------ | ------------------------------- |
| The shipped Mac client's update feed | `GitHubReleaseFeed.defaultRepo` |
| The dashboard's Mac download button  | `MacDownloadPlate.DOWNLOAD_URL` |
| The Mac releases link                | `MacDownloadPlate.RELEASES_URL` |

**Publishing a Windows release to the macOS repository makes it `latest`.** Every installed Mac
client goes silently blind to updates and the download button starts answering 404 — and the only
way to fix it is to ship a Mac update through the path that just broke. A Mac client already on
someone's laptop cannot be rolled back.

So the two platforms publish to **separate repositories**. Do not consolidate them, and do not point
the Windows constants at the macOS repo.

## The two repositories

| Platform | Repository                           | Asset                          | Tag shape              |
| -------- | ------------------------------------ | ------------------------------ | ---------------------- |
| macOS    | `rashedulhasansojib/timetrack-app`   | `NiftyTimer-pilot.zip`         | `vX.Y.Z-pilot`         |
| Windows  | `Chishty-NiftyIT/niftytimer-windows` | `NiftyTimer-windows-pilot.zip` | `vX.Y.Z-windows-pilot` |

Both asset names are a **contract**, not a convention: `UpdateFeed` refuses a release whose asset
name does not match, and the `/releases/latest/download/<name>` links 404 on a rename.
`PackagingContractTests` asserts the scripts and the compiled constants still agree, because that
failure is otherwise invisible — publishing succeeds, the release looks right, and every installed
client quietly stops seeing updates.

> **Confirm before creating the repo.** The macOS repo is under a **personal account**
> (`rashedulhasansojib`) while `AppConfig.UpdateRepo` and `WindowsDownloadPlate` are written against
> an **organisation** (`Chishty-NiftyIT`). That asymmetry may be deliberate or may be a leftover. If
> Windows should also live on the personal account, change the two constants **before** the first
> release — an installed client pins whatever it shipped with, exactly like the Mac one.

## Status

`Chishty-NiftyIT/niftytimer-windows` **does not exist yet**, so the Windows feed has never resolved
and checklist row 10 is blocked rather than pending.

Baseline recorded 2026-08-28, before any Windows release:

```
macOS -- rashedulhasansojib/timetrack-app
  tag       : v0.6.0-pilot
  published : 2026-08-27T14:08:16Z
  assets    : NiftyTimer-pilot.zip, NiftyTimer-pilot.zip.sha256
```

Those three lines are the "before" half of row 10. After the first Windows release they must be
**identical**.

## Publishing

```powershell
# 1. Baseline. Keep the output.
./scripts/verify-release-feeds.ps1

# 2. Build and sign. sign.ps1 is a no-op with a warning until a certificate exists (SIGNING.md).
./scripts/package-app.ps1
./scripts/sign.ps1
./scripts/release-assets.ps1        # produces the zip + .sha256 sidecar

# 3. Publish to the WINDOWS repo. Note --repo: omitting it uses the current
#    checkout's origin, which is this monorepo, not the distribution repo.
gh release create v0.6.0-windows-pilot `
  --repo Chishty-NiftyIT/niftytimer-windows `
  --title "Nifty Timer for Windows 0.6.0 (pilot)" `
  dist/NiftyTimer-windows-pilot.zip dist/NiftyTimer-windows-pilot.zip.sha256

# 4. Verify. The macOS lines must be byte-identical to step 1.
./scripts/verify-release-feeds.ps1
```

Exit codes: `0` both feeds resolve and macOS is unaffected (row 10 satisfied) · `1` **the macOS feed
is broken** · `2` Windows not published yet, macOS fine.

### The sidecar is not optional

`UpdateInstaller` verifies the published SHA-256 before swapping a binary, so a release without
`NiftyTimer-windows-pilot.zip.sha256` is one no client will ever install. It fails closed and quietly
— nothing surfaces to the user — which is why the script checks for it explicitly.

### Signing

The pilot is unsigned; SmartScreen warns once on first run. `sign.ps1` is wired in and no-ops with a
warning until a certificate exists. Note from `SIGNING.md`: a signing-identity change **cannot** be
delivered by the updater — the publisher-transition rule refuses signed → unsigned and cross-publisher
swaps by design — so the cutover needs a manual re-download.

## If the Mac feed does break

1. Delete the Windows release from the macOS repository, or mark it a pre-release — `releases/latest`
   ignores pre-releases, which restores the previous release as `latest`.
2. Re-run `./scripts/verify-release-feeds.ps1` and confirm the macOS lines match the baseline.
3. Only then publish to the Windows repository.

Mac clients poll every 6 hours and on menu-open, so a quick fix is unlikely to be noticed. A slow one
will be.

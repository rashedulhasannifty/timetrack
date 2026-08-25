<#
.SYNOPSIS
  Build the release zip and its checksum sidecar.

.DESCRIPTION
  BOTH FILENAMES ARE CONTRACT. GitHubReleaseFeed looks for an asset named exactly
  NiftyTimer-windows-pilot.zip and refuses any release without a matching .sha256 sidecar, so a
  rename here silently stops every installed client from ever seeing another update.

  The digest is a sidecar file rather than a line in the release notes so that publishing is a
  file copy and not a formatting convention a future release can quietly break. For the unsigned
  pilot it is also the only thing standing between the running app and an arbitrary download.

  Publish to the WINDOWS distribution repo, never the one the Mac client reads. GitHub has a
  single releases/latest per repository; a Windows release in the Mac repo becomes latest and
  every installed Mac client goes silently blind to updates.
#>
[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$published = Join-Path $root 'dist/NiftyTimer'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'dist' }

if (-not (Test-Path (Join-Path $published 'NiftyTimer.exe'))) {
  throw "No packaged build at $published. Run package-app.ps1 first."
}

$assetName = 'NiftyTimer-windows-pilot.zip'
$zipPath = Join-Path $OutputDirectory $assetName
$digestPath = "$zipPath.sha256"

if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
if (Test-Path $digestPath) { Remove-Item -Force $digestPath }

Compress-Archive -Path (Join-Path $published '*') -DestinationPath $zipPath

# sha256sum-style output: the client parses either that or a bare digest.
$digest = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash.ToLowerInvariant()
"$digest  $assetName" | Set-Content -Path $digestPath -Encoding ascii -NoNewline

Write-Host "Release assets ready:" -ForegroundColor Green
Write-Host "  $zipPath"
Write-Host "  $digestPath  ($digest)"
Write-Host ""
Write-Host "Tag as vX.Y.Z-windows-pilot and publish to the WINDOWS repo, not the macOS one." -ForegroundColor Yellow

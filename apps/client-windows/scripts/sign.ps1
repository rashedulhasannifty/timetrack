<#
.SYNOPSIS
  Authenticode-sign the packaged build, or explain why it did not.

.DESCRIPTION
  A NO-OP WITH A WARNING when no certificate is configured. That is the point of it existing
  now: the release pipeline gets written once, works today against an unsigned pilot, and starts
  signing the day a certificate appears — without anybody having to remember to add a step.
  A script that failed hard on a missing certificate would simply be commented out instead, and
  commenting it out is how it never gets switched back on.

  Set NIFTYTIMER_SIGN_PFX and NIFTYTIMER_SIGN_PASSWORD, or NIFTYTIMER_SIGN_THUMBPRINT for a
  certificate already in the machine store, to enable it. See SIGNING.md.

  Timestamping is not optional once signing is real: without /tr the signature stops validating
  the day the certificate expires, including on copies installed long before that.
#>
[CmdletBinding()]
param(
  [string]$Path,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
if (-not $Path) { $Path = Join-Path $root 'dist/NiftyTimer/NiftyTimer.exe' }

$pfx = $env:NIFTYTIMER_SIGN_PFX
$thumbprint = $env:NIFTYTIMER_SIGN_THUMBPRINT

if (-not $pfx -and -not $thumbprint) {
  Write-Warning "No signing certificate configured - skipping. This build is UNSIGNED and SmartScreen will warn on first run."
  Write-Warning "Set NIFTYTIMER_SIGN_PFX (plus NIFTYTIMER_SIGN_PASSWORD) or NIFTYTIMER_SIGN_THUMBPRINT to enable. See SIGNING.md."
  exit 0
}

if (-not (Test-Path $Path)) { throw "Nothing to sign at $Path. Run package-app.ps1 first." }

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if ($signtool) {
  $signtoolPath = $signtool.Source
} else {
  # signtool is not on PATH by default; take the newest x64 copy from the Windows SDK.
  $candidates = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like '*x64*' } | Sort-Object FullName -Descending
  if (-not $candidates) { throw "signtool.exe not found. Install the Windows SDK signing tools." }
  $signtoolPath = $candidates[0].FullName
}

$arguments = @('sign', '/fd', 'SHA256', '/tr', $TimestampUrl, '/td', 'SHA256')
if ($pfx) {
  $arguments += @('/f', $pfx)
  if ($env:NIFTYTIMER_SIGN_PASSWORD) { $arguments += @('/p', $env:NIFTYTIMER_SIGN_PASSWORD) }
} else {
  $arguments += @('/sha1', $thumbprint)
}
$arguments += $Path

& $signtoolPath @arguments
if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE." }

Write-Host "Signed $Path" -ForegroundColor Green

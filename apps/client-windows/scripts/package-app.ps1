<#
.SYNOPSIS
  Publish a self-contained Nifty Timer for Windows and stamp its deployment settings.

.DESCRIPTION
  Produces dist/NiftyTimer/, a self-contained win-x64 build that runs on a machine with no .NET
  installed — which every employee laptop is.

  It DEFAULTS TO PRODUCTION. That is deliberate and is the safer of the two possible mistakes:
  a packaged build is the artifact people actually run, and one that silently talks to
  127.0.0.1 looks like it works and records nothing. Pass -Dev for a localhost build, or use
  package-dev-app.ps1, which also gives it its own %LOCALAPPDATA% container.

  The /v1 suffix on the API base is load-bearing — the reverse proxy routes on it, and
  AppConfig.ApiBaseUri would otherwise resolve every request one path segment too high.
#>
[CmdletBinding()]
param(
  [string]$ApiBaseUrl,
  [string]$DashboardUrl,
  [string]$AppId,
  [string]$UpdateRepo = 'rashedulhasansojib/niftytimer-windows',
  [switch]$Dev,
  [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src/NiftyTimer/NiftyTimer.csproj'
$outputDirectory = Join-Path $root 'dist/NiftyTimer'

if ($Dev) {
  if (-not $ApiBaseUrl)   { $ApiBaseUrl = 'http://127.0.0.1:3001/v1' }
  if (-not $DashboardUrl) { $DashboardUrl = 'http://127.0.0.1:3000' }
  if (-not $AppId)        { $AppId = 'com.niftyitsolution.niftytimer.dev' }
} else {
  if (-not $ApiBaseUrl)   { $ApiBaseUrl = 'https://timer.niftyitsolution.com/v1' }
  if (-not $DashboardUrl) { $DashboardUrl = 'https://timer.niftyitsolution.com' }
  if (-not $AppId)        { $AppId = 'com.niftyitsolution.niftytimer' }
}

if (-not $ApiBaseUrl.TrimEnd('/').EndsWith('/v1')) {
  throw "ApiBaseUrl must end in /v1 (got '$ApiBaseUrl'). The proxy routes on it and a shipped client pins it."
}

Write-Host "Packaging Nifty Timer" -ForegroundColor Cyan
Write-Host "  app id    : $AppId"
Write-Host "  api       : $ApiBaseUrl"
Write-Host "  dashboard : $DashboardUrl"
Write-Host "  updates   : $UpdateRepo"

if (Test-Path $outputDirectory) { Remove-Item -Recurse -Force $outputDirectory }

& dotnet publish $project `
  --configuration $Configuration `
  --runtime win-x64 `
  --self-contained true `
  --output $outputDirectory `
  -p:PublishSingleFile=false
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE." }

# Stamp the deployment settings. Written after publish so the checked-in file stays pointed at
# localhost for developers and only the ARTIFACT carries production URLs.
$settings = [ordered]@{
  appId        = $AppId
  apiBaseUrl   = $ApiBaseUrl
  dashboardUrl = $DashboardUrl
  updateRepo   = $UpdateRepo
}
$settingsPath = Join-Path $outputDirectory 'appsettings.json'
$settings | ConvertTo-Json -Depth 4 | Set-Content -Path $settingsPath -Encoding utf8

# By explicit name, not a glob. The tray icon is the always-visible indicator (PRD 4.2), so a
# renamed or missing file must fail the PACKAGE rather than ship an app that starts without one.
foreach ($icon in @('tray-idle-light.ico', 'tray-idle-dark.ico', 'tray-tracking-light.ico', 'tray-tracking-dark.ico')) {
  $source = Join-Path $root "src/NiftyTimer/Resources/$icon"
  $destination = Join-Path $outputDirectory "Resources/$icon"
  if (-not (Test-Path $source)) { throw "Tray icon '$icon' is missing. The indicator is not optional." }
  New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
  Copy-Item -Force $source $destination
}

$executable = Join-Path $outputDirectory 'NiftyTimer.exe'
if (-not (Test-Path $executable)) { throw "Publish produced no NiftyTimer.exe." }

Write-Host "Packaged to $outputDirectory" -ForegroundColor Green

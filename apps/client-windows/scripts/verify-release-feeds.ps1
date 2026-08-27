<#
.SYNOPSIS
    Checklist row 10 -- both platforms' update feeds resolve, and publishing Windows did not
    silently break macOS.

.DESCRIPTION
    GitHub exposes exactly ONE releases/latest per repository. The shipped macOS client's update
    feed and the dashboard's Mac download button both resolve through it and both require an asset
    literally named NiftyTimer-pilot.zip.

    A Windows release published to the macOS repository would become that 'latest'. Every installed
    Mac client would go silently blind to updates and the download button would start answering
    404 -- fixable only by shipping a Mac update through the path that just broke. A Mac client
    already on someone's laptop cannot be rolled back.

    That is why the two platforms publish to SEPARATE repositories, and why this check exists:
    run it before the first Windows release to record a baseline, and again afterwards. The macOS
    lines must be identical across the two runs.

    Read-only. Uses `gh` for authentication, falling back to an unauthenticated request.

.PARAMETER MacRepo
    The macOS distribution repository.

.PARAMETER WindowsRepo
    The Windows distribution repository. May not exist yet -- that is reported, not fatal.

.EXAMPLE
    ./scripts/verify-release-feeds.ps1
#>
[CmdletBinding()]
param(
    [string] $MacRepo = 'rashedulhasansojib/timetrack-app',
    [string] $WindowsRepo = 'Chishty-NiftyIT/niftytimer-windows'
)

$ErrorActionPreference = 'Stop'

# Both names are a CONTRACT, not a convention. UpdateFeed refuses a release whose asset does not
# match, and the dashboard's /releases/latest/download/<name> link 404s on a rename.
$macAsset = 'NiftyTimer-pilot.zip'
$windowsAsset = 'NiftyTimer-windows-pilot.zip'

function Get-Release {
    param([string] $Repo)

    # A missing repository is an EXPECTED answer here, not a failure -- but `gh` writes its 404
    # to stderr, and under $ErrorActionPreference = 'Stop' Windows PowerShell turns a native
    # command's stderr into a terminating error. Merge the streams and drop back to 'Continue'
    # for the call, or the script dies before it can report "not published yet".
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & gh api "repos/$Repo/releases/latest" 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($code -ne 0) { return $null }

    $json = ($output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
    if (-not $json) { return $null }
    return $json | ConvertFrom-Json
}

function Test-Feed {
    param([string] $Repo, [string] $Asset, [string] $Platform)

    Write-Host ''
    Write-Host "$Platform -- $Repo" -ForegroundColor Cyan

    $release = Get-Release -Repo $Repo
    if (-not $release) {
        Write-Host '  ABSENT  repository or releases/latest does not resolve' -ForegroundColor Yellow
        return $false
    }

    $names = @($release.assets | ForEach-Object { $_.name })
    $hasAsset = $names -contains $Asset
    $hasDigest = $names -contains "$Asset.sha256"

    Write-Host "  tag       : $($release.tag_name)"
    Write-Host "  published : $($release.published_at)"
    Write-Host "  assets    : $($names -join ', ')"

    $mark = if ($hasAsset) { 'PASS' } else { 'FAIL' }
    $colour = if ($hasAsset) { 'Green' } else { 'Red' }
    Write-Host ('  {0}      {1} is on releases/latest' -f $mark, $Asset) -ForegroundColor $colour

    # The client verifies the published digest before swapping a binary, so a release without the
    # sidecar is one no client will ever install.
    $mark = if ($hasDigest) { 'PASS' } else { 'FAIL' }
    $colour = if ($hasDigest) { 'Green' } else { 'Red' }
    Write-Host ('  {0}      {1}.sha256 sidecar is present' -f $mark, $Asset) -ForegroundColor $colour

    return ($hasAsset -and $hasDigest)
}

Write-Host ''
Write-Host 'Row 10 -- update feeds' -ForegroundColor Cyan

$macOk = Test-Feed -Repo $MacRepo -Asset $macAsset -Platform 'macOS'
$winOk = Test-Feed -Repo $WindowsRepo -Asset $windowsAsset -Platform 'Windows'

Write-Host ''
if (-not $macOk) {
    Write-Host 'macOS FEED IS BROKEN. If this passed before a Windows release and fails now,' -ForegroundColor Red
    Write-Host 'the Windows assets went to the wrong repository -- see DISTRIBUTION.md.' -ForegroundColor Red
    exit 1
}

Write-Host 'macOS feed resolves.' -ForegroundColor Green

if (-not $winOk) {
    Write-Host 'Windows feed does not resolve yet -- expected until the first release is published.' -ForegroundColor Yellow
    Write-Host 'Row 10 stays open. Re-run after publishing; the macOS lines above must not change.'
    exit 2
}

Write-Host 'Windows feed resolves, and macOS is unaffected. Row 10 satisfied.' -ForegroundColor Green
exit 0

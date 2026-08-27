<#
.SYNOPSIS
    Checklist row 9 -- prove empirically that the client records keystroke COUNTS, never content.

.DESCRIPTION
    CLAUDE.md section 1 forbids logging or transmitting keystroke content. On macOS the platform
    guarantees it: `CGEventSource.counterForEventType` cannot return key identity. On Windows it
    cannot -- Raw Input *can* -- so the guarantee is structural instead: `Activity/EventCounter`
    calls `GetRawInputData` with `RID_HEADER`, never `RID_INPUT`, so the payload carrying `VKey`
    and `MakeCode` is never copied into the process.

    Structure is an argument. This script is the evidence.

    Type a known, unusual string into Notepad while the client is tracking, then run this. It
    searches every byte the client persisted -- buffered payloads, screenshots, settings, logs,
    the DPAPI token blob -- for that string, for each of its characters as a virtual-key name, and
    for the scancodes they would produce.

    THE IMPORTANT PART: a search that reports "no hits" proves nothing unless it can be shown to
    find hits. So the script first plants the needle in a temporary file inside the search root
    and confirms it is found. If that self-test fails, the run ABORTS rather than reporting a
    reassuring zero.

.PARAMETER Needle
    The string you typed. Make it unusual -- 'correcthorsebatterystaple', not 'test'.

.PARAMETER Root
    The client's state container. Defaults to the dev build's.

.PARAMETER CaptureFile
    Optional. A traffic capture (.har, .txt, .pcap saved as text) covering the same window, so
    outbound request bodies are searched as well as local files. Without it, only local state is
    covered -- and local state is what every upload is built from, so it is the stronger half.

.EXAMPLE
    ./scripts/verify-counts-not-content.ps1 -Needle 'correcthorsebatterystaple'

.EXAMPLE
    ./scripts/verify-counts-not-content.ps1 -Needle 'zqxjvw' -CaptureFile ~/capture.har
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateLength(4, 200)]
    [string] $Needle,

    [string] $Root = (Join-Path $env:LOCALAPPDATA 'NiftyTimer-dev'),

    [string] $CaptureFile
)

$ErrorActionPreference = 'Stop'

function Write-Result {
    param([string] $Label, [bool] $Ok, [string] $Detail = '')
    $mark = if ($Ok) { 'PASS' } else { 'FAIL' }
    $colour = if ($Ok) { 'Green' } else { 'Red' }
    Write-Host ('  {0,-4}  {1}{2}' -f $mark, $Label, $(if ($Detail) { " -- $Detail" } else { '' })) -ForegroundColor $colour
}

# --- what to look for -------------------------------------------------------------------------
#
# The literal string is the obvious probe. The other two are what a partial leak would look like:
# Raw Input yields a virtual-key code and a scancode per keystroke, so a client that captured
# identity without assembling text would still leave those behind.

$chars = $Needle.ToUpperInvariant().ToCharArray() | Select-Object -Unique | Where-Object { $_ -match '[A-Z0-9]' }

$patterns = @(
    @{ Name = 'the literal string you typed'; Value = $Needle; Kind = 'text' }
    @{ Name = 'the string, UTF-16 encoded'; Value = $Needle; Kind = 'utf16' }
)

foreach ($c in $chars) {
    # VK_A..VK_Z and VK_0..VK_9 are the names a leak would most plausibly carry.
    $patterns += @{ Name = "virtual-key name VK_$c"; Value = "VK_$c"; Kind = 'text' }
}

# A JSON field that should never exist on any payload this client sends.
foreach ($field in @('"keys"', '"keystrokes"', '"vkey"', '"scanCode"', '"makeCode"', '"text"', '"typed"')) {
    $patterns += @{ Name = "forbidden field $field"; Value = $field; Kind = 'text' }
}

function Test-Bytes {
    param([byte[]] $Bytes, [string] $Value, [string] $Kind)

    $encodings = switch ($Kind) {
        'utf16' { @([System.Text.Encoding]::Unicode) }
        default { @([System.Text.Encoding]::ASCII, [System.Text.Encoding]::UTF8) }
    }

    foreach ($enc in $encodings) {
        $needleBytes = $enc.GetBytes($Value)
        if ($needleBytes.Length -eq 0 -or $needleBytes.Length -gt $Bytes.Length) { continue }

        $last = $Bytes.Length - $needleBytes.Length
        for ($i = 0; $i -le $last; $i++) {
            $match = $true
            for ($j = 0; $j -lt $needleBytes.Length; $j++) {
                if ($Bytes[$i + $j] -ne $needleBytes[$j]) { $match = $false; break }
            }
            if ($match) { return $true }
        }
    }

    return $false
}

function Search-Tree {
    param([string] $Path, [array] $Patterns)

    $hits = @()
    if (-not (Test-Path $Path)) { return $hits }

    foreach ($file in Get-ChildItem -Path $Path -Recurse -File -Force -ErrorAction SilentlyContinue) {
        # Read as BYTES, not text: screenshots are JPEG and the token file is a DPAPI blob, so a
        # text read would silently skip or mangle exactly the files worth checking.
        try { $bytes = [System.IO.File]::ReadAllBytes($file.FullName) } catch { continue }

        foreach ($p in $Patterns) {
            if (Test-Bytes -Bytes $bytes -Value $p.Value -Kind $p.Kind) {
                $hits += [pscustomobject]@{ File = $file.FullName; Pattern = $p.Name }
            }
        }
    }

    return $hits
}

Write-Host ''
Write-Host 'Row 9 -- counts, never content' -ForegroundColor Cyan
Write-Host "  needle : $Needle"
Write-Host "  root   : $Root"
Write-Host "  probes : $($patterns.Count)"
Write-Host ''

if (-not (Test-Path $Root)) {
    Write-Host "The state container does not exist: $Root" -ForegroundColor Red
    Write-Host 'Run the client at least once, with the clock running, before verifying.'
    exit 2
}

$files = @(Get-ChildItem -Path $Root -Recurse -File -Force -ErrorAction SilentlyContinue)
Write-Host "Searching $($files.Count) file(s) under the container."

# An empty container passes every probe trivially. That is the second way this check can look
# reassuring while proving nothing -- the first being a broken search, which the self-test below
# covers. Refuse rather than print CLEAN over nothing.
if ($files.Count -eq 0) {
    Write-Host ''
    Write-Host 'ABORTING: the container is EMPTY, so a "no hits" result would be vacuous.' -ForegroundColor Red
    Write-Host 'Sign in, acknowledge the policy, start the clock, type the needle into Notepad,' -ForegroundColor Red
    Write-Host 'and give the sampler a full interval (60s) to write something before verifying.' -ForegroundColor Red
    exit 4
}

Write-Host ''

# --- self-test: prove the search can find what it is looking for ------------------------------
#
# Without this, an empty container, a path typo or a broken matcher all produce the same
# reassuring "0 hits" as a genuinely clean run. A negative result is only evidence if the
# instrument demonstrably works.

Write-Host 'Self-test -- the search must find a planted needle:' -ForegroundColor Yellow
$planted = Join-Path $Root ('.counts-not-content-selftest-' + [guid]::NewGuid().ToString('N') + '.tmp')
$selfTestOk = $false
try {
    [System.IO.File]::WriteAllText($planted, "padding $Needle padding")
    $found = Search-Tree -Path $Root -Patterns @($patterns[0])
    $selfTestOk = @($found | Where-Object { $_.File -eq $planted }).Count -eq 1
    Write-Result -Label 'the planted needle is found' -Ok $selfTestOk
}
finally {
    if (Test-Path $planted) { Remove-Item $planted -Force }
}

if (-not $selfTestOk) {
    Write-Host ''
    Write-Host 'ABORTING: the search could not find a string it planted itself, so a "no hits"' -ForegroundColor Red
    Write-Host 'result here would mean nothing. Fix the harness before trusting any run.' -ForegroundColor Red
    exit 3
}

Write-Host ''
Write-Host 'Scanning the container:' -ForegroundColor Yellow
$hits = Search-Tree -Path $Root -Patterns $patterns
Write-Result -Label "$($files.Count) file(s), $($patterns.Count) probe(s)" -Ok ($hits.Count -eq 0) -Detail "$($hits.Count) hit(s)"

# --- the outbound half --------------------------------------------------------------------------

if ($CaptureFile) {
    Write-Host ''
    Write-Host 'Scanning the traffic capture:' -ForegroundColor Yellow
    if (-not (Test-Path $CaptureFile)) {
        Write-Host "  capture not found: $CaptureFile" -ForegroundColor Red
        exit 2
    }

    $captureBytes = [System.IO.File]::ReadAllBytes($CaptureFile)
    $captureHits = @()
    foreach ($p in $patterns) {
        if (Test-Bytes -Bytes $captureBytes -Value $p.Value -Kind $p.Kind) {
            $captureHits += [pscustomobject]@{ File = $CaptureFile; Pattern = $p.Name }
        }
    }
    Write-Result -Label (Split-Path $CaptureFile -Leaf) -Ok ($captureHits.Count -eq 0) -Detail "$($captureHits.Count) hit(s)"
    $hits += $captureHits
}
else {
    Write-Host ''
    Write-Host 'No -CaptureFile given, so outbound request bodies were NOT searched directly.' -ForegroundColor DarkYellow
    Write-Host 'Every upload is built from the buffered payloads above, so this is the weaker half --' -ForegroundColor DarkYellow
    Write-Host 'but say so in the result rather than claiming full coverage.' -ForegroundColor DarkYellow
}

Write-Host ''
if ($hits.Count -eq 0) {
    Write-Host 'CLEAN -- no keystroke content found, and the search was shown to work.' -ForegroundColor Green
    Write-Host 'Record this in the PR description; CLAUDE.md 1 expects it reviewed there.'
    exit 0
}

Write-Host "FOUND KEYSTROKE CONTENT -- $($hits.Count) hit(s). This is a release blocker." -ForegroundColor Red
$hits | Format-Table -AutoSize
exit 1

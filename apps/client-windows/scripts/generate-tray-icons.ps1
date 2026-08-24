#!/usr/bin/env pwsh
# Generates the tray icon set as 16x16 32bpp .ico files.
#
# The icons are committed, not generated at build time — the packaging script copies them by
# explicit name so a rename is a build failure rather than a silent "no icon" (the tray icon is
# the always-visible indicator required by PRD §4.2; it cannot be allowed to quietly not render).
# Re-run this only when the shapes or colours change, then commit the result.
#
#   pwsh ./scripts/generate-tray-icons.ps1

$ErrorActionPreference = 'Stop'
$outDir = Join-Path $PSScriptRoot '..\src\NiftyTimer\Resources'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-TrayIcon {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [byte] $R,
        [Parameter(Mandatory)] [byte] $G,
        [Parameter(Mandatory)] [byte] $B,
        [Parameter()] [bool] $Hollow = $false
    )

    $size = 16
    $xor = New-Object byte[] ($size * $size * 4)
    $center = ($size - 1) / 2.0
    $outer = 6.6
    $inner = 4.2

    for ($y = 0; $y -lt $size; $y++) {
        for ($x = 0; $x -lt $size; $x++) {
            $dx = $x - $center
            $dy = $y - $center
            $d = [Math]::Sqrt($dx * $dx + $dy * $dy)

            # Antialias the rim over one pixel so the dot does not look ragged at 16px.
            $a = [Math]::Min(1.0, [Math]::Max(0.0, $outer - $d))
            if ($Hollow) {
                $a = [Math]::Min($a, [Math]::Min(1.0, [Math]::Max(0.0, $d - $inner)))
            }

            $alpha = [byte][Math]::Round($a * 255)

            # ICO stores the XOR bitmap bottom-up, BGRA, premultiplication not required.
            $row = $size - 1 - $y
            $i = (($row * $size) + $x) * 4
            $xor[$i + 0] = [byte]($B * $a)
            $xor[$i + 1] = [byte]($G * $a)
            $xor[$i + 2] = [byte]($R * $a)
            $xor[$i + 3] = $alpha
        }
    }

    # AND mask: 1bpp, rows padded to 4 bytes. All zero — the alpha channel does the masking.
    $andMask = New-Object byte[] ($size * 4)

    $ms = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter($ms)

    $imageBytes = 40 + $xor.Length + $andMask.Length

    # ICONDIR
    $w.Write([uint16]0)   # reserved
    $w.Write([uint16]1)   # type: icon
    $w.Write([uint16]1)   # image count

    # ICONDIRENTRY
    $w.Write([byte]$size)
    $w.Write([byte]$size)
    $w.Write([byte]0)     # palette size
    $w.Write([byte]0)     # reserved
    $w.Write([uint16]1)   # colour planes
    $w.Write([uint16]32)  # bits per pixel
    $w.Write([uint32]$imageBytes)
    $w.Write([uint32]22)  # offset of the image data

    # BITMAPINFOHEADER — height is doubled to cover XOR + AND.
    $w.Write([uint32]40)
    $w.Write([int32]$size)
    $w.Write([int32]($size * 2))
    $w.Write([uint16]1)
    $w.Write([uint16]32)
    $w.Write([uint32]0)   # BI_RGB
    $w.Write([uint32]($xor.Length + $andMask.Length))
    $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)

    $w.Write($xor)
    $w.Write($andMask)
    $w.Flush()

    [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
    $w.Dispose()
    $ms.Dispose()
    Write-Host "wrote $Path"
}

# Idle: a hollow slate ring — present and legible, clearly not recording.
New-TrayIcon -Path (Join-Path $outDir 'tray-idle.ico') -R 148 -G 163 -B 184 -Hollow $true

# Tracking: a filled green dot. The state change is what makes the indicator meaningful, so the
# two must be distinguishable at a glance and without relying on colour alone (filled vs hollow).
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking.ico') -R 34 -G 197 -B 94

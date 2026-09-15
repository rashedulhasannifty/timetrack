#!/usr/bin/env pwsh
# Generates the tray icon set as 16x16 32bpp .ico files.
#
# The icons are committed, not generated at build time — the packaging script copies them by
# explicit name so a rename is a build failure rather than a silent "no icon" (the tray icon is
# the always-visible indicator required by PRD §4.2; it cannot be allowed to quietly not render).
# Re-run this only when the shapes or colours change, then commit the result. CI re-runs it and
# fails if its output differs from what is committed, so the two cannot drift.
#
#   pwsh ./scripts/generate-tray-icons.ps1

$ErrorActionPreference = 'Stop'
$outDir = Join-Path $PSScriptRoot '..\src\NiftyTimer\Resources'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$size = 16
$center = ($size - 1) / 2.0

# The mark: a disc, a ring (the disc with its middle cut out), or a lens (a disc with a thin clear
# ring around a centre dot).
$outer = 6.6
$inner = 4.2
$lensDot = 1.8
$lensRing = 3.2

# The warning badge: a dot in the bottom-right corner, separated from the mark by a clear gap so
# it reads as a separate thing at 16px rather than a lump on the mark.
$badgeX = 12.5
$badgeY = 12.5
$badgeRadius = 3.0
$badgeGap = 1.0

function Get-Clamp01([double] $v) {
    return [Math]::Min(1.0, [Math]::Max(0.0, $v))
}

function New-TrayIcon {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [byte[]] $Rgb,
        [Parameter()] [ValidateSet('disc', 'ring', 'lens')] [string] $Shape = 'disc',
        [Parameter()] [byte[]] $Badge = $null
    )

    $xor = New-Object byte[] ($size * $size * 4)

    for ($y = 0; $y -lt $size; $y++) {
        for ($x = 0; $x -lt $size; $x++) {
            $dx = $x - $center
            $dy = $y - $center
            $d = [Math]::Sqrt($dx * $dx + $dy * $dy)

            # Antialias every edge over one pixel so the mark does not look ragged at 16px.
            $a = Get-Clamp01 ($outer - $d)
            switch ($Shape) {
                'ring' { $a = [Math]::Min($a, (Get-Clamp01 ($d - $inner))) }
                'lens' { $a = [Math]::Min($a, [Math]::Max((Get-Clamp01 ($lensDot - $d)), (Get-Clamp01 ($d - $lensRing)))) }
            }

            $red = $Rgb[0]
            $green = $Rgb[1]
            $blue = $Rgb[2]

            if ($null -ne $Badge) {
                $bx = $x - $badgeX
                $by = $y - $badgeY
                $db = [Math]::Sqrt($bx * $bx + $by * $by)

                # Cut the gap out of the mark, then draw the badge inside it. The two never
                # overlap, so each pixel takes exactly one colour.
                $a = [Math]::Min($a, (Get-Clamp01 ($db - $badgeRadius - $badgeGap)))
                $ab = Get-Clamp01 ($badgeRadius - $db)
                if ($ab -gt 0) {
                    $a = $ab
                    $red = $Badge[0]
                    $green = $Badge[1]
                    $blue = $Badge[2]
                }
            }

            $alpha = [byte][Math]::Round($a * 255)

            # ICO stores the XOR bitmap bottom-up, BGRA, premultiplication not required.
            $row = $size - 1 - $y
            $i = (($row * $size) + $x) * 4
            $xor[$i + 0] = [byte]($blue * $a)
            $xor[$i + 1] = [byte]($green * $a)
            $xor[$i + 2] = [byte]($red * $a)
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

# Each state needs a variant per taskbar theme: the mark is DARK on a light taskbar and LIGHT on a
# dark one, which is why these are not simply the palette's light/dark values applied naively.
#
# The states differ by SHAPE, not only colour, which is what keeps them legible for colour-blind
# users: idle is a ring, tracking a disc, and capturing (flashed briefly while a screenshot is
# taken, PRD §6.2) a lens. The warning badge is amber — the palette's Manual role — and is drawn
# on idle and tracking only; the capture flash lasts a second and a half and shows nothing else.

$lightIdle = 0x73, 0x72, 0x6C
$lightTracking = 0x0F, 0x76, 0x6E
$lightWarning = 0xB4, 0x53, 0x09
$darkIdle = 0x9D, 0x9D, 0x97
$darkTracking = 0x43, 0xC0, 0xAF
$darkWarning = 0xFB, 0xBF, 0x24

# Light theme: light taskbar, so draw dark.
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-light.ico')             -Rgb $lightIdle -Shape ring
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-light.ico')         -Rgb $lightTracking
New-TrayIcon -Path (Join-Path $outDir 'tray-capturing-light.ico')        -Rgb $lightTracking -Shape lens
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-warning-light.ico')     -Rgb $lightIdle -Shape ring -Badge $lightWarning
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-warning-light.ico') -Rgb $lightTracking -Badge $lightWarning

# Dark theme: dark taskbar, so draw light.
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-dark.ico')              -Rgb $darkIdle -Shape ring
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-dark.ico')          -Rgb $darkTracking
New-TrayIcon -Path (Join-Path $outDir 'tray-capturing-dark.ico')         -Rgb $darkTracking -Shape lens
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-warning-dark.ico')      -Rgb $darkIdle -Shape ring -Badge $darkWarning
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-warning-dark.ico')  -Rgb $darkTracking -Badge $darkWarning

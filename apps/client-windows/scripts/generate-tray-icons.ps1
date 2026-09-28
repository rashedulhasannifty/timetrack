#!/usr/bin/env pwsh
# Generates the tray icon set: one .ico per state and taskbar theme, each carrying 16, 20, 24 and
# 32 px frames so the shell gets a drawn image at 100%, 125%, 150% and 200% scaling instead of a
# 16 px one stretched.
#
# The icons are committed, not generated at build time — the packaging script copies them by
# explicit name so a rename is a build failure rather than a silent "no icon" (the tray icon is
# the always-visible indicator required by PRD §4.2; it cannot be allowed to quietly not render).
# Re-run this only when the shapes or colours change, then commit the result. CI re-runs it and
# fails if its output differs from what is committed, so the two cannot drift.
#
# CI runs this on Windows and the check is byte-exact, so the geometry uses only + - * / and Sqrt,
# which IEEE 754 fixes bit for bit on every platform. No Sin, Cos or Atan2: those come from the
# platform's C runtime and may differ in the last bit between Windows and anywhere else.
#
#   pwsh ./scripts/generate-tray-icons.ps1

$ErrorActionPreference = 'Stop'
$outDir = Join-Path $PSScriptRoot '..\src\NiftyTimer\Resources'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$sizes = 16, 20, 24, 32

# The frame shows the middle 22 units of the brand's 24-unit box: the mark keeps its proportions
# but fills the icon, where the whole box left it a 12 px ring inside a 16 px tile.
$viewLeft = 1.0
$viewTop = 1.0
$viewSize = 22.0

# The mark is the brand's elapsed-time ring, in the 24-unit box UI/BrandMark.xaml and the
# dashboard draw it in: a ring split into elapsed and remaining time, with a crown tick at twelve.
# It used to be a bare circle, which on a real taskbar read as a placeholder, not as this app.
$centerX = 12.0
$centerY = 12.5
$ringRadius = 7.3
$ringHalfStroke = 1.7

# The handover from elapsed to remaining, as a unit vector from the centre (y down): 252 degrees
# clockwise from twelve, the dashboard's (236.19, 601.61) on its r=290 circle about (512, 512).
# Remaining time is the arc from here clockwise back up to twelve.
$handoverX = -0.95107
$handoverY = 0.30900

# Crown tick: a pill at twelve that overlaps the ring so the two never separate when scaled.
$tickLeft = 11.1
$tickTop = 1.7
$tickWidth = 1.8
$tickHeight = 3.4
$tickRadius = 0.9

# States differ by SHAPE, not only colour, which keeps them legible for colour-blind users and
# matches the macOS menu bar set: idle is the bare ring, tracking adds a solid centre dot, and
# capturing (flashed briefly while a screenshot is taken, PRD §6.2) draws a lens — a ring inside
# the ring — so its centre is clear where tracking's is solid.
$dotRadius = 2.6
$lensRadius = 2.65
$lensHalfStroke = 1.15

# The warning badge: a dot in the bottom-right corner, separated from the mark by a clear gap so
# it reads as a separate thing at 16 px rather than a lump on the mark.
$badgeX = 19.0
$badgeY = 19.0
$badgeRadius = 4.0
$badgeGap = 1.4

function Get-Clamp01([double] $v) {
    return [Math]::Min(1.0, [Math]::Max(0.0, $v))
}

# Coverage of a pixel by a shape, from the shape's signed distance in units (negative inside).
# Antialiases every edge over one pixel so the mark does not look ragged at 16 px.
function Get-Coverage([double] $signedDistance, [double] $scale) {
    return Get-Clamp01 (0.5 - ($signedDistance * $scale))
}

# Straight-alpha "over": the layer in front, then what is already there behind it.
function Add-Layer($acc, [byte[]] $rgb, [double] $a) {
    $outA = $a + ($acc.A * (1.0 - $a))
    if ($outA -le 0.0) {
        return @{ R = 0.0; G = 0.0; B = 0.0; A = 0.0 }
    }

    $behind = $acc.A * (1.0 - $a)
    return @{
        R = (($rgb[0] * $a) + ($acc.R * $behind)) / $outA
        G = (($rgb[1] * $a) + ($acc.G * $behind)) / $outA
        B = (($rgb[2] * $a) + ($acc.B * $behind)) / $outA
        A = $outA
    }
}

function Get-Frame {
    param(
        [int] $Size,
        [hashtable] $Palette,
        [string] $Shape,
        [byte[]] $Badge
    )

    $scale = $Size / $viewSize
    $xor = New-Object byte[] ($Size * $Size * 4)

    for ($y = 0; $y -lt $Size; $y++) {
        for ($x = 0; $x -lt $Size; $x++) {
            # The pixel's centre, in the 24-unit box.
            $u = $viewLeft + (($x + 0.5) / $scale)
            $v = $viewTop + (($y + 0.5) / $scale)
            $dx = $u - $centerX
            $dy = $v - $centerY
            $d = [Math]::Sqrt($dx * $dx + $dy * $dy)

            $acc = @{ R = 0.0; G = 0.0; B = 0.0; A = 0.0 }

            # Ring, split into elapsed and remaining. Remaining is left of twelve and past the
            # handover; each boundary blends over a pixel like any other edge. The cross product
            # of the handover direction with the offset is the signed distance to that radial line.
            $ring = Get-Coverage ([Math]::Abs($d - $ringRadius) - $ringHalfStroke) $scale
            if ($ring -gt 0.0) {
                $pastHandover = Get-Clamp01 (0.5 + (($handoverX * $dy) - ($handoverY * $dx)) * $scale)
                $leftOfTwelve = Get-Clamp01 (0.5 - ($dx * $scale))
                $remaining = [Math]::Min($pastHandover, $leftOfTwelve)

                # One layer whose colour blends across the handover. Two layers of partial alpha
                # would leave a notch in the ring where they meet.
                $arc = [byte[]](0, 0, 0)
                for ($c = 0; $c -lt 3; $c++) {
                    $arc[$c] = [byte][Math]::Round(($Palette.Elapsed[$c] * (1.0 - $remaining)) + ($Palette.Remaining[$c] * $remaining))
                }

                $acc = Add-Layer $acc $arc $ring
            }

            # Crown tick: signed distance to a rounded rectangle.
            $qx = [Math]::Abs($u - ($tickLeft + $tickWidth / 2.0)) - ($tickWidth / 2.0 - $tickRadius)
            $qy = [Math]::Abs($v - ($tickTop + $tickHeight / 2.0)) - ($tickHeight / 2.0 - $tickRadius)
            $ox = [Math]::Max($qx, 0.0)
            $oy = [Math]::Max($qy, 0.0)
            $tickDistance = [Math]::Sqrt($ox * $ox + $oy * $oy) + [Math]::Min([Math]::Max($qx, $qy), 0.0) - $tickRadius
            $acc = Add-Layer $acc $Palette.Tick (Get-Coverage $tickDistance $scale)

            switch ($Shape) {
                'dot' { $acc = Add-Layer $acc $Palette.Elapsed (Get-Coverage ($d - $dotRadius) $scale) }
                'lens' { $acc = Add-Layer $acc $Palette.Elapsed (Get-Coverage ([Math]::Abs($d - $lensRadius) - $lensHalfStroke) $scale) }
            }

            if ($null -ne $Badge) {
                $bx = $u - $badgeX
                $by = $v - $badgeY
                $db = [Math]::Sqrt($bx * $bx + $by * $by)

                # Cut the gap out of the mark, then draw the badge inside it.
                $acc.A = $acc.A * (Get-Clamp01 (($db - $badgeRadius - $badgeGap) * $scale + 0.5))
                $acc = Add-Layer $acc $Badge (Get-Coverage ($db - $badgeRadius) $scale)
            }

            # ICO stores the XOR bitmap bottom-up, BGRA, with straight (not premultiplied) alpha.
            $row = $Size - 1 - $y
            $i = (($row * $Size) + $x) * 4
            $xor[$i + 0] = [byte][Math]::Round($acc.B)
            $xor[$i + 1] = [byte][Math]::Round($acc.G)
            $xor[$i + 2] = [byte][Math]::Round($acc.R)
            $xor[$i + 3] = [byte][Math]::Round($acc.A * 255.0)
        }
    }

    return , $xor
}

function New-TrayIcon {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [hashtable] $Palette,
        [Parameter()] [ValidateSet('ring', 'dot', 'lens')] [string] $Shape = 'ring',
        [Parameter()] [byte[]] $Badge = $null
    )

    $frames = foreach ($size in $sizes) {
        , (Get-Frame -Size $size -Palette $Palette -Shape $Shape -Badge $Badge)
    }

    $ms = New-Object System.IO.MemoryStream
    $w = New-Object System.IO.BinaryWriter($ms)

    # ICONDIR
    $w.Write([uint16]0)   # reserved
    $w.Write([uint16]1)   # type: icon
    $w.Write([uint16]$sizes.Count)

    # One ICONDIRENTRY per frame; the images follow the directory in the same order.
    $offset = 6 + (16 * $sizes.Count)
    for ($f = 0; $f -lt $sizes.Count; $f++) {
        $size = $sizes[$f]

        # AND mask: 1bpp, rows padded to 4 bytes. All zero — the alpha channel does the masking.
        $andBytes = ([Math]::Floor(($size + 31) / 32) * 4) * $size
        $imageBytes = 40 + $frames[$f].Length + $andBytes

        $w.Write([byte]$size)
        $w.Write([byte]$size)
        $w.Write([byte]0)     # palette size
        $w.Write([byte]0)     # reserved
        $w.Write([uint16]1)   # colour planes
        $w.Write([uint16]32)  # bits per pixel
        $w.Write([uint32]$imageBytes)
        $w.Write([uint32]$offset)
        $offset += $imageBytes
    }

    for ($f = 0; $f -lt $sizes.Count; $f++) {
        $size = $sizes[$f]
        $andBytes = ([Math]::Floor(($size + 31) / 32) * 4) * $size

        # BITMAPINFOHEADER — height is doubled to cover XOR + AND.
        $w.Write([uint32]40)
        $w.Write([int32]$size)
        $w.Write([int32]($size * 2))
        $w.Write([uint16]1)
        $w.Write([uint16]32)
        $w.Write([uint32]0)   # BI_RGB
        $w.Write([uint32]($frames[$f].Length + $andBytes))
        $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)

        $w.Write($frames[$f])
        $w.Write((New-Object byte[] $andBytes))
    }

    $w.Flush()
    [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
    $w.Dispose()
    $ms.Dispose()
    Write-Host "wrote $Path"
}

# Each state needs a variant per taskbar theme: the mark is DARK on a light taskbar and LIGHT on a
# dark one. Every colour — the remaining arc included — clears the contrast bar for its taskbar
# (TrayIconGenerationTests), so the brand's own hexes are adjusted per theme: its remaining teal is
# too dark for a dark taskbar and its elapsed teal too pale for a light one.
#
# Idle is full contrast, near-black or near-white like the macOS template tint. It used to be a
# mid grey, which on a real taskbar looked like nothing was there. The state is carried by the dot
# and the colour, never by dimming the indicator.
$lightIdle = @{ Elapsed = [byte[]](0x1C, 0x1C, 0x19); Remaining = [byte[]](0x5E, 0x5D, 0x57); Tick = [byte[]](0x1C, 0x1C, 0x19) }
$lightTracking = @{ Elapsed = [byte[]](0x0F, 0x76, 0x6E); Remaining = [byte[]](0x3E, 0x86, 0x7D); Tick = [byte[]](0x1C, 0x1C, 0x19) }
$lightWarning = [byte[]](0xB4, 0x53, 0x09)
$darkIdle = @{ Elapsed = [byte[]](0xF4, 0xF4, 0xF0); Remaining = [byte[]](0xAE, 0xAE, 0xA8); Tick = [byte[]](0xF4, 0xF4, 0xF0) }
$darkTracking = @{ Elapsed = [byte[]](0x7F, 0xD6, 0xC9); Remaining = [byte[]](0x5F, 0xA9, 0x9E); Tick = [byte[]](0xF2, 0xF7, 0xF6) }
$darkWarning = [byte[]](0xFB, 0xBF, 0x24)

# Light theme: light taskbar, so draw dark.
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-light.ico')             -Palette $lightIdle
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-light.ico')         -Palette $lightTracking -Shape dot
New-TrayIcon -Path (Join-Path $outDir 'tray-capturing-light.ico')        -Palette $lightTracking -Shape lens
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-warning-light.ico')     -Palette $lightIdle -Badge $lightWarning
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-warning-light.ico') -Palette $lightTracking -Shape dot -Badge $lightWarning

# Dark theme: dark taskbar, so draw light.
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-dark.ico')              -Palette $darkIdle
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-dark.ico')          -Palette $darkTracking -Shape dot
New-TrayIcon -Path (Join-Path $outDir 'tray-capturing-dark.ico')         -Palette $darkTracking -Shape lens
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-warning-dark.ico')      -Palette $darkIdle -Badge $darkWarning
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-warning-dark.ico')  -Palette $darkTracking -Shape dot -Badge $darkWarning

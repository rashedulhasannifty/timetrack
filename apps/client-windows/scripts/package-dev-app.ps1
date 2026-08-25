<#
.SYNOPSIS
  Package a side-by-side "Nifty Timer Dev" build pointed at a local stack.

.DESCRIPTION
  The separate app id is not tidiness, it is correctness. The app id chooses the
  %LOCALAPPDATA% container, and that container holds the durable buffers. Two builds sharing
  one container means two processes draining the same buffer files: whichever drains a record
  first deletes it, so a record enqueued by one can be uploaded under the other's session
  token. Sharing state here is LOSSY, not untidy.
#>
[CmdletBinding()]
param([string]$Configuration = 'Release')

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'package-app.ps1') -Dev -Configuration $Configuration

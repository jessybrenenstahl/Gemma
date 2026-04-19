param(
  [string]$RepoRoot = "C:\Users\jessy\Documents\Codex\Gemma",
  [string]$RemoteName = "origin",
  [string]$BranchName = "codex/mac-codex-first-sync",
  [string]$Owner = "windows-codex",
  [string]$AppTitle = "Codex",
  [int]$IntervalSeconds = 10,
  [string]$CacheFile = "",
  [switch]$Once,
  [switch]$Force,
  [switch]$PrintOnly,
  [switch]$ClipboardOnly
)

$ErrorActionPreference = "Stop"

if (-not $CacheFile) {
  $CacheFile = Join-Path $env:TEMP "agro-live-bridge-$Owner.last"
}

$remoteRef = "$RemoteName/$BranchName"
$stateRel = "docs/agro/live-bridge/bridge/state.json"
$senderScript = Join-Path $RepoRoot "docs\agro\live-bridge\scripts\send-bridge-prompt-to-windows-codex.ps1"

function Invoke-FetchRemote {
  git -C $RepoRoot fetch $RemoteName $BranchName | Out-Null
}

function Get-RemoteStateJson {
  $content = git -C $RepoRoot show "${remoteRef}:${stateRel}" 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($content)) {
    throw "Required bridge file not found in git ref ${remoteRef}: $stateRel"
  }

  return [string]$content
}

function Get-DispatchToken {
  $state = Get-RemoteStateJson | ConvertFrom-Json
  return @(
    [string]$state.message_id,
    [string]$state.updated_at,
    [string]$state.owner,
    [string]$state.status,
    [string]$state.commit
  ) -join "|"
}

function Should-Dispatch {
  param(
    [string]$CurrentOwner,
    [string]$CurrentToken
  )

  if ($CurrentOwner -ne $Owner) {
    return $false
  }

  if ($Force) {
    return $true
  }

  if (Test-Path -LiteralPath $CacheFile) {
    $cachedToken = Get-Content -LiteralPath $CacheFile -Raw
    return $cachedToken -ne $CurrentToken
  }

  return $true
}

function Invoke-Dispatch {
  $dispatchArgs = @{
    RepoRoot = $RepoRoot
    GitRef = $remoteRef
    AppTitle = $AppTitle
  }

  if ($PrintOnly) {
    $dispatchArgs.PrintOnly = $true
  }

  if ($ClipboardOnly) {
    $dispatchArgs.ClipboardOnly = $true
  }

  & $senderScript @dispatchArgs
}

while ($true) {
  Invoke-FetchRemote
  $state = Get-RemoteStateJson | ConvertFrom-Json
  $token = Get-DispatchToken

  if (Should-Dispatch -CurrentOwner ([string]$state.owner) -CurrentToken $token) {
    try {
      Invoke-Dispatch

      $cacheDir = Split-Path -Parent $CacheFile
      if ($cacheDir -and -not (Test-Path -LiteralPath $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
      }
      Set-Content -LiteralPath $CacheFile -Value $token -NoNewline
    } catch {
      Write-Warning "Bridge dispatch failed for $($state.message_id): $($_.Exception.Message)"
    }
  } else {
    Write-Host "No new bridge task for $Owner on $remoteRef."
  }

  if ($Once) {
    break
  }

  Start-Sleep -Seconds $IntervalSeconds
}

param(
  [string]$RepoRoot = "C:\Users\jessy\Documents\Codex\Gemma",
  [string]$AppTitle = "Codex",
  [string]$GitRef = "",
  [int]$ActivationDelayMs = 700,
  [int]$PostPasteDelayMs = 200,
  [switch]$ClipboardOnly,
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

$inboxPath = Join-Path $RepoRoot "docs\agro\live-bridge\bridge\inbox.md"
$outboxPath = Join-Path $RepoRoot "docs\agro\live-bridge\bridge\outbox.md"
$statePath = Join-Path $RepoRoot "docs\agro\live-bridge\bridge\state.json"
$inboxRel = "docs/agro/live-bridge/bridge/inbox.md"
$stateRel = "docs/agro/live-bridge/bridge/state.json"
$renderScript = Join-Path $RepoRoot "docs\agro\live-bridge\scripts\render-bridge-prompt.mjs"
$activationHelper = Join-Path $RepoRoot "docs\agro\live-bridge\scripts\activate-codex-window.ps1"
$recordScript = Join-Path $RepoRoot "docs\agro\live-bridge\scripts\record-direct-link-delivery.mjs"

. $activationHelper

function Get-BridgeStateJson {
  if ($GitRef) {
    $content = git -C $RepoRoot show "${GitRef}:${stateRel}" 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($content)) {
      throw "Required bridge file not found in git ref ${GitRef}: $stateRel"
    }
    return $content | ConvertFrom-Json
  }

  if (-not (Test-Path -LiteralPath $statePath)) {
    throw "Required bridge file not found: $statePath"
  }

  return (Get-Content -LiteralPath $statePath -Raw) | ConvertFrom-Json
}

function Record-Delivery {
  param(
    [string]$DeliveryStatus,
    [string]$Notes = "repo_watcher_path"
  )

  $state = Get-BridgeStateJson
  $messageId = [string]$state.message_id
  if ([string]::IsNullOrWhiteSpace($messageId)) {
    return
  }

  try {
    & node $recordScript `
      --repo-root $RepoRoot `
      --source-lane "mac-codex" `
      --target-lane "windows-codex" `
      --message-id $messageId `
      --delivery-status $DeliveryStatus `
      --prompt-file "repo-bridge" `
      --notes $Notes
  } catch {
    Write-Warning "Failed to record repo-bridge delivery receipt for $messageId: $($_.Exception.Message)"
  }
}

function Get-BridgeContent {
  param(
    [string]$LocalPath,
    [string]$RelativePath
  )

  if ($GitRef) {
    $content = git -C $RepoRoot show "${GitRef}:${RelativePath}" 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($content)) {
      throw "Required bridge file not found in git ref ${GitRef}: $RelativePath"
    }
    return [string]$content
  }

  if (-not (Test-Path -LiteralPath $LocalPath)) {
    throw "Required bridge file not found: $LocalPath"
  }

  return Get-Content -LiteralPath $LocalPath -Raw
}

$promptArgs = @(
  $renderScript,
  "--repo-root", $RepoRoot,
  "--inbox-path", $inboxPath,
  "--state-path", $statePath,
  "--outbox-path", $outboxPath,
  "--inbox-rel", $inboxRel,
  "--state-rel", $stateRel
)

if ($GitRef) {
  $promptArgs += @("--git-ref", $GitRef)
}

$prompt = & node @promptArgs

Set-Clipboard -Value $prompt

if ($PrintOnly) {
  Write-Output $prompt
  return
}

if ($ClipboardOnly) {
  Record-Delivery -DeliveryStatus "clipboard_only"
  Write-Host "Copied the live bridge prompt to the Windows clipboard."
  return
}

$wShell = New-Object -ComObject WScript.Shell
$activated = Invoke-CodexComposerFocus -AppTitle $AppTitle -ActivationDelayMs $ActivationDelayMs
if (-not $activated) {
  throw "Could not activate the Codex app window using title '$AppTitle'."
}

Start-Sleep -Milliseconds $ActivationDelayMs
$wShell.SendKeys("^v")
Start-Sleep -Milliseconds $PostPasteDelayMs
$wShell.SendKeys("{ENTER}")
Start-Sleep -Milliseconds 120
$wShell.SendKeys("{ENTER}")

Record-Delivery -DeliveryStatus "app_delivered_unconfirmed"
Write-Host "Sent the live bridge prompt to the Windows Codex composer."

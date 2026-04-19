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

$state = Get-BridgeContent -LocalPath $statePath -RelativePath $stateRel | ConvertFrom-Json
$messageId = if ($state.message_id) { [string]$state.message_id } else { "unknown-message" }
$nextStep = if ($state.next_step) { [string]$state.next_step } else { "Read the inbox and continue." }

if ($GitRef) {
  $readBlock = @"
Read from git ref ${GitRef}:
- $inboxRel
- $stateRel

Acknowledge in repo bridge files:
- $outboxPath
- $statePath

If your working tree is behind, inspect via git show ${GitRef}:<path> or fast-forward before acknowledging.
"@
} else {
  $readBlock = @"
Read:
- $inboxPath
- $statePath

Acknowledge in:
- $outboxPath
- $statePath
"@
}

$prompt = @"
Use `$codex-host-handoff-loop.

$readBlock

Current message id: $messageId
Immediate next step: $nextStep

After acknowledging, continue the live bridge task from the inbox.
"@

Set-Clipboard -Value $prompt

if ($PrintOnly) {
  Write-Output $prompt
  return
}

if ($ClipboardOnly) {
  Write-Host "Copied the live bridge prompt to the Windows clipboard."
  return
}

Add-Type -AssemblyName Microsoft.VisualBasic | Out-Null
$wShell = New-Object -ComObject WScript.Shell
$activated = [Microsoft.VisualBasic.Interaction]::AppActivate($AppTitle)
if (-not $activated) {
  throw "Could not activate the Codex app window using title '$AppTitle'."
}

Start-Sleep -Milliseconds $ActivationDelayMs
$wShell.SendKeys("^v")
Start-Sleep -Milliseconds $PostPasteDelayMs
$wShell.SendKeys("{ENTER}")
Start-Sleep -Milliseconds 120
$wShell.SendKeys("{ENTER}")

Write-Host "Sent the live bridge prompt to the Windows Codex composer."

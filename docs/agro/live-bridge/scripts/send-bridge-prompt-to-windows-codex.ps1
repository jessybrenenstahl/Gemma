param(
  [string]$RepoRoot = "C:\Users\jessy\Documents\Codex\Gemma",
  [string]$AppTitle = "Codex",
  [int]$ActivationDelayMs = 700,
  [int]$PostPasteDelayMs = 200,
  [switch]$ClipboardOnly,
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

$inboxPath = Join-Path $RepoRoot "docs\agro\live-bridge\bridge\inbox.md"
$outboxPath = Join-Path $RepoRoot "docs\agro\live-bridge\bridge\outbox.md"
$statePath = Join-Path $RepoRoot "docs\agro\live-bridge\bridge\state.json"

foreach ($requiredPath in @($inboxPath, $statePath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required bridge file not found: $requiredPath"
  }
}

$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$messageId = if ($state.message_id) { [string]$state.message_id } else { "unknown-message" }
$nextStep = if ($state.next_step) { [string]$state.next_step } else { "Read the inbox and continue." }

$prompt = @"
Use `$codex-host-handoff-loop.

Read:
- $inboxPath
- $statePath

Acknowledge in:
- $outboxPath
- $statePath

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

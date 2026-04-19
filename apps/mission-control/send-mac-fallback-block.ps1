param(
  [string]$RecoveryUri = "http://127.0.0.1:3040/api/live-recovery",
  [string]$MacTarget = "jessys-mac-studio",
  [string]$ClipboardBridgeScript = "C:\Users\jessy\Documents\Codex\tmp\tailscale-clipboard-bridge\send-clipboard-to-mac.ps1",
  [string]$ScratchDir = "C:\Users\jessy\Documents\GitHub\Gemma\apps\mission-control\.data\live-recovery"
)

$ErrorActionPreference = "Stop"

$recovery = Invoke-RestMethod -Uri $RecoveryUri -TimeoutSec 20
$actionPack = $recovery.mac_action_pack

if (-not $actionPack) {
  throw "No mac_action_pack is available from $RecoveryUri"
}

if ([string]::IsNullOrWhiteSpace($actionPack.fallback_block)) {
  throw "The current mac_action_pack does not include a fallback_block."
}

$message = @(
  "AGRO Mission Control fallback block from Windows.",
  "",
  "Paste and run this exact block in Mac Terminal:",
  "",
  '```bash',
  $actionPack.fallback_block,
  '```'
) -join "`n"

$deliveries = @()

if (Test-Path -LiteralPath $ClipboardBridgeScript) {
  & pwsh -ExecutionPolicy Bypass -File $ClipboardBridgeScript -Text $message | Out-Null
  $deliveries += [pscustomobject]@{
    channel = "clipboard-bridge"
    target = $MacTarget
    ok = $true
  }
} else {
  $deliveries += [pscustomobject]@{
    channel = "clipboard-bridge"
    target = $MacTarget
    ok = $false
    detail = "Bridge script not found at $ClipboardBridgeScript"
  }
}

New-Item -ItemType Directory -Path $ScratchDir -Force | Out-Null
$fallbackNotePath = Join-Path $ScratchDir "mac-fallback-block.txt"
Set-Content -LiteralPath $fallbackNotePath -Value $message -Encoding utf8

& tailscale file cp $fallbackNotePath "${MacTarget}:" | Out-Null
$deliveries += [pscustomobject]@{
  channel = "taildrop"
  target = $MacTarget
  ok = $true
  file = [System.IO.Path]::GetFileName($fallbackNotePath)
}

[pscustomobject]@{
  ok = $true
  sent_at = (Get-Date).ToString("o")
  target = $MacTarget
  recovery_uri = $RecoveryUri
  note_path = $fallbackNotePath
  deliveries = $deliveries
} | ConvertTo-Json -Depth 8

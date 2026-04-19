param(
  [string]$RecoveryUri = "http://127.0.0.1:3040/api/live-recovery",
  [string]$MacTarget = "jessys-mac-studio",
  [string]$ClipboardBridgeScript = "C:\Users\jessy\Documents\Codex\tmp\tailscale-clipboard-bridge\send-clipboard-to-mac.ps1"
)

$ErrorActionPreference = "Stop"

$recovery = Invoke-RestMethod -Uri $RecoveryUri -TimeoutSec 20
$actionPack = $recovery.mac_action_pack

if (-not $actionPack) {
  throw "No mac_action_pack is available from $RecoveryUri"
}

$message = @(
  "AGRO Mission Control action pack from Windows.",
  "",
  "Preferred:",
  $actionPack.run_block,
  "",
  "Fallback:",
  $actionPack.fallback_block
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

foreach ($path in @($actionPack.script_path, $actionPack.note_path)) {
  if ([string]::IsNullOrWhiteSpace($path)) {
    continue
  }

  if (-not (Test-Path -LiteralPath $path)) {
    $deliveries += [pscustomobject]@{
      channel = "taildrop"
      target = $MacTarget
      ok = $false
      file = [System.IO.Path]::GetFileName($path)
      detail = "File not found at $path"
    }
    continue
  }

  & tailscale file cp $path "${MacTarget}:" | Out-Null
  $deliveries += [pscustomobject]@{
    channel = "taildrop"
    target = $MacTarget
    ok = $true
    file = [System.IO.Path]::GetFileName($path)
  }
}

[pscustomobject]@{
  ok = $true
  sent_at = (Get-Date).ToString("o")
  target = $MacTarget
  recovery_uri = $RecoveryUri
  expected_return_file = $actionPack.expected_return_file
  inline_command = $actionPack.inline_command
  deliveries = $deliveries
} | ConvertTo-Json -Depth 8

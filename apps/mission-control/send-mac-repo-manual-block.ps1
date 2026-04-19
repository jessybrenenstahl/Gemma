param(
  [string]$LaneConfigUri = "http://127.0.0.1:3040/api/lane-config",
  [string]$MacTarget = "jessys-mac-studio",
  [string]$ClipboardBridgeScript = "C:\Users\jessy\Documents\Codex\tmp\tailscale-clipboard-bridge\send-clipboard-to-mac.ps1",
  [string]$ScratchDir = "C:\Users\jessy\Documents\GitHub\Gemma\apps\mission-control\.data\lane-config"
)

$ErrorActionPreference = "Stop"

$laneConfig = Invoke-RestMethod -Uri $LaneConfigUri -TimeoutSec 20
$actionPack = $laneConfig.mac_repo_action_pack

if (-not $actionPack) {
  throw "No mac_repo_action_pack is available from $LaneConfigUri"
}

if ([string]::IsNullOrWhiteSpace($actionPack.manual_block)) {
  throw "The current mac_repo_action_pack does not include a manual_block."
}

$message = @(
  "AGRO Mission Control repo-path manual block from Windows.",
  "",
  "If Taildrop return is failing on the Mac, paste and run this exact block in Mac Terminal.",
  "Then copy the printed USER=/HOST=/REPORT_STATUS=/GEMMA_REPO_PATH=/GEMMA_REPO_ORIGIN= lines into Windows Manual Mac Repo Report and click Apply Pasted Report.",
  "",
  '```bash',
  $actionPack.manual_block,
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
$manualNotePath = Join-Path $ScratchDir "mac-repo-manual-block.txt"
Set-Content -LiteralPath $manualNotePath -Value $message -Encoding utf8

& tailscale file cp $manualNotePath "${MacTarget}:" | Out-Null
$deliveries += [pscustomobject]@{
  channel = "taildrop"
  target = $MacTarget
  ok = $true
  file = [System.IO.Path]::GetFileName($manualNotePath)
}

[pscustomobject]@{
  ok = $true
  sent_at = (Get-Date).ToString("o")
  target = $MacTarget
  lane_config_uri = $LaneConfigUri
  expected_manual_paste_target = "Manual Mac Repo Report"
  note_path = $manualNotePath
  deliveries = $deliveries
} | ConvertTo-Json -Depth 8

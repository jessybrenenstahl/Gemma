param(
  [string]$LaneConfigUri = "http://127.0.0.1:3040/api/lane-config",
  [string]$MacTarget = "jessys-mac-studio",
  [string]$ClipboardBridgeScript = "C:\Users\jessy\Documents\Codex\tmp\tailscale-clipboard-bridge\send-clipboard-to-mac.ps1",
  [string]$ScratchDir = "C:\Users\jessy\Documents\GitHub\Gemma\apps\mission-control\.data\lane-config"
)

$ErrorActionPreference = "Stop"

function Add-UniqueTarget {
  param(
    [System.Collections.Generic.List[string]]$List,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }

  if (-not $List.Contains($Value)) {
    $null = $List.Add($Value)
  }
}

function Get-WindowsTaildropTargets {
  $targets = [System.Collections.Generic.List[string]]::new()
  foreach ($candidate in @(
    "jessy",
    "Jessy",
    "jessy.tail972f90.ts.net",
    "jessy.tail972f90.ts.net.",
    "100.113.117.95"
  )) {
    Add-UniqueTarget -List $targets -Value $candidate
  }

  try {
    $status = tailscale status --json | ConvertFrom-Json -Depth 64
    $self = $status.Self

    Add-UniqueTarget -List $targets -Value $self.HostName
    if (-not [string]::IsNullOrWhiteSpace($self.HostName)) {
      Add-UniqueTarget -List $targets -Value $self.HostName.ToLowerInvariant()
    }

    Add-UniqueTarget -List $targets -Value $self.DNSName
    if (-not [string]::IsNullOrWhiteSpace($self.DNSName)) {
      Add-UniqueTarget -List $targets -Value $self.DNSName.TrimEnd(".")
    }

    foreach ($candidate in @($self.TailscaleIPs)) {
      if ($candidate -is [string] -and $candidate -match '^\d+\.\d+\.\d+\.\d+$') {
        Add-UniqueTarget -List $targets -Value $candidate
      }
    }
  } catch {
  }

  return [string[]]$targets
}

function Get-BashSingleQuotedLiteral {
  param([string]$Value)
  return "'$Value'"
}

function Build-BashTargetArrayLine {
  param([string[]]$Targets)
  $quotedTargets = foreach ($target in $Targets) {
    Get-BashSingleQuotedLiteral -Value $target
  }
  return "taildrop_targets=(" + ($quotedTargets -join " ") + ")"
}

function Render-MacRepoReportScript {
  param(
    [string]$TemplatePath,
    [string]$OutputPath,
    [string[]]$ReturnTargets
  )

  $content = Get-Content -LiteralPath $TemplatePath -Raw
  $replacementLine = Build-BashTargetArrayLine -Targets $ReturnTargets
  $pattern = '(?m)^taildrop_targets=\([^\r\n]*\)$'

  if (-not [regex]::IsMatch($content, $pattern)) {
    throw "Could not find taildrop_targets array in $TemplatePath"
  }

  $rendered = [regex]::Replace(
    $content,
    $pattern,
    [System.Text.RegularExpressions.MatchEvaluator]{
      param($match)
      $replacementLine
    },
    1
  )

  Set-Content -LiteralPath $OutputPath -Value $rendered -Encoding utf8
}

function Build-RepoNudgeMessage {
  param(
    [psobject]$ActionPack,
    [string[]]$ReturnTargets
  )

  $lines = @(
    "AGRO Mission Control repo-path nudge from Windows.",
    "",
    "Preferred:",
    $ActionPack.run_block,
    "",
    "Fallback:",
    $ActionPack.fallback_block,
    "",
    "Return file: agro-mac-repo-path-report.txt",
    "Return targets this bundle will try:",
    ""
  ) + ($ReturnTargets | ForEach-Object { "- $_" })

  if (-not [string]::IsNullOrWhiteSpace($ActionPack.manual_block)) {
    $lines += @(
      "",
      "Manual Paste (use this if Taildrop return fails; paste the output into Windows Manual Mac Repo Report):",
      $ActionPack.manual_block
    )
  }

  return $lines -join "`n"
}

$laneConfig = Invoke-RestMethod -Uri $LaneConfigUri -TimeoutSec 20
$actionPack = $laneConfig.mac_repo_action_pack

if (-not $actionPack) {
  throw "No mac_repo_action_pack is available from $LaneConfigUri"
}

if ([string]::IsNullOrWhiteSpace($actionPack.run_block)) {
  throw "The current mac_repo_action_pack does not include a run_block."
}

if ([string]::IsNullOrWhiteSpace($actionPack.fallback_block)) {
  throw "The current mac_repo_action_pack does not include a fallback_block."
}

$deliveries = @()

New-Item -ItemType Directory -Path $ScratchDir -Force | Out-Null
$returnTargets = [string[]]@($actionPack.return_targets)
if (-not $returnTargets.Length) {
  $returnTargets = Get-WindowsTaildropTargets
}

$message = Build-RepoNudgeMessage -ActionPack $actionPack -ReturnTargets $returnTargets
$renderedScriptPath = Join-Path $ScratchDir "mac-report-gemma-repo-path.sh"
$renderedNotePath = Join-Path $ScratchDir "to-codex-on-mac-report-gemma-repo-path.txt"
$fallbackNotePath = Join-Path $ScratchDir "mac-repo-fallback-block.txt"

if (-not [string]::IsNullOrWhiteSpace($actionPack.script_path) -and (Test-Path -LiteralPath $actionPack.script_path)) {
  Render-MacRepoReportScript -TemplatePath $actionPack.script_path -OutputPath $renderedScriptPath -ReturnTargets $returnTargets
} elseif (-not [string]::IsNullOrWhiteSpace($actionPack.script_path)) {
  $deliveries += [pscustomobject]@{
    channel = "taildrop"
    target = $MacTarget
    ok = $false
    file = [System.IO.Path]::GetFileName($actionPack.script_path)
    detail = "File not found at $($actionPack.script_path)"
  }
}

Set-Content -LiteralPath $renderedNotePath -Value $message -Encoding utf8

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

Set-Content -LiteralPath $fallbackNotePath -Value $message -Encoding utf8

foreach ($path in @($renderedScriptPath, $renderedNotePath, $fallbackNotePath)) {
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
  lane_config_uri = $LaneConfigUri
  expected_return_file = "agro-mac-repo-path-report.txt"
  inline_command = $actionPack.inline_command
  return_targets = $returnTargets
  deliveries = $deliveries
} | ConvertTo-Json -Depth 8

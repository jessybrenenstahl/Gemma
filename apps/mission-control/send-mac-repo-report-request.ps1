param(
  [string]$ArtifactsDir = "C:\Users\jessy\Documents\GitHub\Gemma\artifacts",
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

function Build-RepoReportMessage {
  param([string[]]$ReturnTargets)

  return (@(
    "AGRO Mission Control repo-path request from Windows.",
    "",
    "Run this in Mac Terminal:",
    "",
    "chmod +x ~/Downloads/mac-report-gemma-repo-path.sh 2>/dev/null || true",
    "~/Downloads/mac-report-gemma-repo-path.sh",
    "",
    "This will Taildrop back: agro-mac-repo-path-report.txt",
    "Return targets this bundle will try:",
    ""
  ) + ($ReturnTargets | ForEach-Object { "- $_" })) -join "`n"
}

$scriptPath = Join-Path $ArtifactsDir "mac-report-gemma-repo-path.sh"
$notePath = Join-Path $ArtifactsDir "to-codex-on-mac-report-gemma-repo-path.txt"

if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Mac repo-report script not found at $scriptPath"
}

if (-not (Test-Path -LiteralPath $notePath)) {
  throw "Mac repo-report note not found at $notePath"
}

New-Item -ItemType Directory -Path $ScratchDir -Force | Out-Null

$returnTargets = Get-WindowsTaildropTargets
$renderedScriptPath = Join-Path $ScratchDir "mac-report-gemma-repo-path.sh"
$renderedNotePath = Join-Path $ScratchDir "to-codex-on-mac-report-gemma-repo-path.txt"

Render-MacRepoReportScript -TemplatePath $scriptPath -OutputPath $renderedScriptPath -ReturnTargets $returnTargets

$message = Build-RepoReportMessage -ReturnTargets $returnTargets
Set-Content -LiteralPath $renderedNotePath -Value $message -Encoding utf8

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

foreach ($path in @($renderedScriptPath, $renderedNotePath)) {
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
  expected_return_file = "agro-mac-repo-path-report.txt"
  script_path = $renderedScriptPath
  note_path = $renderedNotePath
  template_script_path = $scriptPath
  template_note_path = $notePath
  return_targets = $returnTargets
  deliveries = $deliveries
} | ConvertTo-Json -Depth 8

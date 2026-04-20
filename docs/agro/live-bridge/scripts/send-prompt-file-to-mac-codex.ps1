param(
  [string]$Target = "jessys-mac-studio",
  [string]$Text,
  [string]$FilePath,
  [string]$Sender = "windows-codex",
  [string]$MessageId,
  [switch]$KeepFile
)

$ErrorActionPreference = "Stop"

if (-not $Text -and -not $FilePath) {
  throw "Pass -Text or -FilePath."
}

if ($FilePath) {
  if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "Message file not found: $FilePath"
  }
  $Text = Get-Content -LiteralPath $FilePath -Raw
}

if ([string]::IsNullOrWhiteSpace($Text)) {
  throw "Prompt bridge aborted because the payload is empty."
}

function Get-EmbeddedMessageId {
  param([string]$Payload)

  $patterns = @(
    '(?m)^Current message id:\s*(.+)\s*$',
    '(?m)^Message ID:\s*(.+)\s*$',
    '(?m)^\s*message_id:\s*(.+)\s*$'
  )

  foreach ($pattern in $patterns) {
    $match = [regex]::Match($Payload, $pattern)
    if ($match.Success) {
      return $match.Groups[1].Value.Trim().Trim('`')
    }
  }

  return ""
}

function New-BridgePayload {
  param(
    [string]$PromptText,
    [string]$PromptSender,
    [string]$PromptTarget,
    [string]$PromptMessageId
  )

  if ($PromptText -match '(?m)^Current message id:\s*' -or $PromptText -match '<!--\s*codex-bridge') {
    return @{
      Text = $PromptText
      MessageId = (Get-EmbeddedMessageId -Payload $PromptText)
    }
  }

  $resolvedMessageId = if ($PromptMessageId) {
    $PromptMessageId
  } else {
    "$PromptSender-$([DateTimeOffset]::UtcNow.ToString('yyyyMMddHHmmss'))-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  }

  $wrapped = @"
<!-- codex-bridge
message_id: $resolvedMessageId
source_lane: $PromptSender
target_lane: $PromptTarget
-->
$PromptText
"@

  return @{
    Text = $wrapped
    MessageId = $resolvedMessageId
  }
}

$tempRoot = Join-Path $env:TEMP "codex-composer-bridge"
$null = New-Item -ItemType Directory -Path $tempRoot -Force

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tempFile = Join-Path $tempRoot "codex-prompt-from-$Sender-$timestamp.md"
$payload = New-BridgePayload -PromptText $Text -PromptSender $Sender -PromptTarget "mac-codex" -PromptMessageId $MessageId

[System.IO.File]::WriteAllText(
  $tempFile,
  $payload.Text,
  [System.Text.UTF8Encoding]::new($false)
)

try {
  & tailscale file cp $tempFile "$Target`:"
  if ($LASTEXITCODE -ne 0) {
    throw "tailscale file cp exited with code $LASTEXITCODE."
  }

  Write-Host "Sent prompt file to $Target via Taildrop."
  Write-Host "Prompt file: $tempFile"
  if ($payload.MessageId) {
    Write-Host "Message id: $($payload.MessageId)"
  }
} finally {
  if (-not $KeepFile -and (Test-Path -LiteralPath $tempFile)) {
    Remove-Item -LiteralPath $tempFile -Force
  }
}

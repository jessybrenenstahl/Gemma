param(
  [string]$Text,
  [string]$FilePath,
  [string]$Sender = "windows-self-test",
  [string]$InboxDir = $(Join-Path $env:USERPROFILE "codex-composer-bridge\inbox"),
  [int]$WaitSeconds = 15,
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

New-Item -ItemType Directory -Path $InboxDir -Force | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$targetFile = Join-Path $InboxDir "codex-prompt-from-$Sender-$timestamp.md"

[System.IO.File]::WriteAllText(
  $targetFile,
  $Text,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Queued prompt file for Windows Codex."
Write-Host "Prompt file: $targetFile"

if ($WaitSeconds -le 0) {
  return
}

$processedDir = Join-Path (Split-Path -Parent $InboxDir) "processed"
$deferredDir = Join-Path (Split-Path -Parent $InboxDir) "deferred"
$processedPath = Join-Path $processedDir (Split-Path -Leaf $targetFile)
$deferredPath = Join-Path $deferredDir (Split-Path -Leaf $targetFile)
$deadline = (Get-Date).AddSeconds($WaitSeconds)

while ((Get-Date) -lt $deadline) {
  if (Test-Path -LiteralPath $processedPath) {
    Write-Host "Prompt file moved to processed."
    if (-not $KeepFile) {
      Remove-Item -LiteralPath $processedPath -Force -ErrorAction SilentlyContinue
    }
    return
  }

  if (Test-Path -LiteralPath $deferredPath) {
    Write-Host "Prompt file moved to deferred for retry."
    return
  }

  if (-not (Test-Path -LiteralPath $targetFile)) {
    Write-Host "Prompt file no longer in inbox."
    return
  }

  Start-Sleep -Milliseconds 300
}

Write-Warning "Timed out waiting for the prompt file to leave inbox."

param(
  [string]$Target = "jessys-mac-studio",
  [string]$Text,
  [string]$FilePath,
  [string]$Sender = "windows-codex",
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

$tempRoot = Join-Path $env:TEMP "codex-composer-bridge"
$null = New-Item -ItemType Directory -Path $tempRoot -Force

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tempFile = Join-Path $tempRoot "codex-prompt-from-$Sender-$timestamp.md"

[System.IO.File]::WriteAllText(
  $tempFile,
  $Text,
  [System.Text.UTF8Encoding]::new($false)
)

try {
  & tailscale file cp $tempFile "$Target`:"
  if ($LASTEXITCODE -ne 0) {
    throw "tailscale file cp exited with code $LASTEXITCODE."
  }

  Write-Host "Sent prompt file to $Target via Taildrop."
  Write-Host "Prompt file: $tempFile"
} finally {
  if (-not $KeepFile -and (Test-Path -LiteralPath $tempFile)) {
    Remove-Item -LiteralPath $tempFile -Force
  }
}

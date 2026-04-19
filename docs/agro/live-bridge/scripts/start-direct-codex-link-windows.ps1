param(
  [string]$RepoRoot = "C:\Users\jessy\Documents\Codex\Gemma",
  [string]$AppTitle = "Codex",
  [string]$RuntimeDir = $(Join-Path $env:LOCALAPPDATA "agro-live-bridge")
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Ensure-Running {
  param(
    [string]$Label,
    [string]$CommandMatch,
    [string[]]$ArgumentList
  )

  $existing = Get-CimInstance Win32_Process |
    Where-Object { ($_.CommandLine -or "") -match [regex]::Escape($CommandMatch) } |
    Select-Object -First 1

  if ($existing) {
    Write-Host "$Label already running with pid $($existing.ProcessId)."
    return
  }

  $stdoutLogPath = Join-Path $RuntimeDir "$Label.stdout.log"
  $stderrLogPath = Join-Path $RuntimeDir "$Label.stderr.log"
  $process = Start-Process -FilePath "pwsh" -ArgumentList $ArgumentList -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutLogPath -RedirectStandardError $stderrLogPath
  Set-Content -LiteralPath (Join-Path $RuntimeDir "$Label.pid") -Value $process.Id
  Write-Host "Started $Label with pid $($process.Id). Logs: $stdoutLogPath ; $stderrLogPath"
}

Ensure-Running `
  -Label "watch-live-bridge-windows" `
  -CommandMatch "watch-live-bridge-windows.ps1" `
  -ArgumentList @(
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $RepoRoot "docs\agro\live-bridge\scripts\watch-live-bridge-windows.ps1"),
    "-RepoRoot", $RepoRoot,
    "-AppTitle", $AppTitle
  )

Ensure-Running `
  -Label "watch-prompts-from-mac-codex" `
  -CommandMatch "watch-prompts-from-mac-codex.ps1" `
  -ArgumentList @(
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $RepoRoot "docs\agro\live-bridge\scripts\watch-prompts-from-mac-codex.ps1"),
    "-AppTitle", $AppTitle
  )

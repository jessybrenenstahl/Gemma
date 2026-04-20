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

  $existing = @(Get-CimInstance Win32_Process |
    Where-Object { ($_.CommandLine -or "") -match [regex]::Escape($CommandMatch) } |
    Select-Object ProcessId, CommandLine)

  if ($existing.Count -gt 1) {
    Write-Host "Multiple $Label processes detected; restarting a single supervised instance."
    foreach ($process in $existing) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
    $existing = @()
  }

  if ($existing.Count -eq 1) {
    Write-Host "$Label already running with pid $($existing[0].ProcessId)."
    return
  }

  $stdoutLogPath = Join-Path $RuntimeDir "$Label.stdout.log"
  $stderrLogPath = Join-Path $RuntimeDir "$Label.stderr.log"
  $supervisor = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    @'
$ErrorActionPreference = "Stop"
$stdout = $args[0]
$stderr = $args[1]
$childArgs = $args[2..($args.Length - 1)]
while ($true) {
  $p = Start-Process -FilePath "pwsh" -ArgumentList $childArgs -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $p.WaitForExit()
  Add-Content -LiteralPath $stdout -Value ("{0} supervisor restart after exit code {1}" -f (Get-Date -Format o), $p.ExitCode)
  Start-Sleep -Seconds 1
}
'@,
    $stdoutLogPath,
    $stderrLogPath
  ) + $ArgumentList
  $process = Start-Process -FilePath "pwsh" -ArgumentList $supervisor -WindowStyle Hidden -PassThru `
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
    "-AppTitle", $AppTitle,
    "-CacheFile", (Join-Path $RuntimeDir "agro-live-bridge-windows.last"),
    "-SeenFile", (Join-Path $RuntimeDir "watch-live-bridge-windows.seen")
  )

Ensure-Running `
  -Label "watch-prompts-from-mac-codex" `
  -CommandMatch "watch-prompts-from-mac-codex.ps1" `
  -ArgumentList @(
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $RepoRoot "docs\agro\live-bridge\scripts\watch-prompts-from-mac-codex.ps1"),
    "-RepoRoot", $RepoRoot,
    "-AppTitle", $AppTitle,
    "-SeenFile", (Join-Path $RuntimeDir "watch-prompts-from-mac-codex.seen")
  )

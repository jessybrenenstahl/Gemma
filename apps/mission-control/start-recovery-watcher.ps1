param(
  [int]$Attempts = 0,
  [int]$IntervalSeconds = 15
)

$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$watcherScript = Join-Path $appRoot "recover-dual-live.ps1"
$recoveryDir = Join-Path $appRoot ".data\live-recovery"
$stdoutPath = Join-Path $recoveryDir "watcher-output.txt"
$stderrPath = Join-Path $recoveryDir "watcher-error.txt"
$pidPath = Join-Path $recoveryDir "watcher.pid"

if (-not (Test-Path $watcherScript)) {
  throw "Missing watcher script at $watcherScript"
}

New-Item -ItemType Directory -Force -Path $recoveryDir | Out-Null

function Wait-ForProcessExit {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) {
      return $true
    }

    Start-Sleep -Milliseconds 250
  }

  return -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Remove-FileWithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [int]$Attempts = 20,

    [int]$DelayMilliseconds = 250
  )

  if (-not (Test-Path $Path)) {
    return
  }

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -eq $Attempts) {
        Write-Warning "Unable to clear $Path before watcher relaunch: $($_.Exception.Message)"
        return
      }

      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }
}

$existing = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "pwsh.exe" -and $_.CommandLine -match "recover-dual-live\.ps1"
}

foreach ($process in $existing) {
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    [void](Wait-ForProcessExit -ProcessId $process.ProcessId)
  } catch {
    Write-Warning "Failed to stop existing watcher process $($process.ProcessId): $($_.Exception.Message)"
  }
}

Remove-FileWithRetry -Path $stdoutPath
Remove-FileWithRetry -Path $stderrPath

$process = Start-Process `
  -FilePath pwsh `
  -ArgumentList @(
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $watcherScript,
    "-Attempts",
    $Attempts,
    "-IntervalSeconds",
    $IntervalSeconds
  ) `
  -WorkingDirectory $appRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

[pscustomobject]@{
  process_id = $process.Id
  stdout = $stdoutPath
  stderr = $stderrPath
  pid_file = $pidPath
  attempts = $Attempts
  interval_seconds = $IntervalSeconds
} | ConvertTo-Json -Depth 4 | Set-Content -Path $pidPath

[pscustomobject]@{
  process_id = $process.Id
  stdout = $stdoutPath
  stderr = $stderrPath
  pid_file = $pidPath
  attempts = $Attempts
  interval_seconds = $IntervalSeconds
} | ConvertTo-Json -Depth 4

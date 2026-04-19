param()

$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$watcherScript = Join-Path $appRoot "watch-taildrop-inbox.ps1"
$inboxDir = Join-Path $appRoot ".data\taildrop-inbox"
$stdoutPath = Join-Path $inboxDir "taildrop-watcher-output.txt"
$stderrPath = Join-Path $inboxDir "taildrop-watcher-error.txt"
$pidPath = Join-Path $inboxDir "taildrop-watcher.pid"

if (-not (Test-Path $watcherScript)) {
  throw "Missing watcher script at $watcherScript"
}

New-Item -ItemType Directory -Force -Path $inboxDir | Out-Null

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
  $_.Name -eq "pwsh.exe" -and $_.CommandLine -match "watch-taildrop-inbox\.ps1"
}

foreach ($process in $existing) {
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    [void](Wait-ForProcessExit -ProcessId $process.ProcessId)
  } catch {
    Write-Warning "Failed to stop existing taildrop watcher process $($process.ProcessId): $($_.Exception.Message)"
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
    $watcherScript
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
} | ConvertTo-Json -Depth 4 | Set-Content -Path $pidPath

[pscustomobject]@{
  process_id = $process.Id
  stdout = $stdoutPath
  stderr = $stderrPath
  pid_file = $pidPath
} | ConvertTo-Json -Depth 4

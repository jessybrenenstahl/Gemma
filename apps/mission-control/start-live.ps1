$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverEntry = Join-Path $appRoot "server\start.mjs"
$laneConfigDir = Join-Path $appRoot ".data\lane-config"
$macRepoWatcherPidPath = Join-Path $laneConfigDir "mac-repo-report-watcher.pid"
$macRepoWatcherStartPath = Join-Path $laneConfigDir "last-mac-repo-report-watcher-start.json"
$macRepoWatcherStartScript = Join-Path $appRoot "start-mac-repo-report-watcher.ps1"
$lmStudioCli = "C:\Users\jessy\AppData\Local\Programs\LM Studio\resources\app\.webpack\lms.exe"
$pcModel = "gemma-4-26b-a4b-it"
$macModel = "google/gemma-4-26b-a4b"
$macEndpointCandidates = @(
  "http://jessys-mac-studio.tail972f90.ts.net:1234",
  "http://100.106.61.53:1234",
  "https://jessys-mac-studio.tail972f90.ts.net"
)

function Test-MacEndpoint {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Endpoint
  )

  $uri = ($Endpoint.TrimEnd("/") + "/v1/models")
  try {
    $response = Invoke-WebRequest -Uri $uri -TimeoutSec 15 -SkipHttpErrorCheck
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
      return $true
    }
  } catch {
    return $false
  }

  return $false
}

function Test-PcChatReady {
  $body = @{
    model = $pcModel
    messages = @(
      @{
        role = "user"
        content = "Say only: ready"
      }
    )
    temperature = 0
    max_tokens = 8
    stream = $false
  } | ConvertTo-Json -Depth 6

  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:1234/v1/chat/completions" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 20 -SkipHttpErrorCheck
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Read-JsonFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  try {
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Get-MacRepoWatcherConfig {
  function Resolve-WatcherCadence {
    param(
      $Value,
      [int]$DefaultValue
    )

    $parsed = 0
    if ($null -ne $Value) {
      $parsed = [int]$Value
    }

    if ($parsed -gt 0) {
      return $parsed
    }

    return $DefaultValue
  }

  $pidData = Read-JsonFile -Path $macRepoWatcherPidPath
  if ($pidData -and -not [string]::IsNullOrWhiteSpace([string]$pidData.session_id)) {
    return [pscustomobject]@{
      session_id = [string]$pidData.session_id
      interval_seconds = Resolve-WatcherCadence -Value $pidData.interval_seconds -DefaultValue 15
      resend_every_attempts = Resolve-WatcherCadence -Value $pidData.resend_every_attempts -DefaultValue 8
      nudge_every_attempts = Resolve-WatcherCadence -Value $pidData.nudge_every_attempts -DefaultValue 24
      fallback_every_attempts = Resolve-WatcherCadence -Value $pidData.fallback_every_attempts -DefaultValue 12
      manual_every_attempts = Resolve-WatcherCadence -Value $pidData.manual_every_attempts -DefaultValue 36
    }
  }

  $startData = Read-JsonFile -Path $macRepoWatcherStartPath
  if ($startData -and -not [string]::IsNullOrWhiteSpace([string]$startData.session_id)) {
    return [pscustomobject]@{
      session_id = [string]$startData.session_id
      interval_seconds = Resolve-WatcherCadence -Value $startData.interval_seconds -DefaultValue 15
      resend_every_attempts = Resolve-WatcherCadence -Value $startData.resend_every_attempts -DefaultValue 8
      nudge_every_attempts = Resolve-WatcherCadence -Value $startData.nudge_every_attempts -DefaultValue 24
      fallback_every_attempts = Resolve-WatcherCadence -Value $startData.fallback_every_attempts -DefaultValue 12
      manual_every_attempts = Resolve-WatcherCadence -Value $startData.manual_every_attempts -DefaultValue 36
    }
  }

  return $null
}

if (-not (Test-Path $serverEntry)) {
  throw "Mission-control server entry not found at $serverEntry"
}

if (-not (Test-Path $lmStudioCli)) {
  throw "LM Studio CLI not found at $lmStudioCli"
}

Write-Host "Ensuring LM Studio local server is running..." -ForegroundColor Cyan
& $lmStudioCli server start | Out-Host

Write-Host "Ensuring the local reviewer model is loaded..." -ForegroundColor Cyan
$loadedJson = & $lmStudioCli ps --json
$loadedModels = @()
if ($loadedJson) {
  try {
    $loadedModels = $loadedJson | ConvertFrom-Json
  } catch {
    $loadedModels = @()
  }
}

$pcModelLoaded = $false
foreach ($loadedModel in $loadedModels) {
  if ($loadedModel.identifier -eq $pcModel) {
    $pcModelLoaded = $true
    break
  }
}

if (-not $pcModelLoaded) {
  & $lmStudioCli load gemma-4-26b-a4b-it --gpu off -c 131072 --ttl 1800 --identifier $pcModel -y | Out-Host
}

Write-Host "Waiting for local reviewer chat readiness..." -ForegroundColor Cyan
$pcReady = $false
for ($attempt = 1; $attempt -le 10; $attempt++) {
  if (Test-PcChatReady) {
    $pcReady = $true
    break
  }
  Start-Sleep -Seconds 2
}

if (-not $pcReady) {
  throw "Local reviewer chat endpoint did not become ready after restart."
}

$macEndpoint = $null
foreach ($candidate in $macEndpointCandidates) {
  Write-Host "Probing Mac endpoint candidate $candidate ..." -ForegroundColor Cyan
  if (Test-MacEndpoint -Endpoint $candidate) {
    $macEndpoint = $candidate
    break
  }
}

if (-not $macEndpoint) {
  $macEndpoint = $macEndpointCandidates[0]
  Write-Host "No healthy Mac endpoint found yet; falling back to $macEndpoint" -ForegroundColor Yellow
} else {
  Write-Host "Selected healthy Mac endpoint $macEndpoint" -ForegroundColor Green
}

Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -match "apps\\mission-control\\server\\start\.mjs"
  } |
  ForEach-Object {
    Write-Host "Stopping existing mission-control process $($_.ProcessId)..." -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force
  }

$env:AGRO_PC_MODEL = $pcModel
$env:AGRO_PC_TIMEOUT_MS = "90000"
$env:AGRO_PC_REPO_PATH = "C:\Users\jessy\Documents\GitHub\Gemma"
$env:AGRO_MAC_ENDPOINT = $macEndpoint
$env:AGRO_MAC_MODEL = $macModel
$env:AGRO_MAC_TRANSPORT = "openai_chat"

$watcherConfig = Get-MacRepoWatcherConfig

Write-Host "Starting AGRO Mission Control..." -ForegroundColor Green
Start-Process -FilePath node -ArgumentList $serverEntry -WorkingDirectory (Split-Path -Parent (Split-Path -Parent $serverEntry)) -WindowStyle Hidden | Out-Null

Start-Sleep -Seconds 2

$status = Invoke-RestMethod -Uri "http://127.0.0.1:3040/api/status" -TimeoutSec 15

if ($watcherConfig -and (Test-Path -LiteralPath $macRepoWatcherStartScript)) {
  Write-Host "Refreshing Mac repo watcher onto the current script..." -ForegroundColor Cyan
  Start-Process -FilePath pwsh -ArgumentList @(
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $macRepoWatcherStartScript,
    "-Attempts",
    "0",
    "-IntervalSeconds",
    [string]$watcherConfig.interval_seconds,
    "-ResendEveryAttempts",
    [string]$watcherConfig.resend_every_attempts,
    "-NudgeEveryAttempts",
    [string]$watcherConfig.nudge_every_attempts,
    "-FallbackEveryAttempts",
    [string]$watcherConfig.fallback_every_attempts,
    "-ManualEveryAttempts",
    [string]$watcherConfig.manual_every_attempts,
    "-SessionId",
    [string]$watcherConfig.session_id
  ) -WorkingDirectory $appRoot -WindowStyle Hidden | Out-Null
}

Write-Host "Mission Control is live at http://127.0.0.1:3040" -ForegroundColor Green
Write-Host ("Routes: " + (($status.available_routes | ForEach-Object { $_ }) -join ", ")) -ForegroundColor Gray
Write-Host ("Mac endpoint: " + $macEndpoint) -ForegroundColor Gray
Write-Host "PC reviewer chat endpoint: ready" -ForegroundColor Gray

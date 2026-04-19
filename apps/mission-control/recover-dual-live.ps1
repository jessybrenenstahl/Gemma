param(
  [int]$Attempts = 1,
  [int]$IntervalSeconds = 15
)

$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startLiveScript = Join-Path $appRoot "start-live.ps1"
$checkLiveScript = Join-Path $appRoot "check-live.ps1"
$resultsDir = Join-Path $appRoot ".data\live-recovery"
$resultsFile = Join-Path $resultsDir "latest-dual-verify.json"
$taildropInboxDir = Join-Path $appRoot ".data\taildrop-inbox"
$downloadsDir = Join-Path $HOME "Downloads"
$macSshUser = "jessy"
$macSshHost = "100.106.61.53"
$macSshKeyPath = Join-Path $HOME ".ssh\agro_mac_bridge_ed25519"

if (-not (Test-Path $startLiveScript)) {
  throw "Missing start-live script at $startLiveScript"
}

if (-not (Test-Path $checkLiveScript)) {
  throw "Missing check-live script at $checkLiveScript"
}

New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

function Write-RecoverySummary {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Summary
  )

  $Summary | ConvertTo-Json -Depth 100 | Set-Content -Path $resultsFile
}

function Test-HasRemainingAttempts {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Attempt,

    [Parameter(Mandatory = $true)]
    [int]$ConfiguredAttempts
  )

  if ($ConfiguredAttempts -le 0) {
    return $true
  }

  return $Attempt -lt $ConfiguredAttempts
}

function Get-LatestMacBridgeReport {
  $candidateFiles = @()
  $searchRoots = @(
    [pscustomobject]@{
      source = "taildrop-inbox"
      path = $taildropInboxDir
    },
    [pscustomobject]@{
      source = "downloads"
      path = $downloadsDir
    }
  )

  foreach ($root in $searchRoots) {
    if (-not (Test-Path -LiteralPath $root.path)) {
      continue
    }

    $matches = Get-ChildItem -LiteralPath $root.path -Filter "agro-mac-ssh-bridge-report*.txt" -File -ErrorAction SilentlyContinue
    foreach ($match in $matches) {
      $candidateFiles += [pscustomobject]@{
        source = $root.source
        path = $match.FullName
        name = $match.Name
        last_write_time = $match.LastWriteTime
      }
    }
  }

  if (-not $candidateFiles.Count) {
    return $null
  }

  $latest = $candidateFiles | Sort-Object -Property last_write_time -Descending | Select-Object -First 1
  $content = Get-Content -LiteralPath $latest.path -Raw -ErrorAction Stop

  [pscustomobject]@{
    source = $latest.source
    path = $latest.path
    name = $latest.name
    updated_at = $latest.last_write_time.ToString("o")
    content = $content
  }
}

function ConvertTo-MacBridgeReport {
  param(
    [pscustomobject]$RawReport
  )

  if ($null -eq $RawReport -or [string]::IsNullOrWhiteSpace($RawReport.content)) {
    return $null
  }

  $text = [string]$RawReport.content
  $userMatch = [regex]::Match($text, '^USER=(.+)$', 'Multiline')
  $hostMatch = [regex]::Match($text, '^HOST=(.+)$', 'Multiline')
  $missingEntries = [regex]::Matches($text, '^MISSING:\s+(.+)$', 'Multiline') | ForEach-Object {
    $_.Groups[1].Value.Trim()
  }
  $keyMissing = $text -match 'MISSING:\s+agro-mac-bridge'
  $keyPresent = (-not $keyMissing) -and ($text -match 'agro-mac-bridge')
  $sshDirMissing = @($missingEntries | Where-Object { $_ -match '(?:^|[\\/])\.ssh$' }).Count -gt 0
  $authorizedKeysMissing = @($missingEntries | Where-Object { $_ -match 'authorized_keys$' }).Count -gt 0

  [pscustomobject]@{
    source = $RawReport.source
    path = $RawReport.path
    name = $RawReport.name
    updated_at = $RawReport.updated_at
    user = if ($userMatch.Success) { $userMatch.Groups[1].Value.Trim() } else { $null }
    host = if ($hostMatch.Success) { $hostMatch.Groups[1].Value.Trim() } else { $null }
    key_missing = $keyMissing
    key_present = $keyPresent
    ssh_dir_missing = $sshDirMissing
    authorized_keys_missing = $authorizedKeysMissing
    missing_entries = @($missingEntries)
  }
}

function Invoke-MacSshCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$UserName,

    [Parameter(Mandatory = $true)]
    [string]$RemoteCommand
  )

  if (-not (Test-Path -LiteralPath $macSshKeyPath)) {
    return [pscustomobject]@{
      ok = $false
      exit_code = 0
      body = "SSH key not found at $macSshKeyPath"
    }
  }

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $arguments = @(
      "-i",
      $macSshKeyPath,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=8",
      "-o",
      "LogLevel=ERROR",
      "$UserName@$macSshHost",
      $RemoteCommand
    )

    & ssh @arguments 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
    $stdoutRaw = Get-Content -Path $stdoutPath -Raw -ErrorAction SilentlyContinue
    $stderrRaw = Get-Content -Path $stderrPath -Raw -ErrorAction SilentlyContinue
    $stdoutText = if ($null -eq $stdoutRaw) { "" } else { ([string]$stdoutRaw).Trim() }
    $stderrText = if ($null -eq $stderrRaw) { "" } else { ([string]$stderrRaw).Trim() }
    $bodyParts = @($stdoutText, $stderrText) | Where-Object { $_ }
    $body = $bodyParts -join "`n"

    return [pscustomobject]@{
      ok = ($exitCode -eq 0)
      exit_code = $exitCode
      body = if ($body) { $body } else { "ssh exit $exitCode" }
    }
  } catch {
    return [pscustomobject]@{
      ok = $false
      exit_code = 0
      body = $_.Exception.Message
    }
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-MacSshRepair {
  param(
    [Parameter(Mandatory = $true)]
    [string]$UserName
  )

  $repairCommand = @'
bash -lc '
set -euo pipefail
mkdir -p "$HOME/Downloads"
tailscale serve get-config > "$HOME/Downloads/tailscale-serve-backup-gemma.json" 2>/dev/null || true
curl -fsS http://127.0.0.1:1234/v1/models >/dev/null
tailscale serve reset || true
tailscale serve --yes --bg --tcp=1234 127.0.0.1:1234
tailscale serve --yes --bg --https=443 http://127.0.0.1:1234
tailscale serve status
'
'@

  $result = Invoke-MacSshCommand -UserName $UserName -RemoteCommand $repairCommand
  [pscustomobject]@{
    ok = $result.ok
    attempted_at = (Get-Date).ToString("o")
    body = $result.body
    exit_code = $result.exit_code
  }
}

function Invoke-RouteProbe {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RouteName,

    [Parameter(Mandatory = $true)]
    [hashtable]$Payload
  )

  $uri = "http://127.0.0.1:3040/api/routes/$RouteName"
  $body = $Payload | ConvertTo-Json -Depth 8

  try {
    $response = Invoke-WebRequest -Uri $uri -Method Post -ContentType "application/json" -Body $body -SkipHttpErrorCheck -TimeoutSec 120
    [pscustomobject]@{
      route = $RouteName
      ok = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
      status = $response.StatusCode
      body = if ($response.Content) { $response.Content | ConvertFrom-Json -Depth 100 } else { $null }
    }
  } catch {
    [pscustomobject]@{
      route = $RouteName
      ok = $false
      status = 0
      body = $_.Exception.Message
    }
  }
}

$attempt = 0
while ($true) {
  $attempt += 1
  $attemptLabel = if ($Attempts -le 0) { "uncapped" } else { $Attempts }
  Write-Host "Recovery attempt $attempt of $attemptLabel..." -ForegroundColor Cyan

  $rawBridgeReport = Get-LatestMacBridgeReport
  $macBridgeReport = ConvertTo-MacBridgeReport -RawReport $rawBridgeReport
  $effectiveMacSshUser = if ($macBridgeReport?.user) { [string]$macBridgeReport.user } else { $macSshUser }

  $healthJson = pwsh -ExecutionPolicy Bypass -File $checkLiveScript -MacSshUser $effectiveMacSshUser
  $health = $healthJson | ConvertFrom-Json -Depth 100
  $healthyMac = $health | Where-Object {
    $_.label -like "mac-models-*" -and $_.ok
  } | Select-Object -First 1
  $sshBridgeProbe = $health | Where-Object {
    $_.label -eq "mac-ssh-${effectiveMacSshUser}_100.106.61.53"
  } | Select-Object -First 1
  $sshRepair = $null

  if (-not $healthyMac -and $sshBridgeProbe?.ok) {
    Write-Host "SSH bridge is healthy. Attempting remote Mac Serve repair..." -ForegroundColor Green
    $sshRepair = Invoke-MacSshRepair -UserName $effectiveMacSshUser
    Start-Sleep -Seconds 3
    $healthJson = pwsh -ExecutionPolicy Bypass -File $checkLiveScript -MacSshUser $effectiveMacSshUser
    $health = $healthJson | ConvertFrom-Json -Depth 100
    $healthyMac = $health | Where-Object {
      $_.label -like "mac-models-*" -and $_.ok
    } | Select-Object -First 1
    $sshBridgeProbe = $health | Where-Object {
      $_.label -eq "mac-ssh-${effectiveMacSshUser}_100.106.61.53"
    } | Select-Object -First 1
  }

  $waitingSummary = [pscustomobject]@{
    status = "waiting"
    recovered_at = $null
    continuous = ($Attempts -le 0)
    attempts_completed = $attempt
    attempts_configured = $Attempts
    last_checked_at = (Get-Date).ToString("o")
    last_health = $health
    mac_bridge_report = $macBridgeReport
    effective_ssh_user = $effectiveMacSshUser
    ssh_bridge = $sshBridgeProbe
    ssh_repair = $sshRepair
    message = if ($Attempts -le 0) {
      "Still waiting for a healthy Mac endpoint. The recovery watcher is running continuously."
    } else {
      "Still waiting for a healthy Mac endpoint."
    }
  }
  Write-RecoverySummary -Summary $waitingSummary

  if ($healthyMac) {
    Write-Host "Healthy Mac endpoint detected via $($healthyMac.label)." -ForegroundColor Green
    pwsh -ExecutionPolicy Bypass -File $startLiveScript | Out-Host
    Start-Sleep -Seconds 2

    $routeResults = @(
      Invoke-RouteProbe -RouteName "send-mac" -Payload @{
        prompt = "Reply with exactly MAC_READY if the Mac execution lane is functioning."
        repo = "jessybrenenstahl/Gemma"
      }
      Invoke-RouteProbe -RouteName "send-both" -Payload @{
        prompt = "Reply with a short status for each lane."
        repo = "jessybrenenstahl/Gemma"
      }
      Invoke-RouteProbe -RouteName "compare" -Payload @{
        prompt = "In one sentence, assess current dual-lane health."
        repo = "jessybrenenstahl/Gemma"
      }
    )

    $summary = [pscustomobject]@{
      status = "recovered"
      recovered_at = (Get-Date).ToString("o")
      continuous = ($Attempts -le 0)
      attempts_completed = $attempt
      attempts_configured = $Attempts
      mac_probe = $healthyMac
      last_health = $health
      mac_bridge_report = $macBridgeReport
      effective_ssh_user = $effectiveMacSshUser
      route_results = $routeResults
    }

    Write-RecoverySummary -Summary $summary
    $summary | ConvertTo-Json -Depth 100
    exit 0
  }

  if (Test-HasRemainingAttempts -Attempt $attempt -ConfiguredAttempts $Attempts) {
    Write-Host "No healthy Mac endpoint yet. Sleeping for $IntervalSeconds seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  break
}

$failure = [pscustomobject]@{
  status = "exhausted"
  recovered_at = $null
  attempts = $Attempts
  attempts_completed = $attempt
  attempts_configured = $Attempts
  continuous = ($Attempts -le 0)
  last_checked_at = (Get-Date).ToString("o")
  last_health = $health
  mac_bridge_report = $macBridgeReport
  effective_ssh_user = $effectiveMacSshUser
  message = "No healthy Mac endpoint was found during the recovery window."
}

Write-RecoverySummary -Summary $failure
$failure | ConvertTo-Json -Depth 100

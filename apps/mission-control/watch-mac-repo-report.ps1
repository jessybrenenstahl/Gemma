param(
  [string]$LaneConfigUri = "http://127.0.0.1:3040/api/lane-config/pull-and-apply-mac-repo-report",
  [string]$MacRepoRequestUri = "http://127.0.0.1:3040/api/lane-config/request-mac-repo-report",
  [string]$MacRepoNudgeUri = "http://127.0.0.1:3040/api/lane-config/send-mac-repo-nudge",
  [string]$MacRepoFallbackUri = "http://127.0.0.1:3040/api/lane-config/send-mac-repo-fallback-block",
  [string]$MacRepoManualUri = "http://127.0.0.1:3040/api/lane-config/send-mac-repo-manual-block",
  [int]$Attempts = 0,
  [int]$IntervalSeconds = 15,
  [int]$ResendEveryAttempts = 8,
  [int]$NudgeEveryAttempts = 24,
  [int]$FallbackEveryAttempts = 12,
  [int]$ManualEveryAttempts = 36,
  [int]$ManualPreferredAtAttempts = 6,
  [string]$SessionId = ""
)

$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateDir = Join-Path $appRoot ".data\lane-config"
$summaryPath = Join-Path $stateDir "mac-repo-report-watch.json"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Write-Summary {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Summary
  )

  $Summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding utf8
}

function Read-PreviousSummary {
  if (-not (Test-Path -LiteralPath $summaryPath)) {
    return @{}
  }

  try {
    $raw = Get-Content -LiteralPath $summaryPath -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return @{}
    }

    return $raw | ConvertFrom-Json -AsHashtable
  } catch {
    return @{}
  }
}

function Copy-PreservedSummaryFields {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Summary,

    [Parameter(Mandatory = $true)]
    [hashtable]$PreviousSummary
  )

  $preserveKeys = @(
    "last_request_attempt",
    "last_request_status_code",
    "last_request_result",
    "last_request_message",
    "last_request_error",
    "last_nudge_attempt",
    "last_nudge_status_code",
    "last_nudge_result",
    "last_nudge_message",
    "last_nudge_error",
    "last_fallback_attempt",
    "last_fallback_status_code",
    "last_fallback_result",
    "last_fallback_message",
    "last_fallback_error",
    "last_manual_attempt",
    "last_manual_status_code",
    "last_manual_result",
    "last_manual_message",
    "last_manual_error",
    "manual_preferred_sent_at"
  )

  foreach ($key in $preserveKeys) {
    if ($PreviousSummary.ContainsKey($key) -and -not $Summary.ContainsKey($key)) {
      $Summary[$key] = $PreviousSummary[$key]
    }
  }
}

$attempt = 0

while ($true) {
  $attempt += 1
  $body = @{}
  if (-not [string]::IsNullOrWhiteSpace($SessionId)) {
    $body.session_id = $SessionId
  }

  $summary = @{
    status = "waiting"
    attempts_completed = $attempt
    attempts_configured = $Attempts
    interval_seconds = $IntervalSeconds
    resend_every_attempts = $ResendEveryAttempts
    nudge_every_attempts = $NudgeEveryAttempts
    fallback_every_attempts = $FallbackEveryAttempts
    manual_every_attempts = $ManualEveryAttempts
    manual_preferred_at_attempts = $ManualPreferredAtAttempts
    last_checked_at = (Get-Date).ToString("o")
    lane_config_uri = $LaneConfigUri
    mac_repo_request_uri = $MacRepoRequestUri
    mac_repo_nudge_uri = $MacRepoNudgeUri
    mac_repo_fallback_uri = $MacRepoFallbackUri
    mac_repo_manual_uri = $MacRepoManualUri
    session_id = if ([string]::IsNullOrWhiteSpace($SessionId)) { $null } else { $SessionId }
  }
  $previousSummary = Read-PreviousSummary
  Copy-PreservedSummaryFields -Summary $summary -PreviousSummary $previousSummary

  $shouldSendNudge = $NudgeEveryAttempts -gt 0 -and (
    $attempt -eq 1 -or
    ($attempt % $NudgeEveryAttempts -eq 0)
  )
  $shouldResendRequest = $ResendEveryAttempts -gt 0 -and (
    $attempt -eq 1 -or
    (($attempt - 1) % $ResendEveryAttempts -eq 0)
  )
  if ($shouldSendNudge) {
    $shouldResendRequest = $false
  }

  if ($shouldResendRequest) {
    try {
      $requestResponse = Invoke-WebRequest -Uri $MacRepoRequestUri -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 30 -SkipHttpErrorCheck
      $requestPayload = if ([string]::IsNullOrWhiteSpace($requestResponse.Content)) {
        @{}
      } else {
        $requestResponse.Content | ConvertFrom-Json
      }
      $summary.last_request_attempt = $attempt
      $summary.last_request_status_code = [int]$requestResponse.StatusCode
      $summary.last_request_result = if ($requestPayload.result) { $requestPayload.result } else { $requestPayload }
      $summary.last_request_message = if ($requestPayload.message) {
        [string]$requestPayload.message
      } else {
        "Re-sent Mac repo-path request."
      }
      Write-Output ("Attempt {0}: re-sent Mac repo-path request ({1})." -f $attempt, $requestResponse.StatusCode)
    } catch {
      $summary.status = "warn"
      $summary.last_request_attempt = $attempt
      $summary.last_request_status_code = 0
      $summary.last_request_error = $_.Exception.Message
      $summary.last_request_message = "Failed to re-send the Mac repo-path request."
      Write-Output ("Attempt {0}: failed to re-send Mac repo-path request: {1}" -f $attempt, $_.Exception.Message)
    }
  }

  $shouldSendFallback = $FallbackEveryAttempts -gt 0 -and ($attempt % $FallbackEveryAttempts -eq 0)
  if ($shouldSendNudge) {
    $shouldSendFallback = $false
  }
  $shouldSendManual = $ManualEveryAttempts -gt 0 -and ($attempt % $ManualEveryAttempts -eq 0)
  $previousManualAttempt = 0
  if ($previousSummary.ContainsKey("last_manual_attempt")) {
    $previousManualAttempt = [int]($previousSummary.last_manual_attempt)
  }
  $shouldTriggerManualPreferred = $ManualPreferredAtAttempts -gt 0 -and (
    $attempt -ge $ManualPreferredAtAttempts -and $previousManualAttempt -lt $ManualPreferredAtAttempts
  )
  if ($shouldSendNudge) {
    $shouldSendManual = $false
  }
  if (-not $shouldSendManual -and $shouldTriggerManualPreferred) {
    $shouldSendManual = $true
  }

  if ($shouldSendNudge) {
    try {
      $nudgeResponse = Invoke-WebRequest -Uri $MacRepoNudgeUri -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 30 -SkipHttpErrorCheck
      $nudgePayload = if ([string]::IsNullOrWhiteSpace($nudgeResponse.Content)) {
        @{}
      } else {
        $nudgeResponse.Content | ConvertFrom-Json
      }
      $summary.last_nudge_attempt = $attempt
      $summary.last_nudge_status_code = [int]$nudgeResponse.StatusCode
      $summary.last_nudge_result = if ($nudgePayload.result) { $nudgePayload.result } else { $nudgePayload }
      $summary.last_nudge_message = if ($nudgePayload.message) {
        [string]$nudgePayload.message
      } else {
        "Sent the combined Mac repo nudge."
      }
      Write-Output ("Attempt {0}: sent Mac repo nudge ({1})." -f $attempt, $nudgeResponse.StatusCode)
    } catch {
      $summary.status = "warn"
      $summary.last_nudge_attempt = $attempt
      $summary.last_nudge_status_code = 0
      $summary.last_nudge_error = $_.Exception.Message
      $summary.last_nudge_message = "Failed to send the combined Mac repo nudge."
      Write-Output ("Attempt {0}: failed to send Mac repo nudge: {1}" -f $attempt, $_.Exception.Message)
    }
  }

  if ($shouldSendFallback) {
    try {
      $fallbackResponse = Invoke-WebRequest -Uri $MacRepoFallbackUri -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 30 -SkipHttpErrorCheck
      $fallbackPayload = if ([string]::IsNullOrWhiteSpace($fallbackResponse.Content)) {
        @{}
      } else {
        $fallbackResponse.Content | ConvertFrom-Json
      }
      $summary.last_fallback_attempt = $attempt
      $summary.last_fallback_status_code = [int]$fallbackResponse.StatusCode
      $summary.last_fallback_result = if ($fallbackPayload.result) { $fallbackPayload.result } else { $fallbackPayload }
      $summary.last_fallback_message = if ($fallbackPayload.message) {
        [string]$fallbackPayload.message
      } else {
        "Sent Mac repo fallback block."
      }
      Write-Output ("Attempt {0}: sent Mac repo fallback block ({1})." -f $attempt, $fallbackResponse.StatusCode)
    } catch {
      $summary.status = "warn"
      $summary.last_fallback_attempt = $attempt
      $summary.last_fallback_status_code = 0
      $summary.last_fallback_error = $_.Exception.Message
      $summary.last_fallback_message = "Failed to send the Mac repo fallback block."
      Write-Output ("Attempt {0}: failed to send Mac repo fallback block: {1}" -f $attempt, $_.Exception.Message)
    }
  }

  if ($shouldSendManual) {
    try {
      $manualResponse = Invoke-WebRequest -Uri $MacRepoManualUri -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 30 -SkipHttpErrorCheck
      $manualPayload = if ([string]::IsNullOrWhiteSpace($manualResponse.Content)) {
        @{}
      } else {
        $manualResponse.Content | ConvertFrom-Json
      }
      $summary.last_manual_attempt = $attempt
      $summary.last_manual_status_code = [int]$manualResponse.StatusCode
      $summary.last_manual_result = if ($manualPayload.result) { $manualPayload.result } else { $manualPayload }
      $summary.last_manual_message = if ($manualPayload.message) {
        [string]$manualPayload.message
      } else {
        "Sent Mac repo manual block."
      }
      if ($shouldTriggerManualPreferred) {
        $summary.manual_preferred_sent_at = (Get-Date).ToString("o")
      }
      Write-Output ("Attempt {0}: sent Mac repo manual block ({1})." -f $attempt, $manualResponse.StatusCode)
    } catch {
      $summary.status = "warn"
      $summary.last_manual_attempt = $attempt
      $summary.last_manual_status_code = 0
      $summary.last_manual_error = $_.Exception.Message
      $summary.last_manual_message = "Failed to send the Mac repo manual block."
      Write-Output ("Attempt {0}: failed to send Mac repo manual block: {1}" -f $attempt, $_.Exception.Message)
    }
  }

  try {
    $response = Invoke-WebRequest -Uri $LaneConfigUri -Method Post -ContentType "application/json" -Body ($body | ConvertTo-Json) -TimeoutSec 30 -SkipHttpErrorCheck
    $payload = $response.Content | ConvertFrom-Json
    $summary.last_status_code = [int]$response.StatusCode
    $summary.last_message = [string]$payload.message
    $summary.pull_result = $payload.pull_result
    $summary.mac_repo_report = $payload.mac_repo_report
    $summary.lane_config = $payload.lane_config

    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300 -and $payload.ok) {
      $summary.status = "applied"
      $summary.applied_at = (Get-Date).ToString("o")
      Write-Summary -Summary $summary
      Write-Output ("Attempt {0}: applied Mac repo report." -f $attempt)
      break
    }

    if ($payload.code) {
      $summary.code = [string]$payload.code
    }
    if ($response.StatusCode -ne 409) {
      $summary.status = "warn"
    }
    if ($response.StatusCode -eq 409) {
      Write-Output ("Attempt {0}: waiting for Mac repo-path report." -f $attempt)
    } else {
      Write-Output ("Attempt {0}: watcher received status {1}." -f $attempt, $response.StatusCode)
    }
  } catch {
    $summary.status = "warn"
    $summary.last_message = $_.Exception.Message
    Write-Output ("Attempt {0}: watcher error: {1}" -f $attempt, $_.Exception.Message)
  }

  Write-Summary -Summary $summary

  if ($Attempts -gt 0 -and $attempt -ge $Attempts) {
    $summary.status = "exhausted"
    Write-Summary -Summary $summary
    Write-Output ("Mac repo report watcher exhausted after {0} attempt(s)." -f $attempt)
    break
  }

  Start-Sleep -Seconds $IntervalSeconds
}

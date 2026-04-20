param(
  [string]$RepoRoot = "C:\Users\jessy\Documents\Codex\Gemma",
  [string]$RemoteName = "origin",
  [string]$BranchName = "codex/mac-codex-first-sync",
  [string]$Subject,
  [string]$Message,
  [string]$MessageFile = "",
  [string]$NextStep,
  [string]$Status = "pending",
  [int]$MaxRetries = 5,
  [switch]$DirectPrompt,
  [switch]$NoDirectPrompt,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not $Subject) {
  throw "Missing required argument: -Subject"
}

if (-not $NextStep) {
  throw "Missing required argument: -NextStep"
}

if ($MessageFile) {
  $Message = Get-Content -LiteralPath $MessageFile -Raw
} elseif (-not $Message -and -not [Console]::IsInputRedirected) {
  $Message = ""
} elseif (-not $Message) {
  $Message = [Console]::In.ReadToEnd()
}

if (-not $Message) {
  throw "Message body is empty. Use -Message, -MessageFile, or stdin."
}

$fromLane = "windows-codex"
$toLane = "mac-codex"
$macRepoRoot = "/Users/jessybrenenstahl/Documents/Sprint/Gemma"
$timestamp = [DateTimeOffset]::Now.ToString("yyyy-MM-ddTHH:mm:sszzz")
$messageId = "windows-{0}-{1}" -f ([DateTimeOffset]::Now.ToString("yyyyMMdd-HHmmss")), $PID
$commitSha = (git -C $RepoRoot rev-parse --short HEAD).Trim()
$senderBranch = (git -C $RepoRoot branch --show-current).Trim()
$remoteRef = "$RemoteName/$BranchName"
$renderScript = Join-Path $RepoRoot "docs\agro\live-bridge\scripts\render-bridge-prompt.mjs"
$promptFileSender = Join-Path $RepoRoot "docs\agro\live-bridge\scripts\send-prompt-file-to-mac-codex.ps1"

function Write-BridgeFiles {
  param(
    [string]$WorktreePath
  )

  $inboxPath = Join-Path $WorktreePath "docs\agro\live-bridge\bridge\inbox.md"
  $statePath = Join-Path $WorktreePath "docs\agro\live-bridge\bridge\state.json"
  $logPath = Join-Path $WorktreePath "docs\agro\live-bridge\logs\events.log"

  $inbox = @"
# Inbox

Message ID: $messageId
From: $fromLane
To: $toLane
Sent At: $timestamp

## Subject

$Subject

## Message

$Message

## Current Source Of Truth

- Repo branch: $BranchName
- Sender branch: $senderBranch
- Sender commit: $commitSha

## Immediate Next Step For $toLane

$NextStep
"@

  Set-Content -LiteralPath $inboxPath -Value $inbox

  $state = [ordered]@{
    status = $Status
    owner = $toLane
    updated_at = $timestamp
    message_id = $messageId
    branch = $BranchName
    commit = $commitSha
    next_step = $NextStep
    needs_continuation = $true
  } | ConvertTo-Json -Depth 5

  Set-Content -LiteralPath $statePath -Value $state

  $eventLine = "{0} {1} sent {2} to {3} on {4}; next step: {5}" -f $timestamp, $fromLane, $messageId, $toLane, $BranchName, $NextStep
  Add-Content -LiteralPath $logPath -Value $eventLine
}

function Remove-WorktreePath {
  param([string]$WorktreePath)

  if (Test-Path -LiteralPath $WorktreePath) {
    git -C $RepoRoot worktree remove --force $WorktreePath *> $null
    if (Test-Path -LiteralPath $WorktreePath) {
      Remove-Item -LiteralPath $WorktreePath -Recurse -Force
    }
  }
}

function Send-DirectPrompt {
  $prompt = & node $renderScript `
    --repo-root $RepoRoot `
    --git-ref $remoteRef `
    --inbox-path "$macRepoRoot/docs/agro/live-bridge/bridge/inbox.md" `
    --state-path "$macRepoRoot/docs/agro/live-bridge/bridge/state.json" `
    --outbox-path "$macRepoRoot/docs/agro/live-bridge/bridge/outbox.md"

  try {
    & $promptFileSender -Text $prompt
  } catch {
    Write-Warning "Bridge message published, but direct prompt-file delivery to Mac Codex failed: $($_.Exception.Message)"
  }
}

if ($DryRun) {
  git -C $RepoRoot fetch $RemoteName $BranchName *> $null
  $tempPath = Join-Path $env:TEMP ("agro-bridge-dryrun-" + [guid]::NewGuid().ToString("N"))
  git -C $RepoRoot worktree add --detach $tempPath $remoteRef *> $null
  try {
    Write-BridgeFiles -WorktreePath $tempPath
    Get-Content -LiteralPath (Join-Path $tempPath "docs\agro\live-bridge\bridge\inbox.md")
    "`n--- state.json ---"
    Get-Content -LiteralPath (Join-Path $tempPath "docs\agro\live-bridge\bridge\state.json")
  } finally {
    Remove-WorktreePath -WorktreePath $tempPath
  }
  return
}

for ($attempt = 1; $attempt -le $MaxRetries; $attempt += 1) {
  git -C $RepoRoot fetch $RemoteName $BranchName *> $null
  $tempPath = Join-Path $env:TEMP ("agro-bridge-send-" + [guid]::NewGuid().ToString("N"))
  git -C $RepoRoot worktree add --detach $tempPath $remoteRef *> $null

  try {
    Write-BridgeFiles -WorktreePath $tempPath
    git -C $tempPath add docs/agro/live-bridge/bridge/inbox.md docs/agro/live-bridge/bridge/state.json docs/agro/live-bridge/logs/events.log *> $null
    git -C $tempPath commit -m "Bridge message windows -> mac: $Subject" *> $null
    git -C $tempPath push $RemoteName HEAD:$BranchName *> $null
    if ($DirectPrompt -and -not $NoDirectPrompt) {
      git -C $RepoRoot fetch $RemoteName $BranchName *> $null
      Send-DirectPrompt
    }
    Write-Host "Published $messageId to $toLane on $BranchName."
    return
  } catch {
    if ($attempt -ge $MaxRetries) {
      throw
    }
    Start-Sleep -Seconds 1
  } finally {
    Remove-WorktreePath -WorktreePath $tempPath
  }
}

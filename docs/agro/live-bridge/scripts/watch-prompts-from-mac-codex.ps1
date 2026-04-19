param(
  [string]$RepoRoot = "C:\Users\jessy\Documents\Codex\Gemma",
  [string]$InboxDir = $(Join-Path $env:USERPROFILE "codex-composer-bridge\inbox"),
  [string]$ProcessedDir = $(Join-Path $env:USERPROFILE "codex-composer-bridge\processed"),
  [string]$DeferredDir = $(Join-Path $env:USERPROFILE "codex-composer-bridge\deferred"),
  [string]$AppTitle = "Codex",
  [int]$ActivationDelayMs = 700,
  [int]$PostPasteDelayMs = 200,
  [switch]$NoSend,
  [switch]$Once
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $InboxDir | Out-Null
New-Item -ItemType Directory -Force -Path $ProcessedDir | Out-Null
New-Item -ItemType Directory -Force -Path $DeferredDir | Out-Null

$scriptDir = Split-Path -Parent $PSCommandPath
$activationHelper = Join-Path $scriptDir "activate-codex-window.ps1"

. $activationHelper

$getProcess = Start-Process -FilePath tailscale -ArgumentList @(
  "file", "get", "--loop", "--conflict=rename", $InboxDir
) -PassThru -WindowStyle Hidden

Write-Host "Watching for Mac Codex prompt files in $InboxDir"

$wShell = New-Object -ComObject WScript.Shell
$recordScript = Join-Path $RepoRoot "docs\agro\live-bridge\scripts\record-direct-link-delivery.mjs"

function Get-MessageId {
  param([string]$Payload)

  $match = [regex]::Match($Payload, '(?m)^Current message id:\s*(.+)\s*$')
  if ($match.Success) {
    return $match.Groups[1].Value.Trim()
  }

  return ""
}

function Record-Delivery {
  param(
    [string]$MessageId,
    [string]$DeliveryStatus,
    [string]$PromptFile,
    [string]$Notes = ""
  )

  if (-not $MessageId) {
    return
  }

  try {
    & node $recordScript `
      --repo-root $RepoRoot `
      --source-lane "mac-codex" `
      --target-lane "windows-codex" `
      --message-id $MessageId `
      --delivery-status $DeliveryStatus `
      --prompt-file $PromptFile `
      --notes $Notes
  } catch {
    Write-Warning "Failed to record delivery receipt for $MessageId: $($_.Exception.Message)"
  }
}

try {
  while ($true) {
    $nextFile = @(
      Get-ChildItem -LiteralPath $DeferredDir -File -Filter "codex-prompt-from-*.md" -ErrorAction SilentlyContinue
      Get-ChildItem -LiteralPath $InboxDir -File -Filter "codex-prompt-from-*.md" -ErrorAction SilentlyContinue
    ) |
      Sort-Object LastWriteTime |
      Select-Object -First 1

    if (-not $nextFile) {
      Start-Sleep -Milliseconds 500
      continue
    }

    $payload = Get-Content -LiteralPath $nextFile.FullName -Raw
    $messageId = Get-MessageId -Payload $payload
    $deliveryStatus = ""
    if (-not [string]::IsNullOrWhiteSpace($payload)) {
      Set-Clipboard -Value $payload
      if (-not $NoSend) {
        $activated = Invoke-CodexWindowActivation -AppTitle $AppTitle -ActivationDelayMs $ActivationDelayMs
        if ($activated) {
          $wShell.SendKeys("^v")
          Start-Sleep -Milliseconds $PostPasteDelayMs
          $wShell.SendKeys("{ENTER}")
          Start-Sleep -Milliseconds 120
          $wShell.SendKeys("{ENTER}")
          $deliveryStatus = "delivered"
          Write-Host "Delivered $($nextFile.Name) into the Windows Codex composer."
          Move-Item -LiteralPath $nextFile.FullName -Destination (Join-Path $ProcessedDir $nextFile.Name) -Force
        } else {
          $deliveryStatus = "activation_failed"
          if ($nextFile.DirectoryName -ne $DeferredDir) {
            Move-Item -LiteralPath $nextFile.FullName -Destination (Join-Path $DeferredDir $nextFile.Name) -Force
          }
          Write-Warning "Could not activate Codex. Prompt kept for retry in $DeferredDir from $($nextFile.Name)."
          Start-Sleep -Seconds 5
        }
      } else {
        $deliveryStatus = "clipboard_only"
        Write-Host "Loaded $($nextFile.Name) into the Windows clipboard only."
        Move-Item -LiteralPath $nextFile.FullName -Destination (Join-Path $ProcessedDir $nextFile.Name) -Force
      }
    }

    if (-not $deliveryStatus) {
      $deliveryStatus = "empty"
    }
    Record-Delivery -MessageId $messageId -DeliveryStatus $deliveryStatus -PromptFile $nextFile.Name
    if ($Once) {
      break
    }
  }
} finally {
  if ($getProcess -and -not $getProcess.HasExited) {
    Stop-Process -Id $getProcess.Id -Force
  }
}

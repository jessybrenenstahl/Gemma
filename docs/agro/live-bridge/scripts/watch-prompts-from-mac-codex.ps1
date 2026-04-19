param(
  [string]$InboxDir = $(Join-Path $env:USERPROFILE "codex-composer-bridge\inbox"),
  [string]$ProcessedDir = $(Join-Path $env:USERPROFILE "codex-composer-bridge\processed"),
  [string]$AppTitle = "Codex",
  [int]$ActivationDelayMs = 700,
  [int]$PostPasteDelayMs = 200,
  [switch]$NoSend,
  [switch]$Once
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $InboxDir | Out-Null
New-Item -ItemType Directory -Force -Path $ProcessedDir | Out-Null

$getProcess = Start-Process -FilePath tailscale -ArgumentList @(
  "file", "get", "--loop", "--conflict=rename", $InboxDir
) -PassThru -WindowStyle Hidden

Write-Host "Watching for Mac Codex prompt files in $InboxDir"

Add-Type -AssemblyName Microsoft.VisualBasic | Out-Null
$wShell = New-Object -ComObject WScript.Shell

try {
  while ($true) {
    $nextFile = Get-ChildItem -LiteralPath $InboxDir -File -Filter "codex-prompt-from-*.md" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime |
      Select-Object -First 1

    if (-not $nextFile) {
      Start-Sleep -Milliseconds 500
      continue
    }

    $payload = Get-Content -LiteralPath $nextFile.FullName -Raw
    if (-not [string]::IsNullOrWhiteSpace($payload)) {
      Set-Clipboard -Value $payload
      if (-not $NoSend) {
        $activated = [Microsoft.VisualBasic.Interaction]::AppActivate($AppTitle)
        if ($activated) {
          Start-Sleep -Milliseconds $ActivationDelayMs
          $wShell.SendKeys("^v")
          Start-Sleep -Milliseconds $PostPasteDelayMs
          $wShell.SendKeys("{ENTER}")
          Start-Sleep -Milliseconds 120
          $wShell.SendKeys("{ENTER}")
          Write-Host "Delivered $($nextFile.Name) into the Windows Codex composer."
        } else {
          Write-Warning "Could not activate Codex. Prompt left in clipboard from $($nextFile.Name)."
        }
      } else {
        Write-Host "Loaded $($nextFile.Name) into the Windows clipboard only."
      }
    }

    Move-Item -LiteralPath $nextFile.FullName -Destination (Join-Path $ProcessedDir $nextFile.Name) -Force
    if ($Once) {
      break
    }
  }
} finally {
  if ($getProcess -and -not $getProcess.HasExited) {
    Stop-Process -Id $getProcess.Id -Force
  }
}

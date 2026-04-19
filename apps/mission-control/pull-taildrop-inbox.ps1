param(
  [string]$InboxDir = $(Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) ".data\taildrop-inbox")
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $InboxDir | Out-Null

$stdoutPath = [System.IO.Path]::GetTempFileName()
$stderrPath = [System.IO.Path]::GetTempFileName()

try {
  & tailscale file get --verbose --conflict=rename $InboxDir 1> $stdoutPath 2> $stderrPath
  $exitCode = $LASTEXITCODE
  $stdoutRaw = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
  $stderrRaw = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
  $stdoutText = if ($null -eq $stdoutRaw) { "" } else { ([string]$stdoutRaw).Trim() }
  $stderrText = if ($null -eq $stderrRaw) { "" } else { ([string]$stderrRaw).Trim() }
  $combined = @($stdoutText, $stderrText) | Where-Object { $_ } | ForEach-Object { $_.Trim() }
  $message = $combined -join "`n"

  $movedMatch = [regex]::Match($message, 'moved\s+(\d+)/(\d+)\s+files', 'IgnoreCase')
  $files = Get-ChildItem -LiteralPath $InboxDir -File -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime |
    Sort-Object LastWriteTime -Descending

  [pscustomobject]@{
    ok = ($exitCode -eq 0)
    pulled_at = (Get-Date).ToString("o")
    inbox_dir = $InboxDir
    command_output = if ($message) { $message } else { "No output." }
    moved = if ($movedMatch.Success) { [int]$movedMatch.Groups[1].Value } else { 0 }
    total_reported = if ($movedMatch.Success) { [int]$movedMatch.Groups[2].Value } else { 0 }
    files = @($files)
  } | ConvertTo-Json -Depth 8
} finally {
  Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
}

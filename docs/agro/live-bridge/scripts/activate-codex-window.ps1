param()

$script:CodexWindowInteropLoaded = $script:CodexWindowInteropLoaded -or $false

function Initialize-CodexWindowInterop {
  if ($script:CodexWindowInteropLoaded) {
    return
  }

  Add-Type -AssemblyName Microsoft.VisualBasic | Out-Null

  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class CodexWindowInterop {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

  $script:CodexWindowInteropLoaded = $true
}

function Get-CodexWindowCandidates {
  param(
    [string]$AppTitle = "Codex",
    [string]$ProcessName = "Codex"
  )

  Get-Process |
    Where-Object {
      $_.MainWindowHandle -ne 0 -and (
        $_.ProcessName -eq $ProcessName -or
        $_.MainWindowTitle -eq $AppTitle -or
        $_.MainWindowTitle -like "*$AppTitle*"
      )
    } |
    Sort-Object @{
      Expression = {
        if ($_.MainWindowTitle -eq $AppTitle) { 0 }
        elseif ($_.ProcessName -eq $ProcessName) { 1 }
        else { 2 }
      }
    }, StartTime
}

function Invoke-CodexWindowActivation {
  param(
    [string]$AppTitle = "Codex",
    [string]$ProcessName = "Codex",
    [int]$ActivationDelayMs = 700
  )

  Initialize-CodexWindowInterop

  $wShell = New-Object -ComObject WScript.Shell
  $candidates = @(Get-CodexWindowCandidates -AppTitle $AppTitle -ProcessName $ProcessName)

  if (-not $candidates.Count) {
    return $false
  }

  foreach ($candidate in $candidates) {
    $attempts = @(
      { [Microsoft.VisualBasic.Interaction]::AppActivate($candidate.Id) },
      { $wShell.AppActivate($candidate.Id) },
      { [Microsoft.VisualBasic.Interaction]::AppActivate($candidate.MainWindowTitle) },
      { $wShell.AppActivate($candidate.MainWindowTitle) }
    )

    foreach ($attempt in $attempts) {
      try {
        $result = & $attempt
        if ($result) {
          Start-Sleep -Milliseconds $ActivationDelayMs
          return $true
        }
      } catch {}
    }

    try {
      [CodexWindowInterop]::ShowWindowAsync($candidate.MainWindowHandle, 5) | Out-Null
      Start-Sleep -Milliseconds 120
      if ([CodexWindowInterop]::SetForegroundWindow($candidate.MainWindowHandle)) {
        Start-Sleep -Milliseconds $ActivationDelayMs
        return $true
      }
    } catch {}
  }

  return $false
}

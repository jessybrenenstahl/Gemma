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
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT point);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
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

function Invoke-CodexComposerFocus {
  param(
    [string]$AppTitle = "Codex",
    [string]$ProcessName = "Codex",
    [int]$ActivationDelayMs = 700,
    [int]$ComposerBottomPaddingPx = 110
  )

  if (-not (Invoke-CodexWindowActivation -AppTitle $AppTitle -ProcessName $ProcessName -ActivationDelayMs $ActivationDelayMs)) {
    return $false
  }

  $candidate = @(Get-CodexWindowCandidates -AppTitle $AppTitle -ProcessName $ProcessName | Select-Object -First 1)
  if (-not $candidate.Count) {
    return $false
  }

  $rect = New-Object CodexWindowInterop+RECT
  $originalPoint = New-Object CodexWindowInterop+POINT
  if (-not [CodexWindowInterop]::GetWindowRect($candidate[0].MainWindowHandle, [ref]$rect)) {
    return $true
  }

  [CodexWindowInterop]::GetCursorPos([ref]$originalPoint) | Out-Null

  $width = [Math]::Max(1, $rect.Right - $rect.Left)
  $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $targetX = $rect.Left + [Math]::Floor($width / 2)
  $targetY = [Math]::Max($rect.Top + [Math]::Floor($height * 0.55), $rect.Bottom - $ComposerBottomPaddingPx)

  [CodexWindowInterop]::SetCursorPos($targetX, $targetY) | Out-Null
  Start-Sleep -Milliseconds 80
  [CodexWindowInterop]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [CodexWindowInterop]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
  [CodexWindowInterop]::SetCursorPos($originalPoint.X, $originalPoint.Y) | Out-Null

  return $true
}

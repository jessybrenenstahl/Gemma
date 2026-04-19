param(
  [string]$MacSshUser = "jessy"
)

$ErrorActionPreference = "Continue"

function Invoke-DnsCheck {
  param(
    [string]$Label,
    [string]$HostName
  )

  try {
    $records = Resolve-DnsName -Name $HostName -ErrorAction Stop |
      Where-Object { $_.Type -eq "A" -and $_.IPAddress } |
      Select-Object -ExpandProperty IPAddress

    [pscustomobject]@{
      label = $Label
      ok = ($records.Count -gt 0)
      status = if ($records.Count -gt 0) { 1 } else { 0 }
      body = if ($records.Count -gt 0) {
        "Resolved to: $($records -join ', ')"
      } else {
        "No A records returned."
      }
    }
  } catch {
    [pscustomobject]@{
      label = $Label
      ok = $false
      status = 0
      body = $_.Exception.Message
    }
  }
}

function Invoke-TcpCheck {
  param(
    [string]$Label,
    [string]$HostName,
    [int]$Port
  )

  try {
    $result = Test-NetConnection -ComputerName $HostName -Port $Port -InformationLevel Detailed -WarningAction SilentlyContinue
    $ok = [bool]$result.TcpTestSucceeded
    $remoteAddress = if ($result.RemoteAddress) { $result.RemoteAddress.IPAddressToString } else { $HostName }
    [pscustomobject]@{
      label = $Label
      ok = $ok
      status = if ($ok) { 1 } else { 0 }
      body = if ($ok) {
        "TCP $Port reachable at $remoteAddress"
      } else {
        "TCP $Port not reachable at $remoteAddress"
      }
    }
  } catch {
    [pscustomobject]@{
      label = $Label
      ok = $false
      status = 0
      body = $_.Exception.Message
    }
  }
}

function Invoke-CurlHttpCheck {
  param(
    [string]$Label,
    [string]$Uri,
    [switch]$Insecure
  )

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $arguments = @(
      "-sS",
      "-o",
      "NUL",
      "-w",
      "%{http_code}",
      "--max-time",
      "15",
      "--connect-timeout",
      "5"
    )

    if ($Insecure) {
      $arguments += "-k"
    }

    $arguments += $Uri

    & curl.exe @arguments 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
    $stdoutRaw = Get-Content -Path $stdoutPath -Raw -ErrorAction SilentlyContinue
    $stderrRaw = Get-Content -Path $stderrPath -Raw -ErrorAction SilentlyContinue
    $statusText = if ($null -eq $stdoutRaw) { "" } else { ([string]$stdoutRaw).Trim() }
    $stderrText = if ($null -eq $stderrRaw) { "" } else { ([string]$stderrRaw).Trim() }

    if ($exitCode -eq 0) {
      $statusCode = 0
      if ($statusText -match '^\d+$') {
        $statusCode = [int]$statusText
      }

      return [pscustomobject]@{
        label = $Label
        ok = ($statusCode -ge 200 -and $statusCode -lt 300)
        status = $statusCode
        body = "HTTP $statusCode"
      }
    }

    $message = switch ($exitCode) {
      52 { "Socket opened but no HTTP response body was returned." }
      56 { "Socket opened and the HTTP request was sent, then the connection was reset." }
      default {
        if ($stderrText) {
          "curl exit ${exitCode}: $stderrText"
        } else {
          "curl exit $exitCode"
        }
      }
    }

    return [pscustomobject]@{
      label = $Label
      ok = $false
      status = 0
      body = $message
    }
  } catch {
    return [pscustomobject]@{
      label = $Label
      ok = $false
      status = 0
      body = $_.Exception.Message
    }
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-SshCheck {
  param(
    [string]$Label,
    [string]$UserName,
    [string]$HostName,
    [string]$KeyPath,
    [string]$Command = "echo AGRO_SSH_OK"
  )

  if (-not (Test-Path -LiteralPath $KeyPath)) {
    return [pscustomobject]@{
      label = $Label
      ok = $false
      status = 0
      body = "SSH key not found at $KeyPath"
    }
  }

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $arguments = @(
      "-i",
      $KeyPath,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=8",
      "-o",
      "LogLevel=ERROR",
      "$UserName@$HostName",
      $Command
    )

    & ssh @arguments 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
    $stdoutRaw = Get-Content -Path $stdoutPath -Raw -ErrorAction SilentlyContinue
    $stderrRaw = Get-Content -Path $stderrPath -Raw -ErrorAction SilentlyContinue
    $stdoutText = if ($null -eq $stdoutRaw) { "" } else { ([string]$stdoutRaw).Trim() }
    $stderrText = if ($null -eq $stderrRaw) { "" } else { ([string]$stderrRaw).Trim() }

    if ($exitCode -eq 0 -and $stdoutText -match "AGRO_SSH_OK") {
      return [pscustomobject]@{
        label = $Label
        ok = $true
        status = 1
        body = if ($stdoutText) { $stdoutText } else { "SSH bridge is healthy." }
      }
    }

    $message = if ($stderrText) {
      $stderrText
    } elseif ($stdoutText) {
      $stdoutText
    } else {
      "ssh exit $exitCode"
    }

    return [pscustomobject]@{
      label = $Label
      ok = $false
      status = 0
      body = $message
    }
  } catch {
    return [pscustomobject]@{
      label = $Label
      ok = $false
      status = 0
      body = $_.Exception.Message
    }
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-JsonCheck {
  param(
    [string]$Label,
    [string]$Uri,
    [string]$Method = "GET",
    [string]$Body = ""
  )

  try {
    if ($Method -eq "POST") {
      $response = Invoke-WebRequest -Uri $Uri -Method Post -ContentType "application/json" -Body $Body -SkipHttpErrorCheck -TimeoutSec 45
    } else {
      $response = Invoke-WebRequest -Uri $Uri -SkipHttpErrorCheck -TimeoutSec 20
    }

    [pscustomobject]@{
      label = $Label
      ok = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
      status = $response.StatusCode
      body = $response.Content
    }
  } catch {
    [pscustomobject]@{
      label = $Label
      ok = $false
      status = 0
      body = $_.Exception.Message
    }
  }
}

$macEndpointCandidates = @(
  "http://jessys-mac-studio.tail972f90.ts.net:1234",
  "http://100.106.61.53:1234",
  "https://jessys-mac-studio.tail972f90.ts.net"
)

$checks = @()
$checks += Invoke-JsonCheck -Label "mission-control-status" -Uri "http://127.0.0.1:3040/api/status"
$checks += Invoke-JsonCheck -Label "pc-models" -Uri "http://127.0.0.1:1234/v1/models"
$checks += Invoke-DnsCheck -Label "mac-dns-jessys-mac-studio.tail972f90.ts.net" -HostName "jessys-mac-studio.tail972f90.ts.net"
$checks += Invoke-TcpCheck -Label "mac-tcp-jessys-mac-studio.tail972f90.ts.net_1234" -HostName "jessys-mac-studio.tail972f90.ts.net" -Port 1234
$checks += Invoke-TcpCheck -Label "mac-tcp-100.106.61.53_1234" -HostName "100.106.61.53" -Port 1234
$checks += Invoke-TcpCheck -Label "mac-tcp-jessys-mac-studio.tail972f90.ts.net_443" -HostName "jessys-mac-studio.tail972f90.ts.net" -Port 443
$checks += Invoke-SshCheck -Label "mac-ssh-${MacSshUser}_100.106.61.53" -UserName $MacSshUser -HostName "100.106.61.53" -KeyPath (Join-Path $HOME ".ssh\agro_mac_bridge_ed25519")
$checks += Invoke-CurlHttpCheck -Label "mac-http-jessys-mac-studio.tail972f90.ts.net_1234" -Uri "http://jessys-mac-studio.tail972f90.ts.net:1234/v1/models"
$checks += Invoke-CurlHttpCheck -Label "mac-http-100.106.61.53_1234" -Uri "http://100.106.61.53:1234/v1/models"
$checks += Invoke-CurlHttpCheck -Label "mac-http-jessys-mac-studio.tail972f90.ts.net_443" -Uri "https://jessys-mac-studio.tail972f90.ts.net/v1/models" -Insecure
$pcChatBody = @{
  model = "gemma-4-26b-a4b-it"
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
$checks += Invoke-JsonCheck -Label "pc-chat" -Uri "http://127.0.0.1:1234/v1/chat/completions" -Method "POST" -Body $pcChatBody
foreach ($candidate in $macEndpointCandidates) {
  $labelBase = $candidate.Replace("https://", "").Replace("http://", "").Replace(":", "_").Replace("/", "_")
  $checks += Invoke-JsonCheck -Label ("mac-models-" + $labelBase) -Uri ($candidate.TrimEnd("/") + "/v1/models")
}

$pcBody = @{
  prompt = "Reply with exactly READY if the local reviewer route is functioning."
} | ConvertTo-Json -Depth 4
$checks += Invoke-JsonCheck -Label "send-pc-route" -Uri "http://127.0.0.1:3040/api/routes/send-pc" -Method "POST" -Body $pcBody

$checks | ConvertTo-Json -Depth 6

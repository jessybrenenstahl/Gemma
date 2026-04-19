$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$inboxDir = Join-Path $appRoot ".data\taildrop-inbox"

New-Item -ItemType Directory -Force -Path $inboxDir | Out-Null

& tailscale file get --loop --conflict=rename $inboxDir

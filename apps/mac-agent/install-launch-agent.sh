#!/usr/bin/env bash
set -euo pipefail

LABEL="${AGRO_MAC_AGENT_LABEL:-io.agro.mac-agent}"
AGENT_DIR="${AGRO_MAC_AGENT_DIR:-$HOME/.agent-mac}"
ENDPOINT="${AGRO_MAC_ENDPOINT:-http://127.0.0.1:1234}"
MODEL="${AGRO_MAC_MODEL:-google/gemma-4-26b-a4b}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_SCRIPT="$SCRIPT_DIR/run.sh"
PLIST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"

mkdir -p "$PLIST_DIR" "$LOG_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$RUN_SCRIPT</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>AGRO_MAC_AGENT_DIR</key>
    <string>$AGENT_DIR</string>
    <key>AGRO_MAC_ENDPOINT</key>
    <string>$ENDPOINT</string>
    <key>AGRO_MAC_MODEL</key>
    <string>$MODEL</string>
  </dict>

  <key>KeepAlive</key>
  <true/>

  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/agro-mac-agent.log</string>

  <key>StandardErrorPath</key>
  <string>$LOG_DIR/agro-mac-agent.log</string>
</dict>
</plist>
PLIST

chmod 644 "$PLIST_PATH"

if [[ "${1:-}" == "--load" ]]; then
  launchctl bootout "gui/$UID" "$PLIST_PATH" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$PLIST_PATH"
  launchctl kickstart -k "gui/$UID/$LABEL"
  echo "Installed and loaded $PLIST_PATH"
else
  echo "Installed $PLIST_PATH"
  echo "Run with --load to start it immediately."
fi

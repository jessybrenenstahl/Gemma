#!/bin/bash
set -euo pipefail

APP_NAME="Codex"
NO_SEND=0
ONCE=0
BRIDGE_ROOT="${HOME}/codex-composer-bridge"
INBOX_DIR="${BRIDGE_ROOT}/inbox"
PROCESSED_DIR="${BRIDGE_ROOT}/processed"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-name)
      APP_NAME="$2"
      shift 2
      ;;
    --no-send)
      NO_SEND=1
      shift
      ;;
    --once)
      ONCE=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "${INBOX_DIR}" "${PROCESSED_DIR}"

echo "Watching for Windows Codex prompt files in ${INBOX_DIR}"
tailscale file get --loop --conflict=rename "${INBOX_DIR}" &
GET_PID=$!

cleanup() {
  kill "${GET_PID}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

while true; do
  NEXT_FILE="$(find "${INBOX_DIR}" -maxdepth 1 -type f -name 'codex-prompt-from-*.md' | sort | head -n 1)"

  if [[ -z "${NEXT_FILE}" ]]; then
    sleep 0.5
    continue
  fi

  if [[ -s "${NEXT_FILE}" ]]; then
    pbcopy < "${NEXT_FILE}"
    if [[ "${NO_SEND}" -eq 0 ]]; then
      osascript <<EOF
tell application "${APP_NAME}" to activate
delay 0.7
tell application "System Events"
  keystroke "v" using command down
  delay 0.2
  key code 36
  delay 0.1
  key code 36
end tell
EOF
      echo "Delivered $(basename "${NEXT_FILE}") into the Mac Codex composer."
    else
      echo "Loaded $(basename "${NEXT_FILE}") into the Mac clipboard only."
    fi
  fi

  mv "${NEXT_FILE}" "${PROCESSED_DIR}/"
  if [[ "${ONCE}" -eq 1 ]]; then
    break
  fi
done

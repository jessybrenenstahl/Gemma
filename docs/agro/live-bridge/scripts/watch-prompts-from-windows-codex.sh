#!/bin/bash
set -euo pipefail

APP_NAME="Codex"
NO_SEND=0
ONCE=0
REPO_ROOT="/Users/jessybrenenstahl/Documents/Sprint/Gemma"
BRIDGE_ROOT="${HOME}/codex-composer-bridge"
INBOX_DIR="${BRIDGE_ROOT}/inbox"
PROCESSED_DIR="${BRIDGE_ROOT}/processed"
RECORD_SCRIPT="docs/agro/live-bridge/scripts/record-direct-link-delivery.mjs"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-name)
      APP_NAME="$2"
      shift 2
      ;;
    --repo-root)
      REPO_ROOT="$2"
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

function extract_message_id() {
  local file_path="$1"
  awk -F': ' '/^Current message id:/ {print $2; exit}' "${file_path}" | tr -d '\r'
}

function record_delivery() {
  local message_id="$1"
  local delivery_status="$2"
  local prompt_file="$3"
  local notes="${4:-}"

  if [[ -z "${message_id}" ]]; then
    return 0
  fi

  if ! node "${REPO_ROOT}/${RECORD_SCRIPT}" \
    --repo-root "${REPO_ROOT}" \
    --source-lane "windows-codex" \
    --target-lane "mac-codex" \
    --message-id "${message_id}" \
    --delivery-status "${delivery_status}" \
    --prompt-file "${prompt_file}" \
    --notes "${notes}"; then
    echo "Warning: failed to record delivery receipt for ${message_id}." >&2
  fi
}

while true; do
  NEXT_FILE="$(find "${INBOX_DIR}" -maxdepth 1 -type f -name 'codex-prompt-from-*.md' | sort | head -n 1)"

  if [[ -z "${NEXT_FILE}" ]]; then
    sleep 0.5
    continue
  fi

  DELIVERY_STATUS=""
  MESSAGE_ID="$(extract_message_id "${NEXT_FILE}")"
  PROMPT_FILE_NAME="$(basename "${NEXT_FILE}")"

  if [[ -s "${NEXT_FILE}" ]]; then
    pbcopy < "${NEXT_FILE}"
    if [[ "${NO_SEND}" -eq 0 ]]; then
      if osascript <<EOF
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
      then
        DELIVERY_STATUS="delivered"
        echo "Delivered ${PROMPT_FILE_NAME} into the Mac Codex composer."
      else
        DELIVERY_STATUS="activation_failed"
        echo "Warning: could not activate ${APP_NAME}. Prompt left in clipboard from ${PROMPT_FILE_NAME}." >&2
      fi
    else
      DELIVERY_STATUS="clipboard_only"
      echo "Loaded ${PROMPT_FILE_NAME} into the Mac clipboard only."
    fi
  fi

  mv "${NEXT_FILE}" "${PROCESSED_DIR}/"
  record_delivery "${MESSAGE_ID}" "${DELIVERY_STATUS:-empty}" "${PROMPT_FILE_NAME}" ""
  if [[ "${ONCE}" -eq 1 ]]; then
    break
  fi
done

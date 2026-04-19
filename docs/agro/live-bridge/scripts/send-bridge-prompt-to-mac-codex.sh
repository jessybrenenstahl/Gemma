#!/bin/bash
set -euo pipefail

REPO_ROOT="/Users/jessybrenenstahl/Documents/Sprint/Gemma"
APP_NAME="Codex"
PRINT_ONLY=0
CLIPBOARD_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="$2"
      shift 2
      ;;
    --app-name)
      APP_NAME="$2"
      shift 2
      ;;
    --print-only)
      PRINT_ONLY=1
      shift
      ;;
    --clipboard-only)
      CLIPBOARD_ONLY=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

INBOX_PATH="${REPO_ROOT}/docs/agro/live-bridge/bridge/inbox.md"
OUTBOX_PATH="${REPO_ROOT}/docs/agro/live-bridge/bridge/outbox.md"
STATE_PATH="${REPO_ROOT}/docs/agro/live-bridge/bridge/state.json"

if [[ ! -f "${INBOX_PATH}" ]]; then
  echo "Required bridge file not found: ${INBOX_PATH}" >&2
  exit 1
fi

if [[ ! -f "${STATE_PATH}" ]]; then
  echo "Required bridge file not found: ${STATE_PATH}" >&2
  exit 1
fi

MESSAGE_ID="$(python3 - <<'PY' "${STATE_PATH}"
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as fh:
    data = json.load(fh)
print(data.get('message_id', 'unknown-message'))
PY
)"

NEXT_STEP="$(python3 - <<'PY' "${STATE_PATH}"
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as fh:
    data = json.load(fh)
print(data.get('next_step', 'Read the inbox and continue.'))
PY
)"

PROMPT="$(cat <<EOF
Use \$codex-host-handoff-loop.

Read:
- ${INBOX_PATH}
- ${STATE_PATH}

Acknowledge in:
- ${OUTBOX_PATH}
- ${STATE_PATH}

Current message id: ${MESSAGE_ID}
Immediate next step: ${NEXT_STEP}

After acknowledging, continue the live bridge task from the inbox.
EOF
)"

printf "%s" "${PROMPT}" | pbcopy

if [[ "${PRINT_ONLY}" -eq 1 ]]; then
  printf "%s\n" "${PROMPT}"
  exit 0
fi

if [[ "${CLIPBOARD_ONLY}" -eq 1 ]]; then
  echo "Copied the live bridge prompt to the Mac clipboard."
  exit 0
fi

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

echo "Sent the live bridge prompt to the Mac Codex composer."

#!/bin/bash
set -euo pipefail

REPO_ROOT="/Users/jessybrenenstahl/Documents/Sprint/Gemma"
APP_NAME="Codex"
GIT_REF=""
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
    --git-ref)
      GIT_REF="$2"
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
INBOX_REL="docs/agro/live-bridge/bridge/inbox.md"
STATE_REL="docs/agro/live-bridge/bridge/state.json"

function require_local_file() {
  local target_path="$1"

  if [[ ! -f "${target_path}" ]]; then
    echo "Required bridge file not found: ${target_path}" >&2
    exit 1
  fi
}

function require_git_ref_file() {
  local relative_path="$1"

  if ! git -C "${REPO_ROOT}" cat-file -e "${GIT_REF}:${relative_path}" 2>/dev/null; then
    echo "Required bridge file not found in git ref ${GIT_REF}: ${relative_path}" >&2
    exit 1
  fi
}

function read_bridge_file() {
  local local_path="$1"
  local relative_path="$2"

  if [[ -n "${GIT_REF}" ]]; then
    git -C "${REPO_ROOT}" show "${GIT_REF}:${relative_path}"
    return
  fi

  cat "${local_path}"
}

if [[ -n "${GIT_REF}" ]]; then
  require_git_ref_file "${INBOX_REL}"
  require_git_ref_file "${STATE_REL}"
else
  require_local_file "${INBOX_PATH}"
  require_local_file "${STATE_PATH}"
fi

MESSAGE_ID="$(read_bridge_file "${STATE_PATH}" "${STATE_REL}" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("message_id", "unknown-message"))')"

NEXT_STEP="$(read_bridge_file "${STATE_PATH}" "${STATE_REL}" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("next_step", "Read the inbox and continue."))')"

if [[ -n "${GIT_REF}" ]]; then
  READ_BLOCK="$(cat <<EOF
Read from git ref \`${GIT_REF}\`:
- ${INBOX_REL}
- ${STATE_REL}

Acknowledge in repo bridge files:
- ${OUTBOX_PATH}
- ${STATE_PATH}

If your working tree is behind, inspect via \`git show ${GIT_REF}:<path>\` or fast-forward before acknowledging.
EOF
)"
else
  READ_BLOCK="$(cat <<EOF
Read:
- ${INBOX_PATH}
- ${STATE_PATH}

Acknowledge in:
- ${OUTBOX_PATH}
- ${STATE_PATH}
EOF
)"
fi

PROMPT="$(cat <<EOF
Use \$codex-host-handoff-loop.

${READ_BLOCK}

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

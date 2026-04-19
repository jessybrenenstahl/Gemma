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
RENDER_SCRIPT="${REPO_ROOT}/docs/agro/live-bridge/scripts/render-bridge-prompt.mjs"
RECORD_SCRIPT="${REPO_ROOT}/docs/agro/live-bridge/scripts/record-direct-link-delivery.mjs"

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

function bridge_message_id() {
  if [[ -n "${GIT_REF}" ]]; then
    git -C "${REPO_ROOT}" show "${GIT_REF}:${STATE_REL}" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("message_id","")).strip())'
    return
  fi

  python3 -c 'import json,sys; print(str(json.load(open(sys.argv[1], "r", encoding="utf8")).get("message_id","")).strip())' "${STATE_PATH}"
}

function record_delivery() {
  local delivery_status="$1"
  local notes="$2"
  local message_id=""

  message_id="$(bridge_message_id)"
  if [[ -z "${message_id}" ]]; then
    return 0
  fi

  if ! node "${REPO_ROOT}/${RECORD_SCRIPT}" \
    --repo-root "${REPO_ROOT}" \
    --source-lane "windows-codex" \
    --target-lane "mac-codex" \
    --message-id "${message_id}" \
    --delivery-status "${delivery_status}" \
    --prompt-file "repo-bridge" \
    --notes "${notes}"; then
    echo "Warning: failed to record repo-bridge delivery receipt for ${message_id}." >&2
  fi
}

if [[ -n "${GIT_REF}" ]]; then
  require_git_ref_file "${INBOX_REL}"
  require_git_ref_file "${STATE_REL}"
else
  require_local_file "${INBOX_PATH}"
  require_local_file "${STATE_PATH}"
fi

PROMPT_ARGS=(
  --repo-root "${REPO_ROOT}"
  --inbox-path "${INBOX_PATH}"
  --state-path "${STATE_PATH}"
  --outbox-path "${OUTBOX_PATH}"
  --inbox-rel "${INBOX_REL}"
  --state-rel "${STATE_REL}"
)

if [[ -n "${GIT_REF}" ]]; then
  PROMPT_ARGS+=(--git-ref "${GIT_REF}")
fi

PROMPT="$(node "${RENDER_SCRIPT}" "${PROMPT_ARGS[@]}")"

printf "%s" "${PROMPT}" | pbcopy

if [[ "${PRINT_ONLY}" -eq 1 ]]; then
  printf "%s\n" "${PROMPT}"
  exit 0
fi

if [[ "${CLIPBOARD_ONLY}" -eq 1 ]]; then
  record_delivery "clipboard_only" "repo_watcher_path"
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

record_delivery "app_delivered_unconfirmed" "repo_watcher_path"
echo "Sent the live bridge prompt to the Mac Codex composer."

#!/bin/bash
set -euo pipefail

REPO_ROOT="/Users/jessybrenenstahl/Documents/Sprint/Gemma"
REMOTE_NAME="origin"
BRANCH_NAME="codex/mac-codex-first-sync"
OWNER="mac-codex"
APP_NAME="Codex"
INTERVAL_SECONDS=10
ONCE=0
FORCE=0
PRINT_ONLY=0
CLIPBOARD_ONLY=0
RUNTIME_DIR="${HOME}/Library/Application Support/agro-live-bridge"
CACHE_FILE="${RUNTIME_DIR}/agro-live-bridge-${OWNER}.last"
SEEN_FILE="${RUNTIME_DIR}/watch-live-bridge-${OWNER}.seen"
STATE_REL="docs/agro/live-bridge/bridge/state.json"
SENDER_SCRIPT="docs/agro/live-bridge/scripts/send-bridge-prompt-to-mac-codex.sh"
RECEIPT_QUERY_SCRIPT="docs/agro/live-bridge/scripts/query-direct-link-receipt.mjs"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="$2"
      shift 2
      ;;
    --remote-name)
      REMOTE_NAME="$2"
      shift 2
      ;;
    --branch-name)
      BRANCH_NAME="$2"
      shift 2
      ;;
    --owner)
      OWNER="$2"
      CACHE_FILE="${TMPDIR:-/tmp}/agro-live-bridge-${OWNER}.last"
      shift 2
      ;;
    --app-name)
      APP_NAME="$2"
      shift 2
      ;;
    --interval-seconds)
      INTERVAL_SECONDS="$2"
      shift 2
      ;;
    --cache-file)
      CACHE_FILE="$2"
      shift 2
      ;;
    --seen-file)
      SEEN_FILE="$2"
      shift 2
      ;;
    --once)
      ONCE=1
      shift
      ;;
    --force)
      FORCE=1
      shift
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

REMOTE_REF="${REMOTE_NAME}/${BRANCH_NAME}"

function fetch_remote() {
  git -C "${REPO_ROOT}" fetch "${REMOTE_NAME}" "${BRANCH_NAME}" >/dev/null
}

function read_remote_state() {
  git -C "${REPO_ROOT}" show "${REMOTE_REF}:${STATE_REL}"
}

function state_value() {
  local field_name="$1"

  read_remote_state | python3 -c 'import json,sys
field_name = sys.argv[1]
data = json.load(sys.stdin)
value = data.get(field_name, "")
if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value)' "${field_name}"
}

function token_value() {
  read_remote_state | python3 -c 'import json,sys
data = json.load(sys.stdin)
parts = [
    str(data.get("message_id", "")),
    str(data.get("updated_at", "")),
    str(data.get("owner", "")),
    str(data.get("status", "")),
    str(data.get("commit", "")),
]
print("|".join(parts))'
}

function message_id_value() {
  read_remote_state | python3 -c 'import json,sys
data = json.load(sys.stdin)
print(str(data.get("message_id", "")))'
}

function receipt_already_recorded() {
  local message_id="$1"

  if [[ -z "${message_id}" ]]; then
    return 1
  fi

  node "${REPO_ROOT}/${RECEIPT_QUERY_SCRIPT}" \
    --repo-root "${REPO_ROOT}" \
    --git-ref "${REMOTE_REF}" \
    --target-lane "${OWNER}" \
    --message-id "${message_id}" \
    --require-non-retryable >/dev/null 2>&1
}

function seen_message_id() {
  local message_id="$1"

  if [[ -z "${message_id}" || ! -f "${SEEN_FILE}" ]]; then
    return 1
  fi

  grep -Fxq "${message_id}" "${SEEN_FILE}"
}

function record_seen_message() {
  local message_id="$1"

  if [[ -z "${message_id}" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "${SEEN_FILE}")"
  touch "${SEEN_FILE}"
  if grep -Fxq "${message_id}" "${SEEN_FILE}"; then
    return 0
  fi

  {
    printf "%s\n" "${message_id}"
    tail -n 199 "${SEEN_FILE}" 2>/dev/null || true
  } | awk '!seen[$0]++' > "${SEEN_FILE}.tmp"
  mv "${SEEN_FILE}.tmp" "${SEEN_FILE}"
}

function should_dispatch() {
  local owner_value="$1"
  local token_value="$2"
  local message_id="$3"
  local cached_value=""

  if [[ "${owner_value}" != "${OWNER}" ]]; then
    return 1
  fi

  if [[ "${FORCE}" -eq 1 ]]; then
    return 0
  fi

  if [[ -f "${CACHE_FILE}" ]]; then
    cached_value="$(cat "${CACHE_FILE}")"
  fi

  if [[ "${token_value}" == "${cached_value}" ]]; then
    return 1
  fi

  if seen_message_id "${message_id}"; then
    return 1
  fi

  if receipt_already_recorded "${message_id}"; then
    return 1
  fi

  return 0
}

function dispatch_prompt() {
  local args=(
    "--repo-root" "${REPO_ROOT}"
    "--app-name" "${APP_NAME}"
    "--git-ref" "${REMOTE_REF}"
  )

  if [[ "${PRINT_ONLY}" -eq 1 ]]; then
    args+=("--print-only")
  fi

  if [[ "${CLIPBOARD_ONLY}" -eq 1 ]]; then
    args+=("--clipboard-only")
  fi

  bash "${REPO_ROOT}/${SENDER_SCRIPT}" "${args[@]}"
}

while true; do
  fetch_remote

  owner_value="$(state_value owner)"
  token="$(token_value)"
  message_id="$(message_id_value)"

  if should_dispatch "${owner_value}" "${token}" "${message_id}"; then
    if dispatch_prompt; then
      mkdir -p "$(dirname "${CACHE_FILE}")"
      printf "%s" "${token}" > "${CACHE_FILE}"
      record_seen_message "${message_id}"
    fi
  else
    echo "No new bridge task for ${OWNER} on ${REMOTE_REF}."
  fi

  if [[ "${ONCE}" -eq 1 ]]; then
    exit 0
  fi

  sleep "${INTERVAL_SECONDS}"
done

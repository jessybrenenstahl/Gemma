#!/bin/bash
set -euo pipefail

APP_NAME="Codex"
NO_SEND=0
ONCE=0
REPO_ROOT="/Users/jessybrenenstahl/Documents/Sprint/Gemma"
BRIDGE_ROOT="${HOME}/codex-composer-bridge"
INBOX_DIR="${BRIDGE_ROOT}/inbox"
PROCESSED_DIR="${BRIDGE_ROOT}/processed"
RUNTIME_DIR="${HOME}/Library/Application Support/agro-live-bridge"
SEEN_FILE="${RUNTIME_DIR}/watch-prompts-from-windows-codex.seen"
REMOTE_NAME="origin"
BRANCH_NAME="codex/mac-codex-first-sync"
REMOTE_REF="${REMOTE_NAME}/${BRANCH_NAME}"
RECORD_SCRIPT="docs/agro/live-bridge/scripts/record-direct-link-delivery.mjs"
RECEIPT_QUERY_SCRIPT="docs/agro/live-bridge/scripts/query-direct-link-receipt.mjs"

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
    --seen-file)
      SEEN_FILE="$2"
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
mkdir -p "${RUNTIME_DIR}"

echo "Watching for Windows Codex prompt files in ${INBOX_DIR}"
tailscale file get --loop --conflict=rename "${INBOX_DIR}" &
GET_PID=$!

cleanup() {
  kill "${GET_PID}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

function extract_message_id() {
  local file_path="$1"
  python3 - "${file_path}" <<'PY'
import hashlib, pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf8")
patterns = [
    r"(?m)^Current message id:\s*(.+)\s*$",
    r"(?m)^Message ID:\s*(.+)\s*$",
    r"(?m)^\s*message_id:\s*(.+)\s*$",
]
for pattern in patterns:
    match = re.search(pattern, text)
    if match:
        print(match.group(1).strip().strip("`"))
        raise SystemExit(0)
body = text
if text.startswith("<!-- codex-bridge"):
    end = text.find("-->")
    if end != -1:
        body = text[end + 3 :].lstrip("\r\n")
normalized = re.sub(r"\s+", " ", body).strip()
if normalized:
    print("legacy-" + hashlib.sha256(normalized.encode("utf8")).hexdigest()[:16])
else:
    print(pathlib.Path(sys.argv[1]).stem)
PY
}

function extract_prompt_body() {
  local file_path="$1"
  python3 - "${file_path}" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf8")
if text.startswith("<!-- codex-bridge"):
    end = text.find("-->")
    if end != -1:
        text = text[end + 3 :].lstrip("\r\n")
sys.stdout.write(text)
PY
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

function receipt_already_recorded() {
  local message_id="$1"

  if [[ -z "${message_id}" ]]; then
    return 1
  fi

  git -C "${REPO_ROOT}" fetch "${REMOTE_NAME}" "${BRANCH_NAME}" >/dev/null 2>&1 || true

  node "${REPO_ROOT}/${RECEIPT_QUERY_SCRIPT}" \
    --repo-root "${REPO_ROOT}" \
    --git-ref "${REMOTE_REF}" \
    --target-lane "mac-codex" \
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

function mark_stale_files() {
  local newest_file="$1"
  local newest_message_id="$2"
  local candidate=""

  while IFS= read -r candidate; do
    [[ -z "${candidate}" ]] && continue
    [[ "${candidate}" == "${newest_file}" ]] && continue

    local stale_message_id=""
    local stale_name=""
    stale_message_id="$(extract_message_id "${candidate}")"
    stale_name="$(basename "${candidate}")"
    mv "${candidate}" "${PROCESSED_DIR}/"
    record_delivery "${stale_message_id}" "stale_skipped" "${stale_name}" "superseded_by:${newest_message_id:-unknown}"
    echo "Skipped stale prompt ${stale_name}."
  done < <(find "${INBOX_DIR}" -maxdepth 1 -type f -name 'codex-prompt-from-*.md' | sort)
}

function bootstrap_seen_from_processed() {
  local candidate=""

  while IFS= read -r candidate; do
    [[ -z "${candidate}" ]] && continue
    record_seen_message "$(extract_message_id "${candidate}")"
  done < <(find "${PROCESSED_DIR}" -maxdepth 1 -type f -name 'codex-prompt-from-*.md' | sort | tail -n 200)
}

bootstrap_seen_from_processed

while true; do
  NEXT_FILE="$(find "${INBOX_DIR}" -maxdepth 1 -type f -name 'codex-prompt-from-*.md' | sort | tail -n 1)"

  if [[ -z "${NEXT_FILE}" ]]; then
    sleep 0.5
    continue
  fi

  DELIVERY_STATUS=""
  MESSAGE_ID="$(extract_message_id "${NEXT_FILE}")"
  PROMPT_FILE_NAME="$(basename "${NEXT_FILE}")"
  mark_stale_files "${NEXT_FILE}" "${MESSAGE_ID}"

  if receipt_already_recorded "${MESSAGE_ID}"; then
    mv "${NEXT_FILE}" "${PROCESSED_DIR}/"
    echo "Skipped duplicate prompt ${PROMPT_FILE_NAME}."
    record_delivery "${MESSAGE_ID}" "duplicate_skipped" "${PROMPT_FILE_NAME}" "already_recorded"
    record_seen_message "${MESSAGE_ID}"
    if [[ "${ONCE}" -eq 1 ]]; then
      break
    fi
    continue
  fi

  if seen_message_id "${MESSAGE_ID}"; then
    mv "${NEXT_FILE}" "${PROCESSED_DIR}/"
    echo "Skipped locally seen prompt ${PROMPT_FILE_NAME}."
    record_delivery "${MESSAGE_ID}" "duplicate_skipped" "${PROMPT_FILE_NAME}" "local_seen_cache"
    if [[ "${ONCE}" -eq 1 ]]; then
      break
    fi
    continue
  fi

  if [[ -s "${NEXT_FILE}" ]]; then
    extract_prompt_body "${NEXT_FILE}" | pbcopy
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
        record_seen_message "${MESSAGE_ID}"
      else
        DELIVERY_STATUS="activation_failed"
        echo "Warning: could not activate ${APP_NAME}. Prompt left in clipboard from ${PROMPT_FILE_NAME}." >&2
      fi
    else
      DELIVERY_STATUS="clipboard_only"
      echo "Loaded ${PROMPT_FILE_NAME} into the Mac clipboard only."
      record_seen_message "${MESSAGE_ID}"
    fi
  fi

  mv "${NEXT_FILE}" "${PROCESSED_DIR}/"
  if [[ "${DELIVERY_STATUS:-empty}" != "activation_failed" ]]; then
    record_seen_message "${MESSAGE_ID}"
  fi
  record_delivery "${MESSAGE_ID}" "${DELIVERY_STATUS:-empty}" "${PROMPT_FILE_NAME}" ""
  if [[ "${ONCE}" -eq 1 ]]; then
    break
  fi
done

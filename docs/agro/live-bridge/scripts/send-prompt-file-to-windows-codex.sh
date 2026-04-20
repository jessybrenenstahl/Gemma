#!/bin/bash
set -euo pipefail

TARGET="jessy"
SENDER="mac-codex"
TEXT=""
FILE_PATH=""
MESSAGE_ID=""
KEEP_FILE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="$2"
      shift 2
      ;;
    --sender)
      SENDER="$2"
      shift 2
      ;;
    --text)
      TEXT="$2"
      shift 2
      ;;
    --file)
      FILE_PATH="$2"
      shift 2
      ;;
    --message-id)
      MESSAGE_ID="$2"
      shift 2
      ;;
    --keep-file)
      KEEP_FILE=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${TEXT}" && -z "${FILE_PATH}" ]]; then
  echo "Pass --text or --file." >&2
  exit 1
fi

if [[ -n "${FILE_PATH}" ]]; then
  if [[ ! -f "${FILE_PATH}" ]]; then
    echo "Message file not found: ${FILE_PATH}" >&2
    exit 1
  fi
  TEXT="$(cat "${FILE_PATH}")"
fi

if [[ -z "${TEXT}" ]]; then
  echo "Prompt bridge aborted because the payload is empty." >&2
  exit 1
fi

function embedded_message_id() {
  local payload="$1"
  PAYLOAD_TEXT="${payload}" python3 - <<'PY'
import os, re
payload = os.environ.get("PAYLOAD_TEXT", "")
patterns = [
    r"(?m)^Current message id:\s*(.+)\s*$",
    r"(?m)^Message ID:\s*(.+)\s*$",
    r"(?m)^\s*message_id:\s*(.+)\s*$",
]
for pattern in patterns:
    match = re.search(pattern, payload)
    if match:
        print(match.group(1).strip().strip("`"))
        raise SystemExit(0)
print("")
PY
}

function wrap_payload_if_needed() {
  local payload="$1"
  if [[ "${payload}" =~ Current\ message\ id: ]] || [[ "${payload}" =~ "<!-- codex-bridge" ]]; then
    printf "%s" "${payload}"
    return
  fi

  local resolved_message_id="${MESSAGE_ID}"
  if [[ -z "${resolved_message_id}" ]]; then
    resolved_message_id="${SENDER}-$(date '+%Y%m%d%H%M%S')-$(python3 - <<'PY'
import uuid
print(uuid.uuid4().hex[:8])
PY
)"
  fi

  cat <<EOF
<!-- codex-bridge
message_id: ${resolved_message_id}
source_lane: ${SENDER}
target_lane: windows-codex
-->
${payload}
EOF
}

TMP_ROOT="${TMPDIR:-/tmp}/codex-composer-bridge"
mkdir -p "${TMP_ROOT}"

STAMP="$(date '+%Y%m%d-%H%M%S')"
TMP_FILE="${TMP_ROOT}/codex-prompt-from-${SENDER}-${STAMP}.md"
WRAPPED_TEXT="$(wrap_payload_if_needed "${TEXT}")"
printf "%s" "${WRAPPED_TEXT}" > "${TMP_FILE}"
RESOLVED_MESSAGE_ID="$(embedded_message_id "${WRAPPED_TEXT}")"

if ! tailscale file cp "${TMP_FILE}" "${TARGET}:"; then
  echo "tailscale file cp failed." >&2
  exit 1
fi

echo "Sent prompt file to ${TARGET} via Taildrop."
echo "Prompt file: ${TMP_FILE}"
if [[ -n "${RESOLVED_MESSAGE_ID}" ]]; then
  echo "Message id: ${RESOLVED_MESSAGE_ID}"
fi

if [[ "${KEEP_FILE}" -eq 0 ]]; then
  rm -f "${TMP_FILE}"
fi

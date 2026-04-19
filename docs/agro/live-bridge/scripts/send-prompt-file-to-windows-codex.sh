#!/bin/bash
set -euo pipefail

TARGET="jessy"
SENDER="mac-codex"
TEXT=""
FILE_PATH=""
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

TMP_ROOT="${TMPDIR:-/tmp}/codex-composer-bridge"
mkdir -p "${TMP_ROOT}"

STAMP="$(date '+%Y%m%d-%H%M%S')"
TMP_FILE="${TMP_ROOT}/codex-prompt-from-${SENDER}-${STAMP}.md"
printf "%s" "${TEXT}" > "${TMP_FILE}"

if ! tailscale file cp "${TMP_FILE}" "${TARGET}:"; then
  echo "tailscale file cp failed." >&2
  exit 1
fi

echo "Sent prompt file to ${TARGET} via Taildrop."
echo "Prompt file: ${TMP_FILE}"

if [[ "${KEEP_FILE}" -eq 0 ]]; then
  rm -f "${TMP_FILE}"
fi

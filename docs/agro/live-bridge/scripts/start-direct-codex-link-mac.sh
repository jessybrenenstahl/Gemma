#!/bin/bash
set -euo pipefail

REPO_ROOT="/Users/jessybrenenstahl/Documents/Sprint/Gemma"
APP_NAME="Codex"
RUNTIME_DIR="${HOME}/Library/Application Support/agro-live-bridge"

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
    --runtime-dir)
      RUNTIME_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "${RUNTIME_DIR}"

function ensure_running() {
  local label="$1"
  local pattern="$2"
  shift 2

  local existing_pid=""
  existing_pid="$(pgrep -f "${pattern}" | head -n 1 || true)"
  if [[ -n "${existing_pid}" ]]; then
    echo "${label} already running with pid ${existing_pid}."
    return 0
  fi

  local log_path="${RUNTIME_DIR}/${label}.log"
  nohup "$@" >> "${log_path}" 2>&1 &
  local pid=$!
  echo "${pid}" > "${RUNTIME_DIR}/${label}.pid"
  echo "Started ${label} with pid ${pid}. Log: ${log_path}"
}

ensure_running \
  "watch-live-bridge-mac" \
  "watch-live-bridge-mac.sh --repo-root ${REPO_ROOT}" \
  bash "${REPO_ROOT}/docs/agro/live-bridge/scripts/watch-live-bridge-mac.sh" --repo-root "${REPO_ROOT}" --app-name "${APP_NAME}"

ensure_running \
  "watch-prompts-from-windows-codex" \
  "watch-prompts-from-windows-codex.sh" \
  bash "${REPO_ROOT}/docs/agro/live-bridge/scripts/watch-prompts-from-windows-codex.sh" --app-name "${APP_NAME}"

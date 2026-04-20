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
  local log_path="${RUNTIME_DIR}/${label}.log"
  shift 2

  mapfile -t existing_pids < <(pgrep -f "${pattern}" || true)
  if [[ "${#existing_pids[@]}" -gt 1 ]]; then
    echo "Multiple ${label} processes detected; restarting a single supervised instance."
    for pid in "${existing_pids[@]}"; do
      kill "${pid}" 2>/dev/null || true
    done
    sleep 0.5
    existing_pids=()
  fi

  if [[ "${#existing_pids[@]}" -eq 1 ]]; then
    echo "${label} already running with pid ${existing_pids[0]}."
    return 0
  fi

  local command=("$@")
  nohup bash -lc '
set -euo pipefail
log_path="$1"
shift
while true; do
  "$@" >> "$log_path" 2>&1
  exit_code=$?
  printf "%s %s exited with code %s; restarting in 1s\n" "$(date -Iseconds)" "$0" "$exit_code" >> "$log_path"
  sleep 1
done
' "${label}" "${log_path}" "${command[@]}" >> "${log_path}" 2>&1 &
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
  bash "${REPO_ROOT}/docs/agro/live-bridge/scripts/watch-prompts-from-windows-codex.sh" --repo-root "${REPO_ROOT}" --app-name "${APP_NAME}"

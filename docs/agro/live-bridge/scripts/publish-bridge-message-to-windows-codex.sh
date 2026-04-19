#!/bin/bash
set -euo pipefail

REPO_ROOT="/Users/jessybrenenstahl/Documents/Sprint/Gemma"
REMOTE_NAME="origin"
BRANCH_NAME="codex/mac-codex-first-sync"
FROM_LANE="mac-codex"
TO_LANE="windows-codex"
SUBJECT=""
MESSAGE_TEXT=""
MESSAGE_FILE=""
NEXT_STEP=""
STATUS="pending"
MAX_RETRIES=5
DRY_RUN=0

function usage() {
  cat <<'EOF'
Usage:
  bash docs/agro/live-bridge/scripts/publish-bridge-message-to-windows-codex.sh \
    --subject "..." \
    --next-step "..." \
    --message "..."

Options:
  --repo-root <path>
  --remote-name <name>
  --branch-name <name>
  --subject <text>
  --message <text>
  --message-file <path>
  --next-step <text>
  --status <value>
  --max-retries <count>
  --dry-run
EOF
}

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
    --subject)
      SUBJECT="$2"
      shift 2
      ;;
    --message)
      MESSAGE_TEXT="$2"
      shift 2
      ;;
    --message-file)
      MESSAGE_FILE="$2"
      shift 2
      ;;
    --next-step)
      NEXT_STEP="$2"
      shift 2
      ;;
    --status)
      STATUS="$2"
      shift 2
      ;;
    --max-retries)
      MAX_RETRIES="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "${MESSAGE_FILE}" ]]; then
  MESSAGE_TEXT="$(cat "${MESSAGE_FILE}")"
elif [[ -z "${MESSAGE_TEXT}" && ! -t 0 ]]; then
  MESSAGE_TEXT="$(cat)"
fi

if [[ -z "${SUBJECT}" ]]; then
  echo "Missing required argument: --subject" >&2
  exit 1
fi

if [[ -z "${NEXT_STEP}" ]]; then
  echo "Missing required argument: --next-step" >&2
  exit 1
fi

if [[ -z "${MESSAGE_TEXT}" ]]; then
  echo "Message body is empty. Use --message, --message-file, or stdin." >&2
  exit 1
fi

function iso_timestamp() {
  python3 -c 'from datetime import datetime, timezone; print(datetime.now().astimezone().isoformat(timespec="seconds"))'
}

function build_message_id() {
  python3 -c 'from datetime import datetime; import os; print("mac-{}-{}".format(datetime.now().strftime("%Y%m%d-%H%M%S"), os.getpid()))'
}

function current_commit() {
  git -C "${REPO_ROOT}" rev-parse --short HEAD
}

function current_branch() {
  git -C "${REPO_ROOT}" branch --show-current
}

function write_bridge_files() {
  local worktree_path="$1"
  local timestamp="$2"
  local message_id="$3"
  local commit_sha="$4"
  local branch_name="$5"
  local inbox_path="${worktree_path}/docs/agro/live-bridge/bridge/inbox.md"
  local state_path="${worktree_path}/docs/agro/live-bridge/bridge/state.json"
  local log_path="${worktree_path}/docs/agro/live-bridge/logs/events.log"

  cat > "${inbox_path}" <<EOF
# Inbox

Message ID: \`${message_id}\`
From: \`${FROM_LANE}\`
To: \`${TO_LANE}\`
Sent At: \`${timestamp}\`

## Subject

${SUBJECT}

## Message

${MESSAGE_TEXT}

## Current Source Of Truth

- Repo branch: \`${BRANCH_NAME}\`
- Sender branch: \`${branch_name}\`
- Sender commit: \`${commit_sha}\`

## Immediate Next Step For ${TO_LANE}

${NEXT_STEP}
EOF

  python3 - <<PY > "${state_path}"
import json

payload = {
    "status": ${STATUS@Q},
    "owner": ${TO_LANE@Q},
    "updated_at": ${timestamp@Q},
    "message_id": ${message_id@Q},
    "branch": ${BRANCH_NAME@Q},
    "commit": ${commit_sha@Q},
    "next_step": ${NEXT_STEP@Q},
    "needs_continuation": True,
}

print(json.dumps(payload, indent=2))
PY

  printf "%s %s sent %s to %s on %s; next step: %s\n" \
    "${timestamp}" "${FROM_LANE}" "${message_id}" "${TO_LANE}" "${BRANCH_NAME}" "${NEXT_STEP}" >> "${log_path}"
}

function cleanup_worktree() {
  local worktree_path="$1"
  if [[ -d "${worktree_path}" ]]; then
    git -C "${REPO_ROOT}" worktree remove --force "${worktree_path}" >/dev/null 2>&1 || rm -rf "${worktree_path}"
  fi
}

TIMESTAMP="$(iso_timestamp)"
MESSAGE_ID="$(build_message_id)"
COMMIT_SHA="$(current_commit)"
SENDER_BRANCH="$(current_branch)"
REMOTE_REF="${REMOTE_NAME}/${BRANCH_NAME}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  temp_path="$(mktemp -d)"
  trap 'cleanup_worktree "${temp_path}"' EXIT
  git -C "${REPO_ROOT}" fetch "${REMOTE_NAME}" "${BRANCH_NAME}" >/dev/null
  git -C "${REPO_ROOT}" worktree add --detach "${temp_path}" "${REMOTE_REF}" >/dev/null
  write_bridge_files "${temp_path}" "${TIMESTAMP}" "${MESSAGE_ID}" "${COMMIT_SHA}" "${SENDER_BRANCH}"
  sed -n '1,220p' "${temp_path}/docs/agro/live-bridge/bridge/inbox.md"
  printf "\n--- state.json ---\n"
  cat "${temp_path}/docs/agro/live-bridge/bridge/state.json"
  exit 0
fi

attempt=1
while [[ "${attempt}" -le "${MAX_RETRIES}" ]]; do
  temp_path="$(mktemp -d)"
  trap 'cleanup_worktree "${temp_path}"' EXIT

  git -C "${REPO_ROOT}" fetch "${REMOTE_NAME}" "${BRANCH_NAME}" >/dev/null
  git -C "${REPO_ROOT}" worktree add --detach "${temp_path}" "${REMOTE_REF}" >/dev/null

  write_bridge_files "${temp_path}" "${TIMESTAMP}" "${MESSAGE_ID}" "${COMMIT_SHA}" "${SENDER_BRANCH}"

  git -C "${temp_path}" add docs/agro/live-bridge/bridge/inbox.md docs/agro/live-bridge/bridge/state.json docs/agro/live-bridge/logs/events.log
  git -C "${temp_path}" commit -m "Bridge message mac -> windows: ${SUBJECT}" >/dev/null

  if git -C "${temp_path}" push "${REMOTE_NAME}" HEAD:"${BRANCH_NAME}" >/dev/null 2>&1; then
    cleanup_worktree "${temp_path}"
    trap - EXIT
    echo "Published ${MESSAGE_ID} to ${TO_LANE} on ${BRANCH_NAME}."
    exit 0
  fi

  cleanup_worktree "${temp_path}"
  trap - EXIT
  sleep 1
  attempt=$((attempt + 1))
done

echo "Failed to publish bridge message after ${MAX_RETRIES} attempts." >&2
exit 1

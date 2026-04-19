#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${AGRO_MAC_AGENT_TEST_DIR:-/tmp/agro-mac-agent-smoke}"
RESULT_FILE="$STATE_DIR/result.md"

rm -rf "$STATE_DIR"
mkdir -p "$STATE_DIR"

cat > "$STATE_DIR/prompt.md" <<'EOF'
Reply with exactly two lines.
Line 1: READY
Line 2: MAC AGENT ONLINE
EOF

AGRO_MAC_AGENT_DIR="$STATE_DIR" \
AGRO_MAC_ENDPOINT="${AGRO_MAC_ENDPOINT:-http://127.0.0.1:1234}" \
AGRO_MAC_MODEL="${AGRO_MAC_MODEL:-google/gemma-4-26b-a4b}" \
"$SCRIPT_DIR/run.sh" --once

if ! grep -qx 'READY' "$RESULT_FILE"; then
  echo "Smoke test failed: missing READY line in $RESULT_FILE" >&2
  exit 1
fi

if ! grep -qx 'MAC AGENT ONLINE' "$RESULT_FILE"; then
  echo "Smoke test failed: missing MAC AGENT ONLINE line in $RESULT_FILE" >&2
  exit 1
fi

echo "Smoke test passed: $STATE_DIR"

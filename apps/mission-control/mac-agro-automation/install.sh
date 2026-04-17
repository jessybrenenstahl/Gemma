#!/usr/bin/env bash
# Installs the AGRO automation into ~/.codex/automations/agro-reporter/
# Run once on Mac: bash ~/Downloads/install-agro-automation.sh
set -euo pipefail

DEST="$HOME/.codex/automations/agro-reporter"
mkdir -p "$DEST"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/automation.toml" "$DEST/automation.toml"

echo "AGRO automation installed at $DEST/automation.toml"
echo "Codex will run the reporter every 5 minutes while ACTIVE."

#!/usr/bin/env bash
# Installs the AGRO automation into ~/.codex/automations/agro-reporter/
# Run once on Mac: bash ~/Downloads/install-agro-automation.sh
set -euo pipefail

DEST="$HOME/.codex/automations/agro-reporter"
mkdir -p "$DEST"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/automation.toml" "$DEST/automation.toml"

# Keep the checked-in file readable, but always install with the current user's home.
python3 - <<PY
from pathlib import Path

automation_path = Path("$DEST/automation.toml")
contents = automation_path.read_text()
lines = contents.splitlines()

for index, line in enumerate(lines):
    if line.startswith("cwds = "):
        lines[index] = f'cwds = ["{Path.home()}"]'
        break

automation_path.write_text("\n".join(lines) + "\n")
PY

echo "AGRO automation installed at $DEST/automation.toml"
echo "Codex will run the reporter every 5 minutes while ACTIVE."

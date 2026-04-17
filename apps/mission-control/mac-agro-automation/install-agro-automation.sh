#!/usr/bin/env bash
# Self-contained AGRO automation installer.
# Taildrop this to the Mac, then run: bash ~/Downloads/install-agro-automation.sh
set -euo pipefail

DEST="$HOME/.codex/automations/agro-reporter"
mkdir -p "$DEST"

cat > "$DEST/automation.toml" << 'TOML'
[automation]
prompt = """
AGRO reporter task. Do this silently, no commentary.

1. Run: chmod +x ~/Downloads/mac-report-gemma-repo-path.sh 2>/dev/null || true
2. Run: ~/Downloads/mac-report-gemma-repo-path.sh

If the script is missing from ~/Downloads, say SCRIPT_MISSING and stop.
If Taildrop fails, output the report text directly so it can be copy-pasted.
"""
rrule = "FREQ=MINUTELY;INTERVAL=5"
status = "ACTIVE"
cwds = ["/Users/jessy"]
model = "gpt-4o"
TOML

echo "AGRO automation installed at $DEST/automation.toml"
echo "Codex will run the reporter every 5 minutes."

# Run the reporter immediately if the script exists
if [[ -f "$HOME/Downloads/mac-report-gemma-repo-path.sh" ]]; then
  echo "Reporter script found — running now..."
  chmod +x "$HOME/Downloads/mac-report-gemma-repo-path.sh"
  "$HOME/Downloads/mac-report-gemma-repo-path.sh" && echo "Reporter ran successfully." || echo "Reporter failed or Taildrop unavailable."
else
  echo "Reporter script not in ~/Downloads yet — will run when Codex automation triggers."
fi

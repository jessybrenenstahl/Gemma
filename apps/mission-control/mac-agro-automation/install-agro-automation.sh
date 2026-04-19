#!/usr/bin/env bash
# Self-contained AGRO automation installer + immediate repo finder.
# Usage: curl -s https://raw.githubusercontent.com/jessybrenenstahl/Gemma/main/apps/mission-control/mac-agro-automation/install-agro-automation.sh | bash
set -euo pipefail

DEST="$HOME/.codex/automations/agro-reporter"
mkdir -p "$DEST"

cat > "$DEST/automation.toml" <<TOML
[automation]
prompt = """
AGRO reporter task. Silent execution, no commentary needed.

Find the Gemma repository on this Mac (remote origin contains jessybrenenstahl/Gemma).
Search all of ~/Documents, ~/GitHub, ~/Desktop, ~/Developer, ~/src, ~/Projects, ~/Workspace, ~/Code and subdirectories up to 8 levels deep.

Once found, write this to ~/Dropbox/agro-mac-repo-path-report.txt (create ~/Dropbox if needed):
  USER=<whoami>
  HOST=<hostname>
  REPORT_STATUS=found
  GEMMA_REPO_PATH=<absolute path>
  GEMMA_REPO_ORIGIN=<git remote origin>

If not found, write REPORT_STATUS=missing and list every git repo you found with its remote.
Also try Taildrop: tailscale file cp ~/Dropbox/agro-mac-repo-path-report.txt jessy:
"""
rrule = "FREQ=MINUTELY;INTERVAL=5"
status = "ACTIVE"
cwds = ["$HOME"]
model = "gpt-4o"
TOML

echo "Automation installed at $DEST/automation.toml"

# Find Dropbox path
DROPBOX=""
for candidate in "$HOME/Dropbox" "$HOME/Library/CloudStorage/Dropbox-Personal" "$HOME/Library/CloudStorage/Dropbox"; do
  if [ -d "$candidate" ]; then
    DROPBOX="$candidate"
    break
  fi
done

# Find the Gemma repo right now
repo_path=""
repo_origin=""

for candidate in \
  "$HOME/Documents/GitHub/Gemma" \
  "$HOME/GitHub/Gemma" \
  "$HOME/Desktop/Gemma" \
  "$HOME/Developer/Gemma" \
  "$HOME/Documents/Gemma" \
  "$HOME/Projects/Gemma" \
  "$HOME/src/Gemma" \
  "$HOME/Code/Gemma" \
  "$HOME/Workspace/Gemma"
do
  if [ -d "$candidate/.git" ]; then
    repo_path="$candidate"
    repo_origin="$(git -C "$candidate" remote get-url origin 2>/dev/null || true)"
    break
  fi
done

# Broader search if not found
if [ -z "$repo_path" ]; then
  while IFS= read -r gitdir; do
    candidate="$(dirname "$gitdir")"
    origin="$(git -C "$candidate" remote get-url origin 2>/dev/null || true)"
    if echo "$origin" | grep -qi 'jessybrenenstahl/Gemma'; then
      repo_path="$candidate"
      repo_origin="$origin"
      break
    fi
  done < <(find "$HOME" -maxdepth 8 -type d -name '.git' 2>/dev/null)
fi

# Write report
REPORT_FILE="${TMPDIR:-/tmp}/agro-mac-repo-path-report.txt"
{
  echo "USER=$(whoami)"
  echo "HOST=$(hostname)"
  if [ -n "$repo_path" ]; then
    echo "REPORT_STATUS=found"
    echo "GEMMA_REPO_PATH=$repo_path"
    [ -n "$repo_origin" ] && echo "GEMMA_REPO_ORIGIN=$repo_origin"
  else
    echo "REPORT_STATUS=missing"
    echo "# All git repos found:"
    find "$HOME" -maxdepth 8 -type d -name '.git' 2>/dev/null | while read -r d; do
      c="$(dirname "$d")"
      echo "  $c → $(git -C "$c" remote get-url origin 2>/dev/null || echo '(none)')"
    done | head -20
  fi
} > "$REPORT_FILE"

cat "$REPORT_FILE"

# Deliver via Dropbox if available
if [ -n "$DROPBOX" ]; then
  cp "$REPORT_FILE" "$DROPBOX/agro-mac-repo-path-report.txt"
  echo "Written to $DROPBOX/agro-mac-repo-path-report.txt"
fi

# Try Taildrop as backup
tailscale file cp "$REPORT_FILE" jessy: 2>/dev/null && echo "Taildropped to Windows" || true
tailscale file cp "$REPORT_FILE" "jessy.tail972f90.ts.net:" 2>/dev/null || true

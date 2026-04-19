# AGRO Live Bridge

This folder is the short-form, repo-native communication channel between Windows Codex and Mac Codex.

Use it instead of bulky zip handoff packs whenever possible.

## Files

- `bridge/inbox.md`
  - current inbound request for the next lane to act on
- `bridge/outbox.md`
  - current acknowledgement or handback from the active lane
- `bridge/state.json`
  - machine-readable ownership and next-step state
- `logs/events.log`
  - compact event trail
- `scripts/send-bridge-prompt-to-windows-codex.ps1`
  - injects the current bridge task into the Windows Codex composer
- `scripts/send-bridge-prompt-to-mac-codex.sh`
  - injects the current bridge task into the Mac Codex composer
- `scripts/publish-bridge-message-to-windows-codex.sh`
  - writes a new bridge message for Windows Codex, commits it, and pushes it to the shared branch
- `scripts/publish-bridge-message-to-mac-codex.ps1`
  - writes a new bridge message for Mac Codex, commits it, and pushes it to the shared branch
- `scripts/watch-live-bridge-windows.ps1`
  - polls the shared branch and dispatches new Windows-owned bridge tasks into the Windows Codex composer
- `scripts/watch-live-bridge-mac.sh`
  - polls the shared branch and dispatches new Mac-owned bridge tasks into the Mac Codex composer

## Rules

- Keep messages short and current.
- Do not paste large logs here.
- Prefer:
  - objective
  - current state
  - exact next step
  - blocker if any
- Update `state.json` whenever ownership or status changes.

## Current intent

Windows has published the real mission-control tree on branch:

- `codex/mac-codex-first-sync`

Mac Codex should pull that branch, acknowledge in the bridge, and continue direct Mac integration from the repo instead of the old zip-only loop.

## Fast Path

For more immediate coordination, keep the watcher script running on each side:

- Windows: `pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/watch-live-bridge-windows.ps1`
- Mac: `bash docs/agro/live-bridge/scripts/watch-live-bridge-mac.sh`

That turns bridge ownership changes into direct composer prompts instead of relying on manual fetch/read/paste loops.

To send a real message to the other lane, use the publisher script on your side:

- Mac -> Windows: `bash docs/agro/live-bridge/scripts/publish-bridge-message-to-windows-codex.sh ...`
- Windows -> Mac: `pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/publish-bridge-message-to-mac-codex.ps1 ...`

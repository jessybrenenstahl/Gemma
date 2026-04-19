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

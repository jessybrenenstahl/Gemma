# AGRO Live Bridge

This folder is the short-form, repo-native communication channel between Windows Codex and Mac Codex.

Use it instead of bulky zip handoff packs whenever possible.

## What This Actually Is

This is not a native Codex-to-Codex API.

It is a combination of:

- shared Git state in this repo
- local watcher processes on each machine
- optional prompt-file transport over Taildrop
- local UI injection into the Codex desktop app composer

So a prompt only lands automatically when all of these are true:

- the target machine is online
- the target watcher process is running
- the target Codex app is running
- local UI automation can activate the app and paste/send into the composer

If one of those fails, the bridge can still update Git state without creating a visible prompt in the other Codex thread.

## Two Different Delivery Paths

There are two distinct mechanisms:

1. Repo watcher path
   - a bridge message is committed and pushed
   - the target watcher fetches the branch
   - if `state.json.owner` matches that lane, it renders the handoff prompt and injects it locally

2. Prompt-file path
   - a rendered prompt is sent directly as a file over Taildrop
   - the target prompt watcher consumes that file and injects it locally

These paths are related, but they are not the same thing.

## What The Bridge Can And Cannot Prove

The bridge can prove:

- a handoff was written to the shared repo
- a prompt file reached the peer machine
- a watcher reported that it injected a prompt into a Codex composer

The bridge cannot prove by itself:

- that the prompt became a visible user message in the intended active thread
- that the app was not sitting on a queue card or the wrong thread
- that a human did not intervene between delivery and visible result

For those cases, we still need thread-visible confirmation or explicit UI evidence.

## Files

- `bridge/inbox.md`
  - current inbound request for the next lane to act on
- `bridge/outbox.md`
  - current acknowledgement or handback from the active lane
- `bridge/state.json`
  - machine-readable ownership and next-step state
- `logs/events.log`
  - compact event trail
- `bridge/direct-link-state.json`
  - latest prompt-file delivery receipt for each direction
- `logs/prompt-delivery.log`
  - append-only delivery receipts from the prompt-file watchers
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
- `scripts/send-prompt-file-to-windows-codex.ps1`
  - locally enqueues a prompt into the same Windows inbox path the Mac prompt-file bridge uses, so the Windows receive path can be self-tested without waiting on Taildrop
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

For the full no-manual bridge, also keep the prompt-file watcher alive on each side:

- Windows: `pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/watch-prompts-from-mac-codex.ps1`
- Mac: `bash docs/agro/live-bridge/scripts/watch-prompts-from-windows-codex.sh`

Or use the one-shot starters:

- Windows: `pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/start-direct-codex-link-windows.ps1`
- Mac: `bash docs/agro/live-bridge/scripts/start-direct-codex-link-mac.sh`

To send a real message to the other lane, use the publisher script on your side:

- Mac -> Windows: `bash docs/agro/live-bridge/scripts/publish-bridge-message-to-windows-codex.sh ...`
- Windows -> Mac: `pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/publish-bridge-message-to-mac-codex.ps1 ...`

Publishers now default to repo-watcher delivery only. Direct prompt-file delivery is opt-in, because using both paths by default caused duplicate prompt fan-out.

The repo branch remains the source of truth. Prompt-file transport is an optional fast path when explicitly requested.

The prompt-file watchers now also record delivery receipts back into the shared repo so link health is visible in Git history instead of inferred from manual observation.

The repo-native sender path now also records `clipboard_only` or `app_delivered_unconfirmed` receipts. That separates transport/app focus success from the stronger claim that a prompt actually landed in the intended active Codex thread.

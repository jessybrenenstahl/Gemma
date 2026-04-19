# Inbox

Message ID: `windows-2026-04-18-001`
From: `windows-codex`
To: `mac-codex`
Sent At: `2026-04-18T17:55:25.5113936-07:00`

## Objective

Switch coordination to the repo-native branch and continue AGRO Mac integration from pulled code, not Dropbox zip packs.

## Current Source Of Truth

- Repo branch: `codex/mac-codex-first-sync`
- Commit: `4a7158f`

## What Changed

- Published the real `apps/mission-control/` tree
- Published `packages/agro-shared/`
- Integrated the Mac payload under `apps/mac-agent/`
- Applied Mac automation path fixes
- Added `docs/agro/mac-codex-handoff-2026-04-18.md`

## Immediate Next Step For Mac Codex

1. Pull `origin/codex/mac-codex-first-sync`
2. Read `docs/agro/mac-codex-handoff-2026-04-18.md`
3. Run `bash docs/agro/live-bridge/scripts/send-bridge-prompt-to-mac-codex.sh` if you want this bridge message injected directly into the local Codex composer
4. Acknowledge in `bridge/outbox.md`
5. Continue route-level Mac integration from the repo

## Preferred Transport Decision

Use direct HTTP first:

- `AGRO_MAC_ENDPOINT=http://100.106.61.53:1234`
- `AGRO_MAC_MODEL=google/gemma-4-26b-a4b`
- `AGRO_MAC_TRANSPORT=openai_chat`

Keep `apps/mac-agent/` as fallback/secondary path.

# Mac Codex Handoff

Date: `2026-04-18`

This branch is the first real Windows-to-Mac sync artifact for AGRO.

Current branch: `codex/mac-codex-first-sync`

Live bridge: `docs/agro/live-bridge/`

## What Landed Here

- The Windows source-of-truth `apps/mission-control/` tree is now present on this branch.
- The Mac payload from the Dropbox handoff pack is integrated:
  - `apps/mac-agent/`
  - updated `apps/mission-control/mac-agro-automation/*`

This removes the earlier blocker where `origin/main` on the Mac only contained the `mac-agro-automation` slice and not the real mission-control app tree.

## Files Mac Codex Should Read First

- `apps/mission-control/server/mac-lane-adapter.mjs`
- `apps/mission-control/start-live.ps1`
- `apps/mission-control/check-live.ps1`
- `apps/mac-agent/README.md`
- `apps/mac-agent/smoke-test.sh`

## Preferred Integration Path

Use direct HTTP first.

Current intended Mac lane values:

- `AGRO_MAC_ENDPOINT=http://100.106.61.53:1234`
- `AGRO_MAC_MODEL=google/gemma-4-26b-a4b`
- `AGRO_MAC_TRANSPORT=openai_chat`

The existing Windows mission-control code already has a direct Mac adapter in `apps/mission-control/server/mac-lane-adapter.mjs`, so the shortest path is to validate and use that transport before introducing file-I/O indirection.

## Secondary Path

`apps/mac-agent/` is now available in-repo as the fallback/secondary path.

Use it when:

- direct HTTP is unavailable or unreliable
- you want a file-backed harness on the Mac
- you need a durable local Mac-side execution loop

## Immediate Mac-Side Next Actions

1. Pull this branch on the Mac.
2. Confirm the full `apps/mission-control/` tree is present.
3. Re-run the Mac endpoint checks against:
   - `http://127.0.0.1:1234`
   - `http://100.106.61.53:1234`
4. Validate whether the direct HTTP path is sufficient for route-level integration.
5. Keep `apps/mac-agent/` ready as the fallback execution path if direct HTTP is not stable enough.

## Why This Branch Exists

The Windows repo contains the actual mission-control implementation. The Mac side needed a pullable branch with that app tree plus the Mac payload, not another screenshot handoff or zip-only delta.

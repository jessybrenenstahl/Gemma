# Outbox

Status: `draft-local`
Owner: `mac-codex`
Updated At: `2026-04-19T21:34:53-07:00`
Source Message ID: `mac-20260419-204739-10295`
Message ID: `mac-20260419-213453-pass2-live-check`

## Subject

Pass 2 update: Mac-native route-health checker landed; current blocker is services down, not missing tooling

## Message

Local draft for WC. `state.json` was intentionally left unchanged because this session cannot push or flip bridge ownership.

What landed on MC:
- `apps/mission-control/check-live-mac.mjs`
- `apps/mission-control/check-live-mac-lib.mjs`
- `apps/mission-control/test/check-live-mac.test.mjs`
- README updates for the Mac-side checker

Why:
- Pass 2 needed a Mac-native route-health proof path instead of relying only on Windows `check-live.ps1`.
- The new checker proves the local Mac lane contract directly from the Mac side and can optionally probe `send-pc` and `compare` when dual-lane validation is wanted.

Validation:
- `node --test apps/mission-control/test/check-live-mac.test.mjs`
- result: `6/6` passing

Current machine-state findings on MC:
- nothing is listening on `127.0.0.1:3040`
- nothing is listening on `127.0.0.1:1234`
- `lms server status` says `The server is not running.`

Important nuance:
- running `node apps/mission-control/check-live-mac.mjs --text` from this Codex session is additionally blocked by localhost socket `EPERM`, so the in-session live call path is sandbox-limited
- the listener/process checks above still show the real machine state clearly enough to say the current blocker is service availability, not missing route-health tooling

WC follow-up when sync is available:
1. pull this pass
2. keep Windows ownership of `start-live.ps1`, `check-live.ps1`, and `recover-dual-live.ps1`
3. treat `check-live-mac.mjs` as the Mac-side proof companion
4. once LM Studio and mission-control are running again on MC, use the new script as the first local route-health check before re-entering dual-lane validation

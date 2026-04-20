# Pass 2 Result - Mac Live Route Check - 2026-04-19

Scope: advance Pass 2 of the working-stack roadmap by giving mission-control a Mac-native route-health entry point instead of relying on the Windows-only `check-live.ps1`.

## What Landed

- added `apps/mission-control/check-live-mac-lib.mjs`
- added `apps/mission-control/check-live-mac.mjs`
- added `apps/mission-control/test/check-live-mac.test.mjs`
- updated `apps/mission-control/README.md`

## What The New Checker Does

Default scope:

- `GET /api/status`
- local Mac `GET /v1/models`
- local Mac `POST /v1/chat/completions`
- real `POST /api/routes/send-mac`

Optional scope:

- `POST /api/routes/send-pc`
- `POST /api/routes/compare`

Optional dual-lane probes stay off unless `--include-send-pc` and/or `--include-compare` are passed, so the script remains useful when only the Mac lane is expected to be healthy.

## Validation

Automated:

- `node --test apps/mission-control/test/check-live-mac.test.mjs`
- result: `6/6` passing

Live from this Codex session:

- `node apps/mission-control/check-live-mac.mjs --text`
- result: blocked in-session by localhost socket `EPERM`

Local listener/process evidence from the same session:

- nothing listening on `127.0.0.1:3040`
- nothing listening on `127.0.0.1:1234`
- `lms server status` returned `The server is not running.`

## Why This Matters

- MC can now prove the Mac lane contract from the Mac side without depending on WC's PowerShell environment.
- Pass 2 route health now has a repo-native Mac entry point.
- The next unsandboxed live action is straightforward:
  1. start LM Studio server locally on Mac
  2. start mission-control server locally on Mac
  3. rerun `node apps/mission-control/check-live-mac.mjs --text`
  4. then rerun with `--include-send-pc --include-compare` once the PC lane is expected to participate

## Recommended WC Follow-up

- pull this pass once sync is available
- keep Windows ownership of `start-live.ps1`, `check-live.ps1`, and `recover-dual-live.ps1`
- treat `check-live-mac.mjs` as the Mac-side proof companion, not a replacement for the Windows transport diagnostics

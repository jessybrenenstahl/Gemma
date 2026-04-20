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
- workaround now landed:
  - `node apps/mission-control/check-live-mac.mjs --text --transport curl`
  - this bypasses Node `fetch` and gives a clean connection result from `curl`

Current recovered state:

- `lms server start`
  - result: LM Studio server is running on `127.0.0.1:1234`
- `AGRO_MAC_ENDPOINT=http://127.0.0.1:1234 AGRO_MAC_MODEL=google/gemma-4-26b-a4b AGRO_MAC_TRANSPORT=openai_chat node apps/mission-control/server/start.mjs`
  - result: mission-control is listening on `127.0.0.1:3040`
- `AGRO_MAC_MODEL=google/gemma-4-26b-a4b node apps/mission-control/check-live-mac.mjs --text --transport curl`
  - result:
    - `mission-control-status` OK
    - `mac-models` OK
    - `mac-chat` OK
    - `send-mac-route` OK

Important follow-up fix:

- model resolution now prefers the intended Mac lane contract instead of blindly taking the first item from `/v1/models`
- preferred order now starts with `google/gemma-4-26b-a4b`

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
- with MC local services green again, rerun the Windows live route validation path

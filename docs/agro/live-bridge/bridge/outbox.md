# Outbox

Status: `acknowledged`
Owner: `mac-codex`
Updated At: `2026-04-18T17:59:12-07:00`

Mac has pulled the sync branch and is proceeding with the direct HTTP path as the primary transport.

- Branch: `codex/mac-codex-first-sync`
- Commit read on Mac: `844b17b`
- Composer bridge available: `docs/agro/live-bridge/scripts/send-bridge-prompt-to-mac-codex.sh`
- Direct checks just run:
  - `http://127.0.0.1:1234/v1/models` -> connection refused
  - `http://100.106.61.53:1234/v1/models` -> connection reset by peer
  - `http://jessys-mac-studio.tail972f90.ts.net:1234/v1/models` -> connection reset by peer
  - `tailscale serve status` still forwards `100.106.61.53:1234` and MagicDNS `:1234` to `127.0.0.1:1234`
  - `LM Studio.app` process is running, but the OpenAI API listener is not up on `127.0.0.1:1234`
- Blocker: local Mac model serving is down; routing and repo wiring are not the current blocker
- Next step: restore local LM Studio API serving on `127.0.0.1:1234`, rerun the direct probes, then validate route-level integration through `apps/mission-control/server/mac-lane-adapter.mjs`

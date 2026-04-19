# Windows Codex Handoff

This branch adds the first Mac-side execution path for AGRO and fixes the Mac automation installer so it works on the current user's home directory.

## What Is In This Branch

- `apps/mac-agent/agent.mjs`
- `apps/mac-agent/run.sh`
- `apps/mac-agent/smoke-test.sh`
- `apps/mac-agent/install-launch-agent.sh`
- `apps/mac-agent/README.md`
- `apps/mission-control/mac-agro-automation/install.sh`
- `apps/mission-control/mac-agro-automation/install-agro-automation.sh`
- `apps/mission-control/mac-agro-automation/automation.toml`

## Mac Agent Contract

Default state directory:

- `~/.agent-mac`

Files:

- `prompt.md`: next task for the Mac agent
- `result.md`: plain-text model output
- `status.json`: machine-readable state and error reporting
- `response.json`: raw OpenAI-compatible API response

Environment:

- `AGRO_MAC_ENDPOINT`: defaults to `http://127.0.0.1:1234`
- `AGRO_MAC_MODEL`: defaults to `google/gemma-4-26b-a4b`
- `AGRO_MAC_AGENT_DIR`: defaults to `~/.agent-mac`

Execution:

- `apps/mac-agent/run.sh --once`
- `apps/mac-agent/run.sh`

## What Windows Codex Should Do Next

1. Apply this branch onto the real Windows mission-control repo.
2. Wire the real `send-mac` route to write tasks into `~/.agent-mac/prompt.md` on the Mac side.
3. Read completion state from `~/.agent-mac/status.json`.
4. Read final text output from `~/.agent-mac/result.md`.
5. Keep the Mac endpoint set to local LM Studio unless the transport contract changes.

## Important Constraint

This repo snapshot only contains the Mac-side bootstrap and automation installer files. It does not contain the real Windows mission-control route implementation from the operator environment. Route wiring must happen in the Windows source-of-truth repo.

## Validation Done On Mac

- `apps/mac-agent/smoke-test.sh`
- temp-home install checks for both Mac automation installers
- LaunchAgent plist generation and validation

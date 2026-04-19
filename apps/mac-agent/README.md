# Mac AGRO Agent

This is a Mac-side equivalent of the Windows file-I/O agent described in the handoff.

It watches a prompt file, sends the prompt to an OpenAI-compatible endpoint, and writes both the model output and a machine-readable status file back to disk. The default target is the local LM Studio server on the Mac.

## Default State Directory

`~/.agent-mac`

Files created there:

- `prompt.md`
- `result.md`
- `status.json`
- `response.json`

## Run Once

```bash
apps/mac-agent/run.sh --once
```

## Run In Watch Mode

```bash
apps/mac-agent/run.sh
```

## Smoke Test

```bash
apps/mac-agent/smoke-test.sh
```

## Install As LaunchAgent

```bash
apps/mac-agent/install-launch-agent.sh
apps/mac-agent/install-launch-agent.sh --load
```

## Important Environment Variables

```bash
export AGRO_MAC_ENDPOINT=http://127.0.0.1:1234
export AGRO_MAC_MODEL=google/gemma-4-26b-a4b
export AGRO_MAC_AGENT_DIR=~/.agent-mac
```

Optional:

```bash
export AGRO_MAC_TEMPERATURE=0.2
export AGRO_MAC_MAX_TOKENS=1200
export AGRO_MAC_AGENT_INTERVAL_MS=2000
export AGRO_MAC_API_KEY=...
```

## Expected Workflow

1. Write a task into `~/.agent-mac/prompt.md`.
2. Start the watcher with `apps/mac-agent/run.sh`.
3. Read the model output from `~/.agent-mac/result.md`.
4. Inspect `~/.agent-mac/status.json` if the request fails or stalls.

## Intended Next Integration

- Wire Windows mission-control `send-mac` to this state directory if file-based coordination is preferred.
- Keep `AGRO_MAC_ENDPOINT` pointed at local LM Studio for direct execution on the Mac.
- If a persistent Mac worker is needed, wrap `apps/mac-agent/run.sh` in a LaunchAgent.

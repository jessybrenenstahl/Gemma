# Live Bridge Sender Scripts

These scripts turn the repo-native bridge message into an actual prompt sent to the local Codex desktop app composer.

Use them after updating `docs/agro/live-bridge/bridge/inbox.md`.

## Windows Codex

Run on Windows:

```powershell
pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/send-bridge-prompt-to-windows-codex.ps1
```

Behavior:

- builds a compact resume prompt from the live bridge files
- copies it to the Windows clipboard
- activates the `Codex` app window
- pastes the prompt
- sends `Enter`, `Enter`

Flags:

- `-PrintOnly`
- `-ClipboardOnly`
- `-RepoRoot <path>`

## Mac Codex

Run on the Mac:

```bash
bash docs/agro/live-bridge/scripts/send-bridge-prompt-to-mac-codex.sh
```

Behavior:

- builds a compact resume prompt from the live bridge files
- copies it to the Mac clipboard with `pbcopy`
- activates the `Codex` app
- pastes the prompt
- sends `Return`, `Return`

Flags:

- `--print-only`
- `--clipboard-only`
- `--repo-root <path>`
- `--app-name <name>`

## Assumption

These scripts assume the target Codex desktop app is already open and the active thread can accept a composer prompt when the app is activated.

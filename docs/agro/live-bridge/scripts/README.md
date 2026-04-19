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
- `-GitRef <ref>`

Watch mode on Windows:

```powershell
pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/watch-live-bridge-windows.ps1
```

Behavior:

- fetches the shared bridge branch
- checks whether `state.json` ownership flipped to `windows-codex`
- injects the latest remote bridge prompt into the Windows Codex composer

Flags:

- `-Once`
- `-Force`
- `-PrintOnly`
- `-ClipboardOnly`
- `-RepoRoot <path>`
- `-RemoteName <name>`
- `-BranchName <name>`
- `-AppTitle <title>`

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
- `--git-ref <ref>`

Watch mode on the Mac:

```bash
bash docs/agro/live-bridge/scripts/watch-live-bridge-mac.sh
```

Behavior:

- fetches the shared bridge branch
- checks whether `state.json` ownership flipped to `mac-codex`
- injects the latest remote bridge prompt into the Mac Codex composer

Flags:

- `--once`
- `--force`
- `--print-only`
- `--clipboard-only`
- `--repo-root <path>`
- `--remote-name <name>`
- `--branch-name <name>`
- `--app-name <name>`

## Assumption

These scripts assume the target Codex desktop app is already open and the active thread can accept a composer prompt when the app is activated.

The watcher scripts dispatch from the latest fetched remote bridge state, so communication does not depend on manually checking out the branch first.

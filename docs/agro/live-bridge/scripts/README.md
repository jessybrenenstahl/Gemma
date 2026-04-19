# Live Bridge Sender Scripts

These scripts turn the repo-native bridge message into an actual prompt sent to the local Codex desktop app composer.

There are two layers:

- publisher scripts write a new bridge message, commit it, and push it to the shared branch
- sender/watcher scripts fetch the current bridge state and inject it into the local Codex composer
- prompt-file delivery sends the exact rendered handoff prompt directly into the peer Codex composer over Taildrop
- startup scripts keep both watcher surfaces alive so the relay no longer depends on manual paste steps

Use the publisher scripts to send real messages between lanes.

## Publishers

### Mac -> Windows

Run on the Mac:

```bash
bash docs/agro/live-bridge/scripts/publish-bridge-message-to-windows-codex.sh \
  --subject "..." \
  --next-step "..." \
  --message "..."
```

Behavior:

- fetches the shared bridge branch
- writes `bridge/inbox.md`, `bridge/state.json`, and `logs/events.log`
- commits the bridge message
- pushes it to `codex/mac-codex-first-sync`
- hands ownership to `windows-codex`, which lets the Windows watcher inject the prompt
- also sends the rendered handoff prompt directly to Windows Codex over Taildrop unless `--no-direct-prompt` is used

Flags:

- `--message-file <path>`
- `--status <value>`
- `--remote-name <name>`
- `--branch-name <name>`
- `--max-retries <count>`
- `--no-direct-prompt`
- `--dry-run`

### Windows -> Mac

Run on Windows:

```powershell
pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/publish-bridge-message-to-mac-codex.ps1 `
  -Subject "..." `
  -NextStep "..." `
  -Message "..."
```

Behavior:

- fetches the shared bridge branch
- writes `bridge/inbox.md`, `bridge/state.json`, and `logs/events.log`
- commits the bridge message
- pushes it to `codex/mac-codex-first-sync`
- hands ownership to `mac-codex`, which lets the Mac watcher inject the prompt
- also sends the rendered handoff prompt directly to Mac Codex over Taildrop unless `-NoDirectPrompt` is used

Flags:

- `-MessageFile <path>`
- `-Status <value>`
- `-RemoteName <name>`
- `-BranchName <name>`
- `-MaxRetries <count>`
- `-NoDirectPrompt`
- `-DryRun`

There are two layers:

- bridge-message injectors
  - turn the current repo-native bridge state into a local Codex prompt
- prompt-file transport scripts
  - send arbitrary prompt files over Taildrop and auto-land them in the other Codex app composer
- direct-link starters
  - launch both the repo watcher and the prompt-file watcher on each side

## Shared Prompt Renderer

Both sides now use the same renderer:

```bash
node docs/agro/live-bridge/scripts/render-bridge-prompt.mjs \
  --repo-root /path/to/Gemma \
  --inbox-path /path/to/inbox.md \
  --state-path /path/to/state.json \
  --outbox-path /path/to/outbox.md \
  --git-ref origin/codex/mac-codex-first-sync
```

That means the repo watcher, the local injector, and the prompt-file sender all emit the same handoff prompt text.

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
- this covers the repo-native path

Flags:

- `-Once`
- `-Force`
- `-PrintOnly`
- `-ClipboardOnly`
- `-RepoRoot <path>`
- `-RemoteName <name>`
- `-BranchName <name>`
- `-AppTitle <title>`

### Receive Mac prompts automatically

Run on Windows:

```powershell
pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/watch-prompts-from-mac-codex.ps1
```

Behavior:

- starts `tailscale file get --loop`
- watches for `codex-prompt-from-*.md`
- copies the prompt to the Windows clipboard
- activates the `Codex` app
- pastes the prompt
- sends `Enter`, `Enter`

### Send a direct prompt to Mac Codex

Run on Windows:

```powershell
pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/send-prompt-file-to-mac-codex.ps1 -Text "your prompt here"
```

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
- this covers the repo-native path

Flags:

- `--once`
- `--force`
- `--print-only`
- `--clipboard-only`
- `--repo-root <path>`
- `--remote-name <name>`
- `--branch-name <name>`
- `--app-name <name>`

### Receive Windows prompts automatically

Run on the Mac:

```bash
bash docs/agro/live-bridge/scripts/watch-prompts-from-windows-codex.sh
```

Behavior:

- starts `tailscale file get --loop`
- watches for `codex-prompt-from-*.md`
- copies the prompt to the Mac clipboard
- activates the `Codex` app
- pastes the prompt
- sends `Return`, `Return`
- records a delivery receipt into `docs/agro/live-bridge/bridge/direct-link-state.json`

### Send a direct prompt to Windows Codex

Run on the Mac:

```bash
bash docs/agro/live-bridge/scripts/send-prompt-file-to-windows-codex.sh --text "your prompt here"
```

## Start Both Watchers

Mac:

```bash
bash docs/agro/live-bridge/scripts/start-direct-codex-link-mac.sh
```

Windows:

```powershell
pwsh -ExecutionPolicy Bypass -File docs/agro/live-bridge/scripts/start-direct-codex-link-windows.ps1
```

These starters launch both:

- the repo-native bridge watcher
- the Taildrop prompt-file watcher

With both starters running and direct prompt delivery enabled in the publisher scripts, a bridge publish can now land directly in the peer Codex composer without a manual copy step.

## Direct-Link Delivery Receipts

Both prompt-file watchers now call:

```bash
node docs/agro/live-bridge/scripts/record-direct-link-delivery.mjs ...
```

That updates:

- `docs/agro/live-bridge/bridge/direct-link-state.json`
- `docs/agro/live-bridge/logs/prompt-delivery.log`

This is the durable shared-memory layer for the prompt-file transport. If a prompt lands automatically, the receiving machine can record that fact back into the shared branch.

The repo-native sender scripts also write receipts now:

- `clipboard_only`
- `app_delivered_unconfirmed`

That gives the bridge a durable distinction between:

- prompt copied but not sent
- prompt sent into the app/composer
- later thread-level confirmation from the peer Codex reply

## Assumption

These scripts assume the target Codex desktop app is already open and the active thread can accept a composer prompt when the app is activated.

The watcher scripts dispatch from the latest fetched remote bridge state, so communication does not depend on manually checking out the branch first.

With the publisher scripts plus the watcher scripts running on both sides, a bridge message becomes an actual prompt in the other Codex app composer.

# AGRO Mission Control

This is the in-repo MVP mission-control surface for AGRO.

It combines:

- the five operator routing actions
- live Mac and PC lane state
- separate shared, Mac, and PC transcript lanes
- compare-card rendering
- confirmation-gate and recovery visibility
- file-backed session persistence

## Run

```powershell
node C:\Users\jessy\Documents\GitHub\Gemma\apps\mission-control\server\start.mjs
```

Then open [http://127.0.0.1:3040](http://127.0.0.1:3040).

## Live Helper Scripts

Start the repo-hosted mission control with the current local PC model and the current Mac endpoint:

```powershell
pwsh -ExecutionPolicy Bypass -File C:\Users\jessy\Documents\GitHub\Gemma\apps\mission-control\start-live.ps1
```

`start-live.ps1` now probes multiple Mac endpoint shapes and adopts the first healthy one:

- `http://jessys-mac-studio.tail972f90.ts.net:1234`
- `http://100.106.61.53:1234`
- `https://jessys-mac-studio.tail972f90.ts.net`

It also waits for a real local reviewer chat call to succeed before relaunching mission control, so the Windows lane is less likely to flap immediately after restart.

Run a quick live health check for the mission-control server, the local PC LM Studio API, the Mac endpoint, and the real `send-pc` route:

```powershell
pwsh -ExecutionPolicy Bypass -File C:\Users\jessy\Documents\GitHub\Gemma\apps\mission-control\check-live.ps1
```

`check-live.ps1` now reports all three Mac candidate endpoint probes so it is easy to see whether the Mac is exposing LM Studio over raw TCP or Tailscale HTTPS Serve.
It also includes a direct `pc-chat` probe, which is more meaningful than `pc-models` alone when the local reviewer lane is still warming up.
It now also includes DNS, TCP-layer, and curl-level HTTP diagnostics for the Mac host, so blocked states can distinguish `network path is open` from `HTTP upstream reset` or `HTTP 502`.

For the Mac side, there is now a local Node-based checker that validates the mission-control server plus the Mac execution lane directly from this machine:

```bash
node /Users/jessybrenenstahl/Documents/Sprint/Gemma/apps/mission-control/check-live-mac.mjs --text
```

That checker focuses on the local route contract:

- `GET /api/status`
- local Mac `GET /v1/models`
- local Mac `POST /v1/chat/completions`
- real `POST /api/routes/send-mac`

If you also want the Mac-side script to exercise dual-lane route proofs from the same entry point, add:

```bash
node /Users/jessybrenenstahl/Documents/Sprint/Gemma/apps/mission-control/check-live-mac.mjs --include-send-pc --include-compare --text
```

The optional dual-lane checks stay off by default so the Mac script can still be useful when only the Mac lane is expected to be healthy.

The mission-control UI also exposes a `Recovery Watch` card backed by `GET /api/live-recovery`, so you can inspect the latest recovery summary, Mac probe statuses, and watcher output from the app itself.

If you want Windows to wait for the Mac to come online and then automatically verify the real dual-lane routes, use:

```powershell
pwsh -ExecutionPolicy Bypass -File C:\Users\jessy\Documents\GitHub\Gemma\apps\mission-control\recover-dual-live.ps1 -Attempts 0 -IntervalSeconds 15
```

When a Mac endpoint becomes healthy, `recover-dual-live.ps1` will:

- rerun `start-live.ps1`
- exercise `send-mac`, `send-both`, and `compare`
- write the latest recovery summary to `apps/mission-control/.data/live-recovery/latest-dual-verify.json`

While it is waiting, it now refreshes that same summary file on every attempt so the UI shows the current attempt state instead of only the last completed run.

To run that recovery loop in the background with durable stdout/stderr files and a PID record, use:

```powershell
pwsh -ExecutionPolicy Bypass -File C:\Users\jessy\Documents\GitHub\Gemma\apps\mission-control\start-recovery-watcher.ps1 -Attempts 0 -IntervalSeconds 15
```

This writes:

- `apps/mission-control/.data/live-recovery/watcher-output.txt`
- `apps/mission-control/.data/live-recovery/watcher-error.txt`
- `apps/mission-control/.data/live-recovery/watcher.pid`

## Notes

- Session snapshots persist under `apps/mission-control/.data/sessions`.
- The mission-control server uses the same route layer tested under `apps/mission-control/test`.
- Live execution still depends on the configured Mac endpoint and local PC LM Studio availability.

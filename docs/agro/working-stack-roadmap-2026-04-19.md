# Working Stack Roadmap - 2026-04-19

Goal: move Gemma from Codex-to-Codex coordination into a stable mission-control-driven dual-lane stack where local Gemma execution is the default and Codex only handles debugging, code changes, and escalation.

## Current Confirmed State

- Mission-control tests are green in repo:
  - `node --test apps/mission-control/test/*.test.mjs`
  - `105/105` passing on Mac
- Mac -> Windows bridge delivery is proven at the transport and app-delivery layer.
- Windows -> Mac transport is also working:
  - a fresh Windows prompt file containing `embergate` reached the Mac inbox
  - the Mac prompt watcher delivered it into the Mac Codex composer after watcher restart
- The direct-link infrastructure still has two recent operational issues:
  - Mac background prompt watcher could silently die
  - publisher scripts were double-sending by default by combining repo ownership handoff with prompt-file transport

## Fixes Landed

- `238658d` `Harden bridge watchers and stop default double-send`
  - watcher starters now supervise and restart the watcher processes
  - duplicate watcher instances are collapsed on startup
  - publisher scripts now default to repo-watcher delivery only
  - direct Taildrop prompt delivery is opt-in only

## Definition Of Done

The stack is "working" when all of the following are true:

1. WC and MC can still exchange fresh prompts without stale replays or fan-out duplicates.
2. Mission-control can run the real Windows and Mac lanes directly without Codex as the normal transport.
3. Direct Mac HTTP execution is the default Mac lane.
4. `apps/mac-agent/` is documented and verified as fallback-only.
5. A real AGRO workflow can be executed, compared, recovered, and persisted through mission-control.

## Execution Passes

### Pass 1: Stabilize Codex Transport

Objective:
- make the bridge boring and deterministic so it can stop being the main problem

Tasks:
- both lanes pull `238658d`
- both lanes restart their direct-link watcher stacks from current code
- verify one fresh prompt each direction with:
  - no stale replay
  - no duplicate fan-out
  - no dead watcher
- keep prompt-file delivery opt-in only unless a watcher path is down

Exit criteria:
- one fresh MC -> WC prompt lands once
- one fresh WC -> MC prompt lands once

### Pass 2: Re-center on Mission Control

Objective:
- stop using Codex-to-Codex prompting as the default operator path

Tasks:
- Windows lane owns `start-live.ps1`, `check-live.ps1`, and `recover-dual-live.ps1`
- Mac lane owns direct Mac endpoint health and fallback clarity
- Mac lane now also owns `check-live-mac.mjs` as the local route-health proof entry point
- verify the real route layer:
  - `send-pc`
  - `send-mac`
  - `send-both`
  - `compare`
- require proof from mission-control routes, not sidecar prompt exchange

Exit criteria:
- route health is visible from the UI and scripts
- Codex prompting is no longer needed for ordinary route execution

MC progress update:
- added `apps/mission-control/check-live-mac.mjs` and `apps/mission-control/check-live-mac-lib.mjs`
- added `apps/mission-control/test/check-live-mac.test.mjs`
- current repo proof:
  - `node --test apps/mission-control/test/check-live-mac.test.mjs`
  - `6/6` passing
- current machine-state finding from MC:
  - nothing is listening on `127.0.0.1:3040` or `127.0.0.1:1234`
  - `lms server status` reports `The server is not running.`
- result note:
  - `docs/agro/pass2-mac-live-check-2026-04-19.md`

### Pass 3: Lock The Mac Lane Contract

Objective:
- make the Mac lane predictable enough that mission-control can treat it as infrastructure

Tasks:
- keep direct HTTP as the primary Mac path
- verify endpoint and model contract:
  - endpoint shape
  - model id
  - timeout behavior
  - compare behavior
- keep `apps/mac-agent/` as fallback only
- document the failover trigger from direct HTTP to file-I/O

Exit criteria:
- direct HTTP is the normal Mac lane
- fallback path is explicit and tested

### Pass 4: Choose Local Gemma Roles

Objective:
- assign sustainable model roles on each machine instead of one-off testing roles

Tasks:
- Mac:
  - confirm `google/gemma-4-26b-a4b` role and expected latency/behavior
- Windows:
  - benchmark the strongest practical sustained local tier
  - pick reviewer/compare role that fits real runtime, not just peak quality
- define role split in mission-control terms:
  - execution lane
  - reviewer lane
  - compare lane

Exit criteria:
- roles are explicit and reflected in lane config and scripts

### Pass 5: Prove The Working AGRO Stack

Objective:
- show a real end-to-end AGRO cycle with recovery and persistence

Tasks:
- run a real AGRO task through mission-control
- persist session state
- trigger compare and confirm shared card behavior
- exercise one recovery/failover path
- capture proof artifacts in repo docs/results

Exit criteria:
- working dual-lane AGRO flow is reproducible
- Codex involvement is limited to debugging and changes

## Lane Ownership Proposal

### WC

- Windows watcher health
- Windows mission-control live scripts
- Windows local Gemma tier selection
- UI/runtime proof from the operator surface

### MC

- Mac endpoint and fallback contract
- bridge reliability and dedupe guardrails
- route/test integrity
- Mac-native route-health tooling
- shared roadmap and repo memory

## Immediate Next Joint Step

1. Pull `238658d` on Windows.
2. Restart the Windows direct-link watcher stack from current code.
3. Run one fresh single-word prompt MC -> WC and one fresh single-word prompt WC -> MC.
4. If both land exactly once, stop treating direct prompting as a blocker and move straight into mission-control route validation.

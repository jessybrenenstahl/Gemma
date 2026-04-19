# Outbox

Status: `active`
Owner: `windows-codex`
Updated At: `2026-04-18T18:58:51-07:00`
Source Message ID: `windows-20260418-184727-25396`
Message ID: `mac-20260418-185851-64182`

## Subject

Mac API listener restored; route validation complete

## Message

Acknowledged Windows message `windows-20260418-184727-25396`.

Concrete Mac results:
1. Restored the LM Studio API listener. `LM Studio` is listening on `127.0.0.1:1234`; `lms server status` reports running; `lms ps` shows `google/gemma-4-26b-a4b` loaded and idle.
2. Confirmed `/v1/models` returns `HTTP/1.1 200 OK` on all three endpoints:
   - `http://127.0.0.1:1234/v1/models`
   - `http://100.106.61.53:1234/v1/models`
   - `http://jessys-mac-studio.tail972f90.ts.net:1234/v1/models`
   All three return model id `google/gemma-4-26b-a4b`.
3. Route and adapter tests on Mac now pass:
   - `node --test apps/mission-control/test/mac-lane-adapter.test.mjs` -> 4/4 pass
   - `node --test apps/mission-control/test/send-mac-route.test.mjs` -> 4/4 pass
   - `node --test apps/mission-control/test/execute-critique-and-compare-route.test.mjs` -> 5/5 pass
4. Live route validation against the real Mac endpoint succeeded:
   - `send-mac` through `MacLaneAdapter` to `http://127.0.0.1:1234` returned `200 OK`
   - session `mac_state.status = idle`
   - transcript recorded both the transport trace and a live `agent_reply`
   - `compare` returned `200 OK`
   - local compare arbitration was `operator_decision` with reason code `unverified_lane_disagreement`
5. Qualification: the live `compare` pass here used a local stub PC executor because the Windows lane runtime is not present on this Mac. That validates the Mac adapter and route path, not the full cross-machine compare.

Mac-side notes:
- `repo_context` still reports `No local repo path is configured for the mac lane.` This is informational, not the HTTP blocker.
- No Mac-side bridge transport issues occurred during validation.

Immediate next step for Windows:
- rerun `apps/mission-control/check-live.ps1`
- rerun the real Windows `send-mac` and `compare` path against the restored Mac endpoint
- report whether Windows now sees `send-mac` 200 and a usable Mac response body through the shared branch

# Local Gemma Handoff Next Stage

Goal: advance AGRO from cross-machine Codex coordination into durable local-Gemma-backed operation on both lanes, with Codex acting as setup and verification rather than the long-term operator.

## Five Concrete Steps

1. **Stabilize bidirectional Codex communication**
   - Run the new live-bridge prompt receiver on Windows and Mac.
   - Confirm each side can send a prompt that lands in the other Codex composer.

2. **Validate direct Mac Gemma execution as the preferred lane**
   - Use `apps/mission-control/server/mac-lane-adapter.mjs` against:
     - `http://100.106.61.53:1234`
   - Confirm route-level `send-mac` and `compare` behavior with the real Mac endpoint.

3. **Keep the Mac agent as the fallback execution path**
   - Confirm `apps/mac-agent/` still works when direct HTTP is unavailable.
   - Document the conditions where AGRO should fail over from direct HTTP to file-I/O.

4. **Choose the local Gemma operating tier on each machine**
   - Mac: confirm the current `google/gemma-4-26b-a4b` lane behavior and expected role.
   - Windows: benchmark and choose the strongest practical local Gemma tier for sustained use, not just one-off review.

5. **Prepare the project handoff from Codex orchestration to local Gemma ownership**
   - Reduce manual clipboard-only coordination.
   - Make mission-control routes and scripts the primary operators.
   - Leave Codex responsible for debugging, escalation, and change management instead of routine message passing.

## Immediate Joint Question For Both Codex Lanes

What is the minimum reliable path to get AGRO from:

- Codex-to-Codex coordination

to:

- mission-control orchestrating Mac and Windows local Gemma execution directly,
- with Codex only stepping in when a route fails or a code change is needed?

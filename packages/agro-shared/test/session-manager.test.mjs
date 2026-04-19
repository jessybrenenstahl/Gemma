import test from "node:test";
import assert from "node:assert/strict";

import { AgroSessionManager } from "../src/index.mjs";

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 13, 15, 0, tick)).toISOString();
  };
}

test("session manager creates a valid running session with derived state", () => {
  const manager = new AgroSessionManager({
    idFactory: () => "session-1",
    now: makeClock(),
  });

  const session = manager.createSession({
    missionGoal: "Ship AGRO mission control MVP",
    operatorMode: "send_mac",
  });

  assert.equal(session.session_id, "session-1");
  assert.equal(session.status, "running");
  assert.equal(session.mission_state.body_authority, "mac");
  assert.equal(session.mission_state.active_repo, "jessybrenenstahl/Gemma");
  assert.equal(session.mac_state.repo_context.repo, "jessybrenenstahl/Gemma");
  assert.equal(session.pc_state.repo_context.repo, "jessybrenenstahl/Gemma");
  assert.equal(session.derived.repo_header.repo, "jessybrenenstahl/Gemma");
  assert.deepEqual(session.derived.transcript_counts, { shared: 0, mac: 0, pc: 0 });
});

test("session manager updates mission state and routes transcript events through lane state", () => {
  const manager = new AgroSessionManager({
    idFactory: () => "session-2",
    now: makeClock(),
  });
  const session = manager.createSession({
    missionGoal: "Initial goal",
    operatorMode: "send_both",
  });

  manager.updateMissionState(session.session_id, {
    mission_goal: "Refined AGRO goal",
    operator_mode: "execute_critique",
  });

  const updated = manager.appendTranscriptEvent(session.session_id, {
    lane: "mac",
    type: "operator_prompt",
    content: "Implement the first execution route.",
    round: 1,
    metrics: {
      latency_ms: 1200,
      tokens_in: 55,
      tokens_out: 0,
    },
  });

  assert.equal(updated.mission_state.mission_goal, "Refined AGRO goal");
  assert.equal(updated.mission_state.operator_mode, "execute_critique");
  assert.equal(updated.mac_state.current_task, "Implement the first execution route.");
  assert.equal(updated.mac_state.status, "thinking");
  assert.match(updated.mac_state.last_action, /^operator_prompt:/);
  assert.equal(updated.derived.transcript_counts.mac, 1);
});

test("session manager records verification, compare cards, and active risks", () => {
  const manager = new AgroSessionManager({
    idFactory: () => "session-3",
    now: makeClock(),
  });
  const session = manager.createSession({
    missionGoal: "Compare Mac and PC AGRO recommendations",
    operatorMode: "compare",
  });

  manager.recordVerification(session.session_id, "mac", {
    summary: "Mac verified that the mission state schema loads correctly.",
    verification_type: "tool",
    status: "verified",
    evidence: "node --test passed for schema loading",
  });

  manager.recordErrorGap(session.session_id, "pc", {
    summary: "PC flagged a missing compare reducer implementation.",
    severity: "warn",
    kind: "gap",
    status: "active",
  });

  const updated = manager.addCompareCard(session.session_id, {
    question: "What should AGRO implement next?",
    mac_answer_summary: "Build the session manager first.",
    pc_answer_summary: "Add route reducers before transport.",
    overlap: "Both want state to be event-driven.",
    disagreement: "Mac prefers backend-first; PC prefers reducer-first.",
    recommended_next_step: "Keep backend-first and add reducer hooks alongside it.",
    arbitration_status: "needs_review",
  });

  assert.equal(updated.mac_state.last_verified_result.verification_type, "tool");
  assert.equal(updated.mission_state.arbitration_state, "needs_review");
  assert.equal(updated.mission_state.active_risk_count, 2);
  assert.equal(updated.derived.latest_compare_card_id, updated.compare_cards[0].id);
});

test("session manager supports stop, completion, and resume recovery", () => {
  const manager = new AgroSessionManager({
    idFactory: () => "session-4",
    now: makeClock(),
  });
  const session = manager.createSession({
    missionGoal: "Recover an AGRO session after refresh",
    operatorMode: "send_pc",
  });

  const stopped = manager.stopSession(session.session_id);
  assert.equal(stopped.status, "stopped");

  const resumedManager = new AgroSessionManager({
    idFactory: () => "unused",
    now: makeClock(),
  });
  const resumed = resumedManager.resumeSession(stopped);
  assert.equal(resumed.session_id, session.session_id);
  assert.equal(resumed.status, "stopped");

  const completed = resumedManager.completeSession(session.session_id);
  assert.equal(completed.status, "completed");
});

test("session manager records lane heartbeats and promotes stalled latency hints", () => {
  const manager = new AgroSessionManager({
    idFactory: () => "session-5",
    now: makeClock(),
  });
  const session = manager.createSession({
    missionGoal: "Track AGRO lane heartbeat state",
    operatorMode: "send_mac",
  });

  const updated = manager.recordLaneHeartbeat(session.session_id, "mac", {
    timestamp: new Date(Date.UTC(2026, 3, 13, 15, 1, 0)).toISOString(),
    ms_estimate: 35000,
  });

  assert.equal(updated.mac_state.heartbeat_state, "stalled");
  assert.equal(updated.mac_state.latency_hint.label, "stalled");
  assert.equal(updated.derived.heartbeat_by_lane.mac.state, "stalled");
  assert.equal(updated.derived.heartbeat_by_lane.pc.state, "idle");
});

test("session manager records lane repo context and surfaces repo header state", () => {
  const manager = new AgroSessionManager({
    idFactory: () => "session-6",
    now: makeClock(),
  });
  const session = manager.createSession({
    missionGoal: "Track AGRO repo scope",
    operatorMode: "send_pc",
  });

  const updated = manager.recordLaneRepoContext(session.session_id, "pc", {
    repo: "jessybrenenstahl/Gemma",
    local_path: "C:\\Users\\jessy\\Documents\\GitHub\\Gemma",
    presence: "present",
    usability: "usable",
    last_checked_at: new Date(Date.UTC(2026, 3, 13, 15, 2, 0)).toISOString(),
    detail: "Repo checkout for the pc lane matches jessybrenenstahl/Gemma.",
  });

  assert.equal(updated.pc_state.repo_context.usability, "usable");
  assert.equal(updated.derived.repo_header.pc.local_path, "C:\\Users\\jessy\\Documents\\GitHub\\Gemma");
  assert.match(updated.derived.repo_header.label, /PC: usable/);
});

test("session manager records and clears operator confirmation gates", () => {
  const manager = new AgroSessionManager({
    idFactory: () => "session-7",
    now: makeClock(),
  });
  const session = manager.createSession({
    missionGoal: "Require operator confirmation before destructive Mac execution",
    operatorMode: "send_mac",
  });

  const gated = manager.recordConfirmationGate(session.session_id, "mac", {
    id: "gate-7",
    status: "pending",
    summary: "Operator confirmation required before deleting generated files.",
    category: "destructive_filesystem",
    severity: "high",
    requested_at: new Date(Date.UTC(2026, 3, 13, 15, 3, 0)).toISOString(),
    resolved_at: null,
    operator_note: "",
    related_event_ids: ["evt-1"],
  });

  assert.equal(gated.mac_state.confirmation_gate.status, "pending");
  assert.equal(gated.mac_state.status, "awaiting_operator");

  const cleared = manager.clearConfirmationGate(session.session_id, "mac");
  assert.equal(cleared.mac_state.confirmation_gate.status, "clear");
  assert.equal(cleared.mac_state.status, "idle");
});

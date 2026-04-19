import { randomUUID } from "node:crypto";

import { assertValidSchemaShape, cloneStructured } from "./schema-registry.mjs";

const DEFAULT_REPO = "jessybrenenstahl/Gemma";

function summarize(content, maxLength = 140) {
  const text = String(content || "").trim().replace(/\s+/g, " ");
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function makeDefaultVerificationRecord(now) {
  return {
    summary: "No verified result yet.",
    timestamp: now,
    verification_type: "system",
  };
}

function makeDefaultErrorGap(now) {
  return {
    summary: "No active gaps.",
    severity: "info",
    timestamp: now,
  };
}

function makeDefaultConfirmationGate() {
  return {
    id: null,
    status: "clear",
    summary: "No operator confirmation required.",
    category: "none",
    severity: "info",
    requested_at: null,
    resolved_at: null,
    operator_note: "",
    related_event_ids: [],
  };
}

function makeDefaultLatencyHint() {
  return {
    label: "fast",
    ms_estimate: 0,
  };
}

function makeDefaultRepoContext(repo, now) {
  return {
    repo,
    local_path: null,
    presence: "unknown",
    usability: "unknown",
    last_checked_at: now,
    detail: "Repo scope has not been checked for this lane yet.",
  };
}

export function createDefaultMissionState({
  missionGoal = "",
  operatorMode = "send_mac",
  activeRepo = DEFAULT_REPO,
  now,
} = {}) {
  const state = {
    mission_goal: missionGoal,
    operator_mode: operatorMode,
    body_authority: "mac",
    arbitration_state: "clear",
    current_compare_summary: "",
    active_risk_count: 0,
    active_repo: activeRepo,
    last_updated_at: now,
  };

  return assertValidSchemaShape("mission-state", state);
}

export function createDefaultAgentState(agentId, now, activeRepo = DEFAULT_REPO) {
  const role = agentId === "mac" ? "primary_executor" : "peer_reviewer";
  const authorityBadge = agentId === "mac" ? "Primary body" : "Peer / critic";
  const state = {
    agent_id: agentId,
    role,
    status: "idle",
    current_task: "",
    last_action: "",
    last_verified_result: makeDefaultVerificationRecord(now),
    latest_error_gap: makeDefaultErrorGap(now),
    confirmation_gate: makeDefaultConfirmationGate(),
    latency_hint: makeDefaultLatencyHint(),
    last_heartbeat_at: null,
    heartbeat_state: "idle",
    authority_badge: authorityBadge,
    repo_context: makeDefaultRepoContext(activeRepo, now),
  };

  return assertValidSchemaShape("agent-state", state);
}

function makeDefaultMetrics(metrics = {}) {
  return {
    latency_ms: Number(metrics.latency_ms) || 0,
    tokens_in: Number(metrics.tokens_in) || 0,
    tokens_out: Number(metrics.tokens_out) || 0,
  };
}

function normalizeEvent(event, session) {
  const normalized = {
    id: String(event.id || `evt-${randomUUID()}`),
    lane: event.lane,
    type: event.type,
    timestamp: String(event.timestamp || session.updated_at),
    round:
      Number.isInteger(event.round) && event.round > 0
        ? event.round
        : Math.max(session.transcript.at(-1)?.round || 0, 1),
    routing_mode: String(event.routing_mode || session.mission_state.operator_mode),
    content: String(event.content || ""),
    verified: Boolean(event.verified),
    related_event_ids: Array.isArray(event.related_event_ids)
      ? event.related_event_ids.map((id) => String(id))
      : [],
    metrics: makeDefaultMetrics(event.metrics),
  };

  return assertValidSchemaShape("transcript-event", normalized);
}

function normalizeCompareCard(compareCard, session) {
  const normalized = {
    id: String(compareCard.id || `cmp-${randomUUID()}`),
    question: String(compareCard.question || session.mission_state.mission_goal || ""),
    mac_answer_summary: String(compareCard.mac_answer_summary || ""),
    pc_answer_summary: String(compareCard.pc_answer_summary || ""),
    overlap: String(compareCard.overlap || ""),
    disagreement: String(compareCard.disagreement || ""),
    recommended_next_step: String(compareCard.recommended_next_step || ""),
    arbitration_status: String(
      compareCard.arbitration_status || session.mission_state.arbitration_state
    ),
    created_at: String(compareCard.created_at || session.updated_at),
  };

  return assertValidSchemaShape("compare-card", normalized);
}

function normalizeVerificationRecord(verification, now) {
  const normalized = {
    summary: String(verification.summary || ""),
    verification_type: String(verification.verification_type || "system"),
    status: String(verification.status || "verified"),
    evidence: String(verification.evidence || ""),
    related_event_ids: Array.isArray(verification.related_event_ids)
      ? verification.related_event_ids.map((id) => String(id))
      : [],
    timestamp: String(verification.timestamp || now),
  };

  return assertValidSchemaShape("verification", normalized);
}

function normalizeErrorGap(errorGap, now) {
  const normalized = {
    summary: String(errorGap.summary || ""),
    severity: String(errorGap.severity || "warn"),
    kind: String(errorGap.kind || "gap"),
    status: String(errorGap.status || "active"),
    superseded_by_event_id:
      errorGap.superseded_by_event_id === null || errorGap.superseded_by_event_id === undefined
        ? null
        : String(errorGap.superseded_by_event_id),
    timestamp: String(errorGap.timestamp || now),
  };

  return assertValidSchemaShape("error-gap", normalized);
}

function normalizeConfirmationGate(gate, now) {
  const normalized = {
    id:
      gate.id === null || gate.id === undefined || gate.id === ""
        ? null
        : String(gate.id),
    status: String(gate.status || "pending"),
    summary: String(gate.summary || "Operator confirmation is required."),
    category: String(gate.category || "mixed"),
    severity: String(gate.severity || "warn"),
    requested_at: String(gate.requested_at || now),
    resolved_at:
      gate.resolved_at === null || gate.resolved_at === undefined || gate.resolved_at === ""
        ? null
        : String(gate.resolved_at),
    operator_note: String(gate.operator_note || ""),
    related_event_ids: Array.isArray(gate.related_event_ids)
      ? gate.related_event_ids.map((id) => String(id))
      : [],
  };

  return assertValidSchemaShape("confirmation-gate", normalized);
}

function computeLatencyLabel(msEstimate) {
  if (msEstimate >= 30_000) {
    return "stalled";
  }
  if (msEstimate >= 10_000) {
    return "slow";
  }
  if (msEstimate >= 2_000) {
    return "steady";
  }
  return "fast";
}

function recalculateMissionRiskCount(session) {
  const latestGaps = [session.mac_state.latest_error_gap, session.pc_state.latest_error_gap];
  let activeRiskCount = latestGaps.filter(
    (gap) => gap.summary !== "No active gaps." && ["warn", "high"].includes(gap.severity)
  ).length;
  activeRiskCount += [session.mac_state.repo_context, session.pc_state.repo_context].filter(
    (repoContext) => repoContext.usability === "unusable"
  ).length;

  const latestCompareCard = session.compare_cards.at(-1);
  const activeArbitrationState =
    latestCompareCard?.arbitration_status || session.mission_state.arbitration_state;

  if (activeArbitrationState !== "clear") {
    activeRiskCount += 1;
  }

  session.mission_state.active_risk_count = activeRiskCount;
}

function updateUpdatedAt(session, now) {
  session.updated_at = now;
  session.mission_state.last_updated_at = now;
}

function getAgentKey(lane) {
  if (lane === "mac") {
    return "mac_state";
  }
  if (lane === "pc") {
    return "pc_state";
  }
  throw new Error(`Unsupported agent lane "${lane}".`);
}

function applyTranscriptEventToState(session, event) {
  if (event.lane === "shared") {
    if (event.type === "operator_prompt") {
      session.mission_state.mission_goal = event.content;
    }
    if (event.type === "compare") {
      session.mission_state.current_compare_summary = summarize(event.content);
    }
    return;
  }

  const agentKey = getAgentKey(event.lane);
  const agentState = session[agentKey];

  agentState.last_action = `${event.type}: ${summarize(event.content)}`;
  agentState.latency_hint = {
    label: computeLatencyLabel(event.metrics.latency_ms),
    ms_estimate: event.metrics.latency_ms,
  };

  if (event.type === "operator_prompt") {
    agentState.current_task = summarize(event.content, 220);
    agentState.status = "thinking";
  } else if (event.type === "execution_action") {
    agentState.status = "executing";
  } else if (event.type === "critique") {
    agentState.status = "reviewing";
  } else if (event.type === "compare") {
    agentState.status = "comparing";
  } else if (event.type === "verification") {
    agentState.status = "verifying";
  } else if (event.type === "error") {
    agentState.status =
      agentState.confirmation_gate?.status === "pending" ? "awaiting_operator" : "blocked";
  } else if (event.type === "agent_reply") {
    agentState.status = "idle";
  }

  agentState.last_heartbeat_at = event.timestamp;
  agentState.heartbeat_state = "active";

  if (event.verified) {
    agentState.last_verified_result = {
      summary: summarize(event.content, 220),
      timestamp: event.timestamp,
      verification_type: "system",
    };
  }
}

export class AgroSessionManager {
  constructor({
    idFactory = () => `session-${randomUUID()}`,
    now = () => new Date().toISOString(),
    snapshotStore = null,
  } = {}) {
    this.idFactory = idFactory;
    this.now = now;
    this.snapshotStore = snapshotStore;
    this.sessions = new Map();

    if (this.snapshotStore?.loadSessions) {
      for (const snapshot of this.snapshotStore.loadSessions()) {
        const candidate = cloneStructured(snapshot);
        delete candidate.derived;
        assertValidSchemaShape("session-state", candidate);
        this.sessions.set(candidate.session_id, candidate);
      }
    }
  }

  createSession({
    missionGoal = "",
    operatorMode = "send_mac",
    activeRepo = DEFAULT_REPO,
    draftPrompt = "",
  } = {}) {
    const now = this.now();
    const session = {
      session_id: this.idFactory(),
      status: "running",
      created_at: now,
      updated_at: now,
      mission_state: createDefaultMissionState({
        missionGoal,
        operatorMode,
        activeRepo,
        now,
      }),
      mac_state: createDefaultAgentState("mac", now, activeRepo),
      pc_state: createDefaultAgentState("pc", now, activeRepo),
      compare_cards: [],
      transcript: [],
      draft_prompt: String(draftPrompt),
    };

    assertValidSchemaShape("session-state", session);
    this.sessions.set(session.session_id, session);
    return this.getSession(session.session_id);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => this.#withDerived(session));
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session "${sessionId}".`);
    }

    return this.#withDerived(session);
  }

  resumeSession(snapshot) {
    const candidate = cloneStructured(snapshot);
    delete candidate.derived;
    assertValidSchemaShape("session-state", candidate);
    this.sessions.set(candidate.session_id, candidate);
    return this.getSession(candidate.session_id);
  }

  updateMissionState(sessionId, patch = {}) {
    const session = this.#requireSession(sessionId);
    const now = this.now();
    const nextActiveRepo = String(patch.active_repo || session.mission_state.active_repo);
    session.mission_state = assertValidSchemaShape("mission-state", {
      ...session.mission_state,
      ...patch,
      active_repo: nextActiveRepo,
      last_updated_at: now,
    });
    if (nextActiveRepo !== session.mac_state.repo_context.repo) {
      session.mac_state.repo_context = makeDefaultRepoContext(nextActiveRepo, now);
      session.pc_state.repo_context = makeDefaultRepoContext(nextActiveRepo, now);
    }
    updateUpdatedAt(session, now);
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  updateAgentState(sessionId, lane, patch = {}) {
    const session = this.#requireSession(sessionId);
    const agentKey = getAgentKey(lane);
    session[agentKey] = assertValidSchemaShape("agent-state", {
      ...session[agentKey],
      ...patch,
    });
    updateUpdatedAt(session, this.now());
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  setDraftPrompt(sessionId, draftPrompt) {
    const session = this.#requireSession(sessionId);
    session.draft_prompt = String(draftPrompt || "");
    updateUpdatedAt(session, this.now());
    return this.#commit(session);
  }

  recordLaneRepoContext(sessionId, lane, repoContext) {
    const session = this.#requireSession(sessionId);
    const agentKey = getAgentKey(lane);
    session[agentKey] = assertValidSchemaShape("agent-state", {
      ...session[agentKey],
      repo_context: {
        ...session[agentKey].repo_context,
        ...repoContext,
      },
    });
    updateUpdatedAt(session, this.now());
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  recordConfirmationGate(sessionId, lane, confirmationGate) {
    const session = this.#requireSession(sessionId);
    const agentKey = getAgentKey(lane);
    const normalized = normalizeConfirmationGate(confirmationGate, this.now());

    session[agentKey] = assertValidSchemaShape("agent-state", {
      ...session[agentKey],
      confirmation_gate: normalized,
      status: normalized.status === "pending" ? "awaiting_operator" : session[agentKey].status,
    });
    updateUpdatedAt(session, this.now());
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  clearConfirmationGate(sessionId, lane) {
    const session = this.#requireSession(sessionId);
    const agentKey = getAgentKey(lane);

    session[agentKey] = assertValidSchemaShape("agent-state", {
      ...session[agentKey],
      confirmation_gate: makeDefaultConfirmationGate(),
      status:
        session[agentKey].status === "awaiting_operator" ? "idle" : session[agentKey].status,
    });
    updateUpdatedAt(session, this.now());
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  recordLaneHeartbeat(sessionId, lane, heartbeat = {}) {
    const session = this.#requireSession(sessionId);
    const agentKey = getAgentKey(lane);
    const timestamp = String(heartbeat.timestamp || this.now());
    const msEstimate = Number(
      heartbeat.ms_estimate ?? heartbeat.latency_ms ?? session[agentKey].latency_hint.ms_estimate
    );
    const heartbeatState = msEstimate >= 30_000 ? "stalled" : "active";

    session[agentKey] = assertValidSchemaShape("agent-state", {
      ...session[agentKey],
      last_heartbeat_at: timestamp,
      heartbeat_state: heartbeatState,
      latency_hint: {
        label: computeLatencyLabel(msEstimate),
        ms_estimate: msEstimate,
      },
    });
    updateUpdatedAt(session, timestamp);
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  appendTranscriptEvent(sessionId, event) {
    const session = this.#requireSession(sessionId);
    const normalized = normalizeEvent(event, session);
    session.transcript.push(normalized);
    applyTranscriptEventToState(session, normalized);
    updateUpdatedAt(session, normalized.timestamp);
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  addCompareCard(sessionId, compareCard) {
    const session = this.#requireSession(sessionId);
    const normalized = normalizeCompareCard(compareCard, session);
    session.compare_cards.push(normalized);
    session.mission_state.current_compare_summary = summarize(
      `${normalized.overlap} ${normalized.disagreement} ${normalized.recommended_next_step}`.trim(),
      240
    );
    session.mission_state.arbitration_state = normalized.arbitration_status;
    updateUpdatedAt(session, normalized.created_at);
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  recordVerification(sessionId, lane, verification) {
    const session = this.#requireSession(sessionId);
    const now = this.now();
    const normalized = normalizeVerificationRecord(verification, now);
    const agentKey = getAgentKey(lane);

    const updated = this.appendTranscriptEvent(sessionId, {
      lane,
      type: "verification",
      content: normalized.summary,
      verified: normalized.status === "verified",
      timestamp: normalized.timestamp,
      related_event_ids: normalized.related_event_ids,
    });

    if (normalized.status === "verified") {
      return this.updateAgentState(sessionId, lane, {
        last_verified_result: {
          summary: summarize(normalized.summary, 220),
          timestamp: normalized.timestamp,
          verification_type: normalized.verification_type,
        },
        status: "idle",
      });
    }

    return updated;
  }

  recordErrorGap(sessionId, lane, errorGap) {
    const session = this.#requireSession(sessionId);
    const normalized = normalizeErrorGap(errorGap, this.now());
    const agentKey = getAgentKey(lane);

    session[agentKey].latest_error_gap = {
      summary: summarize(normalized.summary, 220),
      severity: normalized.severity,
      timestamp: normalized.timestamp,
    };
    session[agentKey].status =
      normalized.status === "resolved"
        ? "idle"
        : normalized.kind === "confirmation_required"
          ? "awaiting_operator"
          : "blocked";

    this.appendTranscriptEvent(sessionId, {
      lane,
      type: "error",
      content: normalized.summary,
      verified: false,
    });

    return this.getSession(sessionId);
  }

  clearErrorGap(sessionId, lane) {
    const session = this.#requireSession(sessionId);
    const agentKey = getAgentKey(lane);
    session[agentKey].latest_error_gap = makeDefaultErrorGap(this.now());
    if (session[agentKey].status === "blocked") {
      session[agentKey].status = "idle";
    }
    updateUpdatedAt(session, this.now());
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  stopSession(sessionId) {
    return this.#setSessionStatus(sessionId, "stopped");
  }

  completeSession(sessionId) {
    return this.#setSessionStatus(sessionId, "completed");
  }

  markSessionError(sessionId, summary) {
    const session = this.#requireSession(sessionId);
    session.status = "error";
    session.pc_state.latest_error_gap = {
      summary: summarize(summary, 220),
      severity: "high",
      timestamp: this.now(),
    };
    updateUpdatedAt(session, this.now());
    recalculateMissionRiskCount(session);
    return this.#commit(session);
  }

  #setSessionStatus(sessionId, status) {
    const session = this.#requireSession(sessionId);
    session.status = status;
    updateUpdatedAt(session, this.now());
    return this.#commit(session);
  }

  #requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session "${sessionId}".`);
    }

    return session;
  }

  #commit(session) {
    assertValidSchemaShape("session-state", session);
    this.sessions.set(session.session_id, session);
    if (this.snapshotStore?.saveSession) {
      this.snapshotStore.saveSession(cloneStructured(session));
    }
    return this.#withDerived(session);
  }

  #withDerived(session) {
    const snapshot = cloneStructured(session);
    snapshot.derived = this.#deriveSession(snapshot);
    return snapshot;
  }

  #deriveSession(session) {
    const transcriptCounts = {
      shared: 0,
      mac: 0,
      pc: 0,
    };
    const latestEventByLane = {
      shared: null,
      mac: null,
      pc: null,
    };

    for (const event of session.transcript) {
      transcriptCounts[event.lane] += 1;
      latestEventByLane[event.lane] = {
        id: event.id,
        type: event.type,
        content: summarize(event.content, 180),
        verified: event.verified,
        timestamp: event.timestamp,
      };
    }

    const latestCompareCard = session.compare_cards.at(-1) || null;
    const now = Date.parse(this.now());
    const heartbeatByLane = {};

    for (const lane of ["mac", "pc"]) {
      const agentState = session[`${lane}_state`];
      const lastHeartbeatAt = agentState.last_heartbeat_at;
      const ageMs = lastHeartbeatAt ? Math.max(now - Date.parse(lastHeartbeatAt), 0) : null;
      heartbeatByLane[lane] = {
        last_heartbeat_at: lastHeartbeatAt,
        age_ms: ageMs,
        state:
          ageMs === null
            ? "idle"
            : ageMs >= 30_000
              ? "stalled"
              : agentState.heartbeat_state,
      };
    }

    return {
      active_risk_count: session.mission_state.active_risk_count,
      heartbeat_by_lane: heartbeatByLane,
      latest_compare_card_id: latestCompareCard?.id || null,
      latest_event_by_lane: latestEventByLane,
      repo_header: {
        repo: session.mission_state.active_repo,
        label: `${session.mission_state.active_repo} | Mac: ${session.mac_state.repo_context.usability} | PC: ${session.pc_state.repo_context.usability}`,
        mac: cloneStructured(session.mac_state.repo_context),
        pc: cloneStructured(session.pc_state.repo_context),
      },
      transcript_counts: transcriptCounts,
    };
  }
}

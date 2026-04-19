import test from "node:test";
import assert from "node:assert/strict";

import { createMissionControlApp } from "../server/index.mjs";

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 13, 20, 0, tick)).toISOString();
  };
}

async function withServer(app, callback) {
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) =>
      app.server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("execute-critique route escalates to operator_decision when verified Mac execution conflicts with material PC critique", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt }) {
        return {
          content: `Mac execution plan for: ${prompt}`,
          event_type: "execution_action",
          verified: true,
          metrics: {
            latency_ms: 550,
            tokens_in: 110,
            tokens_out: 33,
          },
          verification: {
            summary: "Mac verified the execution checklist.",
            verification_type: "tool",
            status: "verified",
            evidence: "stub execution verifier",
          },
        };
      },
    },
    pcExecutor: {
      async execute({ prompt }) {
        return {
          content: `PC critique for ${prompt}: missing rollback path.`,
          event_type: "critique",
          verified: false,
          requires_review: true,
          metrics: {
            latency_ms: 640,
            tokens_in: 95,
            tokens_out: 29,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/execute-critique`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Implement the AGRO mission-state reducer.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.arbitration.arbitration_state, "operator_decision");
    assert.equal(data.session.mission_state.operator_mode, "execute_critique");
    assert.equal(data.session.mission_state.arbitration_state, "operator_decision");
    assert.equal(data.session.mission_state.active_risk_count, 2);
    assert.equal(data.session.derived.transcript_counts.shared, 4);
    assert.equal(data.session.derived.transcript_counts.mac, 3);
    assert.equal(data.session.derived.transcript_counts.pc, 3);
    assert.equal(data.session.pc_state.status, "blocked");
    assert.equal(data.session.pc_state.latest_error_gap.severity, "warn");
    assert.match(data.session.mission_state.current_compare_summary, /Execution \+ critique/);
  });
});

test("compare route generates a shared compare card and operator_decision when lanes differ", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt }) {
        return {
          content: `Mac says to build reducers first for ${prompt}.`,
          event_type: "agent_reply",
          verified: false,
          metrics: {
            latency_ms: 420,
            tokens_in: 70,
            tokens_out: 21,
          },
        };
      },
    },
    pcExecutor: {
      async execute({ prompt }) {
        return {
          content: `PC says to build route handlers first for ${prompt}.`,
          event_type: "agent_reply",
          verified: false,
          metrics: {
            latency_ms: 460,
            tokens_in: 72,
            tokens_out: 20,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Choose the next AGRO backend slice.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.arbitration.arbitration_state, "operator_decision");
    assert.equal(data.session.mission_state.operator_mode, "compare");
    assert.equal(data.session.compare_cards.length, 1);
    assert.equal(data.session.compare_cards[0].arbitration_status, "operator_decision");
    assert.equal(data.session.derived.latest_compare_card_id, data.session.compare_cards[0].id);
    assert.equal(data.session.derived.transcript_counts.shared, 3);
    assert.equal(data.session.derived.transcript_counts.mac, 2);
    assert.equal(data.session.derived.transcript_counts.pc, 2);
    assert.match(data.session.mission_state.current_compare_summary, /Both lanes addressed/);
  });
});

test("compare route lets verified Mac execution outrank speculative PC disagreement", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt }) {
        return {
          content: `Mac verified route reducers first for ${prompt}.`,
          event_type: "agent_reply",
          verified: true,
          metrics: {
            latency_ms: 430,
            tokens_in: 71,
            tokens_out: 20,
          },
          verification: {
            summary: "Mac verified the reducer-first plan.",
            verification_type: "tool",
            status: "verified",
            evidence: "stub compare verifier",
          },
        };
      },
    },
    pcExecutor: {
      async execute({ prompt }) {
        return {
          content: `PC would start with route handlers for ${prompt}.`,
          event_type: "agent_reply",
          verified: false,
          metrics: {
            latency_ms: 470,
            tokens_in: 73,
            tokens_out: 21,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Choose the next AGRO compare slice with a verified Mac answer.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.arbitration.arbitration_state, "clear");
    assert.equal(data.arbitration.reason_code, "verified_mac_outranks_speculative_pc");
    assert.equal(data.session.compare_cards[0].arbitration_status, "clear");
    assert.equal(data.session.derived.transcript_counts.shared, 3);
    assert.equal(data.session.derived.transcript_counts.mac, 3);
    assert.equal(data.session.derived.transcript_counts.pc, 2);
  });
});

test("compare route records lane failure and skips compare card generation when one side fails", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt }) {
        return {
          content: `Mac answer for ${prompt}`,
          verified: false,
          metrics: {
            latency_ms: 300,
            tokens_in: 40,
            tokens_out: 15,
          },
        };
      },
    },
    pcExecutor: {
      async execute() {
        throw new Error("PC compare lane disconnected.");
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Compare AGRO transport choices.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 502);
    assert.equal(data.ok, false);
    assert.equal(data.session.compare_cards.length, 0);
    assert.equal(data.session.pc_state.latest_error_gap.severity, "high");
    assert.equal(data.session.derived.transcript_counts.shared, 1);
    assert.equal(data.session.derived.transcript_counts.mac, 2);
    assert.equal(data.session.derived.transcript_counts.pc, 2);
  });
});

test("compare route keeps clear arbitration when both lanes converge on a shared ready state", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute() {
        return {
          content: "Mac Gemma READY",
          event_type: "agent_reply",
          verified: false,
          metrics: {
            latency_ms: 410,
            tokens_in: 39,
            tokens_out: 6,
          },
        };
      },
    },
    pcExecutor: {
      async execute() {
        return {
          content: "PC READY",
          event_type: "agent_reply",
          verified: false,
          metrics: {
            latency_ms: 420,
            tokens_in: 37,
            tokens_out: 2,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Return the ready signal only.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.arbitration.arbitration_state, "clear");
    assert.equal(data.arbitration.reason_code, "no_material_conflict");
    assert.equal(data.session.compare_cards.length, 1);
    assert.equal(data.session.compare_cards[0].arbitration_status, "clear");
    assert.match(data.session.compare_cards[0].overlap, /shared ready state/i);
    assert.match(data.session.compare_cards[0].disagreement, /No material disagreement detected/i);
  });
});

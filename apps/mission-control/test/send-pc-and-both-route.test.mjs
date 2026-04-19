import test from "node:test";
import assert from "node:assert/strict";

import { createMissionControlApp } from "../server/index.mjs";

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 13, 19, 0, tick)).toISOString();
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

test("send-pc route creates a reviewer task and captures critique output", async () => {
  const app = createMissionControlApp({
    pcExecutor: {
      async execute({ prompt, sharedInstruction }) {
        return {
          content: `PC critique accepted: ${prompt} :: ${sharedInstruction}`,
          event_type: "critique",
          verified: false,
          metrics: {
            latency_ms: 620,
            tokens_in: 80,
            tokens_out: 25,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-pc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Review the AGRO lane-state reducer plan.",
        shared_instruction: "Focus on missing verification edges.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.session.mission_state.operator_mode, "send_pc");
    assert.equal(data.session.pc_state.status, "reviewing");
    assert.equal(data.session.derived.transcript_counts.shared, 1);
    assert.equal(data.session.derived.transcript_counts.pc, 2);
    assert.match(data.pc_result.content, /PC critique accepted: Review the AGRO lane-state reducer plan\./);
    assert.equal(data.pc_result.event_type, "critique");
    assert.equal(data.pc_result.verified, false);
  });
});

test("send-both route dispatches aligned Mac and PC tasks and captures both replies", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt, sharedInstruction }) {
        return {
          content: `Mac path: ${prompt} :: ${sharedInstruction}`,
          event_type: "agent_reply",
          verified: true,
          metrics: {
            latency_ms: 500,
            tokens_in: 100,
            tokens_out: 30,
          },
          verification: {
            summary: "Mac verified the proposed execution slice.",
            verification_type: "tool",
            status: "verified",
            evidence: "stubbed dual executor",
          },
        };
      },
    },
    pcExecutor: {
      async execute({ prompt, sharedInstruction }) {
        return {
          content: `PC path: ${prompt} :: ${sharedInstruction}`,
          event_type: "critique",
          verified: false,
          metrics: {
            latency_ms: 700,
            tokens_in: 90,
            tokens_out: 26,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-both`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Plan the first AGRO mission-control reducer slice.",
        mac_shared_instruction: "Think execution-first.",
        pc_shared_instruction: "Think critique-first.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.arbitration.arbitration_state, "clear");
    assert.equal(data.arbitration.reason_code, "verified_mac_outranks_speculative_pc");
    assert.equal(data.session.mission_state.operator_mode, "send_both");
    assert.equal(data.session.transcript.length, 7);
    assert.equal(data.session.derived.transcript_counts.shared, 2);
    assert.equal(data.session.derived.transcript_counts.mac, 3);
    assert.equal(data.session.derived.transcript_counts.pc, 2);
    assert.match(data.mac_result.content, /Mac path: Plan the first AGRO mission-control reducer slice\./);
    assert.match(data.pc_result.content, /PC path: Plan the first AGRO mission-control reducer slice\./);
    assert.equal(data.mac_result.verified, true);
    assert.equal(data.pc_result.verified, false);
  });
});

test("send-both route records partial failure without losing the successful lane", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt }) {
        return {
          content: `Mac succeeded: ${prompt}`,
          verified: false,
          metrics: {
            latency_ms: 300,
            tokens_in: 20,
            tokens_out: 12,
          },
        };
      },
    },
    pcExecutor: {
      async execute() {
        throw new Error("PC lane stalled while reviewing.");
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-both`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Run both AGRO lanes on the same planning prompt.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 502);
    assert.equal(data.ok, false);
    assert.match(data.mac_result.content, /Mac succeeded: Run both AGRO lanes on the same planning prompt\./);
    assert.equal(data.mac_result.verified, false);
    assert.equal(data.pc_result, null);
    assert.equal(data.session.pc_state.latest_error_gap.severity, "high");
    assert.equal(data.session.derived.transcript_counts.shared, 1);
    assert.equal(data.session.derived.transcript_counts.mac, 2);
    assert.equal(data.session.derived.transcript_counts.pc, 2);
  });
});

test("send-both route promotes strong PC critique into shared risk while keeping successful Mac execution", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt }) {
        return {
          content: `Mac executed: ${prompt}`,
          verified: true,
          metrics: {
            latency_ms: 420,
            tokens_in: 75,
            tokens_out: 20,
          },
          verification: {
            summary: "Mac verified the dual-lane execution slice.",
            verification_type: "tool",
            status: "verified",
            evidence: "stubbed dual verifier",
          },
        };
      },
    },
    pcExecutor: {
      async execute({ prompt }) {
        return {
          content: `PC critique for ${prompt}: rollback path is missing.`,
          event_type: "critique",
          requires_review: true,
          dissent: true,
          confidence: 0.81,
          risk_level: "medium",
          metrics: {
            latency_ms: 640,
            tokens_in: 82,
            tokens_out: 24,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-both`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Run Mac execution and PC critique on the same reducer change.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.match(data.mac_result.content, /Mac executed: Run Mac execution and PC critique on the same reducer change\./);
    assert.match(data.pc_result.content, /rollback path is missing/i);
    assert.equal(data.mac_result.verified, true);
    assert.equal(data.pc_result.promoted_shared_risk, true);
    assert.equal(data.arbitration.arbitration_state, "operator_decision");
    assert.equal(data.session.mission_state.arbitration_state, "operator_decision");
    assert.equal(data.session.mission_state.active_risk_count, 2);
    assert.equal(data.session.derived.transcript_counts.shared, 3);
    assert.equal(data.session.derived.transcript_counts.mac, 3);
    assert.equal(data.session.derived.transcript_counts.pc, 3);
    assert.equal(data.session.pc_state.status, "blocked");
    assert.equal(data.session.transcript.at(-2).type, "error");
    assert.equal(data.session.transcript.at(-1).type, "arbitration");
  });
});

test("send-both route keeps needs_review when a material PC critique blocks an unverified Mac path", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt }) {
        return {
          content: `Mac drafted but did not verify: ${prompt}`,
          verified: false,
          metrics: {
            latency_ms: 410,
            tokens_in: 68,
            tokens_out: 19,
          },
        };
      },
    },
    pcExecutor: {
      async execute() {
        return {
          content: "PC critique: the unverified reducer change is missing rollback coverage.",
          event_type: "critique",
          requires_review: true,
          dissent: true,
          confidence: 0.77,
          risk_level: "medium",
          metrics: {
            latency_ms: 610,
            tokens_in: 80,
            tokens_out: 23,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-both`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Run the unverified Mac reducer draft against the reviewer lane.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.arbitration.arbitration_state, "needs_review");
    assert.equal(data.session.mission_state.arbitration_state, "needs_review");
    assert.equal(data.session.derived.transcript_counts.shared, 2);
    assert.equal(data.session.pc_state.latest_error_gap.severity, "warn");
  });
});

test("send-both route stays clear when both lanes only differ by lane-labeled ready wording", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute() {
        return {
          content: "Mac Gemma READY",
          verified: false,
          metrics: {
            latency_ms: 410,
            tokens_in: 40,
            tokens_out: 6,
          },
        };
      },
    },
    pcExecutor: {
      async execute() {
        return {
          content: "PC READY",
          event_type: "critique",
          verified: false,
          metrics: {
            latency_ms: 430,
            tokens_in: 38,
            tokens_out: 2,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-both`, {
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
    assert.equal(data.session.mission_state.arbitration_state, "clear");
    assert.equal(data.session.derived.transcript_counts.shared, 1);
    assert.equal(data.session.derived.transcript_counts.mac, 2);
    assert.equal(data.session.derived.transcript_counts.pc, 2);
  });
});

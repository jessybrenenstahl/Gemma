import test from "node:test";
import assert from "node:assert/strict";

import { createMissionControlApp } from "../server/index.mjs";

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 14, 1, 0, tick)).toISOString();
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

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return {
    response,
    data: await response.json(),
  };
}

test("mission-control scenario exercises all five routes in one session and produces a compare card", async () => {
  const macCalls = [];
  const pcCalls = [];
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt, operatorMode, session }) {
        macCalls.push({
          prompt,
          operatorMode,
          sessionId: session?.session_id || null,
        });

        if (operatorMode === "compare") {
          return {
            content: `Mac comparison answer for ${prompt}.`,
            event_type: "agent_reply",
            verified: false,
            metrics: {
              latency_ms: 410,
              tokens_in: 64,
              tokens_out: 18,
            },
          };
        }

        return {
          content: `Mac ${operatorMode} answer for ${prompt}.`,
          event_type: operatorMode === "execute_critique" ? "execution_action" : "agent_reply",
          verified: true,
          metrics: {
            latency_ms: 420,
            tokens_in: 72,
            tokens_out: 20,
          },
          verification: {
            summary: `Mac verified ${operatorMode}.`,
            verification_type: "tool",
            status: "verified",
            evidence: "scenario stub",
          },
        };
      },
    },
    pcExecutor: {
      async execute({ prompt, operatorMode, session }) {
        pcCalls.push({
          prompt,
          operatorMode,
          sessionId: session?.session_id || null,
        });

        if (operatorMode === "compare") {
          return {
            content: `PC comparison answer for ${prompt}.`,
            event_type: "compare",
            verified: false,
            confidence: 0.61,
            dissent: true,
            risk_level: "low",
            metrics: {
              latency_ms: 460,
              tokens_in: 67,
              tokens_out: 19,
            },
          };
        }

        return {
          content: `PC ${operatorMode} review for ${prompt}.`,
          event_type: "critique",
          verified: false,
          confidence: 0.58,
          dissent: false,
          risk_level: "low",
          metrics: {
            latency_ms: 470,
            tokens_in: 69,
            tokens_out: 17,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const sendMac = await postJson(baseUrl, "/api/routes/send-mac", {
      prompt: "Bootstrap the AGRO mission-control session.",
    });
    assert.equal(sendMac.response.status, 200);
    const sessionId = sendMac.data.session.session_id;

    const sendPc = await postJson(baseUrl, "/api/routes/send-pc", {
      session_id: sessionId,
      prompt: "Review the AGRO mission-control session bootstrap.",
    });
    assert.equal(sendPc.response.status, 200);

    const sendBoth = await postJson(baseUrl, "/api/routes/send-both", {
      session_id: sessionId,
      prompt: "Run both lanes on the next AGRO route slice.",
    });
    assert.equal(sendBoth.response.status, 200);

    const executeCritique = await postJson(baseUrl, "/api/routes/execute-critique", {
      session_id: sessionId,
      prompt: "Execute and critique the AGRO route slice.",
    });
    assert.equal(executeCritique.response.status, 200);

    const compare = await postJson(baseUrl, "/api/routes/compare", {
      session_id: sessionId,
      prompt: "Compare the next AGRO backend milestone.",
    });
    assert.equal(compare.response.status, 200);
    assert.equal(compare.data.ok, true);
    assert.equal(compare.data.session.session_id, sessionId);
    assert.equal(compare.data.session.compare_cards.length, 1);
    assert.equal(compare.data.session.mission_state.operator_mode, "compare");

    const routingModes = new Set(compare.data.session.transcript.map((event) => event.routing_mode));
    assert.deepEqual(
      [...routingModes].sort(),
      ["compare", "execute_critique", "send_both", "send_mac", "send_pc"]
    );

    assert.deepEqual(
      macCalls.map((call) => call.operatorMode),
      ["send_mac", "send_both", "execute_critique", "compare"]
    );
    assert.deepEqual(
      pcCalls.map((call) => call.operatorMode),
      ["send_pc", "send_both", "execute_critique", "compare"]
    );
    assert.match(
      compare.data.session.compare_cards[0].recommended_next_step,
      /Choose|Proceed|Review|verification/i
    );
    assert.equal(compare.data.session.derived.latest_compare_card_id, compare.data.session.compare_cards[0].id);
  });
});

test("mission-control scenario recovers from a Mac disconnect and clears the stale gap after retry", async () => {
  let callCount = 0;
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt }) {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("Mac lane transport disconnected over Tailscale.");
        }

        return {
          content: `Mac recovered and executed: ${prompt}`,
          verified: true,
          metrics: {
            latency_ms: 430,
            tokens_in: 68,
            tokens_out: 18,
          },
          verification: {
            summary: "Mac verified the recovered execution path.",
            verification_type: "tool",
            status: "verified",
            evidence: "scenario reconnect stub",
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const first = await postJson(baseUrl, "/api/routes/send-mac", {
      prompt: "Run the Mac lane while the remote body is disconnected.",
    });
    assert.equal(first.response.status, 502);
    assert.equal(first.data.session.mac_state.latest_error_gap.summary, "Mac lane transport disconnected over Tailscale.");

    const retry = await postJson(baseUrl, "/api/routes/send-mac", {
      session_id: first.data.session.session_id,
      prompt: "Retry after the Mac body reconnects.",
    });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.data.ok, true);
    assert.equal(retry.data.session.mac_state.latest_error_gap.summary, "No active gaps.");
    assert.equal(retry.data.session.mac_state.last_verified_result.verification_type, "tool");
    assert.equal(retry.data.session.mac_state.status, "idle");
    assert.equal(callCount, 2);
  });
});

test("mission-control scenario recovers from a PC model unload and clears the stale reviewer gap after reload", async () => {
  let callCount = 0;
  const app = createMissionControlApp({
    pcExecutor: {
      async execute({ prompt }) {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("PC model unloaded from LM Studio.");
        }

        return {
          content: `PC recovered critique for ${prompt}.`,
          event_type: "critique",
          verified: false,
          confidence: 0.64,
          dissent: false,
          risk_level: "low",
          metrics: {
            latency_ms: 440,
            tokens_in: 66,
            tokens_out: 16,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const first = await postJson(baseUrl, "/api/routes/send-pc", {
      prompt: "Run the reviewer lane while the local model is unloaded.",
    });
    assert.equal(first.response.status, 502);
    assert.equal(first.data.session.pc_state.latest_error_gap.summary, "PC model unloaded from LM Studio.");

    const retry = await postJson(baseUrl, "/api/routes/send-pc", {
      session_id: first.data.session.session_id,
      prompt: "Retry after the local reviewer model reloads.",
    });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.data.ok, true);
    assert.equal(retry.data.session.pc_state.latest_error_gap.summary, "No active gaps.");
    assert.equal(retry.data.session.pc_state.status, "reviewing");
    assert.match(retry.data.session.pc_state.last_action, /critique/i);
    assert.equal(callCount, 2);
  });
});

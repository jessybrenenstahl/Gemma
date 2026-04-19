import test from "node:test";
import assert from "node:assert/strict";

import { createMissionControlApp, MacVerificationPipeline } from "../server/index.mjs";

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 13, 18, 0, tick)).toISOString();
  };
}

async function withServer(app, callback) {
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => app.server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("send-mac route creates a session, emits transcript events, and records verified Mac output", async () => {
  const app = createMissionControlApp({
    sessionManager: undefined,
    macExecutor: {
      async execute({ prompt, sharedInstruction }) {
        return {
          content: `Mac accepted: ${prompt} :: ${sharedInstruction}`,
          verified: true,
          metrics: {
            latency_ms: 450,
            tokens_in: 120,
            tokens_out: 32,
          },
          verification: {
            summary: "Mac verified the execution plan.",
            verification_type: "tool",
            status: "verified",
            evidence: "stubbed test executor",
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-mac`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Implement session manager endpoints.",
        shared_instruction: "Prefer backend-first slices.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.session.mission_state.operator_mode, "send_mac");
    assert.equal(data.session.mac_state.last_verified_result.verification_type, "tool");
    assert.equal(data.session.transcript.length, 4);
    assert.equal(data.session.derived.transcript_counts.shared, 1);
    assert.equal(data.session.derived.transcript_counts.mac, 3);
    assert.equal(data.mac_result.verified, true);
  });
});

test("send-mac route captures executor failures as Mac error gaps", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute() {
        throw new Error("Mac adapter unreachable.");
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-mac`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Try to execute a Mac task.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 502);
    assert.equal(data.ok, false);
    assert.equal(data.session.mac_state.latest_error_gap.severity, "high");
    assert.equal(data.session.mac_state.status, "blocked");
    assert.equal(data.session.derived.transcript_counts.mac, 2);
  });
});

test("send-mac route records failed Mac verification as an active error gap without dropping the execution result", async () => {
  const app = createMissionControlApp({
    macExecutor: {
      async execute() {
        return {
          content: "Mac applied the AGRO mission-control patch.",
          trace_events: [
            {
              type: "execution_action",
              content: "Updated the Mac mission-control session reducer.",
            },
          ],
          verification_targets: ["mission-control reducer smoke check"],
          metrics: {
            latency_ms: 980,
            tokens_in: 70,
            tokens_out: 28,
          },
        };
      },
    },
    macVerificationPipeline: new MacVerificationPipeline({
      verifier: async ({ verificationTargets }) => ({
        status: "failed",
        summary: `Verification failed for ${verificationTargets[0]}.`,
        verification_type: "tool",
        evidence: "Reducer smoke check returned a mismatch.",
      }),
    }),
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-mac`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Patch the Mac mission-control reducer.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.mac_result.verified, false);
    assert.equal(data.mac_result.verification_status, "failed");
    assert.equal(data.mac_result.verification_source, "tool");
    assert.equal(data.session.mac_state.latest_error_gap.severity, "high");
    assert.match(
      data.session.mac_state.latest_error_gap.summary,
      /verification failed for mission-control reducer smoke check/i
    );
    assert.equal(data.session.mac_state.status, "blocked");
    assert.equal(data.session.transcript.at(-2).type, "verification");
    assert.equal(data.session.transcript.at(-1).type, "error");
  });
});

test("send-mac route creates a pending operator confirmation gate and blocks later Mac continuation until approved", async () => {
  let callCount = 0;
  const app = createMissionControlApp({
    macExecutor: {
      async execute({ prompt }) {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: `Mac wants approval before continuing: ${prompt}`,
            requested_actions: [
              {
                category: "destructive_filesystem",
                summary: "Delete generated AGRO temp files before continuing.",
              },
            ],
            metrics: {
              latency_ms: 640,
              tokens_in: 82,
              tokens_out: 26,
            },
          };
        }

        return {
          content: `Mac continued safely after approval: ${prompt}`,
          verified: true,
          metrics: {
            latency_ms: 420,
            tokens_in: 75,
            tokens_out: 22,
          },
          verification: {
            summary: "Mac verified the approved continuation path.",
            verification_type: "tool",
            status: "verified",
            evidence: "stubbed approved continuation",
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const initialResponse = await fetch(`${baseUrl}/api/routes/send-mac`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Continue the Mac reducer patch after cleanup.",
      }),
    });

    const initialData = await initialResponse.json();
    assert.equal(initialResponse.status, 200);
    assert.equal(initialData.ok, true);
    assert.equal(initialData.mac_result.confirmation_required, true);
    assert.equal(initialData.mac_result.confirmation_category, "destructive_filesystem");
    assert.equal(initialData.session.mac_state.confirmation_gate.status, "pending");
    assert.equal(initialData.session.mac_state.status, "awaiting_operator");
    assert.equal(initialData.session.mission_state.arbitration_state, "operator_decision");

    const blockedResponse = await fetch(`${baseUrl}/api/routes/send-mac`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: initialData.session.session_id,
        prompt: "Try to continue without operator approval.",
      }),
    });

    const blockedData = await blockedResponse.json();
    assert.equal(blockedResponse.status, 409);
    assert.equal(blockedData.ok, false);
    assert.equal(blockedData.code, "OPERATOR_CONFIRMATION_REQUIRED");
    assert.equal(blockedData.required_confirmation.id, initialData.mac_result.confirmation_gate_id);
    assert.equal(callCount, 1);

    const approvedResponse = await fetch(`${baseUrl}/api/routes/send-mac`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: initialData.session.session_id,
        prompt: "Continue after the operator approved the cleanup step.",
        operator_confirmation: {
          approve: true,
          gate_id: initialData.mac_result.confirmation_gate_id,
        },
      }),
    });

    const approvedData = await approvedResponse.json();
    assert.equal(approvedResponse.status, 200);
    assert.equal(approvedData.ok, true);
    assert.equal(approvedData.mac_result.confirmation_required, false);
    assert.equal(approvedData.session.mac_state.confirmation_gate.status, "clear");
    assert.equal(approvedData.session.mac_state.last_verified_result.verification_type, "tool");
    assert.equal(callCount, 2);
  });
});

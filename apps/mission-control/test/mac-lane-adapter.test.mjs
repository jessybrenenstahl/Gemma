import test from "node:test";
import assert from "node:assert/strict";

import { createMissionControlApp, MacLaneAdapter } from "../server/index.mjs";

function createJsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function createFetchStub(handler) {
  const calls = [];
  const stub = async (url, options) => {
    calls.push({
      url,
      options: {
        ...options,
        body: options?.body ? JSON.parse(options.body) : null,
      },
    });
    return handler(url, options);
  };
  stub.calls = calls;
  return stub;
}

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 13, 22, 0, tick)).toISOString();
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

test("MacLaneAdapter sends LM Studio chat requests and emits a transport trace", async () => {
  const fetchStub = createFetchStub(async () =>
    createJsonResponse({
      choices: [
        {
          message: {
            content: "Mac completed the execution planning pass.",
          },
        },
      ],
      usage: {
        prompt_tokens: 44,
        completion_tokens: 12,
      },
    })
  );

  const adapter = new MacLaneAdapter({
    endpoint: "http://mac.test:1234/",
    model: "google/gemma-4-26b-a4b",
    fetchImpl: fetchStub,
  });

  const result = await adapter.execute({
    prompt: "Plan the Mac execution lane.",
    sharedInstruction: "Return verification-ready execution steps.",
    operatorMode: "send_both",
  });

  assert.equal(fetchStub.calls.length, 1);
  assert.equal(fetchStub.calls[0].url, "http://mac.test:1234/v1/chat/completions");
  assert.equal(fetchStub.calls[0].options.body.model, "google/gemma-4-26b-a4b");
  assert.equal(fetchStub.calls[0].options.body.messages[1].content, "Plan the Mac execution lane.");
  assert.match(fetchStub.calls[0].options.body.messages[0].content, /parallel with a reviewer lane/i);
  assert.match(fetchStub.calls[0].options.body.messages[0].content, /current action, evidence, unknowns, and next step/i);
  assert.match(fetchStub.calls[0].options.body.messages[0].content, /Operator-specific framing:/i);
  assert.equal(result.trace_events.length, 1);
  assert.match(result.trace_events[0].content, /Mac remote model call completed/i);
});

test("MacLaneAdapter sends harness context, forwards traces, and preserves verification", async () => {
  const fetchStub = createFetchStub(async () =>
    createJsonResponse({
      content: "Mac harness applied the reducer patch.",
      verified: true,
      verification: {
        summary: "Mac verified the reducer patch with a targeted harness check.",
        verification_type: "tool",
        status: "verified",
      },
      trace_events: [
        {
          type: "execution_action",
          content: "Opened the AGRO mission-state reducer file.",
          metrics: {
            latency_ms: 50,
            tokens_in: 0,
            tokens_out: 0,
          },
        },
      ],
      metrics: {
        latency_ms: 900,
        tokens_in: 60,
        tokens_out: 18,
      },
    })
  );

  const adapter = new MacLaneAdapter({
    endpoint: "http://mac.test:4100",
    model: "google/gemma-4-26b-a4b",
    transport: "harness",
    fetchImpl: fetchStub,
  });

  const result = await adapter.execute({
    prompt: "Update the mission-state reducer.",
    sharedInstruction: "Use the canonical repo.",
    operatorMode: "execute_critique",
    session: {
      session_id: "session-31",
      mission_state: {
        mission_goal: "Ship the Mac lane adapter",
        operator_mode: "send_mac",
        active_repo: "jessybrenenstahl/Gemma",
      },
    },
  });

  assert.equal(fetchStub.calls[0].url, "http://mac.test:4100/api/mac/execute");
  assert.equal(fetchStub.calls[0].options.body.session.session_id, "session-31");
  assert.equal(fetchStub.calls[0].options.body.session.active_repo, "jessybrenenstahl/Gemma");
  assert.match(fetchStub.calls[0].options.body.shared_instruction, /execution side of an execute-plus-critique pair/i);
  assert.match(fetchStub.calls[0].options.body.shared_instruction, /Active repo: jessybrenenstahl\/Gemma/i);
  assert.equal(result.verified, true);
  assert.equal(result.verification.verification_type, "tool");
  assert.equal(result.trace_events.length, 2);
  assert.match(result.trace_events[0].content, /Mac harness call completed/i);
  assert.equal(result.trace_events[1].content, "Opened the AGRO mission-state reducer file.");
});

test("send-mac route records adapter trace events and promotes verified Mac results", async () => {
  const fetchStub = createFetchStub(async () =>
    createJsonResponse({
      content: "Mac harness completed the initial mission-control execution slice.",
      verified: true,
      verification: {
        summary: "Mac verified the slice with a harness check.",
        verification_type: "tool",
        status: "verified",
      },
      trace_events: [
        {
          type: "execution_action",
          content: "Applied the Mac-side mission-control patch.",
        },
      ],
      metrics: {
        latency_ms: 1200,
        tokens_in: 90,
        tokens_out: 30,
      },
    })
  );

  const app = createMissionControlApp({
    macExecutor: new MacLaneAdapter({
      endpoint: "http://mac.test:4100",
      model: "google/gemma-4-26b-a4b",
      transport: "harness",
      fetchImpl: fetchStub,
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
        prompt: "Execute the Mac lane integration slice.",
        shared_instruction: "Stay inside the Gemma repo.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.session.mac_state.last_verified_result.verification_type, "tool");
    assert.equal(data.session.transcript.length, 6);
    assert.equal(data.session.derived.transcript_counts.shared, 1);
    assert.equal(data.session.derived.transcript_counts.mac, 5);
    assert.equal(data.session.transcript[2].type, "execution_action");
    assert.equal(data.session.transcript[3].type, "execution_action");
    assert.equal(data.session.transcript[4].type, "agent_reply");
    assert.equal(data.session.transcript[5].type, "verification");
  });
});

test("MacLaneAdapter reports unreachable transport and stale remote sessions clearly", async () => {
  const unreachableAdapter = new MacLaneAdapter({
    endpoint: "http://mac.test:4100",
    model: "google/gemma-4-26b-a4b",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    unreachableAdapter.execute({ prompt: "Ping the Mac lane." }),
    /transport is unreachable/i
  );

  const staleAdapter = new MacLaneAdapter({
    endpoint: "http://mac.test:4100",
    model: "google/gemma-4-26b-a4b",
    transport: "harness",
    fetchImpl: async () =>
      createJsonResponse(
        {
          code: "STALE_SESSION",
          message: "Remote session expired.",
        },
        { status: 409 }
      ),
  });

  await assert.rejects(staleAdapter.execute({ prompt: "Resume the stale Mac session." }), /stale/i);
});

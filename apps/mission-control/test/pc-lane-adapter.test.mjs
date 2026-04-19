import test from "node:test";
import assert from "node:assert/strict";

import { createMissionControlApp, PcLaneAdapter } from "../server/index.mjs";

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
    return new Date(Date.UTC(2026, 3, 13, 23, 0, tick)).toISOString();
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

test("PcLaneAdapter sends critique requests, strips footer metadata, and emits review traces", async () => {
  const fetchStub = createFetchStub(async () =>
    createJsonResponse({
      choices: [
        {
          message: {
            content: [
              "The reducer plan is missing a rollback path.",
              "",
              "Confidence: 0.82",
              "Dissent: yes",
              "Risk: medium",
            ].join("\n"),
          },
        },
      ],
      usage: {
        prompt_tokens: 55,
        completion_tokens: 16,
      },
    })
  );

  const adapter = new PcLaneAdapter({
    endpoint: "http://127.0.0.1:1234",
    model: "gemma4-26b-128k",
    fetchImpl: fetchStub,
  });

  const result = await adapter.execute({
    prompt: "Critique the AGRO reducer plan.",
    sharedInstruction: "Look for missing verification.",
    operatorMode: "send_pc",
  });

  assert.equal(fetchStub.calls.length, 1);
  assert.equal(fetchStub.calls[0].url, "http://127.0.0.1:1234/v1/chat/completions");
  assert.match(fetchStub.calls[0].options.body.messages[0].content, /direct reviewer request/i);
  assert.match(fetchStub.calls[0].options.body.messages[0].content, /verdict, gaps, risk, and recommendation/i);
  assert.equal(result.event_type, "critique");
  assert.equal(result.content, "The reducer plan is missing a rollback path.");
  assert.equal(result.confidence, 0.82);
  assert.equal(result.dissent, true);
  assert.equal(result.risk_level, "medium");
  assert.equal(result.requires_review, true);
  assert.equal(result.review_mode, "critique");
  assert.equal(result.trace_events.length, 2);
  assert.match(result.trace_events[0].content, /PC reviewer model call completed/i);
  assert.match(result.trace_events[1].content, /confidence 0.82/i);
});

test("PcLaneAdapter supports compare mode and harness review artifacts", async () => {
  const fetchStub = createFetchStub(async () =>
    createJsonResponse({
      content: [
        "I would compare both transport options before changing the reducer order.",
        "",
        "Confidence: 0.61",
        "Dissent: no",
        "Risk: low",
      ].join("\n"),
      review_artifacts: [
        {
          type: "compare",
          content: "Reviewer artifact: compare both branch points before choosing one.",
        },
      ],
    })
  );

  const adapter = new PcLaneAdapter({
    endpoint: "http://pc-review.test:4110",
    model: "gemma4-26b-128k",
    transport: "harness",
    fetchImpl: fetchStub,
  });

  const result = await adapter.execute({
    prompt: "Compare the next AGRO backend slice.",
    sharedInstruction: "Act as the reviewer lane.",
    operatorMode: "compare",
    session: {
      session_id: "session-32",
      mission_state: {
        mission_goal: "Compare AGRO backend slices",
        operator_mode: "compare",
        active_repo: "jessybrenenstahl/Gemma",
      },
    },
  });

  assert.equal(fetchStub.calls[0].url, "http://pc-review.test:4110/api/pc/review");
  assert.equal(fetchStub.calls[0].options.body.review_mode, "compare");
  assert.equal(fetchStub.calls[0].options.body.session.active_repo, "jessybrenenstahl/Gemma");
  assert.match(fetchStub.calls[0].options.body.shared_instruction, /answer independently before compare-card synthesis/i);
  assert.match(fetchStub.calls[0].options.body.shared_instruction, /do not anchor on the Mac lane/i);
  assert.equal(result.event_type, "compare");
  assert.equal(result.review_mode, "compare");
  assert.equal(result.requires_review, false);
  assert.equal(result.trace_events.length, 3);
  assert.equal(result.trace_events[2].content, "Reviewer artifact: compare both branch points before choosing one.");
});

test("send-pc route records reviewer traces and returns critique metadata without execution ambiguity", async () => {
  const fetchStub = createFetchStub(async () =>
    createJsonResponse({
      content: [
        "The route plan is missing a verification handoff.",
        "",
        "Confidence: 0.74",
        "Dissent: yes",
        "Risk: medium",
      ].join("\n"),
    })
  );

  const app = createMissionControlApp({
    pcExecutor: new PcLaneAdapter({
      endpoint: "http://127.0.0.1:1234",
      model: "gemma4-26b-128k",
      fetchImpl: fetchStub,
    }),
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-pc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Review the AGRO route plan.",
        shared_instruction: "Focus on missing verification.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.pc_result.verified, false);
    assert.equal(data.pc_result.review_mode, "critique");
    assert.equal(data.pc_result.dissent, true);
    assert.equal(data.pc_result.risk_level, "medium");
    assert.equal(data.pc_result.requires_review, true);
    assert.equal(data.pc_result.promoted_shared_risk, true);
    assert.match(data.pc_result.promoted_shared_risk_summary, /shared risk/i);
    assert.equal(data.session.mission_state.arbitration_state, "needs_review");
    assert.equal(data.session.mission_state.active_risk_count, 2);
    assert.equal(data.session.derived.transcript_counts.shared, 2);
    assert.equal(data.session.derived.transcript_counts.pc, 5);
    assert.equal(data.session.pc_state.status, "blocked");
    assert.equal(data.session.pc_state.latest_error_gap.severity, "warn");
    assert.equal(data.session.transcript[2].type, "critique");
    assert.equal(data.session.transcript[3].type, "critique");
    assert.equal(data.session.transcript[5].type, "arbitration");
    assert.equal(data.session.transcript[6].type, "error");
  });
});

test("PcLaneAdapter reports unreachable transport and stale reviewer sessions clearly", async () => {
  const unreachableAdapter = new PcLaneAdapter({
    endpoint: "http://127.0.0.1:1234",
    model: "gemma4-26b-128k",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    unreachableAdapter.execute({ prompt: "Review the reviewer lane transport." }),
    /transport is unreachable/i
  );

  const staleAdapter = new PcLaneAdapter({
    endpoint: "http://pc-review.test:4110",
    model: "gemma4-26b-128k",
    transport: "harness",
    fetchImpl: async () =>
      createJsonResponse(
        {
          code: "STALE_SESSION",
          message: "Reviewer session expired.",
        },
        { status: 409 }
      ),
  });

  await assert.rejects(
    staleAdapter.execute({ prompt: "Retry the reviewer session." }),
    /stale/i
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createMissionControlApp,
  FileBackedSessionStore,
  normalizeLaneExecutionResult,
} from "../server/index.mjs";

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 13, 21, 0, tick)).toISOString();
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

test("lane result normalizer extracts visible text and metrics from LM-style responses", () => {
  const normalized = normalizeLaneExecutionResult(
    {
      choices: [
        {
          message: {
            content: "",
            reasoning_content: "Reasoning fallback text.",
          },
        },
      ],
      usage: {
        prompt_tokens: 123,
        completion_tokens: 45,
      },
      elapsedMs: 678,
      verified: true,
    },
    { lane: "mac" }
  );

  assert.equal(normalized.content, "Reasoning fallback text.");
  assert.equal(normalized.metrics.tokens_in, 123);
  assert.equal(normalized.metrics.tokens_out, 45);
  assert.equal(normalized.metrics.latency_ms, 678);
  assert.equal(normalized.verified, true);
});

test("mission-control app persists sessions to disk and reloads them on a new manager", async () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "agro-session-store-"));
  const sessionStore = new FileBackedSessionStore({ rootDir });

  const app = createMissionControlApp({
    sessionStore,
    macExecutor: {
      async execute() {
        return {
          choices: [
            {
              message: {
                content: "Mac persisted response.",
              },
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 6,
          },
          elapsedMs: 250,
          verified: true,
          verification: {
            summary: "Mac verified persisted response.",
            verification_type: "tool",
            status: "verified",
            evidence: "stub persistence executor",
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  let sessionId = null;

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-mac`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Persist this AGRO mission session.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    sessionId = data.session.session_id;
    assert.equal(data.session.mac_state.last_verified_result.verification_type, "tool");
    assert.equal(data.session.derived.heartbeat_by_lane.mac.state, "active");
  });

  const reloadedApp = createMissionControlApp({
    sessionStore,
  });
  reloadedApp.sessionManager.now = makeClock();

  const restored = reloadedApp.sessionManager.getSession(sessionId);
  assert.equal(restored.session_id, sessionId);
  assert.equal(restored.transcript.length, 4);
  assert.equal(restored.mac_state.last_verified_result.verification_type, "tool");
  assert.equal(restored.derived.transcript_counts.mac, 3);
});

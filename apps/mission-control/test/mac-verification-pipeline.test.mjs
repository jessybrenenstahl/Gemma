import test from "node:test";
import assert from "node:assert/strict";

import {
  MacVerificationPipeline,
  collectMacVerificationTargets,
  shouldAutoVerifyMacResult,
} from "../server/index.mjs";

test("collectMacVerificationTargets gathers and de-duplicates explicit verification targets", () => {
  const targets = collectMacVerificationTargets({
    verification_target: "repo smoke check",
    verification_targets: ["repo smoke check", "integration test pass"],
    trace_events: [
      {
        verification_target: "integration test pass",
      },
      {
        verification_targets: ["remote harness echo"],
      },
    ],
  });

  assert.deepEqual(targets, [
    "repo smoke check",
    "integration test pass",
    "remote harness echo",
  ]);
  assert.equal(
    shouldAutoVerifyMacResult({
      verification_targets: ["repo smoke check"],
    }),
    true
  );
});

test("MacVerificationPipeline emits a pending verification record when no verifier is configured", async () => {
  const pipeline = new MacVerificationPipeline({
    now: () => "2026-04-13T23:00:00.000Z",
  });

  const result = await pipeline.run({
    session: {
      session_id: "session-34",
    },
    operatorMode: "send_mac",
    executionResult: {
      content: "Mac updated the AGRO route handler.",
      event_type: "agent_reply",
      trace_events: [
        {
          event_type: "execution_action",
          content: "Edited the AGRO route handler.",
        },
      ],
      verification_targets: ["route handler smoke check"],
    },
  });

  assert.equal(result.executionResult.verification.status, "pending");
  assert.equal(result.executionResult.verification.verification_type, "system");
  assert.equal(result.executionResult.verified, false);
  assert.equal(result.errorGap, null);
  assert.match(result.executionResult.verification.summary, /route handler smoke check/i);
});

test("MacVerificationPipeline promotes verifier success into a tool verification record", async () => {
  const pipeline = new MacVerificationPipeline({
    now: () => "2026-04-13T23:05:00.000Z",
    verifier: async ({ verificationTargets }) => ({
      status: "verified",
      summary: `Verified ${verificationTargets.join(", ")}.`,
      verification_type: "tool",
      evidence: "Mac harness smoke check passed.",
    }),
  });

  const result = await pipeline.run({
    session: {
      session_id: "session-35",
    },
    operatorMode: "send_mac",
    executionResult: {
      content: "Mac updated the mission-control compare route.",
      event_type: "agent_reply",
      verification_targets: ["compare route smoke check"],
    },
  });

  assert.equal(result.executionResult.verification.status, "verified");
  assert.equal(result.executionResult.verification.verification_type, "tool");
  assert.equal(result.executionResult.verified, true);
  assert.equal(result.errorGap, null);
});

test("MacVerificationPipeline converts verifier failures into high-severity verification gaps", async () => {
  const pipeline = new MacVerificationPipeline({
    now: () => "2026-04-13T23:10:00.000Z",
    verifier: async () => {
      throw new Error("remote harness check crashed");
    },
  });

  const result = await pipeline.run({
    session: {
      session_id: "session-36",
    },
    operatorMode: "send_mac",
    executionResult: {
      content: "Mac updated the mission-control arbitration route.",
      event_type: "agent_reply",
      verification_targets: ["arbitration route harness check"],
    },
  });

  assert.equal(result.executionResult.verification.status, "failed");
  assert.equal(result.executionResult.verification.verification_type, "system");
  assert.equal(result.executionResult.requires_review, true);
  assert.equal(result.executionResult.risk_level, "high");
  assert.equal(result.executionResult.arbitration_status, "needs_review");
  assert.equal(result.errorGap.kind, "verification_failure");
  assert.equal(result.errorGap.severity, "high");
  assert.match(result.errorGap.summary, /remote harness check crashed/i);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  MacConfirmationGatePipeline,
  shouldRequireOperatorConfirmation,
} from "../server/index.mjs";

test("shouldRequireOperatorConfirmation ignores empty actions and catches gated requests", () => {
  assert.equal(
    shouldRequireOperatorConfirmation({
      requested_actions: [],
    }),
    false
  );

  assert.equal(
    shouldRequireOperatorConfirmation({
      requested_actions: [
        {
          category: "destructive_filesystem",
          summary: "Delete generated build outputs.",
        },
      ],
    }),
    true
  );
});

test("MacConfirmationGatePipeline leaves safe execution results unchanged", async () => {
  const pipeline = new MacConfirmationGatePipeline({
    now: () => "2026-04-14T00:00:00.000Z",
  });

  const executionResult = {
    content: "Mac updated the reducer plan.",
    event_type: "agent_reply",
    requested_actions: [],
  };

  const result = await pipeline.run({ executionResult });
  assert.equal(result.executionResult, executionResult);
  assert.equal(result.confirmationGate, null);
});

test("MacConfirmationGatePipeline promotes risky requested actions into a pending confirmation gate", async () => {
  const pipeline = new MacConfirmationGatePipeline({
    now: () => "2026-04-14T00:05:00.000Z",
    idFactory: () => "gate-37",
  });

  const result = await pipeline.run({
    executionResult: {
      content: "Mac is ready to continue after deleting generated outputs.",
      event_type: "agent_reply",
      requested_actions: [
        {
          category: "destructive_filesystem",
          summary: "Delete generated outputs before continuing.",
        },
      ],
    },
  });

  assert.equal(result.confirmationGate.id, "gate-37");
  assert.equal(result.confirmationGate.status, "pending");
  assert.equal(result.confirmationGate.category, "destructive_filesystem");
  assert.equal(result.confirmationGate.severity, "high");
  assert.equal(result.executionResult.confirmation_required, true);
  assert.equal(result.executionResult.arbitration_status, "operator_decision");
  assert.equal(result.executionResult.risk_level, "high");
});

test("MacConfirmationGatePipeline collapses multiple action requests into one mixed gate", async () => {
  const pipeline = new MacConfirmationGatePipeline({
    now: () => "2026-04-14T00:10:00.000Z",
    idFactory: () => "gate-38",
  });

  const result = await pipeline.run({
    executionResult: {
      content: "Mac is ready to push and then call the remote deploy hook.",
      event_type: "agent_reply",
      requested_actions: [
        {
          category: "publish_merge",
          summary: "Push the branch after the local checks pass.",
        },
        {
          category: "network_side_effect",
          summary: "Trigger the remote deploy hook.",
          severity: "warn",
        },
      ],
    },
  });

  assert.equal(result.confirmationGate.category, "mixed");
  assert.equal(result.confirmationGate.severity, "high");
  assert.match(result.confirmationGate.summary, /push the branch/i);
  assert.match(result.confirmationGate.summary, /deploy hook/i);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  PcCritiquePromotionPipeline,
  shouldPromotePcCritique,
} from "../server/index.mjs";

test("shouldPromotePcCritique ignores mild reviewer output and catches strong warnings", () => {
  assert.equal(
    shouldPromotePcCritique({
      content: "Looks fine.",
      dissent: false,
      confidence: 0.55,
      risk_level: "low",
      requires_review: false,
    }),
    false
  );

  assert.equal(
    shouldPromotePcCritique({
      content: "Rollback path is missing.",
      dissent: true,
      confidence: 0.8,
      risk_level: "medium",
      requires_review: true,
    }),
    true
  );
});

test("PcCritiquePromotionPipeline leaves non-blocking reviewer output unchanged", async () => {
  const pipeline = new PcCritiquePromotionPipeline({
    now: () => "2026-04-13T23:20:00.000Z",
  });

  const executionResult = {
    content: "Reviewer sees no material contradiction.",
    event_type: "critique",
    dissent: false,
    confidence: 0.52,
    risk_level: "low",
    requires_review: false,
  };

  const result = await pipeline.run({ executionResult });
  assert.equal(result.executionResult, executionResult);
  assert.equal(result.promotion, null);
});

test("PcCritiquePromotionPipeline promotes reviewer warnings into shared risk metadata", async () => {
  const pipeline = new PcCritiquePromotionPipeline({
    now: () => "2026-04-13T23:25:00.000Z",
  });

  const result = await pipeline.run({
    executionResult: {
      content: "Rollback path is missing from the reducer change.",
      event_type: "critique",
      dissent: true,
      confidence: 0.81,
      risk_level: "medium",
      requires_review: true,
    },
  });

  assert.equal(result.executionResult.promoted_shared_risk, true);
  assert.equal(result.executionResult.promotion_severity, "warn");
  assert.equal(result.executionResult.arbitration_status, "needs_review");
  assert.equal(result.promotion.severity, "warn");
  assert.equal(result.promotion.arbitration_state, "needs_review");
  assert.match(result.promotion.summary, /rollback path is missing/i);
});

test("PcCritiquePromotionPipeline escalates high-risk reviewer warnings as high severity", async () => {
  const pipeline = new PcCritiquePromotionPipeline({
    now: () => "2026-04-13T23:30:00.000Z",
  });

  const result = await pipeline.run({
    executionResult: {
      content: "The migration plan would destroy data if retried.",
      event_type: "critique",
      dissent: true,
      confidence: 0.92,
      risk_level: "high",
      requires_review: true,
    },
  });

  assert.equal(result.executionResult.promotion_severity, "high");
  assert.equal(result.promotion.severity, "high");
  assert.equal(result.promotion.error_gap.kind, "warning");
  assert.equal(result.promotion.error_gap.severity, "high");
  assert.match(result.promotion.summary, /risk high/i);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  compareLaneAnswerSimilarity,
  deriveComparableLaneSignature,
  evaluateConflictArbitration,
  hasLaneDisagreement,
  hasMaterialPcCritique,
  hasVerifiedMacAuthority,
} from "../server/index.mjs";

test("conflict arbitration detects verified Mac authority and lane disagreement", () => {
  assert.equal(
    hasVerifiedMacAuthority({
      verified: true,
    }),
    true
  );

  assert.equal(
    hasVerifiedMacAuthority({
      verified: true,
      confirmation_required: true,
    }),
    false
  );

  assert.equal(
    hasLaneDisagreement(
      { content: "Mac says reducers first." },
      { content: "PC says routes first." }
    ),
    true
  );
});

test("conflict arbitration collapses obvious lane-labeled ready states into the same outcome", () => {
  const macSignature = deriveComparableLaneSignature("MAC_READY");
  const pcSignature = deriveComparableLaneSignature("Mac Gemma READY");
  const similarity = compareLaneAnswerSimilarity(
    { content: "MAC_READY" },
    { content: "PC READY" }
  );

  assert.equal(macSignature.kind, "ready");
  assert.equal(pcSignature.kind, "ready");
  assert.equal(similarity.equivalent, true);
  assert.equal(
    hasLaneDisagreement(
      { content: "MAC_READY" },
      { content: "PC READY" }
    ),
    false
  );
});

test("conflict arbitration treats promoted or high-confidence PC warnings as material", () => {
  assert.equal(
    hasMaterialPcCritique({
      promoted_shared_risk: true,
    }),
    true
  );

  assert.equal(
    hasMaterialPcCritique({
      dissent: true,
      confidence: 0.82,
      risk_level: "medium",
    }),
    true
  );
});

test("conflict arbitration blocks material PC critique against unverified Mac output", () => {
  const decision = evaluateConflictArbitration({
    macResult: {
      content: "Mac drafted the reducer plan.",
      verified: false,
    },
    pcResult: {
      content: "PC says rollback coverage is missing.",
      promoted_shared_risk: true,
      requires_review: true,
    },
  });

  assert.equal(decision.arbitration_state, "needs_review");
  assert.equal(decision.reason_code, "pc_blocks_unverified_mac");
  assert.equal(decision.should_emit_event, true);
});

test("conflict arbitration prioritizes pending Mac confirmation gates as operator decisions", () => {
  const decision = evaluateConflictArbitration({
    macResult: {
      content: "Mac wants to delete temp files before continuing.",
      confirmation_required: true,
      confirmation_gate: {
        summary: "Operator confirmation required before deleting temp files.",
      },
    },
    pcResult: {
      content: "PC notes the cleanup is reasonable.",
    },
  });

  assert.equal(decision.arbitration_state, "operator_decision");
  assert.equal(decision.reason_code, "operator_confirmation_required");
});

test("conflict arbitration escalates to operator_decision when verified Mac conflicts with material PC critique", () => {
  const decision = evaluateConflictArbitration({
    macResult: {
      content: "Mac executed and verified the reducer plan.",
      verified: true,
    },
    pcResult: {
      content: "PC says the verified reducer plan still risks data loss.",
      promoted_shared_risk: true,
      requires_review: true,
    },
  });

  assert.equal(decision.arbitration_state, "operator_decision");
  assert.equal(decision.reason_code, "verified_mac_conflicts_with_material_pc_critique");
});

test("conflict arbitration lets verified Mac outrank speculative PC disagreement", () => {
  const decision = evaluateConflictArbitration({
    macResult: {
      content: "Mac verified reducers first.",
      verified: true,
    },
    pcResult: {
      content: "PC would rather start with routes first.",
      verified: false,
    },
  });

  assert.equal(decision.arbitration_state, "clear");
  assert.equal(decision.reason_code, "verified_mac_outranks_speculative_pc");
  assert.equal(decision.should_emit_event, true);
});

test("conflict arbitration requires operator choice when unverified lanes disagree", () => {
  const decision = evaluateConflictArbitration({
    macResult: {
      content: "Mac suggests reducers first.",
      verified: false,
    },
    pcResult: {
      content: "PC suggests routes first.",
      verified: false,
    },
  });

  assert.equal(decision.arbitration_state, "operator_decision");
  assert.equal(decision.reason_code, "unverified_lane_disagreement");
});

test("conflict arbitration stays clear when unverified lanes only differ by lane labels", () => {
  const decision = evaluateConflictArbitration({
    macResult: {
      content: "Mac Gemma READY",
      verified: false,
    },
    pcResult: {
      content: "PC READY",
      verified: false,
    },
  });

  assert.equal(decision.arbitration_state, "clear");
  assert.equal(decision.reason_code, "no_material_conflict");
});

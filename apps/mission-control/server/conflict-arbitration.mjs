function summarize(value, maxLength = 180) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

const LANE_MARKER_TOKENS = new Set([
  "body",
  "executor",
  "gemma",
  "lane",
  "lanes",
  "mac",
  "pc",
  "peer",
  "primary",
  "reviewer",
]);

const FILLER_TOKENS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "be",
  "currently",
  "execution",
  "for",
  "i",
  "is",
  "it",
  "its",
  "now",
  "please",
  "response",
  "role",
  "state",
  "status",
  "the",
  "this",
  "to",
  "we",
]);

function tokenizeComparableText(value) {
  return summarize(value, 500)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function deriveComparableLaneSignature(value) {
  const summary = summarize(value, 500);
  if (!summary) {
    return {
      kind: "empty",
      normalized: "",
      label: "",
      summary: "",
    };
  }

  const tokens = tokenizeComparableText(summary);
  const coreTokens = tokens.filter(
    (token) => !LANE_MARKER_TOKENS.has(token) && !FILLER_TOKENS.has(token)
  );

  if (coreTokens.length && coreTokens.every((token) => token === "ready")) {
    return {
      kind: "ready",
      normalized: "ready",
      label: "ready state",
      summary,
    };
  }

  const normalizedText = tokens.join(" ");
  const hasHealthyMarker = /\b(healthy|nominal|operational|stable|working)\b/.test(normalizedText);
  const hasNegativeHealthMarker =
    /\b(blocked|degraded|down|error|failed|missing|offline|stalled|unhealthy|unknown|unreachable|unverified)\b/.test(
      normalizedText
    );

  if (hasHealthyMarker && !hasNegativeHealthMarker) {
    return {
      kind: "healthy",
      normalized: "healthy",
      label: "healthy state",
      summary,
    };
  }

  return {
    kind: "text",
    normalized: normalizedText,
    label: summary,
    summary,
  };
}

export function compareLaneAnswerSimilarity(macResult = null, pcResult = null) {
  const macSignature = deriveComparableLaneSignature(macResult?.content || "");
  const pcSignature = deriveComparableLaneSignature(pcResult?.content || "");
  const equivalent = Boolean(
    macSignature.normalized &&
      pcSignature.normalized &&
      macSignature.normalized === pcSignature.normalized
  );

  return {
    equivalent,
    macSignature,
    pcSignature,
  };
}

export function hasVerifiedMacAuthority(macResult = null) {
  if (macResult?.confirmation_required) {
    return false;
  }

  return Boolean(
    macResult?.verified ||
      macResult?.verification?.status === "verified" ||
      macResult?.verification_status === "verified"
  );
}

export function hasMaterialPcCritique(pcResult = null) {
  return Boolean(
    pcResult?.promoted_shared_risk ||
      pcResult?.requires_review ||
      pcResult?.arbitration_status === "needs_review" ||
      pcResult?.risk_level === "high" ||
      (pcResult?.dissent === true &&
        (pcResult?.confidence === null || pcResult?.confidence >= 0.65))
  );
}

export function hasLaneDisagreement(macResult = null, pcResult = null) {
  const { equivalent, macSignature, pcSignature } = compareLaneAnswerSimilarity(macResult, pcResult);

  return Boolean(macSignature.normalized && pcSignature.normalized && !equivalent);
}

export function evaluateConflictArbitration({ macResult = null, pcResult = null } = {}) {
  if (macResult?.confirmation_required) {
    return {
      arbitration_state: "operator_decision",
      reason_code: "operator_confirmation_required",
      summary:
        macResult?.confirmation_gate?.summary ||
        "Operator confirmation is required before the Mac lane can continue.",
      recommended_next_step:
        "Review the requested action and explicitly approve it before continuing the Mac lane.",
      should_emit_event: true,
    };
  }

  const macVerified = hasVerifiedMacAuthority(macResult);
  const materialPcCritique = hasMaterialPcCritique(pcResult);
  const disagreement = hasLaneDisagreement(macResult, pcResult);

  if (materialPcCritique && !macVerified) {
    return {
      arbitration_state: "needs_review",
      reason_code: "pc_blocks_unverified_mac",
      summary: "Material PC critique blocks the unverified Mac path until reviewed.",
      recommended_next_step:
        "Review the PC critique, add verification, or revise the Mac path before continuing.",
      should_emit_event: true,
    };
  }

  if (materialPcCritique && macVerified) {
    return {
      arbitration_state: "operator_decision",
      reason_code: "verified_mac_conflicts_with_material_pc_critique",
      summary:
        "Verified Mac execution conflicts with a material PC critique. Operator decision is required.",
      recommended_next_step:
        "Inspect the verified Mac evidence and the PC critique together before deciding whether to continue or revise.",
      should_emit_event: true,
    };
  }

  if (macVerified && disagreement) {
    return {
      arbitration_state: "clear",
      reason_code: "verified_mac_outranks_speculative_pc",
      summary:
        "Verified Mac execution outranks the speculative PC critique. Continue with the Mac path while keeping the reviewer note visible.",
      recommended_next_step:
        "Proceed with the verified Mac path and treat the PC difference as follow-up review, not a block.",
      should_emit_event: true,
    };
  }

  if (disagreement) {
    return {
      arbitration_state: "operator_decision",
      reason_code: "unverified_lane_disagreement",
      summary:
        "Mac and PC disagree without a verified execution result to resolve the conflict. Operator decision is required.",
      recommended_next_step:
        "Choose a direction or request stronger verification before continuing.",
      should_emit_event: true,
    };
  }

  if (macVerified) {
    return {
      arbitration_state: "clear",
      reason_code: "verified_mac_clear",
      summary: "Verified Mac execution is authoritative for the current step.",
      recommended_next_step: "Proceed with the verified Mac path.",
      should_emit_event: false,
    };
  }

  return {
    arbitration_state: "clear",
    reason_code: "no_material_conflict",
    summary: "No material conflict remains across lanes.",
    recommended_next_step: "Proceed and continue monitoring for new risk.",
    should_emit_event: false,
  };
}

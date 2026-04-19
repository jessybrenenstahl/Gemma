function summarize(content, maxLength = 180) {
  const text = String(content || "").trim().replace(/\s+/g, " ");
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function shouldPromotePcCritique(executionResult = {}) {
  return Boolean(
    executionResult.requires_review ||
      executionResult.arbitration_status === "needs_review" ||
      executionResult.risk_level === "high" ||
      (executionResult.dissent === true &&
        (executionResult.confidence === null || executionResult.confidence >= 0.65))
  );
}

function buildPromotionSeverity(executionResult = {}) {
  return executionResult.risk_level === "high" ? "high" : "warn";
}

function buildPromotionSummary(executionResult = {}) {
  const summary = summarize(executionResult.content || "");
  const parts = [
    summary
      ? `PC critique promoted a shared risk: ${summary}`
      : "PC critique promoted a shared risk.",
  ];

  if (typeof executionResult.confidence === "number") {
    parts.push(`Confidence ${executionResult.confidence.toFixed(2)}.`);
  }

  if (typeof executionResult.dissent === "boolean") {
    parts.push(`Dissent ${executionResult.dissent ? "yes" : "no"}.`);
  }

  if (executionResult.risk_level) {
    parts.push(`Risk ${executionResult.risk_level}.`);
  }

  return parts.join(" ");
}

export class PcCritiquePromotionPipeline {
  constructor({
    now = () => new Date().toISOString(),
  } = {}) {
    this.now = now;
  }

  async run({ executionResult }) {
    if (!shouldPromotePcCritique(executionResult)) {
      return {
        executionResult,
        promotion: null,
      };
    }

    const timestamp = this.now();
    const severity = buildPromotionSeverity(executionResult);
    const summary = buildPromotionSummary(executionResult);
    const promotion = {
      summary,
      severity,
      arbitration_state: "needs_review",
      error_gap: {
        summary,
        severity,
        kind: "warning",
        status: "active",
        superseded_by_event_id: null,
        timestamp,
      },
      timestamp,
    };

    return {
      executionResult: {
        ...executionResult,
        requires_review: true,
        arbitration_status: "needs_review",
        risk_level:
          executionResult.risk_level || (severity === "high" ? "high" : "medium"),
        promoted_shared_risk: true,
        promoted_shared_risk_summary: summary,
        promotion_severity: severity,
      },
      promotion,
    };
  }
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function collectTraceVerificationTargets(traceEvents = []) {
  const targets = [];
  for (const traceEvent of traceEvents) {
    if (typeof traceEvent?.verification_target === "string") {
      targets.push(traceEvent.verification_target);
    }
    if (Array.isArray(traceEvent?.verification_targets)) {
      targets.push(...traceEvent.verification_targets);
    }
  }
  return uniqueStrings(targets);
}

export function collectMacVerificationTargets(executionResult = {}) {
  return uniqueStrings([
    executionResult.verification_target,
    ...(Array.isArray(executionResult.verification_targets)
      ? executionResult.verification_targets
      : []),
    ...collectTraceVerificationTargets(executionResult.trace_events),
  ]);
}

export function shouldAutoVerifyMacResult(executionResult = {}) {
  const targets = collectMacVerificationTargets(executionResult);
  return Boolean(executionResult.verification_required || targets.length > 0);
}

function normalizeRelatedEventIds(relatedEventIds = []) {
  return uniqueStrings(Array.isArray(relatedEventIds) ? relatedEventIds : []);
}

function buildDefaultPendingSummary(targets) {
  if (targets.length === 0) {
    return "Mac verification is pending.";
  }
  return `Mac verification is pending for: ${targets.join(", ")}.`;
}

function buildDefaultVerifiedSummary(targets) {
  if (targets.length === 0) {
    return "Mac verification succeeded.";
  }

  return `Mac verification succeeded for: ${targets.join(", ")}.`;
}

function buildDefaultFailureSummary(targets, errorMessage = "") {
  if (targets.length === 0) {
    return errorMessage
      ? `Mac verification failed: ${errorMessage}`
      : "Mac verification failed.";
  }

  const suffix = errorMessage ? ` ${errorMessage}` : "";
  return `Mac verification failed for ${targets.join(", ")}.${suffix}`.trim();
}

function buildDefaultFailureGap(summary, timestamp) {
  return {
    summary,
    severity: "high",
    kind: "verification_failure",
    status: "active",
    superseded_by_event_id: null,
    timestamp,
  };
}

function normalizeVerificationOutcome(rawOutcome, targets, now) {
  const status = String(rawOutcome?.status || "verified");
  const summary = String(
    rawOutcome?.summary ||
      (status === "pending"
        ? buildDefaultPendingSummary(targets)
        : status === "failed"
          ? buildDefaultFailureSummary(targets)
          : buildDefaultVerifiedSummary(targets))
  ).trim();

  return {
    verification: {
      summary,
      verification_type: String(rawOutcome?.verification_type || "tool"),
      status,
      evidence: String(rawOutcome?.evidence || ""),
      related_event_ids: normalizeRelatedEventIds(rawOutcome?.related_event_ids),
      timestamp: String(rawOutcome?.timestamp || now),
    },
    errorGap:
      status === "failed"
        ? {
            ...buildDefaultFailureGap(summary, String(rawOutcome?.timestamp || now)),
            ...(rawOutcome?.error_gap || {}),
            timestamp: String(rawOutcome?.error_gap?.timestamp || rawOutcome?.timestamp || now),
          }
        : null,
  };
}

function buildPendingVerificationOutcome(targets, now) {
  return {
    verification: {
      summary: buildDefaultPendingSummary(targets),
      verification_type: "system",
      status: "pending",
      evidence: "No Mac verifier is configured for this execution result yet.",
      related_event_ids: [],
      timestamp: now,
    },
    errorGap: null,
  };
}

export class MacVerificationPipeline {
  constructor({
    verifier = null,
    now = () => new Date().toISOString(),
  } = {}) {
    this.verifier = verifier;
    this.now = now;
  }

  async run({ session, executionResult, operatorMode }) {
    const targets = collectMacVerificationTargets(executionResult);
    const shouldVerify = shouldAutoVerifyMacResult(executionResult);

    if (!shouldVerify) {
      return {
        executionResult,
        verification: executionResult.verification || null,
        errorGap: null,
      };
    }

    const now = this.now();

    let outcome;
    if (typeof this.verifier === "function") {
      try {
        outcome = normalizeVerificationOutcome(
          await this.verifier({
            session,
            executionResult,
            operatorMode,
            verificationTargets: targets,
          }),
          targets,
          now
        );
      } catch (error) {
        outcome = normalizeVerificationOutcome(
          {
            status: "failed",
            summary: buildDefaultFailureSummary(targets, error.message),
            verification_type: "system",
            evidence: `Verifier error: ${error.message}`,
            error_gap: buildDefaultFailureGap(
              buildDefaultFailureSummary(targets, error.message),
              now
            ),
          },
          targets,
          now
        );
      }
    } else if (executionResult.verification) {
      outcome = normalizeVerificationOutcome(executionResult.verification, targets, now);
    } else {
      outcome = buildPendingVerificationOutcome(targets, now);
    }

    const nextExecutionResult = {
      ...executionResult,
      verification_required: shouldVerify,
      verification_targets: targets,
      verification: outcome.verification,
      verified: outcome.verification.status === "verified" || Boolean(executionResult.verified),
      verification_error_gap: outcome.errorGap,
    };

    if (outcome.verification.status === "failed") {
      nextExecutionResult.requires_review = true;
      nextExecutionResult.risk_level = "high";
      nextExecutionResult.arbitration_status = "needs_review";
    }

    return {
      executionResult: nextExecutionResult,
      verification: outcome.verification,
      errorGap: outcome.errorGap,
    };
  }
}

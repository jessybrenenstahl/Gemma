import { randomUUID } from "node:crypto";

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

const HIGH_SEVERITY_CATEGORIES = new Set([
  "destructive_filesystem",
  "credential_change",
  "publish_merge",
]);

function normalizeActionCategory(category) {
  const normalized = String(category || "mixed").trim();
  return normalized || "mixed";
}

function normalizeActionSeverity(action) {
  const category = normalizeActionCategory(action.category);
  const explicit = String(action.severity || "").trim();
  if (["info", "warn", "high"].includes(explicit)) {
    return explicit;
  }

  return HIGH_SEVERITY_CATEGORIES.has(category) ? "high" : "warn";
}

function normalizeRequestedActions(requestedActions = []) {
  return requestedActions
    .filter((action) => action?.requires_confirmation !== false)
    .map((action) => ({
      id:
        action.id === null || action.id === undefined || action.id === ""
          ? null
          : String(action.id),
      category: normalizeActionCategory(action.category),
      summary: String(action.summary || "").trim(),
      severity: normalizeActionSeverity(action),
    }))
    .filter((action) => action.summary);
}

function resolveGateCategory(actions) {
  const categories = uniqueStrings(actions.map((action) => action.category));
  if (!categories.length) {
    return "none";
  }
  if (categories.length === 1) {
    return categories[0];
  }
  return "mixed";
}

function resolveGateSeverity(actions) {
  return actions.some((action) => action.severity === "high") ? "high" : "warn";
}

function buildGateSummary(actions) {
  const summaries = actions.map((action) => action.summary);
  if (!summaries.length) {
    return "Operator confirmation is required before Mac can continue.";
  }
  if (summaries.length === 1) {
    return `Operator confirmation required before Mac can continue: ${summaries[0]}`;
  }

  return `Operator confirmation required before Mac can continue: ${summaries.join("; ")}`;
}

export function shouldRequireOperatorConfirmation(executionResult = {}) {
  return normalizeRequestedActions(executionResult.requested_actions).length > 0;
}

export class MacConfirmationGatePipeline {
  constructor({
    idFactory = () => `gate-${randomUUID()}`,
    now = () => new Date().toISOString(),
  } = {}) {
    this.idFactory = idFactory;
    this.now = now;
  }

  async run({ executionResult }) {
    const actions = normalizeRequestedActions(executionResult.requested_actions);
    if (!actions.length) {
      return {
        executionResult,
        confirmationGate: null,
      };
    }

    const timestamp = this.now();
    const confirmationGate = {
      id: this.idFactory(),
      status: "pending",
      summary: buildGateSummary(actions),
      category: resolveGateCategory(actions),
      severity: resolveGateSeverity(actions),
      requested_at: timestamp,
      resolved_at: null,
      operator_note: "",
      related_event_ids: [],
    };

    return {
      executionResult: {
        ...executionResult,
        confirmation_required: true,
        confirmation_gate: confirmationGate,
        requires_review: true,
        arbitration_status: "operator_decision",
        risk_level: confirmationGate.severity === "high" ? "high" : "medium",
      },
      confirmationGate,
    };
  }
}

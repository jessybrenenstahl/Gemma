function extractTextFromMessageContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          if (typeof item.text === "string") {
            return item.text;
          }
          if (typeof item.content === "string") {
            return item.content;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content && typeof content === "object") {
    if (typeof content.text === "string") {
      return content.text;
    }
    if (typeof content.content === "string") {
      return content.content;
    }
  }

  return "";
}

function extractVisibleText(raw) {
  if (typeof raw === "string") {
    return raw.trim();
  }

  if (!raw || typeof raw !== "object") {
    return "";
  }

  const directCandidates = [
    raw.content,
    raw.reply,
    raw.output_text,
    raw.text,
    raw.message?.content,
    raw.choices?.[0]?.message?.content,
    raw.response?.output_text,
  ];

  for (const candidate of directCandidates) {
    const extracted = extractTextFromMessageContent(candidate).trim();
    if (extracted) {
      return extracted;
    }
  }

  const reasoningCandidates = [
    raw.reasoning_content,
    raw.message?.reasoning_content,
    raw.choices?.[0]?.message?.reasoning_content,
  ];

  for (const candidate of reasoningCandidates) {
    const extracted = extractTextFromMessageContent(candidate).trim();
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function extractMetrics(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
    };
  }

  const usage = raw.usage || raw.response?.usage || {};
  const metrics = raw.metrics || raw.proxyMetrics || {};
  return {
    latency_ms: Number(
      metrics.latency_ms ?? metrics.elapsedMs ?? raw.elapsed_ms ?? raw.elapsedMs ?? 0
    ),
    tokens_in: Number(
      usage.prompt_tokens ?? metrics.tokens_in ?? metrics.prompt_tokens ?? raw.tokens_in ?? 0
    ),
    tokens_out: Number(
      usage.completion_tokens ??
        metrics.tokens_out ??
        metrics.completion_tokens ??
        raw.tokens_out ??
        0
    ),
  };
}

function extractVerificationTargets(raw) {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const targets = [];
  const directTargets = [
    raw.verification_target,
    raw.verificationTarget,
  ];

  for (const target of directTargets) {
    if (typeof target === "string" && target.trim()) {
      targets.push(target.trim());
    }
  }

  const listCandidates = [
    raw.verification_targets,
    raw.verificationTargets,
  ];

  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    for (const target of candidate) {
      if (typeof target === "string" && target.trim()) {
        targets.push(target.trim());
      }
    }
  }

  return Array.from(new Set(targets));
}

function normalizeRequestedAction(rawAction) {
  if (typeof rawAction === "string") {
    const summary = rawAction.trim();
    if (!summary) {
      return null;
    }

    return {
      id: null,
      category: "mixed",
      summary,
      severity: "warn",
      requires_confirmation: true,
    };
  }

  if (!rawAction || typeof rawAction !== "object") {
    return null;
  }

  const summary = String(rawAction.summary || rawAction.content || rawAction.label || "").trim();
  if (!summary) {
    return null;
  }

  return {
    id:
      rawAction.id === null || rawAction.id === undefined || rawAction.id === ""
        ? null
        : String(rawAction.id),
    category: String(rawAction.category || "mixed"),
    summary,
    severity: String(rawAction.severity || "warn"),
    requires_confirmation:
      rawAction.requires_confirmation === undefined
        ? true
        : Boolean(rawAction.requires_confirmation),
  };
}

function extractRequestedActions(raw) {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const candidates = [
    raw.requested_actions,
    raw.requestedActions,
    raw.action_requests,
    raw.actionRequests,
    raw.action_request,
    raw.actionRequest,
  ];

  const actions = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      actions.push(...candidate);
      continue;
    }
    if (candidate) {
      actions.push(candidate);
    }
  }

  return actions.map(normalizeRequestedAction).filter(Boolean);
}

function normalizeTraceType(type) {
  const supportedTypes = new Set([
    "operator_prompt",
    "agent_reply",
    "execution_action",
    "critique",
    "compare",
    "verification",
    "error",
    "arbitration",
  ]);

  return supportedTypes.has(type) ? type : "execution_action";
}

function extractTraceContent(trace) {
  if (typeof trace === "string") {
    return trace.trim();
  }

  return extractVisibleText(trace).trim() ||
    String(trace?.summary || trace?.message || trace?.label || "").trim();
}

function extractTraceEvents(raw) {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const candidates = [
    raw.trace_events,
    raw.traceEvents,
    raw.tool_trace,
    raw.toolTrace,
    raw.harness_trace,
    raw.harnessTrace,
    raw.review_artifacts,
    raw.reviewArtifacts,
  ];
  const fallbackMetrics = extractMetrics(raw);
  const traceItems = [];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      traceItems.push(...candidate);
      continue;
    }
    if (candidate) {
      traceItems.push(candidate);
    }
  }

  return traceItems
    .map((trace) => {
      const content = extractTraceContent(trace);
      if (!content) {
        return null;
      }

      return {
        event_type: normalizeTraceType(trace?.type || trace?.event_type),
        content,
        verified: Boolean(trace?.verified),
        timestamp: String(trace?.timestamp || new Date().toISOString()),
        related_event_ids: Array.isArray(trace?.related_event_ids)
          ? trace.related_event_ids.map((id) => String(id))
          : [],
        metrics: {
          ...fallbackMetrics,
          ...extractMetrics(trace),
        },
      };
    })
    .filter(Boolean);
}

export function normalizeLaneExecutionResult(raw, { lane, fallbackEventType = "agent_reply" } = {}) {
  const content = extractVisibleText(raw);

  const normalized = {
    content: content || "No visible response returned.",
    event_type:
      typeof raw?.event_type === "string"
        ? raw.event_type
        : lane === "pc"
          ? fallbackEventType === "agent_reply"
            ? "critique"
            : fallbackEventType
          : fallbackEventType,
    verified: Boolean(raw?.verified),
    metrics: extractMetrics(raw),
    verification: raw?.verification || null,
    requires_review: Boolean(raw?.requires_review),
    confidence:
      typeof raw?.confidence === "number" && Number.isFinite(raw.confidence)
        ? raw.confidence
        : null,
    dissent: typeof raw?.dissent === "boolean" ? raw.dissent : null,
    risk_level: typeof raw?.risk_level === "string" ? raw.risk_level : null,
    review_mode: typeof raw?.review_mode === "string" ? raw.review_mode : null,
    arbitration_status:
      typeof raw?.arbitration_status === "string" ? raw.arbitration_status : null,
    verification_required: Boolean(
      raw?.verification_required || raw?.requires_follow_up_verification
    ),
    verification_targets: extractVerificationTargets(raw),
    requested_actions: extractRequestedActions(raw),
    trace_events: extractTraceEvents(raw),
    heartbeat: {
      timestamp: String(raw?.heartbeat?.timestamp || new Date().toISOString()),
      latency_ms: Number(raw?.heartbeat?.latency_ms || extractMetrics(raw).latency_ms || 0),
    },
  };

  return normalized;
}

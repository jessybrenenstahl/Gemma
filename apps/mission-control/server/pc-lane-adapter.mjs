import { buildAgroLanePrompt } from "./agro-route-prompts.mjs";
import { inspectRepoScope } from "./repo-scope.mjs";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 900;
const DEFAULT_CHAT_PATH = "/v1/chat/completions";
const DEFAULT_HARNESS_PATH = "/api/pc/review";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildPcLaneAdapterError(message, code, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function inferTaskKind(operatorMode) {
  return operatorMode === "compare" ? "compare" : "critique";
}

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
          return typeof item.text === "string"
            ? item.text
            : typeof item.content === "string"
              ? item.content
              : "";
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

  const candidates = [
    raw.content,
    raw.reply,
    raw.output_text,
    raw.text,
    raw.message?.content,
    raw.choices?.[0]?.message?.content,
    raw.response?.output_text,
  ];

  for (const candidate of candidates) {
    const extracted = extractTextFromMessageContent(candidate).trim();
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function parseConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return null;
  }

  if (text === "high") {
    return 0.85;
  }
  if (text === "medium") {
    return 0.65;
  }
  if (text === "low") {
    return 0.4;
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(1, numeric));
}

function parseBooleanHint(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return null;
  }

  if (["yes", "true", "1", "y"].includes(text)) {
    return true;
  }
  if (["no", "false", "0", "n"].includes(text)) {
    return false;
  }

  return null;
}

function parseRiskLevel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["none", "low", "medium", "high"].includes(text)) {
    return text;
  }
  return null;
}

function parseReviewFooter(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/);
  let confidence = null;
  let dissent = null;
  let riskLevel = null;
  const kept = [];

  for (const line of lines) {
    const confidenceMatch = line.match(/^\s*confidence\s*:\s*(.+)\s*$/i);
    if (confidenceMatch) {
      confidence = parseConfidence(confidenceMatch[1]);
      continue;
    }

    const dissentMatch = line.match(/^\s*dissent\s*:\s*(.+)\s*$/i);
    if (dissentMatch) {
      dissent = parseBooleanHint(dissentMatch[1]);
      continue;
    }

    const riskMatch = line.match(/^\s*risk\s*:\s*(.+)\s*$/i);
    if (riskMatch) {
      riskLevel = parseRiskLevel(riskMatch[1]);
      continue;
    }

    kept.push(line);
  }

  return {
    content: kept.join("\n").trim(),
    confidence,
    dissent,
    riskLevel,
  };
}

function extractMetrics(raw) {
  const usage = raw?.usage || raw?.response?.usage || {};
  const metrics = raw?.metrics || raw?.proxyMetrics || {};
  return {
    latency_ms: Number(metrics.latency_ms || metrics.elapsedMs || raw?.elapsed_ms || raw?.elapsedMs || 0),
    tokens_in: Number(usage.prompt_tokens || raw?.tokens_in || 0),
    tokens_out: Number(usage.completion_tokens || raw?.tokens_out || 0),
  };
}

function buildTransportTrace({ endpoint, model, latencyMs, taskKind }) {
  return {
    type: taskKind === "compare" ? "compare" : "critique",
    content: `PC reviewer model call completed via ${endpoint} using ${model} in ${taskKind} mode.`,
    verified: false,
    metrics: {
      latency_ms: Number(latencyMs) || 0,
      tokens_in: 0,
      tokens_out: 0,
    },
  };
}

function buildMetadataTrace({ taskKind, confidence, dissent, riskLevel }) {
  const parts = [];
  if (confidence !== null) {
    parts.push(`confidence ${confidence.toFixed(2)}`);
  }
  if (dissent !== null) {
    parts.push(`dissent ${dissent ? "yes" : "no"}`);
  }
  if (riskLevel) {
    parts.push(`risk ${riskLevel}`);
  }

  if (!parts.length) {
    return null;
  }

  return {
    type: taskKind === "compare" ? "compare" : "critique",
    content: `PC reviewer metadata: ${parts.join(", ")}.`,
    verified: false,
    metrics: {
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
    },
  };
}

function normalizeReviewArtifacts(reviewArtifacts, taskKind) {
  const items = Array.isArray(reviewArtifacts)
    ? reviewArtifacts
    : reviewArtifacts
      ? [reviewArtifacts]
      : [];

  return items
    .map((item) => {
      const content =
        typeof item === "string"
          ? item.trim()
          : String(item?.content || item?.summary || item?.message || item?.label || "").trim();
      if (!content) {
        return null;
      }

      return {
        type: item?.type || (taskKind === "compare" ? "compare" : "critique"),
        content,
        verified: Boolean(item?.verified),
        metrics: {
          latency_ms: Number(item?.metrics?.latency_ms || 0),
          tokens_in: Number(item?.metrics?.tokens_in || 0),
          tokens_out: Number(item?.metrics?.tokens_out || 0),
        },
      };
    })
    .filter(Boolean);
}

function resolveRequiresReview({
  taskKind,
  explicitRequiresReview,
  dissent,
  riskLevel,
}) {
  if (typeof explicitRequiresReview === "boolean") {
    return explicitRequiresReview;
  }

  if (taskKind === "compare") {
    return riskLevel === "high";
  }

  return Boolean(dissent) || ["medium", "high"].includes(riskLevel || "");
}

function extractHarnessErrorMessage(data, fallbackStatus) {
  if (typeof data?.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  if (typeof data?.error === "string" && data.error.trim()) {
    return data.error.trim();
  }
  return `PC lane request failed with ${fallbackStatus}.`;
}

function normalizeAdapterResponse(data, { endpoint, model, latencyMs, taskKind, transport }) {
  const visibleText = extractVisibleText(data);
  const footer = parseReviewFooter(visibleText);
  const explicitConfidence = parseConfidence(data?.confidence ?? data?.review?.confidence);
  const explicitDissent = parseBooleanHint(data?.dissent ?? data?.review?.dissent);
  const explicitRiskLevel = parseRiskLevel(data?.risk_level ?? data?.riskLevel ?? data?.review?.risk_level);

  const confidence = explicitConfidence ?? footer.confidence;
  const dissent = explicitDissent ?? footer.dissent;
  const riskLevel = explicitRiskLevel ?? footer.riskLevel;
  const content = footer.content || visibleText || "No visible response returned.";
  const reviewArtifacts = normalizeReviewArtifacts(
    data?.review_artifacts || data?.reviewArtifacts,
    taskKind
  );
  const metadataTrace = buildMetadataTrace({
    taskKind,
    confidence,
    dissent,
    riskLevel,
  });

  return {
    ...data,
    content,
    elapsedMs: latencyMs,
    event_type:
      typeof data?.event_type === "string"
        ? data.event_type
        : taskKind === "compare"
          ? "compare"
          : "critique",
    confidence,
    dissent,
    risk_level: riskLevel,
    review_mode: taskKind,
    requires_review: resolveRequiresReview({
      taskKind,
      explicitRequiresReview: data?.requires_review,
      dissent,
      riskLevel,
    }),
    trace_events: [
      {
        ...buildTransportTrace({
          endpoint,
          model,
          latencyMs,
          taskKind,
        }),
        content:
          transport === "harness"
            ? `PC reviewer harness call completed via ${endpoint} using ${model} in ${taskKind} mode.`
            : buildTransportTrace({
                endpoint,
                model,
                latencyMs,
                taskKind,
              }).content,
      },
      ...(metadataTrace ? [metadataTrace] : []),
      ...reviewArtifacts,
    ],
    metrics: {
      ...extractMetrics(data),
      latency_ms: latencyMs,
    },
  };
}

export class PcLaneAdapter {
  constructor({
    endpoint = process.env.AGRO_PC_ENDPOINT || "http://127.0.0.1:1234",
    model = process.env.AGRO_PC_MODEL || "",
    transport = process.env.AGRO_PC_TRANSPORT || "openai_chat",
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
    chatPath = DEFAULT_CHAT_PATH,
    harnessPath = DEFAULT_HARNESS_PATH,
    repoPaths = {},
  } = {}) {
    this.endpoint = trimTrailingSlash(endpoint);
    this.model = String(model || "").trim();
    this.transport = String(transport || "openai_chat").trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
    this.temperature = Number(temperature) || DEFAULT_TEMPERATURE;
    this.maxTokens = Number(maxTokens) || DEFAULT_MAX_TOKENS;
    this.chatPath = chatPath;
    this.harnessPath = harnessPath;
    this.repoPaths = repoPaths;
  }

  isConfigured() {
    return Boolean(this.endpoint && this.model && typeof this.fetchImpl === "function");
  }

  async execute({ prompt, sharedInstruction = "", session = null, operatorMode = "send_pc" }) {
    if (!this.endpoint || !this.model) {
      throw buildPcLaneAdapterError(
        "PC lane is not configured. Set a PC endpoint and model before using the reviewer lane.",
        "PC_CONFIG_REQUIRED"
      );
    }

    if (typeof this.fetchImpl !== "function") {
      throw buildPcLaneAdapterError(
        "PC lane transport is unavailable because no fetch implementation is configured.",
        "PC_FETCH_UNAVAILABLE"
      );
    }

    const taskKind = inferTaskKind(operatorMode);
    if (this.transport === "harness") {
      return this.#executeHarness({ prompt, sharedInstruction, session, taskKind, operatorMode });
    }

    return this.#executeOpenAiChat({ prompt, sharedInstruction, taskKind, operatorMode });
  }

  async describeRepoContext({ repo, session = null, now } = {}) {
    return inspectRepoScope({
      lane: "pc",
      repo: repo || session?.mission_state?.active_repo,
      repoPaths: this.repoPaths,
      now: now || new Date().toISOString(),
    });
  }

  async #executeOpenAiChat({ prompt, sharedInstruction, taskKind, operatorMode }) {
    const startedAt = Date.now();
    const repoContext = await this.describeRepoContext({});
    const data = await this.#postJson(`${this.endpoint}${this.chatPath}`, {
      model: this.model,
      messages: [
        {
          role: "system",
          content: buildAgroLanePrompt({
            lane: "pc",
            operatorMode,
            sharedInstruction,
            repoContext,
            taskKind,
          }),
        },
        {
          role: "user",
          content: String(prompt || ""),
        },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: false,
    });

    return normalizeAdapterResponse(data, {
      endpoint: this.endpoint,
      model: this.model,
      latencyMs: Date.now() - startedAt,
      taskKind,
      transport: "openai_chat",
    });
  }

  async #executeHarness({ prompt, sharedInstruction, session, taskKind, operatorMode }) {
    const startedAt = Date.now();
    const repoContext = await this.describeRepoContext({ session });
    const data = await this.#postJson(`${this.endpoint}${this.harnessPath}`, {
      prompt: String(prompt || ""),
      shared_instruction: buildAgroLanePrompt({
        lane: "pc",
        operatorMode: operatorMode || session?.mission_state?.operator_mode || "send_pc",
        sharedInstruction,
        repoContext,
        taskKind,
      }),
      model: this.model,
      review_mode: taskKind,
      repo_context: repoContext,
      session: session
        ? {
            session_id: session.session_id,
            mission_goal: session.mission_state?.mission_goal || "",
            operator_mode: session.mission_state?.operator_mode || "",
            active_repo: session.mission_state?.active_repo || "",
          }
        : null,
    });

    return normalizeAdapterResponse(data, {
      endpoint: this.endpoint,
      model: this.model,
      latencyMs: Date.now() - startedAt,
      taskKind,
      transport: "harness",
    });
  }

  async #postJson(url, payload) {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorCode =
          data?.code || data?.error_code || (response.status === 409 ? "STALE_SESSION" : "PC_HTTP_ERROR");
        if (errorCode === "STALE_SESSION") {
          throw buildPcLaneAdapterError(
            "PC reviewer session went stale on the remote side. Retry the review task or re-establish the reviewer session.",
            "STALE_SESSION"
          );
        }

        throw buildPcLaneAdapterError(
          extractHarnessErrorMessage(data, response.status),
          errorCode
        );
      }

      return data;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw buildPcLaneAdapterError(
          `PC lane request timed out after ${this.timeoutMs} ms. Check the local reviewer endpoint or model availability.`,
          "PC_TIMEOUT",
          error
        );
      }

      if (error?.code) {
        throw error;
      }

      if (error instanceof TypeError) {
        throw buildPcLaneAdapterError(
          `PC lane transport is unreachable at ${this.endpoint}. Check the local reviewer server binding or model availability.`,
          "PC_UNREACHABLE",
          error
        );
      }

      throw buildPcLaneAdapterError(
        `PC lane request failed: ${error.message}`,
        "PC_REQUEST_FAILED",
        error
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export { buildPcLaneAdapterError, inferTaskKind };

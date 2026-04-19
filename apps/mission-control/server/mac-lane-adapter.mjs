import { buildAgroLanePrompt } from "./agro-route-prompts.mjs";
import { inspectRepoScope } from "./repo-scope.mjs";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 900;
const DEFAULT_CHAT_PATH = "/v1/chat/completions";
const DEFAULT_HARNESS_PATH = "/api/mac/execute";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildMacLaneAdapterError(message, code, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function buildTransportTrace({
  kind,
  endpoint,
  model,
  latencyMs,
  extra = "",
}) {
  const base =
    kind === "harness"
      ? `Mac harness call completed via ${endpoint}.`
      : `Mac remote model call completed via ${endpoint} using ${model}.`;
  const content = [base, String(extra || "").trim()].filter(Boolean).join(" ");

  return {
    type: "execution_action",
    content,
    verified: false,
    metrics: {
      latency_ms: Number(latencyMs) || 0,
      tokens_in: 0,
      tokens_out: 0,
    },
  };
}

function extractHarnessErrorMessage(data, fallbackStatus) {
  if (typeof data?.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  if (typeof data?.error === "string" && data.error.trim()) {
    return data.error.trim();
  }
  return `Mac lane request failed with ${fallbackStatus}.`;
}

function normalizeHarnessResponse(data, { endpoint, model, latencyMs, transport }) {
  const upstreamTraces = Array.isArray(data?.trace_events)
    ? data.trace_events
    : Array.isArray(data?.traceEvents)
      ? data.traceEvents
      : [];

  return {
    ...data,
    elapsedMs: latencyMs,
    trace_events: [
      buildTransportTrace({
        kind: transport,
        endpoint,
        model,
        latencyMs,
        extra: upstreamTraces.length ? "Remote harness returned execution traces." : "",
      }),
      ...upstreamTraces,
    ],
  };
}

export class MacLaneAdapter {
  constructor({
    endpoint = process.env.AGRO_MAC_ENDPOINT || "",
    model = process.env.AGRO_MAC_MODEL || "",
    transport = process.env.AGRO_MAC_TRANSPORT || "openai_chat",
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

  async execute({ prompt, sharedInstruction = "", session = null, operatorMode = "send_mac" }) {
    if (!this.endpoint || !this.model) {
      throw buildMacLaneAdapterError(
        "Mac lane is not configured. Set a Mac endpoint and model before using the execution lane.",
        "MAC_CONFIG_REQUIRED"
      );
    }

    if (typeof this.fetchImpl !== "function") {
      throw buildMacLaneAdapterError(
        "Mac lane transport is unavailable because no fetch implementation is configured.",
        "MAC_FETCH_UNAVAILABLE"
      );
    }

    if (this.transport === "harness") {
      return this.#executeHarness({ prompt, sharedInstruction, session, operatorMode });
    }

    return this.#executeOpenAiChat({ prompt, sharedInstruction, operatorMode });
  }

  async describeRepoContext({ repo, session = null, now } = {}) {
    return inspectRepoScope({
      lane: "mac",
      repo: repo || session?.mission_state?.active_repo,
      repoPaths: this.repoPaths,
      now: now || new Date().toISOString(),
    });
  }

  async #executeOpenAiChat({ prompt, sharedInstruction, operatorMode }) {
    const startedAt = Date.now();
    const repoContext = await this.describeRepoContext({});
    const data = await this.#postJson(`${this.endpoint}${this.chatPath}`, {
      model: this.model,
      messages: [
        {
          role: "system",
          content: buildAgroLanePrompt({
            lane: "mac",
            operatorMode,
            sharedInstruction,
            repoContext,
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

    const latencyMs = Date.now() - startedAt;
    return {
      ...data,
      elapsedMs: latencyMs,
      trace_events: [
        buildTransportTrace({
          kind: "openai_chat",
          endpoint: this.endpoint,
          model: this.model,
          latencyMs,
        }),
      ],
    };
  }

  async #executeHarness({ prompt, sharedInstruction, session, operatorMode }) {
    const startedAt = Date.now();
    const repoContext = await this.describeRepoContext({ session });
    const data = await this.#postJson(`${this.endpoint}${this.harnessPath}`, {
      prompt: String(prompt || ""),
      shared_instruction: buildAgroLanePrompt({
        lane: "mac",
        operatorMode,
        sharedInstruction,
        repoContext,
      }),
      model: this.model,
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

    const latencyMs = Date.now() - startedAt;
    return normalizeHarnessResponse(data, {
      endpoint: this.endpoint,
      model: this.model,
      latencyMs,
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
          data?.code || data?.error_code || (response.status === 409 ? "STALE_SESSION" : "MAC_HTTP_ERROR");
        if (errorCode === "STALE_SESSION") {
          throw buildMacLaneAdapterError(
            "Mac lane session went stale on the remote side. Retry the task or re-establish the Mac harness session.",
            "STALE_SESSION"
          );
        }

        throw buildMacLaneAdapterError(
          extractHarnessErrorMessage(data, response.status),
          errorCode
        );
      }

      return data;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw buildMacLaneAdapterError(
          `Mac lane request timed out after ${this.timeoutMs} ms. Check the Mac endpoint or model availability.`,
          "MAC_TIMEOUT",
          error
        );
      }

      if (error?.code) {
        throw error;
      }

      if (error instanceof TypeError) {
        throw buildMacLaneAdapterError(
          `Mac lane transport is unreachable at ${this.endpoint}. Check Tailscale connectivity and the remote server binding.`,
          "MAC_UNREACHABLE",
          error
        );
      }

      throw buildMacLaneAdapterError(
        `Mac lane request failed: ${error.message}`,
        "MAC_REQUEST_FAILED",
        error
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export { buildMacLaneAdapterError };

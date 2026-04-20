const DEFAULT_MISSION_CONTROL_URL = "http://127.0.0.1:3040"
const DEFAULT_MAC_ENDPOINT = "http://127.0.0.1:1234"
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_COMPARE_PROBE_PROMPT =
  "Return exactly READY if your lane is currently routable for this request. Otherwise return BLOCKED."

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "")
}

function clipText(value, limit = 240) {
  const text = String(value || "").trim().replace(/\s+/g, " ")
  if (!text) {
    return ""
  }
  if (text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit - 1)}…`
}

function parseBooleanFlag(rawValue, defaultValue = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return defaultValue
  }

  const normalized = String(rawValue).trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false
  }
  return defaultValue
}

export function resolveMacModel(payload, fallbackModel = "") {
  const preferred = String(fallbackModel || "").trim()
  if (preferred) {
    return preferred
  }

  if (!payload || typeof payload !== "object") {
    return ""
  }

  const candidates = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : []

  for (const candidate of candidates) {
    const modelId = String(candidate?.id || candidate?.model || "").trim()
    if (modelId) {
      return modelId
    }
  }

  return ""
}

function buildSkippedCheck(label, body, required = false) {
  return {
    label,
    ok: true,
    skipped: true,
    required,
    status: 0,
    body,
  }
}

async function requestJson(fetchImpl, url, { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const rawText = await response.text()
    let parsed = null
    if (rawText) {
      try {
        parsed = JSON.parse(rawText)
      } catch {
        parsed = null
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      text: rawText,
      json: parsed,
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        ok: false,
        status: 0,
        text: `Timed out after ${timeoutMs} ms.`,
        json: null,
      }
    }

    const causeCode = String(error?.cause?.code || "").trim()
    const causeAddress = String(error?.cause?.address || "").trim()
    const causePort = String(error?.cause?.port || "").trim()
    const causeMessage = String(error?.cause?.message || "").trim()
    const connectionTarget =
      causeAddress && causePort ? `${causeAddress}:${causePort}` : causeAddress || causePort
    const detail = [causeCode, connectionTarget, causeMessage].filter(Boolean).join(" ")

    return {
      ok: false,
      status: 0,
      text: detail || error?.message || "Request failed.",
      json: null,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function summarizeModelsResponse(response, modelId) {
  if (!response.json || typeof response.json !== "object") {
    return clipText(response.text || "No JSON body returned.")
  }

  const models = Array.isArray(response.json.data)
    ? response.json.data
    : Array.isArray(response.json.models)
      ? response.json.models
      : []

  return `${models.length} model(s) exposed${modelId ? `; selected ${modelId}` : ""}.`
}

function extractVisibleText(raw) {
  if (typeof raw === "string") {
    return raw.trim()
  }

  if (Array.isArray(raw)) {
    return raw
      .map((item) => extractVisibleText(item))
      .filter(Boolean)
      .join("\n")
      .trim()
  }

  if (!raw || typeof raw !== "object") {
    return ""
  }

  const candidates = [
    raw.content,
    raw.text,
    raw.output_text,
    raw.reply,
    raw.message?.content,
    raw.choices?.[0]?.message?.content,
  ]

  for (const candidate of candidates) {
    const text = extractVisibleText(candidate)
    if (text) {
      return text
    }
  }

  return ""
}

function summarizeChatResponse(response) {
  if (!response.json || typeof response.json !== "object") {
    return clipText(response.text || "No JSON body returned.")
  }

  const reply = extractVisibleText(response.json)
  return reply ? `Reply: ${clipText(reply)}` : "Chat call returned no visible text."
}

function summarizeSendMacResponse(response) {
  if (!response.json || typeof response.json !== "object") {
    return clipText(response.text || "No JSON body returned.")
  }

  const content = clipText(response.json.mac_result?.content || response.json.message || "")
  if (!content) {
    return "send-mac returned no Mac result content."
  }
  return `mac_result.content=${content}`
}

function summarizeSendPcResponse(response) {
  if (!response.json || typeof response.json !== "object") {
    return clipText(response.text || "No JSON body returned.")
  }

  const content = clipText(response.json.pc_result?.content || response.json.message || "")
  if (!content) {
    return "send-pc returned no PC result content."
  }
  return `pc_result.content=${content}`
}

function summarizeCompareResponse(response) {
  if (!response.json || typeof response.json !== "object") {
    return clipText(response.text || "No JSON body returned.")
  }

  const mac = clipText(response.json.mac_result?.content || "")
  const pc = clipText(response.json.pc_result?.content || "")
  const arbitration = clipText(response.json.arbitration?.reason_code || response.json.message || "")

  return [
    mac ? `mac=${mac}` : "",
    pc ? `pc=${pc}` : "",
    arbitration ? `arbitration=${arbitration}` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

async function runCheck(fetchImpl, label, url, options, summarize, required = true) {
  const response = await requestJson(fetchImpl, url, options)
  return {
    label,
    ok: response.ok,
    skipped: false,
    required,
    status: response.status,
    body: summarize(response),
  }
}

export async function runMacCheckSuite({
  fetchImpl = globalThis.fetch,
  missionControlUrl = DEFAULT_MISSION_CONTROL_URL,
  macEndpoint = DEFAULT_MAC_ENDPOINT,
  macModel = "",
  includeSendPc = false,
  includeCompare = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required to run the Mac live checks.")
  }

  const baseMissionControlUrl = trimTrailingSlash(missionControlUrl || DEFAULT_MISSION_CONTROL_URL)
  const baseMacEndpoint = trimTrailingSlash(macEndpoint || DEFAULT_MAC_ENDPOINT)
  const checks = []

  const statusCheck = await runCheck(
    fetchImpl,
    "mission-control-status",
    `${baseMissionControlUrl}/api/status`,
    { timeoutMs },
    (response) => clipText(response.text || `HTTP ${response.status}`)
  )
  checks.push(statusCheck)

  const modelsResponse = await requestJson(fetchImpl, `${baseMacEndpoint}/v1/models`, { timeoutMs })
  const resolvedModel = resolveMacModel(modelsResponse.json, macModel)
  checks.push({
    label: "mac-models",
    ok: modelsResponse.ok,
    skipped: false,
    required: true,
    status: modelsResponse.status,
    body: summarizeModelsResponse(modelsResponse, resolvedModel),
  })

  if (resolvedModel) {
    checks.push(
      await runCheck(
        fetchImpl,
        "mac-chat",
        `${baseMacEndpoint}/v1/chat/completions`,
        {
          method: "POST",
          timeoutMs,
          body: {
            model: resolvedModel,
            messages: [
              {
                role: "user",
                content: "Say only: ready",
              },
            ],
            temperature: 0,
            max_tokens: 8,
            stream: false,
          },
        },
        summarizeChatResponse
      )
    )
  } else {
    checks.push(buildSkippedCheck("mac-chat", "Skipped because no Mac model could be resolved."))
  }

  checks.push(
    await runCheck(
      fetchImpl,
      "send-mac-route",
      `${baseMissionControlUrl}/api/routes/send-mac`,
      {
        method: "POST",
        timeoutMs,
        body: {
          prompt: "State whether the Mac execution lane is healthy. Keep the reply short and concrete.",
        },
      },
      summarizeSendMacResponse
    )
  )

  if (includeSendPc) {
    checks.push(
      await runCheck(
        fetchImpl,
        "send-pc-route",
        `${baseMissionControlUrl}/api/routes/send-pc`,
        {
          method: "POST",
          timeoutMs,
          body: {
            prompt: "Reply with exactly READY if the local reviewer route is functioning.",
          },
        },
        summarizeSendPcResponse,
        false
      )
    )
  } else {
    checks.push(buildSkippedCheck("send-pc-route", "Skipped because --include-send-pc was not requested.", false))
  }

  if (includeCompare) {
    checks.push(
      await runCheck(
        fetchImpl,
        "compare-route",
        `${baseMissionControlUrl}/api/routes/compare`,
        {
          method: "POST",
          timeoutMs,
          body: {
            prompt: DEFAULT_COMPARE_PROBE_PROMPT,
            operational_probe: true,
          },
        },
        summarizeCompareResponse,
        false
      )
    )
  } else {
    checks.push(buildSkippedCheck("compare-route", "Skipped because --include-compare was not requested.", false))
  }

  const blockingFailures = checks.filter((check) => !check.skipped && !check.ok && check.required)
  const optionalFailures = checks.filter((check) => !check.skipped && !check.ok && !check.required)

  return {
    ok: blockingFailures.length === 0 && optionalFailures.length === 0,
    blocking_failure_count: blockingFailures.length,
    optional_failure_count: optionalFailures.length,
    resolved_model: resolvedModel,
    mission_control_url: baseMissionControlUrl,
    mac_endpoint: baseMacEndpoint,
    checks,
  }
}

export function parseCliArgs(argv = [], env = process.env) {
  const args = Array.from(argv)
  const config = {
    missionControlUrl: String(env.AGRO_MISSION_CONTROL_URL || DEFAULT_MISSION_CONTROL_URL),
    macEndpoint: String(env.AGRO_MAC_ENDPOINT || DEFAULT_MAC_ENDPOINT),
    macModel: String(env.AGRO_MAC_MODEL || ""),
    includeSendPc: parseBooleanFlag(env.AGRO_CHECK_INCLUDE_SEND_PC, false),
    includeCompare: parseBooleanFlag(env.AGRO_CHECK_INCLUDE_COMPARE, false),
    timeoutMs: Number(env.AGRO_CHECK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    format: "json",
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    if (arg === "--mission-control-url" && next) {
      config.missionControlUrl = next
      index += 1
      continue
    }
    if (arg === "--mac-endpoint" && next) {
      config.macEndpoint = next
      index += 1
      continue
    }
    if (arg === "--mac-model" && next) {
      config.macModel = next
      index += 1
      continue
    }
    if (arg === "--timeout-ms" && next) {
      config.timeoutMs = Number(next) || DEFAULT_TIMEOUT_MS
      index += 1
      continue
    }
    if (arg === "--include-send-pc") {
      config.includeSendPc = true
      continue
    }
    if (arg === "--include-compare") {
      config.includeCompare = true
      continue
    }
    if (arg === "--text") {
      config.format = "text"
      continue
    }
    if (arg === "--json") {
      config.format = "json"
      continue
    }
  }

  return config
}

export function formatTextReport(report) {
  const lines = [
    `ok=${report.ok ? "true" : "false"}`,
    `mission_control_url=${report.mission_control_url}`,
    `mac_endpoint=${report.mac_endpoint}`,
    `resolved_model=${report.resolved_model || "(none)"}`,
  ]

  for (const check of report.checks || []) {
    const flags = [
      check.required ? "required" : "optional",
      check.skipped ? "skipped" : check.ok ? "ok" : "failed",
    ]
    lines.push(
      `${check.label} [${flags.join(", ")}] status=${check.status}: ${check.body}`
    )
  }

  return `${lines.join("\n")}\n`
}

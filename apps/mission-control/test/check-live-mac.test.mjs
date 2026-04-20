import test from "node:test"
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"

import {
  formatTextReport,
  parseCliArgs,
  resolveMacModel,
  runMacCheckSuite,
} from "../check-live-mac-lib.mjs"

function buildJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  })
}

function buildFetchStub(routes) {
  return async function fetchStub(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase()
    const key = `${method} ${url}`
    const handler = routes.get(key)
    if (!handler) {
      throw new Error(`Unexpected request: ${key}`)
    }
    return handler(url, options)
  }
}

test("resolveMacModel prefers explicit model and otherwise falls back to models payload", () => {
  assert.equal(resolveMacModel({ data: [{ id: "fallback-model" }] }, "preferred-model"), "preferred-model")
  assert.equal(resolveMacModel({ data: [{ id: "fallback-model" }] }, ""), "fallback-model")
  assert.equal(resolveMacModel({}, ""), "")
})

test("runMacCheckSuite reports Mac lane success and skips dual-lane probes by default", async () => {
  const fetchStub = buildFetchStub(
    new Map([
      [
        "GET http://127.0.0.1:3040/api/status",
        () => buildJsonResponse({ ok: true, status: "running" }),
      ],
      [
        "GET http://127.0.0.1:1234/v1/models",
        () => buildJsonResponse({ data: [{ id: "google/gemma-4-26b-a4b" }] }),
      ],
      [
        "POST http://127.0.0.1:1234/v1/chat/completions",
        () =>
          buildJsonResponse({
            choices: [{ message: { content: "ready" } }],
          }),
      ],
      [
        "POST http://127.0.0.1:3040/api/routes/send-mac",
        () =>
          buildJsonResponse({
            ok: true,
            mac_result: {
              content: "READY",
            },
          }),
      ],
    ])
  )

  const report = await runMacCheckSuite({ fetchImpl: fetchStub })

  assert.equal(report.ok, true)
  assert.equal(report.resolved_model, "google/gemma-4-26b-a4b")
  assert.equal(report.checks.find((check) => check.label === "send-pc-route")?.skipped, true)
  assert.equal(report.checks.find((check) => check.label === "compare-route")?.skipped, true)

  const textReport = formatTextReport(report)
  assert.match(textReport, /send-mac-route/)
  assert.match(textReport, /resolved_model=google\/gemma-4-26b-a4b/)
})

test("runMacCheckSuite includes optional dual-lane probes when requested", async () => {
  const fetchStub = buildFetchStub(
    new Map([
      [
        "GET http://127.0.0.1:3040/api/status",
        () => buildJsonResponse({ ok: true }),
      ],
      [
        "GET http://127.0.0.1:1234/v1/models",
        () => buildJsonResponse({ data: [{ id: "google/gemma-4-26b-a4b" }] }),
      ],
      [
        "POST http://127.0.0.1:1234/v1/chat/completions",
        () => buildJsonResponse({ choices: [{ message: { content: "ready" } }] }),
      ],
      [
        "POST http://127.0.0.1:3040/api/routes/send-mac",
        () => buildJsonResponse({ ok: true, mac_result: { content: "READY" } }),
      ],
      [
        "POST http://127.0.0.1:3040/api/routes/send-pc",
        () => buildJsonResponse({ ok: true, pc_result: { content: "READY" } }),
      ],
      [
        "POST http://127.0.0.1:3040/api/routes/compare",
        () =>
          buildJsonResponse({
            ok: true,
            mac_result: { content: "READY" },
            pc_result: { content: "READY" },
            arbitration: { reason_code: "no_material_conflict" },
          }),
      ],
    ])
  )

  const report = await runMacCheckSuite({
    fetchImpl: fetchStub,
    includeSendPc: true,
    includeCompare: true,
  })

  assert.equal(report.ok, true)
  assert.equal(report.checks.find((check) => check.label === "send-pc-route")?.skipped, false)
  assert.match(
    report.checks.find((check) => check.label === "compare-route")?.body || "",
    /arbitration=no_material_conflict/
  )
})

test("runMacCheckSuite fails when the required send-mac route is unhealthy", async () => {
  const fetchStub = buildFetchStub(
    new Map([
      [
        "GET http://127.0.0.1:3040/api/status",
        () => buildJsonResponse({ ok: true }),
      ],
      [
        "GET http://127.0.0.1:1234/v1/models",
        () => buildJsonResponse({ data: [{ id: "google/gemma-4-26b-a4b" }] }),
      ],
      [
        "POST http://127.0.0.1:1234/v1/chat/completions",
        () => buildJsonResponse({ choices: [{ message: { content: "ready" } }] }),
      ],
      [
        "POST http://127.0.0.1:3040/api/routes/send-mac",
        () => buildJsonResponse({ ok: false, message: "Mac lane unavailable." }, 503),
      ],
    ])
  )

  const report = await runMacCheckSuite({ fetchImpl: fetchStub })

  assert.equal(report.ok, false)
  assert.equal(report.blocking_failure_count, 1)
  assert.match(report.checks.find((check) => check.label === "send-mac-route")?.body || "", /Mac lane unavailable/)
})

test("runMacCheckSuite surfaces connection-level fetch details when a local service is down", async () => {
  const fetchStub = async () => {
    const error = new TypeError("fetch failed")
    error.cause = {
      code: "ECONNREFUSED",
      address: "127.0.0.1",
      port: 3040,
      message: "connect ECONNREFUSED 127.0.0.1:3040",
    }
    throw error
  }

  const report = await runMacCheckSuite({ fetchImpl: fetchStub })

  assert.equal(report.ok, false)
  assert.match(report.checks.find((check) => check.label === "mission-control-status")?.body || "", /ECONNREFUSED/)
  assert.match(report.checks.find((check) => check.label === "mission-control-status")?.body || "", /127\.0\.0\.1:3040/)
})

test("runMacCheckSuite falls back to curl when fetch hits EPERM in auto mode", async () => {
  const fetchStub = async () => {
    const error = new TypeError("fetch failed")
    error.cause = {
      code: "EPERM",
      address: "127.0.0.1",
      port: 3040,
      message: "connect EPERM 127.0.0.1:3040",
    }
    throw error
  }

  const execFileStub = async (_file, args, _options, callback) => {
    const bodyPath = args[args.indexOf("-o") + 1]
    await writeFile(bodyPath, JSON.stringify({ ok: true }), "utf8")
    callback(null, "200", "")
  }

  const report = await runMacCheckSuite({
    fetchImpl: fetchStub,
    execFileImpl: execFileStub,
    transport: "auto",
  })

  assert.equal(report.checks.find((check) => check.label === "mission-control-status")?.ok, true)
  assert.equal(report.checks.find((check) => check.label === "mac-models")?.ok, true)
})

test("parseCliArgs honors Mac checker flags", () => {
  const parsed = parseCliArgs([
    "--mission-control-url",
    "http://127.0.0.1:4040",
    "--mac-endpoint",
    "http://127.0.0.1:2234",
    "--mac-model",
    "gemma-test",
    "--include-send-pc",
    "--include-compare",
    "--text",
    "--timeout-ms",
    "9000",
    "--transport",
    "curl",
  ])

  assert.deepEqual(parsed, {
    missionControlUrl: "http://127.0.0.1:4040",
    macEndpoint: "http://127.0.0.1:2234",
    macModel: "gemma-test",
    includeSendPc: true,
    includeCompare: true,
    timeoutMs: 9000,
    format: "text",
    transport: "curl",
  })
})

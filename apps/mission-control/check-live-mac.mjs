#!/usr/bin/env node

import {
  formatTextReport,
  parseCliArgs,
  runMacCheckSuite,
} from "./check-live-mac-lib.mjs"

async function main() {
  const config = parseCliArgs(process.argv.slice(2))
  const report = await runMacCheckSuite({
    missionControlUrl: config.missionControlUrl,
    macEndpoint: config.macEndpoint,
    macModel: config.macModel,
    includeSendPc: config.includeSendPc,
    includeCompare: config.includeCompare,
    timeoutMs: config.timeoutMs,
    transport: config.transport,
  })

  if (config.format === "text") {
    process.stdout.write(formatTextReport(report))
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }

  process.exitCode = report.ok ? 0 : 1
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exitCode = 1
})

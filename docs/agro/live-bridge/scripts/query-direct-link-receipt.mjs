#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function usage() {
  console.error(`Usage:
  node query-direct-link-receipt.mjs \
    --repo-root <path> \
    --target-lane <lane> \
    --message-id <id> \
    [--git-ref <ref>] \
    [--state-path <path>] \
    [--require-non-retryable]`);
}

function parseArgs(argv) {
  const options = {
    repoRoot: "",
    targetLane: "",
    messageId: "",
    gitRef: "",
    statePath: "",
    stateRel: "docs/agro/live-bridge/bridge/direct-link-state.json",
    requireNonRetryable: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--repo-root":
        options.repoRoot = next || "";
        index += 1;
        break;
      case "--target-lane":
        options.targetLane = next || "";
        index += 1;
        break;
      case "--message-id":
        options.messageId = next || "";
        index += 1;
        break;
      case "--git-ref":
        options.gitRef = next || "";
        index += 1;
        break;
      case "--state-path":
        options.statePath = next || "";
        index += 1;
        break;
      case "--require-non-retryable":
        options.requireNonRetryable = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
        process.exit(1);
    }
  }

  return options;
}

function requireArg(value, name) {
  if (!String(value || "").trim()) {
    console.error(`Missing required argument: ${name}`);
    usage();
    process.exit(1);
  }
}

function readState(options) {
  if (options.gitRef) {
    const content = execFileSync(
      "git",
      ["-C", options.repoRoot, "show", `${options.gitRef}:${options.stateRel}`],
      { encoding: "utf8" }
    );
    return JSON.parse(content);
  }

  const statePath = options.statePath || `${options.repoRoot}/docs/agro/live-bridge/bridge/direct-link-state.json`;
  if (!existsSync(statePath)) {
    return {};
  }

  return JSON.parse(readFileSync(statePath, "utf8"));
}

function readLog(options) {
  const logRel = "docs/agro/live-bridge/logs/prompt-delivery.log";

  if (options.gitRef) {
    try {
      return execFileSync(
        "git",
        ["-C", options.repoRoot, "show", `${options.gitRef}:${logRel}`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
    } catch {
      return "";
    }
  }

  const logPath = `${options.repoRoot}/${logRel}`;
  if (!existsSync(logPath)) {
    return "";
  }

  return readFileSync(logPath, "utf8");
}

function buildReceiptKey(targetLane) {
  return targetLane === "mac-codex" ? "receipts_to_mac" : "receipts_to_windows";
}

function buildLastKey(targetLane) {
  return targetLane === "mac-codex" ? "last_delivered_to_mac" : "last_delivered_to_windows";
}

function isRetryable(status) {
  return status === "activation_failed" || status === "deferred";
}

function findRecordInLog(options, logText) {
  if (!String(logText || "").trim()) {
    return null;
  }

  const lines = logText.trim().split(/\r?\n/).reverse();
  const targetNeedle = `-> ${options.targetLane} delivered ${options.messageId} as `;

  for (const line of lines) {
    if (!line.includes(targetNeedle)) {
      continue;
    }

    const match = line.match(/^(\S+)\s+(\S+)\s+->\s+(\S+)\s+delivered\s+(\S+)\s+as\s+(\S+)\s+via\s+(\S+)(?:;\s+notes:\s+(.*))?$/);
    if (!match) {
      continue;
    }

    return {
      delivered_at: match[1],
      source_lane: match[2],
      target_lane: match[3],
      message_id: match[4],
      delivery_status: match[5],
      prompt_file: match[6],
      notes: match[7] || "",
      recorded_from_commit: "",
      recorded_from_branch: "",
    };
  }

  return null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  requireArg(options.repoRoot, "--repo-root");
  requireArg(options.targetLane, "--target-lane");
  requireArg(options.messageId, "--message-id");

  const state = readState(options);
  const receiptKey = buildReceiptKey(options.targetLane);
  const lastKey = buildLastKey(options.targetLane);
  const receipts = state?.[receiptKey] && typeof state[receiptKey] === "object" ? state[receiptKey] : {};
  const fallbackRecord = findRecordInLog(options, readLog(options));
  const lastRecord = state?.[lastKey] && state[lastKey].message_id === options.messageId ? state[lastKey] : null;
  const record = receipts[options.messageId] || lastRecord || fallbackRecord || null;
  const matched = record && record.message_id === options.messageId;
  const retryable = matched ? isRetryable(String(record.delivery_status || "")) : false;

  if (!matched) {
    process.stdout.write(JSON.stringify({ matched: false, retryable: false, record: null }));
    process.exit(1);
  }

  if (options.requireNonRetryable && retryable) {
    process.stdout.write(JSON.stringify({ matched: true, retryable: true, record }));
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({ matched: true, retryable, record }));
}

main();

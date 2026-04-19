#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function usage() {
  console.error(`Usage:
  node record-direct-link-delivery.mjs \
    --repo-root <path> \
    --source-lane <lane> \
    --target-lane <lane> \
    --message-id <id> \
    --delivery-status <status> \
    --prompt-file <name> \
    [--notes <text>] \
    [--branch-name <name>] \
    [--remote-name <name>] \
    [--max-retries <count>] \
    [--dry-run]`);
}

function parseArgs(argv) {
  const result = {
    repoRoot: "",
    sourceLane: "",
    targetLane: "",
    messageId: "",
    deliveryStatus: "",
    promptFile: "",
    notes: "",
    branchName: "codex/mac-codex-first-sync",
    remoteName: "origin",
    maxRetries: 5,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--repo-root":
        result.repoRoot = next || "";
        index += 1;
        break;
      case "--source-lane":
        result.sourceLane = next || "";
        index += 1;
        break;
      case "--target-lane":
        result.targetLane = next || "";
        index += 1;
        break;
      case "--message-id":
        result.messageId = next || "";
        index += 1;
        break;
      case "--delivery-status":
        result.deliveryStatus = next || "";
        index += 1;
        break;
      case "--prompt-file":
        result.promptFile = next || "";
        index += 1;
        break;
      case "--notes":
        result.notes = next || "";
        index += 1;
        break;
      case "--branch-name":
        result.branchName = next || result.branchName;
        index += 1;
        break;
      case "--remote-name":
        result.remoteName = next || result.remoteName;
        index += 1;
        break;
      case "--max-retries":
        result.maxRetries = Number(next || result.maxRetries) || result.maxRetries;
        index += 1;
        break;
      case "--dry-run":
        result.dryRun = true;
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

  return result;
}

function requireArg(value, name) {
  if (!String(value || "").trim()) {
    console.error(`Missing required argument: ${name}`);
    usage();
    process.exit(1);
  }
}

function runGit(repoRoot, args, options = {}) {
  const output = execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function runGitInDir(dir, args, options = {}) {
  const output = execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function isoTimestamp() {
  return new Date().toISOString().replace(".000Z", "Z");
}

function buildStateKey(targetLane) {
  return targetLane === "mac-codex" ? "last_delivered_to_mac" : "last_delivered_to_windows";
}

function readJson(filePath, fallbackValue) {
  if (!existsSync(filePath)) {
    return fallbackValue;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeBridgeArtifacts(worktreePath, options) {
  const statePath = path.join(worktreePath, "docs/agro/live-bridge/bridge/direct-link-state.json");
  const logPath = path.join(worktreePath, "docs/agro/live-bridge/logs/prompt-delivery.log");
  const currentState = readJson(statePath, {
    updated_at: "",
    last_delivered_to_mac: null,
    last_delivered_to_windows: null,
  });

  const stateKey = buildStateKey(options.targetLane);
  const record = {
    message_id: options.messageId,
    source_lane: options.sourceLane,
    target_lane: options.targetLane,
    delivery_status: options.deliveryStatus,
    prompt_file: options.promptFile,
    notes: options.notes || "",
    delivered_at: options.timestamp,
    recorded_from_commit: options.commitSha,
    recorded_from_branch: options.branchName,
  };

  const previous = currentState[stateKey];
  const unchanged =
    previous &&
    previous.message_id === record.message_id &&
    previous.delivery_status === record.delivery_status &&
    previous.prompt_file === record.prompt_file;

  if (unchanged) {
    return false;
  }

  currentState.updated_at = options.timestamp;
  currentState[stateKey] = record;
  writeFileSync(statePath, `${JSON.stringify(currentState, null, 2)}\n`);

  const noteSuffix = record.notes ? `; notes: ${record.notes}` : "";
  appendFileSync(
    logPath,
    `${options.timestamp} ${options.sourceLane} -> ${options.targetLane} delivered ${options.messageId} as ${options.deliveryStatus} via ${options.promptFile}${noteSuffix}\n`
  );

  return true;
}

function cleanupWorktree(repoRoot, worktreePath) {
  try {
    runGit(repoRoot, ["worktree", "remove", "--force", worktreePath]);
  } catch {
    rmSync(worktreePath, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  requireArg(options.repoRoot, "--repo-root");
  requireArg(options.sourceLane, "--source-lane");
  requireArg(options.targetLane, "--target-lane");
  requireArg(options.messageId, "--message-id");
  requireArg(options.deliveryStatus, "--delivery-status");
  requireArg(options.promptFile, "--prompt-file");

  const timestamp = isoTimestamp();
  const commitSha = runGit(options.repoRoot, ["rev-parse", "--short", "HEAD"]);
  const branchName = runGit(options.repoRoot, ["branch", "--show-current"]);
  const remoteRef = `${options.remoteName}/${options.branchName}`;

  if (options.dryRun) {
    runGit(options.repoRoot, ["fetch", options.remoteName, options.branchName], { stdio: ["ignore", "ignore", "pipe"] });
    const tempDir = mkdtempSync(path.join(tmpdir(), "agro-delivery-dryrun-"));
    try {
      runGit(options.repoRoot, ["worktree", "add", "--detach", tempDir, remoteRef], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      const changed = writeBridgeArtifacts(tempDir, {
        ...options,
        timestamp,
        commitSha,
        branchName,
      });
      if (!changed) {
        console.log("No receipt change needed.");
        return;
      }
      console.log(readFileSync(path.join(tempDir, "docs/agro/live-bridge/bridge/direct-link-state.json"), "utf8"));
      console.log("--- prompt-delivery.log ---");
      console.log(readFileSync(path.join(tempDir, "docs/agro/live-bridge/logs/prompt-delivery.log"), "utf8"));
      return;
    } finally {
      cleanupWorktree(options.repoRoot, tempDir);
    }
  }

  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    runGit(options.repoRoot, ["fetch", options.remoteName, options.branchName], { stdio: ["ignore", "ignore", "pipe"] });
    const tempDir = mkdtempSync(path.join(tmpdir(), "agro-delivery-"));

    try {
      runGit(options.repoRoot, ["worktree", "add", "--detach", tempDir, remoteRef], {
        stdio: ["ignore", "ignore", "pipe"],
      });

      const changed = writeBridgeArtifacts(tempDir, {
        ...options,
        timestamp,
        commitSha,
        branchName,
      });

      if (!changed) {
        cleanupWorktree(options.repoRoot, tempDir);
        console.log(`Receipt for ${options.messageId} already recorded.`);
        return;
      }

      runGitInDir(tempDir, [
        "add",
        "docs/agro/live-bridge/bridge/direct-link-state.json",
        "docs/agro/live-bridge/logs/prompt-delivery.log",
      ]);
      runGitInDir(tempDir, [
        "commit",
        "-m",
        `Record direct-link delivery ${options.sourceLane} -> ${options.targetLane}: ${options.messageId}`,
      ], { stdio: ["ignore", "ignore", "pipe"] });
      runGitInDir(tempDir, ["push", options.remoteName, `HEAD:${options.branchName}`], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      cleanupWorktree(options.repoRoot, tempDir);
      console.log(`Recorded delivery receipt for ${options.messageId}.`);
      return;
    } catch (error) {
      cleanupWorktree(options.repoRoot, tempDir);
      if (attempt >= options.maxRetries) {
        throw error;
      }
    }
  }
}

main();

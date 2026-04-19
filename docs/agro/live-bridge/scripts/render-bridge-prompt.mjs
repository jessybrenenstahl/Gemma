#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function usage() {
  console.error(`Usage:
  node render-bridge-prompt.mjs \
    --repo-root <path> \
    --inbox-path <path> \
    --state-path <path> \
    --outbox-path <path> \
    [--git-ref <ref>]`);
}

function parseArgs(argv) {
  const result = {
    repoRoot: "",
    gitRef: "",
    inboxPath: "",
    statePath: "",
    outboxPath: "",
    inboxRel: "docs/agro/live-bridge/bridge/inbox.md",
    stateRel: "docs/agro/live-bridge/bridge/state.json",
    loopSkill: "codex-host-handoff-loop",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--repo-root":
        result.repoRoot = next || "";
        index += 1;
        break;
      case "--git-ref":
        result.gitRef = next || "";
        index += 1;
        break;
      case "--inbox-path":
        result.inboxPath = next || "";
        index += 1;
        break;
      case "--state-path":
        result.statePath = next || "";
        index += 1;
        break;
      case "--outbox-path":
        result.outboxPath = next || "";
        index += 1;
        break;
      case "--inbox-rel":
        result.inboxRel = next || result.inboxRel;
        index += 1;
        break;
      case "--state-rel":
        result.stateRel = next || result.stateRel;
        index += 1;
        break;
      case "--loop-skill":
        result.loopSkill = next || result.loopSkill;
        index += 1;
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

function readStateJson(options) {
  if (options.gitRef) {
    const content = execFileSync(
      "git",
      ["-C", options.repoRoot, "show", `${options.gitRef}:${options.stateRel}`],
      { encoding: "utf8" }
    );
    return JSON.parse(content);
  }

  if (!existsSync(options.statePath)) {
    console.error(`Required bridge file not found: ${options.statePath}`);
    process.exit(1);
  }

  return JSON.parse(readFileSync(options.statePath, "utf8"));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  requireArg(options.repoRoot, "--repo-root");
  requireArg(options.inboxPath, "--inbox-path");
  requireArg(options.statePath, "--state-path");
  requireArg(options.outboxPath, "--outbox-path");

  const state = readStateJson(options);
  const messageId = String(state.message_id || "unknown-message");
  const nextStep = String(state.next_step || "Read the inbox and continue.");

  const readBlock = options.gitRef
    ? [
        `Read from git ref \`${options.gitRef}\`:`,
        `- ${options.inboxRel}`,
        `- ${options.stateRel}`,
        "",
        "Acknowledge in repo bridge files:",
        `- ${options.outboxPath}`,
        `- ${options.statePath}`,
        "",
        `If your working tree is behind, inspect via \`git show ${options.gitRef}:<path>\` or fast-forward before acknowledging.`,
      ].join("\n")
    : [
        "Read:",
        `- ${options.inboxPath}`,
        `- ${options.statePath}`,
        "",
        "Acknowledge in:",
        `- ${options.outboxPath}`,
        `- ${options.statePath}`,
      ].join("\n");

  const prompt = [
    `Use $${options.loopSkill}.`,
    "",
    readBlock,
    "",
    `Current message id: ${messageId}`,
    `Immediate next step: ${nextStep}`,
    "",
    "After acknowledging, continue the live bridge task from the inbox.",
  ].join("\n");

  process.stdout.write(prompt);
}

main();

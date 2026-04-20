#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function usage() {
  console.error(`Usage:
  node check-wc-activity.mjs \
    --repo-root <path> \
    [--git-ref <ref>] \
    [--remote-name <name>] \
    [--branch-name <name>] \
    [--state-file <path>] \
    [--inbox-dir <path>] \
    [--watcher-log <path>]`);
}

function parseArgs(argv) {
  const homeDir = os.homedir();
  const options = {
    repoRoot: "",
    gitRef: "origin/codex/mac-codex-first-sync",
    remoteName: "origin",
    branchName: "codex/mac-codex-first-sync",
    bridgeStateRel: "docs/agro/live-bridge/bridge/state.json",
    bridgeInboxRel: "docs/agro/live-bridge/bridge/inbox.md",
    inboxDir: path.join(homeDir, "codex-composer-bridge", "inbox"),
    watcherLog: path.join(
      homeDir,
      "Library/Application Support/agro-live-bridge/watch-prompts-from-windows-codex.log"
    ),
    stateFile: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--repo-root":
        options.repoRoot = next || "";
        index += 1;
        break;
      case "--git-ref":
        options.gitRef = next || options.gitRef;
        index += 1;
        break;
      case "--remote-name":
        options.remoteName = next || options.remoteName;
        index += 1;
        break;
      case "--branch-name":
        options.branchName = next || options.branchName;
        index += 1;
        break;
      case "--state-file":
        options.stateFile = next || "";
        index += 1;
        break;
      case "--inbox-dir":
        options.inboxDir = next || options.inboxDir;
        index += 1;
        break;
      case "--watcher-log":
        options.watcherLog = next || options.watcherLog;
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

  return options;
}

function requireArg(value, name) {
  if (!String(value || "").trim()) {
    console.error(`Missing required argument: ${name}`);
    usage();
    process.exit(1);
  }
}

function safeReadJson(filePath, fallbackValue) {
  if (!existsSync(filePath)) {
    return fallbackValue;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function safeWriteJson(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function runGit(repoRoot, args, options = {}) {
  const output = execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });

  return typeof output === "string" ? output.trim() : "";
}

function tryFetch(repoRoot, remoteName, branchName) {
  try {
    runGit(repoRoot, ["fetch", remoteName, branchName], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return { ok: true, message: "fetch ok" };
  } catch (error) {
    const message = String(error?.stderr || error?.message || "").trim() || "fetch failed";
    return { ok: false, message };
  }
}

function readGitJson(repoRoot, gitRef, relativePath) {
  const content = runGit(repoRoot, ["show", `${gitRef}:${relativePath}`]);
  return JSON.parse(content);
}

function readGitText(repoRoot, gitRef, relativePath) {
  return runGit(repoRoot, ["show", `${gitRef}:${relativePath}`]);
}

function newestInboxPrompt(inboxDir) {
  if (!existsSync(inboxDir)) {
    return null;
  }

  const entries = execFileSync(
    "find",
    [inboxDir, "-maxdepth", "1", "-type", "f", "-name", "codex-prompt-from-windows-codex-*", "-print"],
    { encoding: "utf8" }
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!entries.length) {
    return null;
  }

  const withTimes = entries.map((filePath) => {
    const stat = execFileSync("stat", ["-f", "%m", filePath], { encoding: "utf8" }).trim();
    return {
      filePath,
      fileName: path.basename(filePath),
      mtime: Number(stat) || 0,
    };
  });

  withTimes.sort((left, right) => right.mtime - left.mtime || right.fileName.localeCompare(left.fileName));
  return withTimes[0];
}

function latestWatcherEvent(logPath) {
  if (!existsSync(logPath)) {
    return null;
  }

  const lines = readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const relevant = lines.filter((line) =>
    /codex-prompt-from-windows-codex-/.test(line) &&
    /(Delivered|Skipped stale prompt|Skipped duplicate prompt|Loaded)/.test(line)
  );

  if (!relevant.length) {
    return null;
  }

  const line = relevant[relevant.length - 1];
  const fileMatch = line.match(/(codex-prompt-from-windows-codex-[^ ]+\.md(?: \(\d+\)\.md)?)/);
  return {
    line,
    fileName: fileMatch ? fileMatch[1] : "",
  };
}

function bridgeActivity(bridgeState, bridgeInbox) {
  if (!bridgeState || bridgeState.owner !== "mac-codex") {
    return null;
  }

  const messageId = String(bridgeState.message_id || "").trim();
  if (!messageId || !messageId.startsWith("windows-")) {
    return null;
  }

  const subjectMatch = String(bridgeInbox || "").match(/## Subject\s+([\s\S]*?)\n## /);
  const subject = subjectMatch ? subjectMatch[1].trim().replace(/\s+/g, " ") : "";

  return {
    messageId,
    updatedAt: String(bridgeState.updated_at || ""),
    commit: String(bridgeState.commit || ""),
    subject,
    fingerprint: `bridge:${messageId}:${bridgeState.updated_at || ""}:${bridgeState.commit || ""}`,
  };
}

function loadMonitorState(stateFile) {
  return safeReadJson(stateFile, {
    bridgeFingerprint: "",
    inboxFingerprint: "",
    logFingerprint: "",
    updatedAt: "",
  });
}

function saveMonitorState(stateFile, state) {
  safeWriteJson(stateFile, {
    bridgeFingerprint: state.bridgeFingerprint || "",
    inboxFingerprint: state.inboxFingerprint || "",
    logFingerprint: state.logFingerprint || "",
    updatedAt: new Date().toISOString(),
  });
}

function buildChangeRecord(kind, detail) {
  return {
    kind,
    ...detail,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  requireArg(options.repoRoot, "--repo-root");

  if (!options.stateFile) {
    options.stateFile = path.join(
      options.repoRoot,
      "apps/mission-control/.data/live-bridge/watch-wc-prompt-state.json"
    );
  }

  const fetchStatus = tryFetch(options.repoRoot, options.remoteName, options.branchName);
  const priorState = loadMonitorState(options.stateFile);

  let bridgeState = null;
  let bridgeInbox = "";
  try {
    bridgeState = readGitJson(options.repoRoot, options.gitRef, options.bridgeStateRel);
    bridgeInbox = readGitText(options.repoRoot, options.gitRef, options.bridgeInboxRel);
  } catch (error) {
    const output = {
      changed: false,
      quiet_reason: `Bridge ref unreadable: ${String(error?.message || error)}`,
      fetch: fetchStatus,
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exit(0);
  }

  const bridge = bridgeActivity(bridgeState, bridgeInbox);
  const inbox = newestInboxPrompt(options.inboxDir);
  const logEvent = latestWatcherEvent(options.watcherLog);

  const currentState = {
    bridgeFingerprint: bridge ? bridge.fingerprint : "",
    inboxFingerprint: inbox ? `inbox:${inbox.fileName}:${inbox.mtime}` : "",
    logFingerprint: logEvent ? `log:${logEvent.line}` : "",
  };

  const changes = [];

  if (bridge && bridge.fingerprint !== priorState.bridgeFingerprint) {
    changes.push(
      buildChangeRecord("bridge_message", {
        message_id: bridge.messageId,
        updated_at: bridge.updatedAt,
        commit: bridge.commit,
        subject: bridge.subject,
      })
    );
  }

  if (inbox && currentState.inboxFingerprint !== priorState.inboxFingerprint) {
    changes.push(
      buildChangeRecord("prompt_file_arrived", {
        filename: inbox.fileName,
        mtime_epoch: inbox.mtime,
      })
    );
  }

  if (logEvent && currentState.logFingerprint !== priorState.logFingerprint) {
    changes.push(
      buildChangeRecord("watcher_log_event", {
        filename: logEvent.fileName,
        line: logEvent.line,
      })
    );
  }

  saveMonitorState(options.stateFile, currentState);

  const output = {
    changed: changes.length > 0,
    changes,
    fetch: fetchStatus,
    current: {
      bridge_message_id: bridge?.messageId || "",
      inbox_filename: inbox?.fileName || "",
      watcher_filename: logEvent?.fileName || "",
    },
    quiet_reason:
      changes.length > 0
        ? ""
        : "No new windows-codex activity since the last recorded heartbeat check.",
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();

import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { AgroSessionManager } from "../../../packages/agro-shared/src/index.mjs";
import { compareLaneAnswerSimilarity, evaluateConflictArbitration } from "./conflict-arbitration.mjs";
import { GitHubTooling } from "./github-tooling.mjs";
import { FileBackedLaneConfigStore } from "./lane-config-store.mjs";
import { normalizeLaneExecutionResult } from "./lane-result-normalizer.mjs";
import { MacLaneAdapter } from "./mac-lane-adapter.mjs";
import { MacConfirmationGatePipeline } from "./mac-confirmation-gate-pipeline.mjs";
import { MacVerificationPipeline } from "./mac-verification-pipeline.mjs";
import { PcLaneAdapter } from "./pc-lane-adapter.mjs";
import { PcCritiquePromotionPipeline } from "./pc-critique-promotion-pipeline.mjs";
import { isRepoScopeBlocking } from "./repo-scope.mjs";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LIVE_RECOVERY_DIR = path.resolve(__dirname, "..", ".data", "live-recovery");
const DEFAULT_TAILDROP_INBOX_DIR = path.resolve(__dirname, "..", ".data", "taildrop-inbox");
const DEFAULT_LANE_CONFIG_PATH = path.resolve(__dirname, "..", ".data", "lane-config.json");
const DEFAULT_LANE_CONFIG_DIR = path.resolve(__dirname, "..", ".data", "lane-config");
const DEFAULT_ARTIFACTS_DIR = path.resolve(__dirname, "..", "..", "..", "artifacts");
const DEFAULT_SEND_MAC_ACTION_PACK_SCRIPT = path.resolve(__dirname, "..", "send-mac-action-pack.ps1");
const DEFAULT_SEND_MAC_FALLBACK_SCRIPT = path.resolve(__dirname, "..", "send-mac-fallback-block.ps1");
const DEFAULT_SEND_MAC_REPO_FALLBACK_SCRIPT = path.resolve(
  __dirname,
  "..",
  "send-mac-repo-fallback-block.ps1"
);
const DEFAULT_SEND_MAC_REPO_MANUAL_SCRIPT = path.resolve(
  __dirname,
  "..",
  "send-mac-repo-manual-block.ps1"
);
const DEFAULT_SEND_MAC_REPO_REPORT_REQUEST_SCRIPT = path.resolve(
  __dirname,
  "..",
  "send-mac-repo-report-request.ps1"
);
const DEFAULT_SEND_MAC_REPO_NUDGE_SCRIPT = path.resolve(
  __dirname,
  "..",
  "send-mac-repo-nudge.ps1"
);
const DEFAULT_START_MAC_REPO_REPORT_WATCHER_SCRIPT = path.resolve(
  __dirname,
  "..",
  "start-mac-repo-report-watcher.ps1"
);
const DEFAULT_PULL_TAILDROP_SCRIPT = path.resolve(__dirname, "..", "pull-taildrop-inbox.ps1");
const DEFAULT_MAC_REPO_MANUAL_PREFERRED_ATTEMPTS = 6;
const DEFAULT_MAC_REPO_CLIPBOARD_PROBE_STALE_MS = 5 * 60 * 1000;
const DEFAULT_MAC_REPO_RETURN_TARGETS = [
  "jessy",
  "Jessy",
  "jessy.tail972f90.ts.net",
  "jessy.tail972f90.ts.net.",
  "100.113.117.95",
];
const SENSITIVE_TEXT_REDACTION_RULES = [
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
];
const DEFAULT_DOWNLOADS_DIR = path.resolve(
  process.env.USERPROFILE || process.env.HOME || path.resolve(__dirname, ".."),
  "Downloads"
);
const execFileAsync = promisify(execFile);

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function resolveContentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function summarizeSessionListItem(session) {
  return {
    session_id: session.session_id,
    status: session.status,
    mission_goal: session.mission_state.mission_goal,
    operator_mode: session.mission_state.operator_mode,
    active_repo: session.mission_state.active_repo,
    arbitration_state: session.mission_state.arbitration_state,
    active_risk_count: session.mission_state.active_risk_count,
    updated_at: session.updated_at,
    latest_compare_card_id: session.derived?.latest_compare_card_id || null,
    transcript_counts: session.derived?.transcript_counts || {
      shared: 0,
      mac: 0,
      pc: 0,
    },
  };
}

function summarizePrompt(prompt, sharedInstruction) {
  if (!sharedInstruction) {
    return prompt;
  }

  return `${prompt}\n\nShared framing:\n${sharedInstruction}`;
}

function buildLiveRecoverySummary(summary, summaryStat) {
  if (!summary) {
    return {
      status: "unavailable",
      tone: "offline",
      message: "No live-recovery summary has been written yet.",
      updated_at: null,
      mac_probes: [],
      ssh_bridge: null,
      ssh_repair: null,
    };
  }

  const macProbes = Array.isArray(summary.last_health)
    ? summary.last_health.filter((entry) => String(entry.label || "").startsWith("mac-models-"))
    : [];
  const sshBridge =
    summary.ssh_bridge ||
    (Array.isArray(summary.last_health)
      ? summary.last_health.find((entry) => String(entry.label || "").startsWith("mac-ssh-")) || null
      : null);
  const sshRepair = summary.ssh_repair || null;

  if (summary.recovered_at) {
    return {
      status: "recovered",
      tone: "online",
      message: "A healthy Mac endpoint was detected and dual-lane verification completed.",
      updated_at: summary.recovered_at,
      mac_probes: macProbes,
      ssh_bridge: sshBridge,
      ssh_repair: sshRepair,
    };
  }

  if (summary.status === "exhausted") {
    return {
      status: "exhausted",
      tone: "danger",
      message:
        summary.message || "The latest recovery run exhausted its attempts without a healthy Mac endpoint.",
      updated_at:
        summary.last_checked_at || summaryStat?.mtime?.toISOString?.() || null,
      mac_probes: macProbes,
      ssh_bridge: sshBridge,
      ssh_repair: sshRepair,
    };
  }

  return {
    status: "waiting",
    tone: "warn",
    message:
      summary.message || "No healthy Mac endpoint was found during the latest recovery attempt.",
    updated_at:
      summary.last_checked_at || summaryStat?.mtime?.toISOString?.() || null,
    mac_probes: macProbes,
    ssh_bridge: sshBridge,
    ssh_repair: sshRepair,
  };
}

function redactSensitiveText(text) {
  let sanitizedText = String(text || "");
  let redactionCount = 0;

  for (const rule of SENSITIVE_TEXT_REDACTION_RULES) {
    sanitizedText = sanitizedText.replace(rule.pattern, (match) => {
      redactionCount += 1;
      return rule.replacement;
    });
  }

  return {
    text: sanitizedText,
    redaction_count: redactionCount,
  };
}

function redactSensitiveOutputLines(lines) {
  if (Array.isArray(lines)) {
    return lines.map((line) => redactSensitiveText(line).text);
  }

  return redactSensitiveText(lines).text;
}

async function findLatestMatchingFile(
  dirEntries,
  pattern = /^agro-mac-ssh-bridge-report.*\.txt$/i
) {
  const candidates = [];

  for (const entry of dirEntries) {
    if (!entry?.dirPath) {
      continue;
    }

    try {
      const names = await readdir(entry.dirPath);
      const matches = names.filter((name) => pattern.test(name));
      const fileEntries = await Promise.all(
        matches.map(async (name) => {
          const filePath = path.join(entry.dirPath, name);
          const fileStat = await stat(filePath);
          return {
            source: entry.source,
            filePath,
            name,
            fileStat,
          };
        })
      );
      candidates.push(...fileEntries.filter((candidate) => candidate.fileStat.isFile()));
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  if (!candidates.length) {
    return {
      data: "",
      stat: null,
      path: null,
      name: null,
      source: null,
    };
  }

  candidates.sort((left, right) => right.fileStat.mtimeMs - left.fileStat.mtimeMs);
  const latest = candidates[0];
  const raw = await readFile(latest.filePath, "utf8");

  return {
    data: raw,
    stat: latest.fileStat,
    path: latest.filePath,
    name: latest.name,
    source: latest.source,
  };
}

function parseMacBridgeReport(reportText, reportMeta) {
  if (!String(reportText || "").trim()) {
    return null;
  }

  const text = String(reportText || "");
  const missingEntries = Array.from(text.matchAll(/^MISSING:\s+(.+)$/gm), (match) => match[1].trim());
  const user = text.match(/^USER=(.+)$/m)?.[1]?.trim() || null;
  const host = text.match(/^HOST=(.+)$/m)?.[1]?.trim() || null;
  const keyMissing = /MISSING:\s+agro-mac-bridge/m.test(text);
  const keyPresent = !keyMissing && /agro-mac-bridge/m.test(text);
  const sshDirMissing = missingEntries.some((entry) => /(?:^|[\\/])\.ssh$/i.test(entry));
  const authorizedKeysMissing = missingEntries.some((entry) => /authorized_keys$/i.test(entry));

  const summaryParts = [];
  if (user) {
    summaryParts.push(`user ${user}`);
  }
  if (host) {
    summaryParts.push(`host ${host}`);
  }
  if (keyPresent) {
    summaryParts.push("bridge key present");
  } else if (keyMissing) {
    summaryParts.push("bridge key missing");
  }
  if (authorizedKeysMissing) {
    summaryParts.push("authorized_keys missing");
  }
  if (sshDirMissing) {
    summaryParts.push(".ssh missing");
  }

  return {
    path: reportMeta?.path || null,
    name: reportMeta?.name || null,
    source: reportMeta?.source || null,
    updated_at: reportMeta?.stat?.mtime?.toISOString?.() || null,
    user,
    host,
    key_present: keyPresent,
    key_missing: keyMissing,
    ssh_dir_missing: sshDirMissing,
    authorized_keys_missing: authorizedKeysMissing,
    missing_entries: missingEntries,
    summary:
      summaryParts.join(" | ") ||
      "Mac SSH bridge report received, but it did not include any actionable fields.",
    raw_excerpt: redactSensitiveOutputLines(summarizeWatcherOutput(text, 10)),
  };
}

function parseMacRepoPathReport(reportText, reportMeta) {
  if (!String(reportText || "").trim()) {
    return null;
  }

  const text = String(reportText || "");
  const user =
    text.match(/^USER=(.+)$/m)?.[1]?.trim() ||
    text.match(/^\s*user\s*[:=]\s*(.+)$/im)?.[1]?.trim() ||
    null;
  const host =
    text.match(/^HOST=(.+)$/m)?.[1]?.trim() ||
    text.match(/^\s*host\s*[:=]\s*(.+)$/im)?.[1]?.trim() ||
    null;
  const explicitReportStatus = text.match(/^REPORT_STATUS=(.+)$/m)?.[1]?.trim() || null;
  const repoPath =
    text.match(/^GEMMA_REPO_PATH=(.+)$/m)?.[1]?.trim() ||
    text.match(/^\s*(?:gemma[_\s-]*repo[_\s-]*path|repo(?:\s+path)?|path)\s*[:=]\s*(.+)$/im)?.[1]?.trim() ||
    detectLooseMacRepoPath(text);
  const repoOrigin =
    text.match(/^GEMMA_REPO_ORIGIN=(.+)$/m)?.[1]?.trim() ||
    text.match(/^\s*(?:gemma[_\s-]*repo[_\s-]*origin|repo(?:\s+origin)?|origin)\s*[:=]\s*(.+)$/im)?.[1]?.trim() ||
    detectLooseMacRepoOrigin(text);
  const reportStatus =
    explicitReportStatus ||
    (repoPath ? "found" : "missing");
  const missingEntries = Array.from(text.matchAll(/^MISSING:\s+(.+)$/gm), (match) => match[1].trim());

  const summaryParts = [];
  if (user) {
    summaryParts.push(`user ${user}`);
  }
  if (host) {
    summaryParts.push(`host ${host}`);
  }
  if (repoPath) {
    summaryParts.push(`repo ${repoPath}`);
  } else if (reportStatus === "missing") {
    summaryParts.push("repo path missing");
  }
  if (repoOrigin) {
    summaryParts.push(`origin ${repoOrigin}`);
  }

  return {
    path: reportMeta?.path || null,
    name: reportMeta?.name || null,
    source: reportMeta?.source || null,
    updated_at: reportMeta?.stat?.mtime?.toISOString?.() || null,
    user,
    host,
    report_status: reportStatus,
    repo_path: repoPath,
    repo_origin: repoOrigin,
    missing_entries: missingEntries,
    summary:
      summaryParts.join(" | ") ||
      "Mac repo-path report received, but it did not include a Gemma path.",
    raw_excerpt: redactSensitiveOutputLines(summarizeWatcherOutput(text, 10)),
  };
}

function buildMacRepoPreviewText(reportText, reportMeta, fallbackSummary) {
  const text = String(reportText || "");
  if (!text.trim()) {
    return null;
  }

  const previewReport = parseMacRepoPathReport(text, {
    source: reportMeta?.source || null,
    name: reportMeta?.name || null,
  });
  const fallbackPreview = {
    path: null,
    name: reportMeta?.name || null,
    source: reportMeta?.source || null,
    updated_at: null,
    user: null,
    host: null,
    report_status: "unknown",
    repo_path: null,
    repo_origin: null,
    missing_entries: [],
    summary: fallbackSummary,
    raw_excerpt: redactSensitiveOutputLines(summarizeWatcherOutput(text, 6)),
  };

  return previewReport?.repo_path
    ? previewReport
    : {
        ...fallbackPreview,
        ...(previewReport || {}),
        summary: fallbackPreview.summary,
        raw_excerpt: previewReport?.raw_excerpt || fallbackPreview.raw_excerpt,
      };
}

function buildClipboardMacRepoPreview(clipboardText) {
  return buildMacRepoPreviewText(
    clipboardText,
    {
      source: "windows-clipboard",
      name: "windows-clipboard",
    },
    "Clipboard loaded, but it does not look like a Mac repo report yet."
  );
}

function buildPastedMacRepoPreview(reportText) {
  return buildMacRepoPreviewText(
    reportText,
    {
      source: "lane-config",
      name: "agro-mac-repo-path-report-manual.txt",
    },
    "Pasted text is loaded, but it does not include a usable Mac repo path yet."
  );
}

function trimLooseRepoValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['"`]+/, "")
    .replace(/['"`]+$/, "")
    .replace(/[.,;:)\]]+$/, "")
    .trim();
}

function detectLooseMacRepoPath(text) {
  const pathPattern = /(?:~\/|\/Users\/|\/Volumes\/)[^\r\n"'`]*?\/Gemma\b/g;
  const matches = Array.from(String(text || "").matchAll(pathPattern), (match) =>
    trimLooseRepoValue(match[0])
  ).filter(Boolean);

  if (!matches.length) {
    return null;
  }

  const directGemmaRoot = matches.find((candidate) => /\/Gemma$/i.test(candidate));
  return directGemmaRoot || matches[0];
}

function detectLooseMacRepoOrigin(text) {
  const originPattern =
    /(https:\/\/github\.com\/jessybrenenstahl\/Gemma(?:\.git)?|git@github\.com:jessybrenenstahl\/Gemma(?:\.git)?)/i;
  const match = String(text || "").match(originPattern);
  return match ? trimLooseRepoValue(match[1]) : null;
}

function uniqueStringList(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function buildBashArrayLiteral(values = []) {
  const entries = uniqueStringList(values).map((value) => `'${value.replaceAll("'", `'\"'\"'`)}'`);
  return `taildrop_targets=(${entries.join(" ")})`;
}

function getMacRepoReturnTargets(macRepoRequestSend) {
  const requestedTargets = Array.isArray(macRepoRequestSend?.return_targets)
    ? macRepoRequestSend.return_targets
    : [];

  return uniqueStringList([...requestedTargets, ...DEFAULT_MAC_REPO_RETURN_TARGETS]);
}

function buildMacActionPack({ artifactsDir, macBridgeReport }) {
  const scriptPath = path.join(artifactsDir, "mac-install-and-report-agro-ssh-key.sh");
  const notePath = path.join(artifactsDir, "to-codex-on-mac-install-and-report-ssh.txt");
  const inlineCommand = "~/Downloads/mac-install-and-report-agro-ssh-key.sh";
  const runBlock = [
    "chmod +x ~/Downloads/mac-install-and-report-agro-ssh-key.sh 2>/dev/null || true",
    "~/Downloads/mac-install-and-report-agro-ssh-key.sh",
  ].join("\n");
  const fallbackBlock = [
    "bridge_key='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILX+gW+Wv2DJvWrgr6ojr1M/6OdL2cFmDTvGkdGPyQSv agro-mac-bridge'",
    'ssh_dir="${HOME}/.ssh"',
    'auth_file="${ssh_dir}/authorized_keys"',
    'report="${HOME}/Downloads/agro-mac-ssh-bridge-report.txt"',
    "",
    'mkdir -p "${ssh_dir}"',
    'chmod 700 "${ssh_dir}"',
    'touch "${auth_file}"',
    'chmod 600 "${auth_file}"',
    "",
    'if ! grep -Fq "agro-mac-bridge" "${auth_file}"; then',
    "  printf '%s\\n' \"${bridge_key}\" >> \"${auth_file}\"",
    "fi",
    "",
    "{",
    '  echo "USER=$(whoami)"',
    '  echo "HOST=$(hostname)"',
    '  echo',
    '  echo "[ssh dir]"',
    '  ls -ld "${ssh_dir}" || echo "MISSING: ${ssh_dir}"',
    '  echo',
    '  echo "[authorized_keys]"',
    '  ls -l "${auth_file}" || echo "MISSING: ${auth_file}"',
    '  grep -Fn "agro-mac-bridge" "${auth_file}" || echo "MISSING: agro-mac-bridge"',
    '} > "${report}"',
    "",
    'tailscale file cp "${report}" jessy:',
    'echo "Sent ${report} to jessy via Taildrop."',
  ].join("\n");

  if (macBridgeReport) {
    return {
      summary: `Mac report received from ${macBridgeReport.source || "unknown source"} at ${macBridgeReport.updated_at || "unknown time"}.`,
      script_path: scriptPath,
      note_path: notePath,
      inline_command: inlineCommand,
      run_block: runBlock,
      fallback_block: fallbackBlock,
      expected_return_file: "agro-mac-ssh-bridge-report.txt",
    };
  }

  return {
    summary:
      "Run the combined Mac install-and-report script to install the AGRO bridge key, fix permissions, and Taildrop the SSH report back to Windows.",
    script_path: scriptPath,
    note_path: notePath,
    inline_command: inlineCommand,
    run_block: runBlock,
    fallback_block: fallbackBlock,
    expected_return_file: "agro-mac-ssh-bridge-report.txt",
  };
}

function buildMacRepoActionPack({ artifactsDir, macRepoReport, macRepoRequestSend }) {
  const scriptPath = path.join(artifactsDir, "mac-report-gemma-repo-path.sh");
  const notePath = path.join(artifactsDir, "to-codex-on-mac-report-gemma-repo-path.txt");
  const inlineCommand = "~/Downloads/mac-report-gemma-repo-path.sh";
  const returnTargets = getMacRepoReturnTargets(macRepoRequestSend);
  const runBlock = [
    "chmod +x ~/Downloads/mac-report-gemma-repo-path.sh 2>/dev/null || true",
    "~/Downloads/mac-report-gemma-repo-path.sh",
  ].join("\n");
  const fallbackBlock = [
    'report="${HOME}/Downloads/agro-mac-repo-path-report.txt"',
    'repo_path=""',
    'repo_origin=""',
    buildBashArrayLiteral(returnTargets),
    "",
    "find_by_origin() {",
    '  local root="$1"',
    '  [ -d "${root}" ] || return 1',
    "",
    '  while IFS= read -r gitdir; do',
    '    candidate="$(dirname "${gitdir}")"',
    '    if git -C "${candidate}" remote get-url origin 2>/dev/null | grep -qi "jessybrenenstahl/Gemma"; then',
    '      repo_path="${candidate}"',
    "      return 0",
    "    fi",
    '  done < <(find "${root}" -maxdepth 6 -type d -name .git -prune 2>/dev/null)',
    "",
    "  return 1",
    "}",
    "",
    'for candidate in \\',
    '  "${HOME}/Documents/GitHub/Gemma" \\',
    '  "${HOME}/GitHub/Gemma" \\',
    '  "${HOME}/Documents/Codex/Gemma" \\',
    '  "${HOME}/Documents/Code/Gemma" \\',
    '  "${HOME}/Documents/Gemma" \\',
    '  "${HOME}/Code/Gemma" \\',
    '  "${HOME}/Projects/Gemma" \\',
    '  "${HOME}/Workspace/Gemma" \\',
    '  "${HOME}/Development/Gemma" \\',
    '  "${HOME}/Developer/Gemma" \\',
    '  "${HOME}/src/Gemma" \\',
    '  "${HOME}/Gemma"',
    "do",
    '  if [ -d "${candidate}/.git" ]; then',
    '    repo_path="${candidate}"',
    "    break",
    "  fi",
    "done",
    "",
    'if [ -z "${repo_path}" ]; then',
    '  for root in \\',
    '    "${HOME}/Documents/GitHub" \\',
    '    "${HOME}/GitHub" \\',
    '    "${HOME}/Documents/Codex" \\',
    '    "${HOME}/Documents/Code" \\',
    '    "${HOME}/Documents" \\',
    '    "${HOME}/Code" \\',
    '    "${HOME}/Projects" \\',
    '    "${HOME}/Workspace" \\',
    '    "${HOME}/Development" \\',
    '    "${HOME}/Developer" \\',
    '    "${HOME}/src"',
    "  do",
    '    [ -d "${root}" ] || continue',
    '    while IFS= read -r candidate; do',
    '      if [ -d "${candidate}/.git" ]; then',
    '        repo_path="${candidate}"',
    "        break 2",
    "      fi",
    '    done < <(find "${root}" -maxdepth 6 -type d -name Gemma 2>/dev/null)',
    "  done",
    "fi",
    "",
    'if [ -z "${repo_path}" ]; then',
    '  for root in \\',
    '    "${HOME}/Documents/GitHub" \\',
    '    "${HOME}/GitHub" \\',
    '    "${HOME}/Documents/Codex" \\',
    '    "${HOME}/Documents/Code" \\',
    '    "${HOME}/Documents" \\',
    '    "${HOME}/Code" \\',
    '    "${HOME}/Projects" \\',
    '    "${HOME}/Workspace" \\',
    '    "${HOME}/Development" \\',
    '    "${HOME}/Developer" \\',
    '    "${HOME}/src" \\',
    '    "${HOME}"',
    "  do",
    '    find_by_origin "${root}" && break',
    "  done",
    "fi",
    "",
    'if [ -n "${repo_path}" ]; then',
    '  repo_origin="$(git -C "${repo_path}" remote get-url origin 2>/dev/null || true)"',
    "fi",
    "",
    "{",
    '  echo "USER=$(whoami)"',
    '  echo "HOST=$(hostname)"',
    '  if [ -n "${repo_path}" ]; then',
    '    echo "REPORT_STATUS=found"',
    '    echo "GEMMA_REPO_PATH=${repo_path}"',
    "  else",
    '    echo "REPORT_STATUS=missing"',
    "  fi",
    '  if [ -n "${repo_origin}" ]; then',
    '    echo "GEMMA_REPO_ORIGIN=${repo_origin}"',
    "  fi",
    "} > \"${report}\"",
    "",
    'for target in "${taildrop_targets[@]}"; do',
    '  if tailscale file cp "${report}" "${target}:"; then',
    '    echo "Sent ${report} to ${target} via Taildrop."',
    "    exit 0",
    "  fi",
    "done",
    "",
    'echo "Failed to Taildrop ${report} to any Windows target." >&2',
    'echo "Tried: ${taildrop_targets[*]}" >&2',
    "exit 1",
  ].join("\n");
  const manualBlock = [
    'repo_path=""',
    'repo_origin=""',
    "",
    "find_by_origin() {",
    '  local root="$1"',
    '  [ -d "${root}" ] || return 1',
    "",
    '  while IFS= read -r gitdir; do',
    '    candidate="$(dirname "${gitdir}")"',
    '    if git -C "${candidate}" remote get-url origin 2>/dev/null | grep -qi "jessybrenenstahl/Gemma"; then',
    '      repo_path="${candidate}"',
    "      return 0",
    "    fi",
    '  done < <(find "${root}" -maxdepth 6 -type d -name .git -prune 2>/dev/null)',
    "",
    "  return 1",
    "}",
    "",
    'for candidate in \\',
    '  "${HOME}/Documents/GitHub/Gemma" \\',
    '  "${HOME}/GitHub/Gemma" \\',
    '  "${HOME}/Documents/Codex/Gemma" \\',
    '  "${HOME}/Documents/Code/Gemma" \\',
    '  "${HOME}/Documents/Gemma" \\',
    '  "${HOME}/Code/Gemma" \\',
    '  "${HOME}/Projects/Gemma" \\',
    '  "${HOME}/Workspace/Gemma" \\',
    '  "${HOME}/Development/Gemma" \\',
    '  "${HOME}/Developer/Gemma" \\',
    '  "${HOME}/src/Gemma" \\',
    '  "${HOME}/Gemma"',
    "do",
    '  if [ -d "${candidate}/.git" ]; then',
    '    repo_path="${candidate}"',
    "    break",
    "  fi",
    "done",
    "",
    'if [ -z "${repo_path}" ]; then',
    '  for root in \\',
    '    "${HOME}/Documents/GitHub" \\',
    '    "${HOME}/GitHub" \\',
    '    "${HOME}/Documents/Codex" \\',
    '    "${HOME}/Documents/Code" \\',
    '    "${HOME}/Documents" \\',
    '    "${HOME}/Code" \\',
    '    "${HOME}/Projects" \\',
    '    "${HOME}/Workspace" \\',
    '    "${HOME}/Development" \\',
    '    "${HOME}/Developer" \\',
    '    "${HOME}/src"',
    "  do",
    '    [ -d "${root}" ] || continue',
    '    while IFS= read -r candidate; do',
    '      if [ -d "${candidate}/.git" ]; then',
    '        repo_path="${candidate}"',
    "        break 2",
    "      fi",
    '    done < <(find "${root}" -maxdepth 6 -type d -name Gemma 2>/dev/null)',
    "  done",
    "fi",
    "",
    'if [ -z "${repo_path}" ]; then',
    '  for root in \\',
    '    "${HOME}/Documents/GitHub" \\',
    '    "${HOME}/GitHub" \\',
    '    "${HOME}/Documents/Codex" \\',
    '    "${HOME}/Documents/Code" \\',
    '    "${HOME}/Documents" \\',
    '    "${HOME}/Code" \\',
    '    "${HOME}/Projects" \\',
    '    "${HOME}/Workspace" \\',
    '    "${HOME}/Development" \\',
    '    "${HOME}/Developer" \\',
    '    "${HOME}/src" \\',
    '    "${HOME}"',
    "  do",
    '    find_by_origin "${root}" && break',
    "  done",
    "fi",
    "",
    'if [ -n "${repo_path}" ]; then',
    '  repo_origin="$(git -C "${repo_path}" remote get-url origin 2>/dev/null || true)"',
    "fi",
    "",
    'echo "USER=$(whoami)"',
    'echo "HOST=$(hostname)"',
    'if [ -n "${repo_path}" ]; then',
    '  echo "REPORT_STATUS=found"',
    '  echo "GEMMA_REPO_PATH=${repo_path}"',
    "else",
    '  echo "REPORT_STATUS=missing"',
    '  echo "MISSING: gemma-repo-path"',
    "fi",
    'if [ -n "${repo_origin}" ]; then',
    '  echo "GEMMA_REPO_ORIGIN=${repo_origin}"',
    "fi",
  ].join("\n");

  if (macRepoReport?.repo_path) {
    return {
      summary: `Mac repo report received from ${macRepoReport.source || "unknown source"} at ${macRepoReport.updated_at || "unknown time"}.`,
      script_path: scriptPath,
      note_path: notePath,
      inline_command: inlineCommand,
      run_block: runBlock,
      fallback_block: fallbackBlock,
      manual_block: manualBlock,
      expected_return_file: "agro-mac-repo-path-report.txt",
      return_targets: returnTargets,
    };
  }

  const requestSummary = macRepoRequestSend?.recorded_at
    ? `Last watcher/request send recorded at ${macRepoRequestSend.recorded_at}.`
    : "No repo-path report has landed yet.";

  return {
    summary: `Run the Mac repo-path reporter to Taildrop the Gemma checkout path back to Windows. ${requestSummary}`,
    script_path: scriptPath,
    note_path: notePath,
    inline_command: inlineCommand,
    run_block: runBlock,
    fallback_block: fallbackBlock,
    manual_block: manualBlock,
    expected_return_file: "agro-mac-repo-path-report.txt",
    return_targets: returnTargets,
  };
}

async function loadLatestMacRepoReport({ taildropInboxDir, downloadsDir, laneConfigDir = null }) {
  const latestReport = await findLatestMatchingFile(
    [
      ...(laneConfigDir
        ? [
            {
              dirPath: laneConfigDir,
              source: "lane-config",
            },
          ]
        : []),
      {
        dirPath: taildropInboxDir,
        source: "taildrop-inbox",
      },
      {
        dirPath: downloadsDir,
        source: "downloads",
      },
    ],
    /^agro-mac-repo-path-report.*\.txt$/i
  );

  return parseMacRepoPathReport(latestReport.data, latestReport);
}

function buildLaneConfigAction(
  laneConfig,
  macRepoReport,
  {
    laneConfigManualSurface = null,
    macRepoNudgeSend = null,
    macRepoFallbackSend = null,
    macRepoManualSend = null,
    macRepoRequestSend = null,
    macRepoWatcherSummary = null,
    macRepoInputClear = null,
  } = {}
) {
  if (macRepoReport?.repo_path) {
    return `Apply the reported Mac repo path ${macRepoReport.repo_path} to lane config.`;
  }

  if (laneConfig?.configured_repo_paths?.mac) {
    return "Mac repo path is already configured. Use `Clear Mac Repo Path` if it moved or was applied by mistake, or re-run a Mac repo report if the checkout changed.";
  }

  const manualRecommendedAction = laneConfigManualSurface?.recommended_action || null;
  if (manualRecommendedAction?.key === "probe_clipboard") {
    return "Last clipboard probe is stale. Use `Refresh Clipboard` or `Run Recommended Action` to refresh the Windows clipboard truth before trusting it.";
  }

  if (manualRecommendedAction?.blocked_code === "WINDOWS_CLIPBOARD_UNCHANGED") {
    return "The Windows clipboard is unchanged and still does not contain a fresh usable Mac repo reply. Copy a fresh Mac reply into Windows, then use `Run Recommended Action`, `Load Clipboard`, `Apply Clipboard`, or `Smart Apply`.";
  }

  const nudgeRecordedAt = macRepoNudgeSend?.recorded_at || macRepoNudgeSend?.sent_at || null;
  const fallbackRecordedAt = macRepoFallbackSend?.recorded_at || macRepoFallbackSend?.sent_at || null;
  const manualRecordedAt = macRepoManualSend?.recorded_at || macRepoManualSend?.sent_at || null;
  const requestRecordedAt = macRepoRequestSend?.recorded_at || macRepoRequestSend?.sent_at || null;
  const hasWatcherNudge = Number.isFinite(Number(macRepoWatcherSummary?.last_nudge_attempt))
    && Number(macRepoWatcherSummary.last_nudge_attempt) > 0;
  const hasWatcherManual = Number.isFinite(Number(macRepoWatcherSummary?.last_manual_attempt))
    && Number(macRepoWatcherSummary.last_manual_attempt) > 0;

  if (macRepoInputClear?.recorded_at) {
    return "A stale loaded Mac repo input was cleared. Copy a fresh Mac repo reply into Windows, then use Load Clipboard, Apply Clipboard, or Smart Apply.";
  }

  if (manualRecordedAt || hasWatcherManual) {
    return "Windows already sent the manual repo block to the Mac. On the Mac, run the `# Manual Paste` block from `Mac Repo Run Block`. In Windows, any of these are safe first moves: `Smart Apply`, `Apply Clipboard`, or `Apply Pasted Report`. If Taildrop return starts working, you can also use `Pull + Apply`.";
  }

  if (nudgeRecordedAt || hasWatcherNudge) {
    return "Windows already sent the full repo nudge. On the Mac, run `~/Downloads/mac-report-gemma-repo-path.sh` or paste the `Mac Repo Run Block`. If you already copied a Mac reply into Windows, `Smart Apply`, `Apply Clipboard`, and `Apply Pasted Report` are all safe first moves. Otherwise you can use `Pull + Apply` or wait for the watcher.";
  }

  if (fallbackRecordedAt) {
    return "Windows already sent the direct repo fallback block. On the Mac, paste the `Mac Repo Run Block`. If you already copied a Mac reply into Windows, `Smart Apply`, `Apply Clipboard`, and `Apply Pasted Report` are all safe first moves. Otherwise you can use `Pull + Apply` or wait for the watcher.";
  }

  if (requestRecordedAt) {
    return "Windows already asked the Mac for the repo path. If the script is already on the Mac, run `~/Downloads/mac-report-gemma-repo-path.sh`; otherwise use `Nudge Mac Now`. If you already copied a Mac reply into Windows, `Smart Apply`, `Apply Clipboard`, and `Apply Pasted Report` are all safe first moves.";
  }

  return "Use `Nudge Mac Now` to push the full repo-path prompt bundle, `Ask Mac for Repo Path` for the lightweight request, or use `Smart Apply`, `Apply Clipboard`, or `Apply Pasted Report` once a returned report, copied Mac reply, or pasted text is available.";
}

function buildLaneConfigRecommendedAction(
  laneConfig,
  macRepoReport,
  {
    laneConfigStatus = null,
    macRepoInputCandidate = null,
    macRepoClipboardProbe = null,
    macRepoClipboardProbeFreshness = null,
    macRepoInputRisk = null,
    macRepoInputClear = null,
    laneConfigRecommendedRun = null,
    macRepoNudgeSend = null,
    macRepoFallbackSend = null,
    macRepoManualSend = null,
    macRepoRequestSend = null,
    macRepoWatcherSummary = null,
  } = {}
) {
  const configuredMacPath = String(
    laneConfig?.effective_repo_paths?.mac ||
      laneConfig?.configured_repo_paths?.mac ||
      ""
  ).trim();
  const manualRecordedAt = macRepoManualSend?.recorded_at || macRepoManualSend?.sent_at || null;
  const nudgeRecordedAt = macRepoNudgeSend?.recorded_at || macRepoNudgeSend?.sent_at || null;
  const fallbackRecordedAt =
    macRepoFallbackSend?.recorded_at || macRepoFallbackSend?.sent_at || null;
  const requestRecordedAt = macRepoRequestSend?.recorded_at || macRepoRequestSend?.sent_at || null;
  const inputClearTime = parseIsoTimeMs(macRepoInputClear?.recorded_at);
  const recommendedRunTime = parseIsoTimeMs(laneConfigRecommendedRun?.recorded_at);
  const inputClearSupersedesRun =
    Number.isFinite(inputClearTime) &&
    Number.isFinite(recommendedRunTime) &&
    inputClearTime > recommendedRunTime;
  const watcherAttempts = Number(macRepoWatcherSummary?.attempts_completed) || 0;
  const recommendedRunExecutedActionKey = getLaneConfigRunExecutedActionKey(
    laneConfigRecommendedRun
  );
  const lastRunFailedClipboardApply =
    !laneConfigRecommendedRun?.ok &&
    recommendedRunExecutedActionKey === "apply_clipboard" &&
    ["MAC_REPO_REPORT_TEXT_MISSING_PATH", "WINDOWS_CLIPBOARD_EMPTY"].includes(
      String(laneConfigRecommendedRun?.code || "")
    );
  const lastRunClipboardUnchanged =
    !inputClearSupersedesRun &&
    !laneConfigRecommendedRun?.ok &&
    recommendedRunExecutedActionKey === "load_clipboard" &&
    String(laneConfigRecommendedRun?.code || "") === "WINDOWS_CLIPBOARD_UNCHANGED";

  if (macRepoReport?.repo_path || laneConfigStatus?.can_apply_report) {
    return {
      key: "apply_report",
      label: "Apply Report",
      reason: "A returned Mac repo report is ready right now.",
      source: "server",
    };
  }

  if (configuredMacPath || laneConfigStatus?.can_clear_mac_repo_path) {
    return {
      key: "clear_mac_repo_path",
      label: "Clear Mac Repo Path",
      reason: "A Mac repo path is already configured. Clear it only if the checkout moved or was applied by mistake.",
      source: "server",
    };
  }

  if (macRepoInputCandidate?.has_usable_repo_path && macRepoInputCandidate?.input_text_length > 0) {
    return {
      key: "smart_apply",
      label: "Smart Apply",
      reason: "The latest loaded Mac repo input already contains a usable Gemma repo path.",
      source: "input_candidate",
    };
  }

  if (macRepoInputCandidate?.input_text_length > 0) {
    return {
      key: "load_clipboard",
      label: "Load Clipboard",
      reason: macRepoInputRisk?.state === "secret_like_text"
        ? "The latest loaded Mac repo input includes redacted secret-looking text and still does not contain a usable Gemma repo path. Copy a fresh Mac reply from the Mac into Windows, then reload it."
        : "The latest loaded Mac repo input still does not contain a usable Gemma repo path. Copy a fresh Mac reply into Windows, then reload it.",
      source: "input_candidate",
      blocked: lastRunClipboardUnchanged,
      retryable: lastRunClipboardUnchanged,
      blocked_code: lastRunClipboardUnchanged ? "WINDOWS_CLIPBOARD_UNCHANGED" : null,
      blocked_reason: lastRunClipboardUnchanged
        ? macRepoInputRisk?.state === "secret_like_text"
          ? "The Windows clipboard is unchanged and still includes redacted secret-looking text without a usable Mac repo path. Copy a fresh Mac reply first."
          : "The Windows clipboard is unchanged and still does not include a usable Mac repo path. Copy a fresh Mac reply first."
        : null,
    };
  }

  if (
    macRepoClipboardProbeFreshness?.state === "stale" ||
    macRepoClipboardProbeFreshness?.state === "unknown"
  ) {
    return {
      key: "probe_clipboard",
      label: "Refresh Clipboard",
      reason:
        macRepoClipboardProbeFreshness.state === "unknown"
          ? "The last clipboard probe has no usable timestamp, so refresh the Windows clipboard truth before trusting it."
          : "The last clipboard probe is stale, so refresh the Windows clipboard truth before trusting it.",
      source: "clipboard_probe_freshness",
    };
  }

  if (macRepoClipboardProbe?.state === "usable") {
    return {
      key: "apply_clipboard",
      label: "Apply Clipboard",
      reason: "Clipboard probe found a usable Mac repo path, so the one-click path is ready now.",
      source: "clipboard_probe",
    };
  }

  if (
    macRepoClipboardProbe?.state === "unchanged_after_input_clear" ||
    macRepoClipboardProbe?.state === "unchanged_candidate"
  ) {
    return {
      key: "load_clipboard",
      label: "Load Clipboard",
      reason:
        "Clipboard probe says Windows is still holding the same stale Mac repo text. Copy a fresh Mac reply first.",
      source: "clipboard_probe",
      blocked: true,
      retryable: true,
      blocked_code: "WINDOWS_CLIPBOARD_UNCHANGED",
      blocked_reason:
        "The Windows clipboard is unchanged and still does not contain a fresh usable Mac repo reply. Copy a fresh Mac reply first.",
    };
  }

  if (
    macRepoClipboardProbe?.state === "needs_review" ||
    macRepoClipboardProbe?.state === "secret_like_text"
  ) {
    return {
      key: "load_clipboard",
      label: "Load Clipboard",
      reason:
        macRepoClipboardProbe.state === "secret_like_text"
          ? "Clipboard probe found new text, but it still includes redacted secret-looking content and needs review."
          : "Clipboard probe found new text that still needs review before apply.",
      source: "clipboard_probe",
    };
  }

  if (macRepoInputClear?.recorded_at) {
    return {
      key: "load_clipboard",
      label: "Load Clipboard",
      reason: "A stale Mac repo input candidate was cleared. Copy a fresh Mac reply into Windows, then load it.",
      source: "input_clear",
      blocked: lastRunClipboardUnchanged,
      retryable: lastRunClipboardUnchanged,
      blocked_code: lastRunClipboardUnchanged ? "WINDOWS_CLIPBOARD_UNCHANGED" : null,
      blocked_reason: lastRunClipboardUnchanged
        ? Number(macRepoInputClear?.previous_redaction_count) > 0
          ? "The Windows clipboard is unchanged and still includes redacted secret-looking text without a usable Mac repo path. Copy a fresh Mac reply first."
          : "The Windows clipboard is unchanged and still does not include a usable Mac repo path. Copy a fresh Mac reply first."
        : null,
    };
  }

  if (lastRunFailedClipboardApply) {
    return {
      key: "load_clipboard",
      label: "Load Clipboard",
      reason: "The last Apply Clipboard run showed the current clipboard is not a usable Mac repo reply yet. Copy a fresh Mac reply into Windows, then reload it.",
      source: "recommended_run",
    };
  }

  if (laneConfigStatus?.state === "manual_preferred" || manualRecordedAt) {
    return {
      key: "apply_clipboard",
      label: "Apply Clipboard",
      reason: "If the Mac reply is already copied into Windows, this is the fastest one-click path.",
      source: "server",
    };
  }

  if (
    laneConfigStatus?.state === "watching" ||
    requestRecordedAt ||
    nudgeRecordedAt ||
    fallbackRecordedAt ||
    watcherAttempts > 0
  ) {
    return {
      key: "load_clipboard",
      label: "Load Clipboard",
      reason: "This bypasses the watcher as soon as a Mac repo reply is copied into Windows.",
      source: "server",
    };
  }

  return {
    key: "send_nudge",
    label: "Nudge Mac Now",
    reason: "No returned or copied Mac repo input is available yet, so the safest next move is to push the repo-path prompt bundle again.",
    source: "server",
  };
}

function buildLaneConfigSuccessPath(
  laneConfigStatus,
  laneConfigRecommendedAction,
  {
    macRepoClipboardProbe = null,
  } = {}
) {
  if (laneConfigStatus?.can_apply_report) {
    return "Click Apply Report now.";
  }

  if (macRepoClipboardProbe?.state === "usable") {
    return "A usable Mac repo path is already in the clipboard flow. Click Run Recommended Action once.";
  }

  if (laneConfigRecommendedAction?.key === "smart_apply") {
    return "A usable Mac repo path is already loaded. Click Smart Apply or Run Recommended Action now.";
  }

  if (laneConfigRecommendedAction?.key === "apply_pasted_report") {
    return "Review the loaded text, then click Smart Apply or Apply Pasted Report.";
  }

  if (laneConfigStatus?.can_clear_mac_repo_path || laneConfigStatus?.state === "configured") {
    return "Only clear the Mac repo path if the checkout moved or was applied by mistake.";
  }

  if (laneConfigRecommendedAction?.blocked_code === "WINDOWS_CLIPBOARD_UNCHANGED") {
    return "Copy a fresh Mac repo reply into Windows, then click Run Recommended Action once.";
  }

  if (laneConfigRecommendedAction?.key === "probe_clipboard") {
    return "Let the app refresh the Windows clipboard truth again, or click Run Recommended Action to refresh it now.";
  }

  if (laneConfigStatus?.state === "manual_preferred") {
    return "Copy a fresh Mac repo reply into Windows, then click Run Recommended Action once.";
  }

  if (laneConfigStatus?.state === "watching") {
    return "Wait for a returned Mac repo report, or bypass the watcher by copying a Mac reply into Windows.";
  }

  if (laneConfigRecommendedAction?.key === "send_nudge") {
    return "Push the Mac repo prompt bundle again or wait for a returned report.";
  }

  return "Load clipboard or wait for a returned Mac repo report.";
}

function buildLaneConfigSummary(
  laneConfigStatus,
  laneConfigRecommendedAction,
  {
    macRepoClipboardProbe = null,
  } = {}
) {
  if (!laneConfigRecommendedAction) {
    return "No lane-config summary yet.";
  }

  const successPath = buildLaneConfigSuccessPath(laneConfigStatus, laneConfigRecommendedAction, {
    macRepoClipboardProbe,
  });

  if (laneConfigRecommendedAction.blocked) {
    const parts = [
      "blocked",
      laneConfigRecommendedAction.label || "recommended action",
      laneConfigRecommendedAction.blocked_reason || laneConfigRecommendedAction.reason,
    ];
    if (laneConfigRecommendedAction.retryable) {
      parts.push("retryable · Run Recommended: Recheck Clipboard");
    }
    parts.push(successPath);
    return parts.filter(Boolean).join(" · ");
  }

  if (laneConfigRecommendedAction.key === "probe_clipboard") {
    return [
      "refresh",
      laneConfigRecommendedAction.label || "recommended action",
      laneConfigRecommendedAction.reason || "Refresh the clipboard truth before trusting the current recommendation.",
      successPath,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return [
    "ready",
    laneConfigRecommendedAction.label || "recommended action",
    laneConfigRecommendedAction.reason || "No lane-config summary yet.",
    successPath,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildLaneConfigBlockedBy(laneConfigRecommendedAction) {
  if (laneConfigRecommendedAction?.key === "probe_clipboard") {
    return [
      "STALE_CLIPBOARD_PROBE",
      laneConfigRecommendedAction.reason ||
        "The last clipboard probe is stale, so refresh the Windows clipboard truth before trusting it.",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (!laneConfigRecommendedAction?.blocked) {
    return "No active manual-ingest blocker.";
  }

  return [laneConfigRecommendedAction.blocked_code, laneConfigRecommendedAction.blocked_reason || laneConfigRecommendedAction.reason]
    .filter(Boolean)
    .join(" · ");
}

function buildLaneConfigRetryPath(laneConfigRunRecommended) {
  if (laneConfigRunRecommended?.mode === "refresh") {
    return `refresh-needed · ${
      laneConfigRunRecommended.label || "Run Recommended: Refresh Clipboard"
    }`;
  }

  if (laneConfigRunRecommended?.mode === "retry") {
    return `retryable · ${
      laneConfigRunRecommended.label || "Run Recommended: Recheck Clipboard"
    }`;
  }

  if (!laneConfigRunRecommended?.blocked) {
    return "No retry needed.";
  }

  return "not retryable yet · wait for new input or a different recommendation";
}

function buildLaneConfigManualIngestHint(
  laneConfigStatus,
  laneConfigRecommendedAction,
  {
    macRepoClipboardProbe = null,
    macRepoClipboardProbeFreshness = null,
    macRepoInputRisk = null,
    macRepoInputCandidate = null,
  } = {}
) {
  if (laneConfigStatus?.can_apply_report) {
    return "A returned Mac repo report is ready. Apply Report is the fastest next step.";
  }

  if (laneConfigRecommendedAction?.blocked) {
    const blockedReason =
      laneConfigRecommendedAction.blocked_reason ||
      laneConfigRecommendedAction.reason ||
      "Waiting for a fresh Mac repo reply in the clipboard.";
    if (macRepoClipboardProbe?.state === "usable") {
      return "Clipboard probe found a usable Mac repo path. Run Recommended Action should now finish in one click.";
    }
    return laneConfigStatus?.can_clear_mac_repo_input_candidate
      ? `${blockedReason} If this is just stale loaded text, use Clear Input Candidate to reset it without touching repo paths.`
      : blockedReason;
  }

  if (
    laneConfigRecommendedAction?.key === "probe_clipboard" ||
    macRepoClipboardProbeFreshness?.state === "stale"
  ) {
    return "Last clipboard probe is stale. Use Refresh Clipboard or Run Recommended Action to refresh it before trusting the current clipboard recommendation.";
  }

  if (macRepoClipboardProbe?.state === "usable") {
    return "Clipboard probe found a usable Mac repo path. Run Recommended Action should now finish in one click.";
  }

  if (macRepoClipboardProbe?.state === "unchanged_after_input_clear") {
    return "Clipboard probe says Windows still holds the same stale cleared input. Copy a fresh Mac reply first.";
  }

  if (macRepoInputRisk?.state === "secret_like_text") {
    return "Current input includes redacted secret-looking text and no usable repo path. Copy a fresh Mac repo reply into Windows, then use Load Clipboard.";
  }

  if (macRepoInputCandidate?.has_usable_repo_path) {
    return "Clipboard preview found a usable Mac repo path. Smart Apply is the fastest next step.";
  }

  if (Number(macRepoInputCandidate?.input_text_length) > 0) {
    return "Manual Mac Repo Report has text loaded. If it looks right, use Apply Pasted Report or Smart Apply.";
  }

  if (laneConfigRecommendedAction?.key === "send_nudge") {
    return "Use Nudge Mac Now to push the full repo-path prompt bundle again, or wait for a returned Mac repo report.";
  }

  if (laneConfigStatus?.state === "manual_preferred") {
    return "Best next step: copy the Mac repo reply into Windows, click Load Clipboard, then Smart Apply if the preview finds a path.";
  }

  if (laneConfigStatus?.state === "watching") {
    return "Watcher is still trying, but you can bypass it by copying a Mac repo reply into Windows and using Load Clipboard.";
  }

  return "Load Clipboard, paste a Mac reply, or wait for a returned Mac repo report.";
}

function buildLaneConfigNextAction(laneConfigRecommendedAction) {
  if (!laneConfigRecommendedAction) {
    return "No recommended action yet.";
  }

  return laneConfigRecommendedAction.blocked
    ? `${laneConfigRecommendedAction.label} blocked · ${laneConfigRecommendedAction.blocked_reason || laneConfigRecommendedAction.reason}`
    : `${laneConfigRecommendedAction.label} · ${laneConfigRecommendedAction.reason}`;
}

  function buildLaneConfigRunRecommended(laneConfigRecommendedAction) {
    if (!laneConfigRecommendedAction?.key) {
      return {
        action_key: null,
        label: "Run Recommended Action",
        disabled: true,
        title: "No recommended action is available yet.",
        blocked: false,
        mode: "run",
        retryable: false,
        refreshable: false,
      };
    }

    const retryable = Boolean(
      laneConfigRecommendedAction.blocked && laneConfigRecommendedAction.retryable
    );
    const refreshable = laneConfigRecommendedAction.key === "probe_clipboard";
    const mode = refreshable ? "refresh" : retryable ? "retry" : "run";
    const title =
      refreshable
        ? `${laneConfigRecommendedAction.reason} This button will refresh the Windows clipboard truth when you click it.`
        : retryable
        ? `${laneConfigRecommendedAction.blocked_reason || laneConfigRecommendedAction.reason} This button will recheck the current Windows clipboard when you click it.`
        : laneConfigRecommendedAction.blocked_reason || laneConfigRecommendedAction.reason || "Run the recommended lane-config action.";

    return {
    action_key: laneConfigRecommendedAction.key,
      label: retryable
      ? "Run Recommended: Recheck Clipboard"
      : laneConfigRecommendedAction.blocked
      ? `Waiting: ${laneConfigRecommendedAction.label}`
      : `Run Recommended: ${laneConfigRecommendedAction.label}`,
      disabled: Boolean(laneConfigRecommendedAction.blocked && !retryable),
      title,
      blocked: Boolean(laneConfigRecommendedAction.blocked),
      mode,
      retryable,
      refreshable,
      blocked_code: laneConfigRecommendedAction.blocked_code || null,
    };
  }

function buildLaneConfigManualSurface(
  laneConfigStatus,
  laneConfigRecommendedAction,
  {
    macRepoClipboardProbe = null,
    macRepoClipboardProbeFreshness = null,
    macRepoInputRisk = null,
    macRepoInputCandidate = null,
    laneConfigRecommendedRun = null,
    laneConfigRecommendedRunState = null,
  } = {}
) {
  const laneConfigSuccessPath = buildLaneConfigSuccessPath(
    laneConfigStatus,
    laneConfigRecommendedAction,
    {
      macRepoClipboardProbe,
    }
  );
  const laneConfigSummary = buildLaneConfigSummary(
    laneConfigStatus,
    laneConfigRecommendedAction,
    {
      macRepoClipboardProbe,
    }
  );
  const laneConfigBlockedBy = buildLaneConfigBlockedBy(laneConfigRecommendedAction);
  const laneConfigManualIngestHint = buildLaneConfigManualIngestHint(
    laneConfigStatus,
    laneConfigRecommendedAction,
    {
      macRepoClipboardProbe,
      macRepoClipboardProbeFreshness,
      macRepoInputRisk,
      macRepoInputCandidate,
    }
  );
  const laneConfigNextAction = buildLaneConfigNextAction(laneConfigRecommendedAction);
  const laneConfigRunRecommended = buildLaneConfigRunRecommended(
    laneConfigRecommendedAction
  );
  const laneConfigRetryPath = buildLaneConfigRetryPath(laneConfigRunRecommended);

  return {
    blocked_by: laneConfigBlockedBy,
    manual_ingest_hint: laneConfigManualIngestHint,
    next_action: laneConfigNextAction,
    recommended_action: laneConfigRecommendedAction,
    recommended_run: laneConfigRecommendedRun,
    recommended_run_state: laneConfigRecommendedRunState,
    retry_path: laneConfigRetryPath,
    run_recommended: laneConfigRunRecommended,
    success_path: laneConfigSuccessPath,
    summary: laneConfigSummary,
  };
}

function buildMacRepoInputRisk(macRepoInputCandidate) {
  if (!macRepoInputCandidate?.input_text_length) {
    return {
      state: "clear",
      severity: "none",
      summary: "No loaded Mac repo input candidate yet.",
    };
  }

  if (Number(macRepoInputCandidate.redaction_count) > 0 && !macRepoInputCandidate.has_usable_repo_path) {
    return {
      state: "secret_like_text",
      severity: "warn",
      summary:
        "The current loaded Mac repo input includes redacted secret-looking text and still does not contain a usable Gemma repo path. Replace it with a fresh Mac reply before applying.",
      redaction_count: Number(macRepoInputCandidate.redaction_count),
      source: macRepoInputCandidate.source || null,
    };
  }

  if (Number(macRepoInputCandidate.redaction_count) > 0) {
    return {
      state: "redacted",
      severity: "warn",
      summary:
        "The current loaded Mac repo input includes redacted secret-looking text. Verify it carefully before applying.",
      redaction_count: Number(macRepoInputCandidate.redaction_count),
      source: macRepoInputCandidate.source || null,
    };
  }

  if (macRepoInputCandidate.has_usable_repo_path) {
    return {
      state: "usable",
      severity: "info",
      summary: "The current loaded Mac repo input includes a usable Gemma repo path.",
      source: macRepoInputCandidate.source || null,
    };
  }

  return {
    state: "needs_review",
    severity: "warn",
    summary:
      "The current loaded Mac repo input still does not include a usable Gemma repo path. Copy a fresh Mac reply or edit the text before applying.",
    source: macRepoInputCandidate.source || null,
  };
}

function summarizeLaneConfigRecommendedRun(runReceipt) {
  if (!runReceipt) {
    return null;
  }

  const waitingForClipboard = isLaneConfigRecommendedRunWaitingForClipboard(runReceipt);
  const statusCode = Number(runReceipt.status_code);
  const statusLabel = Number.isFinite(statusCode) ? `status ${statusCode}` : "status unknown";
  const actionLabel = getLaneConfigRunActionLabel(runReceipt);
  const outcome = waitingForClipboard
    ? "is waiting on fresh clipboard input"
    : runReceipt.ok
    ? "completed"
    : "needs review";
  const detail =
    runReceipt.repo_path ||
    runReceipt.message ||
    runReceipt.code ||
    "";

  return {
    ...runReceipt,
    summary: waitingForClipboard
      ? detail
        ? `${actionLabel} ${outcome} · ${detail}`
        : `${actionLabel} ${outcome}`
      : detail
      ? `${actionLabel} ${outcome} (${statusLabel}) · ${detail}`
      : `${actionLabel} ${outcome} (${statusLabel})`,
  };
}

function getLaneConfigRunActionLabel(runReceipt) {
  return (
    runReceipt?.executed_action?.label ||
    runReceipt?.recommended_action?.label ||
    "Recommended Action"
  );
}

function isLaneConfigRecommendedRunWaitingForClipboard(runReceipt) {
  return String(runReceipt?.code || "") === "WINDOWS_CLIPBOARD_UNCHANGED";
}

function getLaneConfigRunExecutedActionKey(runReceipt) {
  return runReceipt?.executed_action?.key || null;
}

function buildLaneConfigExecutedAction(recommendedAction, overrides = {}) {
  const effectiveKey = overrides.key || recommendedAction?.key || null;
  if (!effectiveKey) {
    return null;
  }

  return {
    key: effectiveKey,
    label: overrides.label || recommendedAction?.label || "Recommended Action",
    reason: overrides.reason || recommendedAction?.reason || null,
  };
}

function buildLaneConfigRecommendedRunReceipt({
  ok,
  statusCode,
  code = null,
  message = null,
  recommendedAction,
  executedAction,
  repoPath = null,
  recordedAt = new Date().toISOString(),
}) {
  return {
    ok,
    status_code: statusCode,
    code,
    message,
    recommended_action: recommendedAction,
    executed_action: executedAction,
    repo_path: repoPath,
    recorded_at: recordedAt,
  };
}

function buildLaneConfigRecommendedRunState(runReceipt, inputClearReceipt) {
  if (!runReceipt) {
    return null;
  }

  const runTime = parseIsoTimeMs(runReceipt.recorded_at);
  const inputClearTime = parseIsoTimeMs(inputClearReceipt?.recorded_at);

  if (runTime && inputClearTime && inputClearTime > runTime) {
    return {
      state: "superseded",
      summary: `Superseded by Clear Input Candidate at ${inputClearReceipt.recorded_at}.`,
      superseded_at: inputClearReceipt.recorded_at,
      source: "input_clear",
    };
  }

  if (isLaneConfigRecommendedRunWaitingForClipboard(runReceipt)) {
    return {
      state: "waiting_for_clipboard",
      summary:
        "Still waiting for a fresh Mac repo reply in the Windows clipboard.",
      source: "clipboard_probe",
    };
  }

  return {
    state: runReceipt.ok ? "current" : "historical",
    summary: runReceipt.ok
      ? "Still reflects the latest recommended-action outcome."
      : "Historical receipt from the last recommended-action attempt.",
  };
}

function buildLaneConfigStatus(
  laneConfig,
  macRepoReport,
  macRepoWatcher,
  macRepoWatcherSummary,
  macRepoManualSend,
  macRepoInputCandidate = null
) {
  const configuredMacPath = String(
    laneConfig?.configured_repo_paths?.mac ||
    laneConfig?.effective_repo_paths?.mac ||
    ""
  ).trim();
  const hasLoadedInputCandidate = Boolean(
    String(macRepoInputCandidate?.input_text || "").trim()
  );
  const watcherAttempts = Number(macRepoWatcherSummary?.attempts_completed) || 0;
  const manualPreferredAtAttempts =
    Number(macRepoWatcherSummary?.manual_preferred_at_attempts) ||
    DEFAULT_MAC_REPO_MANUAL_PREFERRED_ATTEMPTS;
  const manualBlockAlreadySent = Boolean(
    macRepoManualSend?.recorded_at ||
      macRepoManualSend?.sent_at ||
      macRepoWatcherSummary?.manual_preferred_sent_at ||
      macRepoWatcherSummary?.last_manual_attempt
  );
  const watcherAttemptsSummary = watcherAttempts
    ? `${watcherAttempts} ${watcherAttempts === 1 ? "time" : "times"}`
    : null;

  if (macRepoReport?.repo_path) {
    return {
      state: "report_ready",
      summary: `Mac repo report is ready from ${macRepoReport.source || "unknown source"}.`,
      can_apply_report: true,
      can_clear_mac_repo_path: Boolean(configuredMacPath),
      can_clear_mac_repo_input_candidate: hasLoadedInputCandidate,
    };
  }

  if (configuredMacPath) {
    return {
      state: "configured",
      summary: `Mac repo path is configured as ${configuredMacPath}.`,
      can_apply_report: false,
      can_clear_mac_repo_path: true,
      can_clear_mac_repo_input_candidate: hasLoadedInputCandidate,
    };
  }

  if (manualBlockAlreadySent || watcherAttempts >= manualPreferredAtAttempts) {
    const summary = manualBlockAlreadySent
      ? `Windows already sent the manual repo block to the Mac.${watcherAttemptsSummary ? ` Watcher has tried ${watcherAttemptsSummary} without a Mac repo report.` : ""} Use Smart Apply with a copied Mac reply or paste it into Manual Mac Repo Report.`
      : `Watcher has tried ${watcherAttemptsSummary} without a Mac repo report. Use Smart Apply with a copied Mac reply or paste it into Manual Mac Repo Report.`;
    return {
      state: "manual_preferred",
      summary,
      can_apply_report: false,
      can_clear_mac_repo_path: false,
      can_clear_mac_repo_input_candidate: hasLoadedInputCandidate,
      watcher_attempts: watcherAttempts || null,
      recommended_source: "manual",
      manual_preferred_at_attempts: manualPreferredAtAttempts,
    };
  }

  if (macRepoWatcher?.status === "running") {
    return {
      state: "watching",
      summary: "Waiting for a Mac repo report while the watcher runs.",
      can_apply_report: false,
      can_clear_mac_repo_path: false,
      can_clear_mac_repo_input_candidate: hasLoadedInputCandidate,
      watcher_attempts: watcherAttempts || null,
    };
  }

  return {
    state: "waiting",
    summary: "No Mac repo report is available yet.",
    can_apply_report: false,
    can_clear_mac_repo_path: false,
    can_clear_mac_repo_input_candidate: hasLoadedInputCandidate,
  };
}

function normalizeComparablePath(value) {
  return String(value || "").trim().replace(/[\\/]+$/, "");
}

function parseIsoTimeMs(value) {
  const stamp = String(value || "").trim();
  if (!stamp) {
    return null;
  }

  const parsed = Date.parse(stamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function humanizeDurationMs(ms) {
  const totalMs = Number(ms);
  if (!Number.isFinite(totalMs) || totalMs < 0) {
    return "unknown age";
  }

  if (totalMs < 60_000) {
    return `${Math.max(1, Math.round(totalMs / 1000))}s`;
  }

  if (totalMs < 3_600_000) {
    return `${Math.max(1, Math.round(totalMs / 60_000))}m`;
  }

  return `${Math.max(1, Math.round(totalMs / 3_600_000))}h`;
}

function buildMacRepoClipboardProbeFreshness(
  macRepoClipboardProbe,
  {
    nowMs = Date.now(),
    staleAfterMs = DEFAULT_MAC_REPO_CLIPBOARD_PROBE_STALE_MS,
  } = {}
) {
  if (!macRepoClipboardProbe) {
    return null;
  }

  const recordedAt = String(macRepoClipboardProbe.recorded_at || "").trim();
  const recordedAtMs = parseIsoTimeMs(recordedAt);
  if (!recordedAtMs) {
    return {
      state: "unknown",
      recorded_at: recordedAt || null,
      age_ms: null,
      stale_after_ms: staleAfterMs,
      summary: "The last clipboard probe has no usable timestamp, so it should be refreshed before trusting it.",
    };
  }

  const ageMs = Math.max(0, nowMs - recordedAtMs);
  if (ageMs > staleAfterMs) {
    return {
      state: "stale",
      recorded_at: recordedAt,
      age_ms: ageMs,
      stale_after_ms: staleAfterMs,
      summary: `The last clipboard probe is ${humanizeDurationMs(ageMs)} old and may no longer match the current Windows clipboard.`,
    };
  }

  return {
    state: "fresh",
    recorded_at: recordedAt,
    age_ms: ageMs,
    stale_after_ms: staleAfterMs,
    summary: `The last clipboard probe is ${humanizeDurationMs(ageMs)} old and still fresh enough to trust.`,
  };
}

function buildMacRepoSmartApplyState(smartApply, clearReceipt, laneConfig, macRepoReport) {
  if (!smartApply) {
    return null;
  }

  const smartApplyAt = parseIsoTimeMs(smartApply.recorded_at || smartApply.sent_at);
  const clearAt = parseIsoTimeMs(clearReceipt?.recorded_at || clearReceipt?.sent_at);
  const configuredMacPath = normalizeComparablePath(
    macRepoReport?.repo_path ||
      laneConfig?.effective_repo_paths?.mac ||
      laneConfig?.configured_repo_paths?.mac ||
      ""
  );
  const appliedPath = normalizeComparablePath(smartApply.repo_path);

  if (clearAt && (!smartApplyAt || clearAt >= smartApplyAt) && !configuredMacPath) {
    return {
      state: "superseded",
      active: false,
      superseded_by: "clear",
      repo_path: smartApply.repo_path || null,
      summary: `Superseded by Clear Mac Repo Path at ${clearReceipt?.recorded_at || clearReceipt?.sent_at || "unknown time"}.`,
    };
  }

  if (configuredMacPath && appliedPath && configuredMacPath !== appliedPath) {
    return {
      state: "stale",
      active: false,
      superseded_by: "repo_path_changed",
      repo_path: smartApply.repo_path || null,
      current_repo_path: configuredMacPath,
      summary: `Last Smart Apply targeted ${smartApply.repo_path}, but the current Mac repo path is ${configuredMacPath}.`,
    };
  }

  if (configuredMacPath && (!appliedPath || configuredMacPath === appliedPath)) {
    return {
      state: "active",
      active: true,
      repo_path: smartApply.repo_path || configuredMacPath || null,
      summary: `Smart Apply is still aligned with the current Mac repo path.`,
    };
  }

  return {
    state: "historical",
    active: false,
    repo_path: smartApply.repo_path || null,
    summary: `Smart Apply succeeded earlier, but there is no current Mac repo path configured.`,
  };
}

function buildRecoveryAction(summary, macBridgeReport, macActionSend, taildropPull, macFallbackSend) {
  if (!summary) {
    return "No recovery action yet. Wait for the first watcher summary.";
  }

  const sshBridge =
    summary.ssh_bridge ||
    (Array.isArray(summary.last_health)
      ? summary.last_health.find((entry) => String(entry.label || "").startsWith("mac-ssh-")) || null
      : null);
  const diagnostics = Array.isArray(summary.last_health) ? summary.last_health : [];
  const httpsProbe = diagnostics.find((entry) => String(entry.label || "").startsWith("mac-http-") && String(entry.label || "").endsWith("_443"));
  const rawHttpProbe = diagnostics.find((entry) => String(entry.label || "").startsWith("mac-http-") && String(entry.label || "").includes("_1234"));

  if (summary.recovered_at) {
    return "No manual recovery action needed. Dual-lane verification already completed.";
  }

  if (macBridgeReport?.ssh_dir_missing) {
    const targetUser = macBridgeReport.user || "the active Mac user";
    return `On the Mac as ${targetUser}, create ~/.ssh with 700 permissions, then add the agro-mac-bridge key to ~/.ssh/authorized_keys.`;
  }

  if (macBridgeReport?.authorized_keys_missing) {
    const targetUser = macBridgeReport.user || "the active Mac user";
    return `On the Mac as ${targetUser}, create ~/.ssh/authorized_keys, append the agro-mac-bridge key, and keep the file readable only by that user.`;
  }

  if (macBridgeReport?.key_missing) {
    const targetUser = macBridgeReport.user || "the active Mac user";
    return `The Mac report says agro-mac-bridge is still missing for ${targetUser}. Append the Windows bridge public key to ~/.ssh/authorized_keys, then retry SSH.`;
  }

  if (macBridgeReport?.key_present) {
    const targetUser = macBridgeReport.user || "the active Mac user";
    return `The Mac report says the agro-mac-bridge key is present for ${targetUser}. Fix ~/.ssh or authorized_keys permissions, then retry SSH so the watcher can repair Serve automatically.`;
  }

  const sendRecordedAt = macActionSend?.recorded_at || macActionSend?.sent_at || null;
  const pullRecordedAt = taildropPull?.recorded_at || taildropPull?.pulled_at || null;
  const fallbackRecordedAt = macFallbackSend?.recorded_at || macFallbackSend?.sent_at || null;
  const sendStamp = sendRecordedAt ? new Date(sendRecordedAt) : null;
  const pullStamp = pullRecordedAt ? new Date(pullRecordedAt) : null;
  const fallbackStamp = fallbackRecordedAt ? new Date(fallbackRecordedAt) : null;
  const pullAfterSend =
    sendStamp && pullStamp ? pullStamp.getTime() >= sendStamp.getTime() : false;
  const fallbackAfterSend =
    fallbackStamp && sendStamp ? fallbackStamp.getTime() >= sendStamp.getTime() : Boolean(fallbackStamp);

  if (!macActionSend) {
    return "Use `Resend to Mac` in Recovery Watch to push the current Mac action pack before retrying anything else.";
  }

  if (macActionSend && (!taildropPull || !pullAfterSend)) {
    return "Windows already resent the Mac action pack. The next move is for the Mac to run the `Mac Run Block`, then either wait for the inbox watcher or use `Pull Taildrop Now`.";
  }

  if (taildropPull && pullAfterSend && Number(taildropPull.moved ?? 0) === 0 && !fallbackAfterSend) {
    return "Windows resent the Mac action pack and the latest pull found no returned files. Use `Send Fallback to Mac` to push the inline Terminal block directly, or run the `Mac Run Block` if it is already on the Mac.";
  }

  if (macFallbackSend && fallbackAfterSend) {
    return "Windows already sent the direct fallback block to the Mac. The next move is for the Mac to paste and run that block in Terminal, then either wait for the inbox watcher or use `Pull Taildrop Now`.";
  }

  if (sshBridge && !sshBridge.ok && /Permission denied/i.test(String(sshBridge.body || ""))) {
    return "On the Mac, verify the current username and ensure the `agro-mac-bridge` key is present in that user's `~/.ssh/authorized_keys`.";
  }

  if (sshBridge && sshBridge.ok && summary.ssh_repair && !summary.ssh_repair.ok) {
    return "SSH bridge is up, but the automatic Mac repair failed. Inspect `tailscale serve status` and local LM Studio on the Mac.";
  }

  if (sshBridge && sshBridge.ok && !summary.ssh_repair) {
    return "SSH bridge is ready. The watcher will attempt automatic Mac Serve repair as soon as the endpoint is still unhealthy on the next pass.";
  }

  if (httpsProbe && Number(httpsProbe.status) === 502) {
    return "The Mac's Tailscale HTTPS Serve target is reachable but returning 502. Keep LM Studio running on the Mac and repair the Serve upstream binding.";
  }

  if (rawHttpProbe && /reset|no HTTP response body/i.test(String(rawHttpProbe.body || ""))) {
    return "The raw Tailscale TCP forward reaches the Mac, but the LM Studio HTTP upstream is still not answering cleanly. Repair the Mac-side Serve/forwarding path.";
  }

  return "Keep the watcher running and continue probing the Mac endpoint candidates.";
}

function checkProcessRunning(processId) {
  if (!Number.isInteger(processId) || processId <= 0) {
    return false;
  }

  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function escapePowerShellSingleQuoted(value) {
  return String(value || "").replace(/'/g, "''");
}

async function findNewestMacRepoWatcherProcess({ sessionId = "" } = {}) {
  const sessionFilter = sessionId
    ? ` -and $_.CommandLine -match '${escapePowerShellSingleQuoted(sessionId)}'`
    : "";
  const command = [
    "$watcher = Get-CimInstance Win32_Process | Where-Object {",
    `  $_.Name -eq 'pwsh.exe' -and $_.CommandLine -match 'watch-mac-repo-report\\.ps1'${sessionFilter}`,
    "} | Sort-Object CreationDate -Descending | Select-Object -First 1 ProcessId,CreationDate,CommandLine",
    "if ($watcher) {",
    "  $watcher | ConvertTo-Json -Compress",
    "}",
  ].join("\n");

  try {
    const { stdout } = await execFileAsync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        command,
      ],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      }
    );
    const output = String(stdout || "").trim();
    if (!output) {
      return null;
    }

    const watcher = JSON.parse(output);
    return {
      process_id: Number(watcher.ProcessId) || null,
      created_at: watcher.CreationDate || null,
      command_line: watcher.CommandLine || "",
    };
  } catch {
    return null;
  }
}

function buildWatcherStatus({ watcherMeta, watcherOutputStat, recoverySummary = null }) {
  const processId = Number(watcherMeta?.process_id) || null;
  const running = checkProcessRunning(processId);

  if (running) {
    const modeSummary =
      Number(watcherMeta?.attempts) <= 0
        ? `Watcher running in continuous mode as PID ${processId}.`
        : `Watcher running as PID ${processId}.`;
    return {
      status: "running",
      tone: "online",
      summary: modeSummary,
      process_id: processId,
      attempts: watcherMeta?.attempts ?? null,
      interval_seconds: watcherMeta?.interval_seconds ?? null,
      output_updated_at: watcherOutputStat?.mtime?.toISOString?.() || null,
    };
  }

  if (watcherMeta) {
    if (recoverySummary?.recovered_at) {
      return {
        status: "completed",
        tone: "online",
        summary: `Watcher completed successfully after recovery at ${recoverySummary.recovered_at}.`,
        process_id: processId,
        attempts: watcherMeta?.attempts ?? null,
        interval_seconds: watcherMeta?.interval_seconds ?? null,
        output_updated_at: watcherOutputStat?.mtime?.toISOString?.() || null,
      };
    }

    return {
      status: "stopped",
      tone: "danger",
      summary: `Watcher PID ${processId || "unknown"} is not active.`,
      process_id: processId,
      attempts: watcherMeta?.attempts ?? null,
      interval_seconds: watcherMeta?.interval_seconds ?? null,
      output_updated_at: watcherOutputStat?.mtime?.toISOString?.() || null,
    };
  }

  return {
    status: "unstarted",
    tone: "offline",
    summary: "No watcher metadata found yet.",
    process_id: null,
    attempts: null,
    interval_seconds: null,
    output_updated_at: watcherOutputStat?.mtime?.toISOString?.() || null,
  };
}

async function readOptionalJsonFile(filePath) {
  try {
    const [raw, fileStat] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    return {
      data: JSON.parse(raw),
      stat: fileStat,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        data: null,
        stat: null,
      };
    }

    throw error;
  }
}

async function readOptionalTextFile(filePath) {
  try {
    const [raw, fileStat] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    return {
      data: raw,
      stat: fileStat,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        data: "",
        stat: null,
      };
    }

    throw error;
  }
}

async function listOptionalDirectoryFiles(dirPath, maxEntries = 8) {
  try {
    const names = await readdir(dirPath);
    const entries = await Promise.all(
      names.map(async (name) => {
        const filePath = path.join(dirPath, name);
        const fileStat = await stat(filePath);
        return {
          name,
          size: fileStat.size,
          updated_at: fileStat.mtime.toISOString(),
          is_file: fileStat.isFile(),
        };
      })
    );

    return entries
      .filter((entry) => entry.is_file)
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
      .slice(0, maxEntries);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function summarizeWatcherOutput(text, maxLines = 12) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  return lines.slice(-maxLines);
}

function summarizeMacDiagnostics(lastHealth) {
  if (!Array.isArray(lastHealth)) {
    return [];
  }

  return lastHealth.filter((entry) => {
    const label = String(entry?.label || "");
    return (
      label.startsWith("mac-dns-") ||
      label.startsWith("mac-tcp-") ||
      label.startsWith("mac-http-") ||
      label.startsWith("mac-ssh-")
    );
  });
}

function summarizeText(value, maxLength = 180) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function toError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

function ensurePrompt(body) {
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    throw new Error("A prompt is required.");
  }

  return prompt;
}

function ensureSession({
  sessionManager,
  sessionId,
  prompt,
  operatorMode,
}) {
  const resolvedSessionId = sessionId
    ? String(sessionId)
    : sessionManager.createSession({
        missionGoal: prompt,
        operatorMode,
      }).session_id;

  sessionManager.updateMissionState(resolvedSessionId, {
    mission_goal: prompt,
    operator_mode: operatorMode,
  });

  return resolvedSessionId;
}

function appendSharedPromptEvent({ sessionManager, sessionId, prompt, operatorMode }) {
  const session = sessionManager.appendTranscriptEvent(sessionId, {
    lane: "shared",
    type: "operator_prompt",
    content: prompt,
    routing_mode: operatorMode,
    round: 1,
  });

  return session.transcript.at(-1)?.id || null;
}

function appendLaneTaskEvent({
  sessionManager,
  sessionId,
  lane,
  prompt,
  sharedInstruction,
  operatorMode,
  sharedEventId,
}) {
  const session = sessionManager.appendTranscriptEvent(sessionId, {
    lane,
    type: "operator_prompt",
    content: summarizePrompt(prompt, sharedInstruction),
    routing_mode: operatorMode,
    round: 1,
    related_event_ids: sharedEventId ? [sharedEventId] : [],
  });

  return session.transcript.at(-1)?.id || null;
}

async function applyLaneExecutionResult({
  sessionManager,
  sessionId,
  lane,
  operatorMode,
  taskEventId,
  executionResult,
}) {
  for (const traceEvent of executionResult.trace_events || []) {
    sessionManager.appendTranscriptEvent(sessionId, {
      lane,
      type: traceEvent.event_type || "execution_action",
      content: String(traceEvent.content || ""),
      routing_mode: operatorMode,
      round: Number(traceEvent.round) || 1,
      verified: Boolean(traceEvent.verified),
      related_event_ids: taskEventId
        ? [taskEventId, ...(traceEvent.related_event_ids || [])]
        : traceEvent.related_event_ids || [],
      metrics: traceEvent.metrics || {},
      timestamp: traceEvent.timestamp,
    });
  }

  const replySession = sessionManager.appendTranscriptEvent(sessionId, {
    lane,
    type: executionResult.event_type || "agent_reply",
    content: String(executionResult.content || ""),
    routing_mode: operatorMode,
    round: Number(executionResult.round) || 1,
    verified: Boolean(executionResult.verified),
    related_event_ids: taskEventId ? [taskEventId] : [],
    metrics: executionResult.metrics || {},
  });

  const replyEventId = replySession.transcript.at(-1)?.id || null;

  if (executionResult.verification) {
    sessionManager.recordVerification(sessionId, lane, {
      ...executionResult.verification,
      related_event_ids: Array.from(
        new Set(
          [replyEventId, ...(executionResult.verification.related_event_ids || [])].filter(Boolean)
        )
      ),
    });
  }

  if (executionResult.verification_error_gap) {
    sessionManager.recordErrorGap(sessionId, lane, executionResult.verification_error_gap);
  }

  return {
    task_event_id: taskEventId || null,
    reply_event_id: replyEventId,
    content: String(executionResult.content || ""),
    event_type: executionResult.event_type || "agent_reply",
    verified: Boolean(executionResult.verified),
    confidence: executionResult.confidence ?? null,
    dissent: executionResult.dissent ?? null,
    risk_level: executionResult.risk_level ?? null,
    requires_review: Boolean(executionResult.requires_review),
    review_mode: executionResult.review_mode ?? null,
    metrics: executionResult.metrics || {},
    verification_status: executionResult.verification?.status ?? null,
    verification_summary: executionResult.verification?.summary ?? null,
    verification_source: executionResult.verification?.verification_type ?? null,
    confirmation_required: Boolean(executionResult.confirmation_required),
    confirmation_gate_id: executionResult.confirmation_gate?.id ?? null,
    confirmation_summary: executionResult.confirmation_gate?.summary ?? null,
    confirmation_category: executionResult.confirmation_gate?.category ?? null,
    confirmation_severity: executionResult.confirmation_gate?.severity ?? null,
    promoted_shared_risk: Boolean(executionResult.promoted_shared_risk),
    promoted_shared_risk_summary: executionResult.promoted_shared_risk_summary ?? null,
    promotion_severity: executionResult.promotion_severity ?? null,
  };
}

function recordLaneFailure({ sessionManager, sessionId, lane, error }) {
  sessionManager.recordErrorGap(sessionId, lane, {
    summary: error.message,
    severity: "high",
    kind: "error",
    status: "active",
  });
}

function shouldClearRecoveredLaneGap({ executionResult, promotion, confirmationGate }) {
  if (executionResult?.verification_error_gap) {
    return false;
  }

  if (promotion?.error_gap) {
    return false;
  }

  if (confirmationGate) {
    return false;
  }

  return true;
}

function clearRecoveredLaneGapIfNeeded({
  sessionManager,
  sessionId,
  lane,
  executionResult,
  promotion,
  confirmationGate,
}) {
  if (!shouldClearRecoveredLaneGap({ executionResult, promotion, confirmationGate })) {
    return false;
  }

  const session = sessionManager.getSession(sessionId);
  const latestGap =
    lane === "mac" ? session.mac_state.latest_error_gap : session.pc_state.latest_error_gap;

  if (latestGap.summary === "No active gaps.") {
    return false;
  }

  sessionManager.clearErrorGap(sessionId, lane);
  return true;
}

async function captureLaneRepoContext({
  sessionManager,
  sessionId,
  lane,
  executor,
  repo,
}) {
  if (typeof executor?.describeRepoContext !== "function") {
    return null;
  }

  const session = sessionManager.getSession(sessionId);
  const repoContext = await executor.describeRepoContext({
    repo,
    session,
  });
  sessionManager.recordLaneRepoContext(sessionId, lane, repoContext);
  return repoContext;
}

async function runMacVerificationIfNeeded({
  macVerificationPipeline,
  sessionManager,
  sessionId,
  operatorMode,
  lane,
  executionResult,
}) {
  if (lane !== "mac" || !macVerificationPipeline) {
    return executionResult;
  }

  const verified = await macVerificationPipeline.run({
    session: sessionManager.getSession(sessionId),
    executionResult,
    operatorMode,
  });

  return verified.executionResult;
}

async function runMacConfirmationGateIfNeeded({
  macConfirmationGatePipeline,
  executionResult,
  lane,
}) {
  if (lane !== "mac" || !macConfirmationGatePipeline) {
    return {
      executionResult,
      confirmationGate: null,
    };
  }

  return macConfirmationGatePipeline.run({
    executionResult,
  });
}

async function runPcCritiquePromotionIfNeeded({
  pcCritiquePromotionPipeline,
  executionResult,
  lane,
}) {
  if (lane !== "pc" || !pcCritiquePromotionPipeline) {
    return {
      executionResult,
      promotion: null,
    };
  }

  return pcCritiquePromotionPipeline.run({
    executionResult,
  });
}

function applyPcCritiquePromotion({
  sessionManager,
  sessionId,
  operatorMode,
  laneResult,
  promotion,
}) {
  if (!promotion) {
    return null;
  }

  sessionManager.updateMissionState(sessionId, {
    arbitration_state: promotion.arbitration_state,
    current_compare_summary: promotion.summary,
  });

  sessionManager.appendTranscriptEvent(sessionId, {
    lane: "shared",
    type: "arbitration",
    content: promotion.summary,
    routing_mode: operatorMode,
    round: 1,
    related_event_ids: laneResult?.reply_event_id ? [laneResult.reply_event_id] : [],
  });

  sessionManager.recordErrorGap(sessionId, "pc", promotion.error_gap);
  return promotion;
}

function applyMacConfirmationGate({
  sessionManager,
  sessionId,
  operatorMode,
  laneResult,
  confirmationGate,
}) {
  if (!confirmationGate) {
    return null;
  }

  sessionManager.recordConfirmationGate(sessionId, "mac", {
    ...confirmationGate,
    related_event_ids: laneResult?.reply_event_id ? [laneResult.reply_event_id] : [],
  });
  sessionManager.updateMissionState(sessionId, {
    arbitration_state: "operator_decision",
    current_compare_summary: confirmationGate.summary,
  });
  sessionManager.appendTranscriptEvent(sessionId, {
    lane: "shared",
    type: "arbitration",
    content: confirmationGate.summary,
    routing_mode: operatorMode,
    round: 1,
    related_event_ids: laneResult?.reply_event_id ? [laneResult.reply_event_id] : [],
  });
  sessionManager.recordErrorGap(sessionId, "mac", {
    summary: confirmationGate.summary,
    severity: confirmationGate.severity,
    kind: "confirmation_required",
    status: "active",
    superseded_by_event_id: null,
    timestamp: confirmationGate.requested_at,
  });
  return confirmationGate;
}

function resolvePendingMacConfirmation({
  sessionManager,
  sessionId,
  body,
  operatorMode,
}) {
  const pendingGate = sessionManager.getSession(sessionId).mac_state.confirmation_gate;
  if (pendingGate.status !== "pending") {
    return {
      approved: false,
      blocked: false,
      pendingGate: null,
    };
  }

  const approval = body.operator_confirmation || body.mac_operator_confirmation || null;
  const gateMatches =
    !approval?.gate_id || String(approval.gate_id) === String(pendingGate.id);

  if (approval?.approve === true && gateMatches) {
    sessionManager.appendTranscriptEvent(sessionId, {
      lane: "shared",
      type: "arbitration",
      content: `Operator approved confirmation gate: ${pendingGate.summary}`,
      routing_mode: operatorMode,
      round: 1,
      related_event_ids: pendingGate.related_event_ids || [],
    });
    sessionManager.clearConfirmationGate(sessionId, "mac");
    sessionManager.clearErrorGap(sessionId, "mac");
    return {
      approved: true,
      blocked: false,
      pendingGate,
    };
  }

  return {
    approved: false,
    blocked: true,
    pendingGate,
  };
}

function finalizeConflictArbitration({
  sessionManager,
  sessionId,
  operatorMode,
  decision,
  relatedEventIds = [],
  suppressEvent = false,
  updateSummary = true,
}) {
  if (!decision) {
    return null;
  }

  sessionManager.updateMissionState(sessionId, {
    arbitration_state: decision.arbitration_state,
    ...(updateSummary ? { current_compare_summary: decision.summary } : {}),
  });

  if (decision.should_emit_event && !suppressEvent) {
    sessionManager.appendTranscriptEvent(sessionId, {
      lane: "shared",
      type: "arbitration",
      content: decision.summary,
      routing_mode: operatorMode,
      round: 1,
      related_event_ids: relatedEventIds.filter(Boolean),
    });
  }

  return decision;
}

function resolveGitHubErrorResponse(error) {
  const statusCodeByErrorCode = {
    AUTH_REQUIRED: 401,
    REPO_CONTEXT_REQUIRED: 400,
    INVALID_REPO: 400,
    REPO_UNAVAILABLE: 404,
    GH_UNAVAILABLE: 503,
    GITHUB_TOOL_ERROR: 502,
  };

  return {
    statusCode: statusCodeByErrorCode[error.code] || 502,
    payload: {
      ok: false,
      code: error.code || "GITHUB_TOOL_ERROR",
      message: error.message,
    },
  };
}

function resolveGitHubSession(sessionManager, sessionId) {
  if (!sessionId) {
    return null;
  }

  return sessionManager.getSession(String(sessionId));
}

async function handleGitHubAuthStatusRoute({ githubTooling }) {
  try {
    const auth = await githubTooling.getAuthStatus();
    return {
      statusCode: 200,
      payload: {
        ok: true,
        auth,
      },
    };
  } catch (error) {
    return resolveGitHubErrorResponse(error);
  }
}

async function handleGitHubRepoRoute({ githubTooling, sessionManager }, body) {
  try {
    const session = resolveGitHubSession(sessionManager, body.session_id);
    const repoDetails = await githubTooling.inspectRepo({
      repo: body.repo,
      session,
    });
    return {
      statusCode: 200,
      payload: {
        ok: true,
        ...repoDetails,
      },
    };
  } catch (error) {
    return resolveGitHubErrorResponse(error);
  }
}

async function handleGitHubIssuesRoute({ githubTooling, sessionManager }, body) {
  try {
    const session = resolveGitHubSession(sessionManager, body.session_id);
    const issues = await githubTooling.listIssues({
      repo: body.repo,
      session,
      limit: body.limit,
    });
    return {
      statusCode: 200,
      payload: {
        ok: true,
        ...issues,
      },
    };
  } catch (error) {
    return resolveGitHubErrorResponse(error);
  }
}

async function handleGitHubPullRequestsRoute({ githubTooling, sessionManager }, body) {
  try {
    const session = resolveGitHubSession(sessionManager, body.session_id);
    const pullRequests = await githubTooling.listPullRequests({
      repo: body.repo,
      session,
      limit: body.limit,
    });
    return {
      statusCode: 200,
      payload: {
        ok: true,
        ...pullRequests,
      },
    };
  } catch (error) {
    return resolveGitHubErrorResponse(error);
  }
}

async function handleGitHubWorkflowsRoute({ githubTooling, sessionManager }, body) {
  try {
    const session = resolveGitHubSession(sessionManager, body.session_id);
    const workflows = await githubTooling.listWorkflows({
      repo: body.repo,
      session,
      limit: body.limit,
    });
    return {
      statusCode: 200,
      payload: {
        ok: true,
        ...workflows,
      },
    };
  } catch (error) {
    return resolveGitHubErrorResponse(error);
  }
}

async function refreshSessionRepoContexts({
  sessionManager,
  sessionId,
  macExecutor,
  pcExecutor,
}) {
  const session = sessionManager.getSession(sessionId);
  const repo = session.mission_state.active_repo;
  const [macRepoContext, pcRepoContext] = await Promise.all([
    typeof macExecutor?.describeRepoContext === "function"
      ? macExecutor.describeRepoContext({ repo, session })
      : null,
    typeof pcExecutor?.describeRepoContext === "function"
      ? pcExecutor.describeRepoContext({ repo, session })
      : null,
  ]);

  if (macRepoContext) {
    sessionManager.recordLaneRepoContext(sessionId, "mac", macRepoContext);
  }
  if (pcRepoContext) {
    sessionManager.recordLaneRepoContext(sessionId, "pc", pcRepoContext);
  }

  return sessionManager.getSession(sessionId);
}

async function refreshAllSessionRepoContexts({
  sessionManager,
  macExecutor,
  pcExecutor,
}) {
  const sessions = sessionManager.listSessions();
  for (const session of sessions) {
    await refreshSessionRepoContexts({
      sessionManager,
      sessionId: session.session_id,
      macExecutor,
      pcExecutor,
    });
  }
}

async function handleGetLaneConfigRoute({
  artifactsDir,
  laneConfigStore,
  taildropInboxDir,
  downloadsDir,
  liveRecoveryDir,
  laneConfigDir,
}) {
  const laneConfig = laneConfigStore.getConfig();
  const macRepoReport = await loadLatestMacRepoReport({
    taildropInboxDir,
    downloadsDir,
    laneConfigDir,
  });
  const { data: macRepoNudgeSend } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-nudge-send.json")
  );
  const { data: macRepoFallbackSend } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-fallback-send.json")
  );
  const { data: macRepoManualSend } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-manual-send.json")
  );
  const { data: macRepoSmartApply } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-smart-apply.json")
  );
  const { data: macRepoClear } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-clear.json")
  );
  const { data: macRepoInputClear } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-input-clear.json")
  );
  const { data: laneConfigRecommendedRun } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-lane-config-recommended-run.json")
  );
  const { data: macRepoInputCandidate } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-input-candidate.json")
  );
  const { data: macRepoClipboardProbe } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-clipboard-probe.json")
  );
  const { data: macRepoRequestSend } = await readOptionalJsonFile(
    path.join(liveRecoveryDir, "last-mac-repo-report-request-send.json")
  );
  const { data: macRepoWatcherStart } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-report-watcher-start.json")
  );
  const { data: macRepoWatcherSummary, stat: macRepoWatcherSummaryStat } = await readOptionalJsonFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json")
  );
  const { data: macRepoWatcherOutput, stat: macRepoWatcherOutputStat } = await readOptionalTextFile(
    path.join(laneConfigDir, "mac-repo-report-watcher-output.txt")
  );
  const { data: macRepoWatcherMeta } = await readOptionalJsonFile(
    path.join(laneConfigDir, "mac-repo-report-watcher.pid")
  );
  const macRepoPathStillConfigured = Boolean(
    String(
      macRepoReport?.repo_path ||
      laneConfig?.effective_repo_paths?.mac ||
      laneConfig?.configured_repo_paths?.mac ||
      ""
    ).trim()
  );
  const macRepoWatcher = buildWatcherStatus({
    watcherMeta: macRepoWatcherMeta,
    watcherOutputStat: macRepoWatcherOutputStat,
    recoverySummary: macRepoWatcherSummary?.status === "applied" && macRepoPathStillConfigured
      ? { recovered_at: macRepoWatcherSummary.applied_at || macRepoWatcherSummary.last_checked_at }
      : null,
  });
  const laneConfigStatus = buildLaneConfigStatus(
    laneConfig,
    macRepoReport,
    macRepoWatcher,
    macRepoWatcherSummary,
    macRepoManualSend,
    macRepoInputCandidate
  );
  const macRepoInputRisk = buildMacRepoInputRisk(macRepoInputCandidate);
  const macRepoClipboardProbeFreshness = buildMacRepoClipboardProbeFreshness(
    macRepoClipboardProbe
  );
  const macRepoSmartApplyState = buildMacRepoSmartApplyState(
    macRepoSmartApply,
    macRepoClear,
    laneConfig,
    macRepoReport
  );
  const laneConfigRecommendedRunSummary = summarizeLaneConfigRecommendedRun(laneConfigRecommendedRun);
  const laneConfigRecommendedRunState = buildLaneConfigRecommendedRunState(
    laneConfigRecommendedRunSummary,
    macRepoInputClear
  );
  const laneConfigRecommendedAction = buildLaneConfigRecommendedAction(laneConfig, macRepoReport, {
    laneConfigStatus,
    macRepoInputCandidate,
    macRepoClipboardProbe,
    macRepoClipboardProbeFreshness,
    macRepoInputRisk,
    macRepoInputClear,
    laneConfigRecommendedRun,
    macRepoNudgeSend,
    macRepoFallbackSend,
    macRepoManualSend,
    macRepoRequestSend,
    macRepoWatcherSummary,
  });
  const laneConfigManualSurfaceBase = buildLaneConfigManualSurface(
    laneConfigStatus,
    laneConfigRecommendedAction,
    {
      macRepoClipboardProbe,
      macRepoClipboardProbeFreshness,
      macRepoInputRisk,
      macRepoInputCandidate,
      laneConfigRecommendedRun: laneConfigRecommendedRunSummary,
      laneConfigRecommendedRunState,
    }
  );

  const laneConfigAction = buildLaneConfigAction(laneConfig, macRepoReport, {
    laneConfigManualSurface: laneConfigManualSurfaceBase,
    macRepoNudgeSend,
    macRepoFallbackSend,
    macRepoManualSend,
    macRepoRequestSend,
    macRepoWatcherSummary,
    macRepoInputClear,
  });
  const laneConfigManualSurface = {
    ...laneConfigManualSurfaceBase,
    action: laneConfigAction,
  };

  return {
    statusCode: 200,
    payload: {
      ok: true,
      lane_config: laneConfig,
      lane_config_status: laneConfigStatus,
      mac_repo_report: macRepoReport,
      mac_repo_action_pack: buildMacRepoActionPack({
        artifactsDir,
        macRepoReport,
        macRepoRequestSend,
      }),
      mac_repo_nudge_send: macRepoNudgeSend,
      mac_repo_fallback_send: macRepoFallbackSend,
      mac_repo_manual_send: macRepoManualSend,
      mac_repo_smart_apply: macRepoSmartApply,
      mac_repo_smart_apply_state: macRepoSmartApplyState,
      mac_repo_clear: macRepoClear,
      mac_repo_input_clear: macRepoInputClear,
      mac_repo_input_candidate: macRepoInputCandidate,
      mac_repo_clipboard_probe: macRepoClipboardProbe,
      mac_repo_clipboard_probe_freshness: macRepoClipboardProbeFreshness,
      mac_repo_input_risk: macRepoInputRisk,
      lane_config_manual_surface: laneConfigManualSurface,
      mac_repo_request_send: macRepoRequestSend,
      mac_repo_watcher_start: macRepoWatcherStart,
      mac_repo_watcher_summary: macRepoWatcherSummary,
      mac_repo_watcher: macRepoWatcher,
      mac_repo_watcher_output_lines: summarizeWatcherOutput(macRepoWatcherOutput),
      mac_repo_watcher_output_updated_at: macRepoWatcherOutputStat?.mtime?.toISOString?.() || null,
    },
  };
}

function buildRunRecommendedLaneConfigAction({
  laneConfig,
  laneConfigStatus,
  macRepoReport,
  reportText = "",
  macRepoInputCandidate = null,
  macRepoClipboardProbe = null,
  macRepoClipboardProbeFreshness = null,
  macRepoInputRisk = null,
  macRepoInputClear = null,
  laneConfigRecommendedRun = null,
  macRepoNudgeSend = null,
  macRepoFallbackSend = null,
  macRepoManualSend = null,
  macRepoRequestSend = null,
  macRepoWatcherSummary = null,
}) {
  const trimmedReportText = String(
    reportText ||
      (macRepoInputCandidate?.has_usable_repo_path
        ? macRepoInputCandidate?.input_text
        : "") ||
      ""
  ).trim();
  const pastedPreview = trimmedReportText ? buildPastedMacRepoPreview(trimmedReportText) : null;

  if (macRepoReport?.repo_path || laneConfigStatus?.can_apply_report) {
    return {
      key: "apply_report",
      label: "Apply Report",
      reason: "A returned Mac repo report is ready right now.",
      source: "server",
    };
  }

  if (pastedPreview?.repo_path) {
    return {
      key: "smart_apply",
      label: "Smart Apply",
      reason: "The provided Mac repo text already contains a usable Gemma repo path.",
      source: "report_text",
    };
  }

  if (trimmedReportText) {
    return {
      key: "apply_pasted_report",
      label: "Apply Pasted Report",
      reason: "Manual Mac Repo Report already has text loaded for review.",
      source: "report_text",
    };
  }

  return buildLaneConfigRecommendedAction(laneConfig, macRepoReport, {
    laneConfigStatus,
    macRepoInputCandidate,
    macRepoClipboardProbe,
    macRepoClipboardProbeFreshness,
    macRepoInputRisk,
    macRepoInputClear,
    laneConfigRecommendedRun,
    macRepoNudgeSend,
    macRepoFallbackSend,
    macRepoManualSend,
    macRepoRequestSend,
    macRepoWatcherSummary,
  });
}

async function handleRunRecommendedLaneConfigActionRoute(
  {
    artifactsDir,
    laneConfigStore,
    sessionManager,
    macExecutor,
    pcExecutor,
    taildropInboxDir,
    downloadsDir,
    liveRecoveryDir,
    laneConfigDir,
    readWindowsClipboard,
    pullTaildropInbox,
    sendMacRepoNudge,
    sendMacRepoReportRequest,
    sendMacRepoFallbackBlock,
  },
  body
) {
  const loadLaneConfigPayload = async () => {
    const laneConfigResponse = await handleGetLaneConfigRoute({
      artifactsDir,
      laneConfigStore,
      taildropInboxDir,
      downloadsDir,
      liveRecoveryDir,
      laneConfigDir,
    });
    return laneConfigResponse.payload || {};
  };
  const laneConfigPayload = await loadLaneConfigPayload();
  const liveClipboardProbe =
    !String(body?.report_text || "").trim()
      ? await persistMacRepoClipboardProbe({
          laneConfigDir,
          probe: await buildMacRepoClipboardProbe({
            readWindowsClipboard,
            laneConfigDir,
          }),
        })
      : null;
  const effectiveClipboardProbe =
    liveClipboardProbe || laneConfigPayload.mac_repo_clipboard_probe || null;
  const effectiveClipboardProbeFreshness = buildMacRepoClipboardProbeFreshness(
    effectiveClipboardProbe
  );
  const recommendedAction = buildRunRecommendedLaneConfigAction({
    laneConfig: laneConfigPayload.lane_config || null,
    laneConfigStatus: laneConfigPayload.lane_config_status || null,
    macRepoReport: laneConfigPayload.mac_repo_report || null,
    reportText: body?.report_text || "",
    macRepoInputCandidate: laneConfigPayload.mac_repo_input_candidate || null,
    macRepoClipboardProbe: effectiveClipboardProbe,
    macRepoClipboardProbeFreshness: effectiveClipboardProbeFreshness,
    macRepoInputRisk: laneConfigPayload.mac_repo_input_risk || null,
    macRepoInputClear: laneConfigPayload.mac_repo_input_clear || null,
    laneConfigRecommendedRun:
      laneConfigPayload.lane_config_manual_surface?.recommended_run || null,
    macRepoNudgeSend: laneConfigPayload.mac_repo_nudge_send || null,
    macRepoFallbackSend: laneConfigPayload.mac_repo_fallback_send || null,
    macRepoManualSend: laneConfigPayload.mac_repo_manual_send || null,
    macRepoRequestSend: laneConfigPayload.mac_repo_request_send || null,
    macRepoWatcherSummary: laneConfigPayload.mac_repo_watcher_summary || null,
  });

  if (recommendedAction.blocked) {
    const blockedExecutedAction = buildLaneConfigExecutedAction(recommendedAction);
    const receipt = buildLaneConfigRecommendedRunReceipt({
      ok: false,
      statusCode: 409,
      code: recommendedAction.blocked_code || "RECOMMENDED_ACTION_BLOCKED",
      message: recommendedAction.blocked_reason || recommendedAction.reason,
      recommendedAction,
      executedAction: blockedExecutedAction,
      repoPath: null,
    });
    await mkdir(laneConfigDir, { recursive: true });
    await writeFile(
      path.join(laneConfigDir, "last-lane-config-recommended-run.json"),
      JSON.stringify(receipt, null, 2)
    );
    const refreshedLaneConfigPayload = await loadLaneConfigPayload();

    return {
      statusCode: 409,
      payload: {
        ...refreshedLaneConfigPayload,
        ok: false,
        code: receipt.code,
        message: receipt.message,
        mac_repo_input_candidate:
          refreshedLaneConfigPayload.mac_repo_input_candidate ||
          laneConfigPayload.mac_repo_input_candidate ||
          null,
        mac_repo_clipboard_probe:
          refreshedLaneConfigPayload.mac_repo_clipboard_probe ||
          effectiveClipboardProbe,
        mac_repo_clipboard_probe_freshness:
          refreshedLaneConfigPayload.mac_repo_clipboard_probe_freshness ||
          effectiveClipboardProbeFreshness,
        mac_repo_input_risk:
          refreshedLaneConfigPayload.mac_repo_input_risk ||
          laneConfigPayload.mac_repo_input_risk ||
          null,
      },
    };
  }

  let executedAction = buildLaneConfigExecutedAction(recommendedAction);
  let result;
  let executionKey = recommendedAction.key;

  if (recommendedAction.key === "load_clipboard") {
    const liveClipboardText = String((await readWindowsClipboard()) || "");
    const liveClipboardPreview = buildClipboardMacRepoPreview(liveClipboardText);
    if (liveClipboardPreview?.repo_path) {
      executionKey = "apply_clipboard";
      executedAction = buildLaneConfigExecutedAction(recommendedAction, {
        key: "apply_clipboard",
        label: "Apply Clipboard",
        reason:
          "The current Windows clipboard already contains a usable Mac repo path, so the one-click path can finish immediately.",
      });
    }
  }

  if (recommendedAction.key === "probe_clipboard" && effectiveClipboardProbe?.preview?.repo_path) {
    executionKey = "apply_clipboard";
    executedAction = buildLaneConfigExecutedAction(recommendedAction, {
      key: "apply_clipboard",
      label: "Apply Clipboard",
      reason:
        "A fresh clipboard probe found a usable Mac repo path, so the one-click path can finish immediately.",
    });
  }

  switch (executionKey) {
    case "apply_report":
      result = await handleUpdateLaneConfigRoute(
        {
          laneConfigStore,
          sessionManager,
          macExecutor,
          pcExecutor,
          taildropInboxDir,
          downloadsDir,
          laneConfigDir,
        },
        {
          ...body,
          apply_mac_repo_report: true,
        }
      );
      break;
    case "smart_apply":
      result = await handleSmartApplyMacRepoReportRoute(
        {
          pullTaildropInbox,
          liveRecoveryDir,
          laneConfigStore,
          sessionManager,
          macExecutor,
          pcExecutor,
          taildropInboxDir,
          downloadsDir,
          laneConfigDir,
          readWindowsClipboard,
        },
        {
          ...body,
          report_text: String(
            body?.report_text ||
              laneConfigPayload.mac_repo_input_candidate?.input_text ||
              ""
          ).trim(),
        }
      );
      break;
    case "apply_pasted_report":
      result = await handleApplyMacRepoReportTextRoute(
        {
          laneConfigStore,
          sessionManager,
          macExecutor,
          pcExecutor,
          taildropInboxDir,
          downloadsDir,
          laneConfigDir,
        },
        {
          ...body,
          report_text: String(
            body?.report_text ||
              laneConfigPayload.mac_repo_input_candidate?.input_text ||
              ""
          ).trim(),
        }
      );
      break;
    case "apply_clipboard":
      result = await handleApplyMacRepoReportClipboardRoute(
        {
          laneConfigStore,
          sessionManager,
          macExecutor,
          pcExecutor,
          taildropInboxDir,
          downloadsDir,
          laneConfigDir,
          readWindowsClipboard,
        },
        body
      );
      break;
    case "load_clipboard":
      result = await handleLoadMacRepoReportClipboardRoute({
        readWindowsClipboard,
        laneConfigDir,
      });
      break;
    case "probe_clipboard":
      result = await handleProbeMacRepoClipboardRoute({
        readWindowsClipboard,
        laneConfigDir,
      });
      break;
    case "clear_mac_repo_path":
      result = await handleUpdateLaneConfigRoute(
        {
          laneConfigStore,
          sessionManager,
          macExecutor,
          pcExecutor,
          taildropInboxDir,
          downloadsDir,
          laneConfigDir,
        },
        {
          ...body,
          mac_repo_path: "",
        }
      );
      break;
    case "send_nudge":
    default:
      result = await handleSendMacRepoNudgeRoute({
        sendMacRepoNudge,
        sendMacRepoReportRequest,
        sendMacRepoFallbackBlock,
        laneConfigDir,
      });
      break;
  }

  const receipt = buildLaneConfigRecommendedRunReceipt({
    ok: result.payload?.ok ?? result.statusCode < 400,
    statusCode: result.statusCode,
    code: result.payload?.code || null,
    message: result.payload?.message || null,
    recommendedAction,
    executedAction,
    repoPath:
      result.payload?.lane_config?.configured_repo_paths?.mac ||
      result.payload?.mac_repo_report?.repo_path ||
      null,
  });
  await mkdir(laneConfigDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-lane-config-recommended-run.json"),
    JSON.stringify(receipt, null, 2)
  );
  const refreshedLaneConfigPayload = await loadLaneConfigPayload();

  return {
    statusCode: result.statusCode,
    payload: {
      ...refreshedLaneConfigPayload,
      ...result.payload,
      ok: result.payload?.ok ?? result.statusCode < 400,
      mac_repo_clipboard_probe:
        result.payload?.mac_repo_clipboard_probe ||
        refreshedLaneConfigPayload.mac_repo_clipboard_probe ||
        effectiveClipboardProbe,
      mac_repo_clipboard_probe_freshness:
        result.payload?.mac_repo_clipboard_probe_freshness ||
        refreshedLaneConfigPayload.mac_repo_clipboard_probe_freshness ||
        buildMacRepoClipboardProbeFreshness(
          result.payload?.mac_repo_clipboard_probe || effectiveClipboardProbe
        ),
    },
  };
}

async function handleUpdateLaneConfigRoute(
  { laneConfigStore, sessionManager, macExecutor, pcExecutor, taildropInboxDir, downloadsDir, laneConfigDir },
  body
) {
  const currentLaneConfig = laneConfigStore.getConfig({
    activeRepo: body.active_repo,
  });
  let macRepoPath = body.mac_repo_path;
  if (body.apply_mac_repo_report) {
    const macRepoReport = await loadLatestMacRepoReport({
      taildropInboxDir,
      downloadsDir,
      laneConfigDir,
    });

    if (!macRepoReport?.repo_path) {
      return {
        statusCode: 409,
        payload: {
          ok: false,
          code: "MAC_REPO_REPORT_MISSING",
          message: "No Mac repo report with a Gemma path is available yet.",
        },
      };
    }

    macRepoPath = macRepoReport.repo_path;
  }

  const previousMacRepoPath = currentLaneConfig?.configured_repo_paths?.mac || "";
  const shouldClearMacRepoPath =
    Object.prototype.hasOwnProperty.call(body || {}, "mac_repo_path") &&
    macRepoPath !== undefined &&
    !String(body.apply_mac_repo_report || "").trim() &&
    !String(macRepoPath || "").trim();

  let removedManualReport = false;
  if (shouldClearMacRepoPath && laneConfigDir) {
    const manualReportPath = path.join(laneConfigDir, "agro-mac-repo-path-report-manual.txt");
    try {
      await rm(manualReportPath, { force: true });
      removedManualReport = true;
    } catch {
      removedManualReport = false;
    }
  }

  const laneConfig = laneConfigStore.updateConfig({
    activeRepo: body.active_repo,
    macRepoPath,
    pcRepoPath: body.pc_repo_path,
  });

  await refreshAllSessionRepoContexts({
    sessionManager,
    macExecutor,
    pcExecutor,
  });

  if (shouldClearMacRepoPath && laneConfigDir) {
    const clearReceiptPath = path.join(laneConfigDir, "last-mac-repo-clear.json");
    const sessionId = String(body.session_id || "").trim();
    const clearReceipt = {
      ok: true,
      previous_mac_repo_path: previousMacRepoPath || null,
      cleared_mac_repo_path: "",
      removed_manual_report: removedManualReport,
      session_id: sessionId || null,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(laneConfigDir, { recursive: true });
    await writeFile(clearReceiptPath, JSON.stringify(clearReceipt, null, 2));
  }

  const sessionId = String(body.session_id || "").trim();
  const session = sessionId ? sessionManager.getSession(sessionId) : null;

  return {
    statusCode: 200,
    payload: {
      ok: true,
      lane_config: laneConfig,
      mac_repo_report: await loadLatestMacRepoReport({
        taildropInboxDir,
        downloadsDir,
        laneConfigDir,
      }),
      session,
      updated_sessions_count: sessionManager.listSessions().length,
    },
  };
}

async function handleApplyMacRepoReportTextRoute(
  { laneConfigStore, sessionManager, macExecutor, pcExecutor, taildropInboxDir, downloadsDir, laneConfigDir },
  body
) {
  return applyMacRepoReportTextInput(
    { laneConfigStore, sessionManager, macExecutor, pcExecutor, taildropInboxDir, downloadsDir, laneConfigDir },
    body,
    body.report_text
  );
}

async function persistManualMacRepoReportText({
  laneConfigDir,
  reportText,
}) {
  await mkdir(laneConfigDir, { recursive: true });
  const manualReportPath = path.join(laneConfigDir, "agro-mac-repo-path-report-manual.txt");
  const normalizedText = `${String(reportText || "").trim()}\n`;
  await writeFile(manualReportPath, normalizedText, "utf8");
  const fileStat = await stat(manualReportPath);
  return parseMacRepoPathReport(normalizedText, {
    path: manualReportPath,
    name: path.basename(manualReportPath),
    source: "lane-config",
    stat: fileStat,
  });
}

function buildMacRepoInputCandidate({
  source,
  inputText,
  preview,
  message = null,
  code = null,
  sourceLabel = null,
}) {
  const normalizedInput = String(inputText || "");
  const sanitizedInput = redactSensitiveText(normalizedInput);
  const normalizedPreview = preview || null;
  const normalizedSource = String(source || "unknown").trim() || "unknown";
  const derivedSourceLabel =
    sourceLabel ||
    {
      clipboard: "clipboard loaded",
      pasted_text: "pasted text loaded",
    }[normalizedSource] ||
    normalizedSource.replace(/_/g, " ");

  return {
    source: normalizedSource,
    source_label: derivedSourceLabel,
    input_text: sanitizedInput.text,
    input_text_length: normalizedInput.length,
    preview: normalizedPreview,
    has_usable_repo_path: Boolean(normalizedPreview?.repo_path),
    repo_path: normalizedPreview?.repo_path || null,
    repo_origin: normalizedPreview?.repo_origin || null,
    redaction_count: sanitizedInput.redaction_count,
    message: message ? String(message) : null,
    code: code ? String(code) : null,
    recorded_at: new Date().toISOString(),
  };
}

async function persistMacRepoInputCandidate({
  laneConfigDir,
  source,
  inputText,
  preview,
  message = null,
  code = null,
  sourceLabel = null,
}) {
  const candidate = buildMacRepoInputCandidate({
    source,
    inputText,
    preview,
    message,
    code,
    sourceLabel,
  });
  await mkdir(laneConfigDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-input-candidate.json"),
    JSON.stringify(candidate, null, 2)
  );
  return candidate;
}

async function clearMacRepoInputCandidate({ laneConfigDir }) {
  if (!laneConfigDir) {
    return;
  }

  await rm(path.join(laneConfigDir, "last-mac-repo-input-candidate.json"), {
    force: true,
  });
}

async function persistMacRepoClipboardProbe({ laneConfigDir, probe }) {
  await mkdir(laneConfigDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-clipboard-probe.json"),
    JSON.stringify(probe, null, 2)
  );
  return probe;
}

async function buildMacRepoClipboardProbe({
  readWindowsClipboard,
  laneConfigDir,
}) {
  const clipboardText = await readWindowsClipboard();
  const trimmedClipboardText = String(clipboardText || "").trim();
  const sanitizedClipboard = redactSensitiveText(clipboardText);
  const effectivePreview = trimmedClipboardText
    ? buildClipboardMacRepoPreview(clipboardText)
    : null;
  const { data: currentInputCandidate } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-input-candidate.json")
  );
  const { data: lastInputClear } = await readOptionalJsonFile(
    path.join(laneConfigDir, "last-mac-repo-input-clear.json")
  );
  const unchangedCandidate =
    currentInputCandidate &&
    !currentInputCandidate.has_usable_repo_path &&
    String(currentInputCandidate.input_text || "").trim() ===
      String(sanitizedClipboard.text || "").trim();
  const unchangedAfterInputClear =
    !currentInputCandidate &&
    lastInputClear &&
    String(lastInputClear.previous_input_text || "").trim() &&
    !lastInputClear.previous_has_usable_repo_path &&
    String(lastInputClear.previous_input_text || "").trim() ===
      String(sanitizedClipboard.text || "").trim();

  let state = "needs_review";
  let summary = "Clipboard has text, but it still needs review.";

  if (!trimmedClipboardText) {
    state = "empty";
    summary = "Windows clipboard is empty.";
  } else if (effectivePreview?.repo_path) {
    state = "usable";
    summary = "Windows clipboard already contains a usable Mac repo path.";
  } else if (unchangedCandidate) {
    state = "unchanged_candidate";
    summary =
      "Windows clipboard still matches the current loaded stale Mac repo input candidate.";
  } else if (unchangedAfterInputClear) {
    state = "unchanged_after_input_clear";
    summary =
      "Windows clipboard still matches the stale Mac repo input that was already cleared.";
  } else if (sanitizedClipboard.redaction_count > 0) {
    state = "secret_like_text";
    summary =
      "Windows clipboard includes redacted secret-looking text and still lacks a usable Mac repo path.";
  }

  return {
    state,
    summary,
    recorded_at: new Date().toISOString(),
    clipboard_text_length: String(clipboardText || "").length,
    redaction_count: sanitizedClipboard.redaction_count,
    has_usable_repo_path: Boolean(effectivePreview?.repo_path),
    preview: effectivePreview,
    unchanged_candidate: Boolean(unchangedCandidate),
    unchanged_after_input_clear: Boolean(unchangedAfterInputClear),
  };
}

async function applyMacRepoReportObject(
  { laneConfigStore, sessionManager, macExecutor, pcExecutor, laneConfigDir },
  body,
  macRepoReport,
  extraPayload = {}
) {
  await clearMacRepoInputCandidate({ laneConfigDir });
  const laneConfig = laneConfigStore.updateConfig({
    activeRepo: body.active_repo,
    macRepoPath: macRepoReport.repo_path,
  });

  await refreshAllSessionRepoContexts({
    sessionManager,
    macExecutor,
    pcExecutor,
  });

  const sessionId = String(body.session_id || "").trim();
  const session = sessionId ? sessionManager.getSession(sessionId) : null;

  return {
    statusCode: 200,
    payload: {
      ok: true,
      lane_config: laneConfig,
      mac_repo_report: macRepoReport,
      mac_repo_input_candidate: null,
      session,
      updated_sessions_count: sessionManager.listSessions().length,
      ...extraPayload,
    },
  };
}

async function applyMacRepoReportTextInput(
  { laneConfigStore, sessionManager, macExecutor, pcExecutor, taildropInboxDir, downloadsDir, laneConfigDir },
  body,
  reportTextInput
) {
  const reportText = String(reportTextInput || "").trim();
  if (!reportText) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        code: "MAC_REPO_REPORT_TEXT_REQUIRED",
        message: "A Mac repo report text block is required.",
      },
    };
  }

  const previewReport = parseMacRepoPathReport(reportText, {
    source: "lane-config",
    name: "agro-mac-repo-path-report-manual.txt",
  });

  if (!previewReport?.repo_path) {
    const effectivePreview = buildPastedMacRepoPreview(reportText);
    const inputCandidate = await persistMacRepoInputCandidate({
      laneConfigDir,
      source: "pasted_text",
      inputText: reportText,
      preview: effectivePreview,
      message:
        "The pasted Mac repo report did not include a usable Gemma repo path. Paste either a USER=/HOST=/GEMMA_REPO_PATH= block, or a Mac reply containing a plain /Users/.../Gemma path.",
      code: "MAC_REPO_REPORT_TEXT_MISSING_PATH",
      sourceLabel: "pasted text needs review",
    });
    return {
      statusCode: 409,
      payload: {
        ok: false,
        code: "MAC_REPO_REPORT_TEXT_MISSING_PATH",
        message:
          "The pasted Mac repo report did not include a usable Gemma repo path. Paste either a USER=/HOST=/GEMMA_REPO_PATH= block, or a Mac reply containing a plain /Users/.../Gemma path.",
        mac_repo_report: effectivePreview,
        report_text: redactSensitiveText(reportText).text,
        report_text_length: reportText.length,
        mac_repo_report_preview: effectivePreview,
        mac_repo_input_candidate: inputCandidate,
        mac_repo_input_risk: buildMacRepoInputRisk(inputCandidate),
        has_usable_repo_path: false,
      },
    };
  }

  const macRepoReport = await persistManualMacRepoReportText({
    laneConfigDir,
    reportText,
  });

  return applyMacRepoReportObject(
    { laneConfigStore, sessionManager, macExecutor, pcExecutor, laneConfigDir },
    body,
    macRepoReport
  );
}

async function handleApplyMacRepoReportClipboardRoute(
  {
    laneConfigStore,
    sessionManager,
    macExecutor,
    pcExecutor,
    taildropInboxDir,
    downloadsDir,
    laneConfigDir,
    readWindowsClipboard,
  },
  body
) {
  try {
    const clipboardText = await readWindowsClipboard();
    if (!String(clipboardText || "").trim()) {
      return {
        statusCode: 409,
        payload: {
          ok: false,
          code: "WINDOWS_CLIPBOARD_EMPTY",
          message: "The Windows clipboard is empty. Copy the Mac repo text first, then try Apply Clipboard again.",
        },
      };
    }

    const result = await applyMacRepoReportTextInput(
      { laneConfigStore, sessionManager, macExecutor, pcExecutor, taildropInboxDir, downloadsDir, laneConfigDir },
      body,
      clipboardText
    );

    const clipboardTextLength = String(clipboardText || "").length;
    const sanitizedClipboardText = redactSensitiveText(clipboardText).text;
    if (result?.payload?.ok) {
      result.payload.clipboard_text_length = clipboardTextLength;
    } else if (result?.payload) {
      const preview = buildClipboardMacRepoPreview(clipboardText);
      const inputCandidate = await persistMacRepoInputCandidate({
        laneConfigDir,
        source: "clipboard",
        inputText: clipboardText,
        preview,
        message: result.payload.message || null,
        code: result.payload.code || null,
        sourceLabel: "clipboard apply needs review",
      });
      result.payload.clipboard_text = sanitizedClipboardText;
      result.payload.clipboard_text_length = clipboardTextLength;
      result.payload.mac_repo_report_preview = preview;
      result.payload.mac_repo_input_candidate = inputCandidate;
      result.payload.mac_repo_input_risk = buildMacRepoInputRisk(inputCandidate);
      result.payload.has_usable_repo_path = Boolean(preview?.repo_path);
    }

    return result;
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleLoadMacRepoReportClipboardRoute({ readWindowsClipboard, laneConfigDir }) {
  try {
    const clipboardText = await readWindowsClipboard();
    if (!String(clipboardText || "").trim()) {
      return {
        statusCode: 409,
        payload: {
          ok: false,
          code: "WINDOWS_CLIPBOARD_EMPTY",
          message: "The Windows clipboard is empty. Copy the Mac repo text first, then try Load Clipboard again.",
          clipboard_text: "",
          clipboard_text_length: 0,
          mac_repo_report_preview: null,
          has_usable_repo_path: false,
        },
      };
    }

    const sanitizedClipboard = redactSensitiveText(clipboardText);
    const { data: currentInputCandidate } = await readOptionalJsonFile(
      path.join(laneConfigDir, "last-mac-repo-input-candidate.json")
    );
    const { data: lastInputClear } = await readOptionalJsonFile(
      path.join(laneConfigDir, "last-mac-repo-input-clear.json")
    );
    const effectivePreview = buildClipboardMacRepoPreview(clipboardText);
    const unchangedCandidate =
      currentInputCandidate &&
      !currentInputCandidate.has_usable_repo_path &&
      String(currentInputCandidate.input_text || "").trim() ===
        String(sanitizedClipboard.text || "").trim();
    const unchangedAfterClear =
      !currentInputCandidate &&
      lastInputClear &&
      String(lastInputClear.previous_input_text || "").trim() &&
      !lastInputClear.previous_has_usable_repo_path &&
      String(lastInputClear.previous_input_text || "").trim() ===
        String(sanitizedClipboard.text || "").trim();

    if (unchangedCandidate || unchangedAfterClear) {
      const inputCandidate = unchangedCandidate ? currentInputCandidate : null;
      const inputRisk = unchangedCandidate
        ? buildMacRepoInputRisk(currentInputCandidate)
        : {
            state: Number(lastInputClear?.previous_redaction_count) > 0
              ? "secret_like_text"
              : "needs_review",
            severity: "warn",
            summary: Number(lastInputClear?.previous_redaction_count) > 0
              ? "The Windows clipboard still matches the stale cleared input and includes redacted secret-looking text without a usable Gemma repo path."
              : "The Windows clipboard still matches the stale cleared input and does not include a usable Gemma repo path.",
            redaction_count: Number(lastInputClear?.previous_redaction_count) || 0,
            source: lastInputClear?.previous_source || null,
          };
      return {
        statusCode: 409,
        payload: {
          ok: false,
          code: "WINDOWS_CLIPBOARD_UNCHANGED",
          message:
            inputRisk.state === "secret_like_text"
              ? "The Windows clipboard is unchanged and still includes redacted secret-looking text without a usable Mac repo path. Copy a fresh Mac reply first."
              : "The Windows clipboard is unchanged and still does not include a usable Mac repo path. Copy a fresh Mac reply first.",
          clipboard_text: sanitizedClipboard.text,
          clipboard_text_length: String(clipboardText || "").length,
          mac_repo_report_preview: effectivePreview,
          mac_repo_input_candidate: inputCandidate,
          mac_repo_input_risk: inputRisk,
          has_usable_repo_path: false,
          unchanged_candidate: true,
          unchanged_after_input_clear: unchangedAfterClear,
        },
      };
    }

    const inputCandidate = await persistMacRepoInputCandidate({
      laneConfigDir,
      source: "clipboard",
      inputText: clipboardText,
      preview: effectivePreview,
      message: effectivePreview?.repo_path
        ? "Loaded the Windows clipboard and found a usable Mac repo path."
        : sanitizedClipboard.redaction_count > 0
          ? "Loaded the Windows clipboard, but it includes redacted secret-looking text and does not include a usable Mac repo path yet."
          : "Loaded the Windows clipboard, but it does not include a usable Mac repo path yet.",
      sourceLabel: effectivePreview?.repo_path
        ? "usable Mac repo path found"
        : "clipboard loaded",
    });
    const inputRisk = buildMacRepoInputRisk(inputCandidate);

    return {
      statusCode: 200,
      payload: {
        ok: true,
        message: inputCandidate.message,
        clipboard_text: sanitizedClipboard.text,
        clipboard_text_length: String(clipboardText || "").length,
        mac_repo_report_preview: effectivePreview,
        mac_repo_input_candidate: inputCandidate,
        mac_repo_input_risk: inputRisk,
        has_usable_repo_path: Boolean(effectivePreview?.repo_path),
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleProbeMacRepoClipboardRoute({ readWindowsClipboard, laneConfigDir }) {
  try {
    const probe = await persistMacRepoClipboardProbe({
      laneConfigDir,
      probe: await buildMacRepoClipboardProbe({
        readWindowsClipboard,
        laneConfigDir,
      }),
    });

    return {
      statusCode: 200,
      payload: {
        ok: true,
        message: probe.summary,
        mac_repo_clipboard_probe: probe,
        mac_repo_clipboard_probe_freshness: buildMacRepoClipboardProbeFreshness(probe),
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleClearMacRepoInputCandidateRoute({ laneConfigDir }, body) {
  const candidatePath = path.join(laneConfigDir, "last-mac-repo-input-candidate.json");
  const { data: currentInputCandidate } = await readOptionalJsonFile(candidatePath);
  const previousInputText = String(currentInputCandidate?.input_text || "");

  if (!previousInputText.trim()) {
    return {
      statusCode: 409,
      payload: {
        ok: false,
        code: "MAC_REPO_INPUT_CANDIDATE_MISSING",
        message: "No loaded Mac repo input candidate is available to clear.",
        mac_repo_input_candidate: null,
        mac_repo_input_risk: buildMacRepoInputRisk(null),
      },
    };
  }

  await clearMacRepoInputCandidate({ laneConfigDir });

  const sessionId = String(body?.session_id || "").trim();
  const clearReceipt = {
    ok: true,
    previous_source: currentInputCandidate?.source || null,
    previous_source_label: currentInputCandidate?.source_label || null,
    previous_input_text: previousInputText,
    previous_input_text_length: Number(currentInputCandidate?.input_text_length) || previousInputText.length,
    previous_redaction_count: Number(currentInputCandidate?.redaction_count) || 0,
    previous_has_usable_repo_path: Boolean(currentInputCandidate?.has_usable_repo_path),
    previous_repo_path: currentInputCandidate?.repo_path || null,
    previous_code: currentInputCandidate?.code || null,
    previous_message: currentInputCandidate?.message || null,
    session_id: sessionId || null,
    recorded_at: new Date().toISOString(),
  };

  await mkdir(laneConfigDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-input-clear.json"),
    JSON.stringify(clearReceipt, null, 2)
  );

  return {
    statusCode: 200,
    payload: {
      ok: true,
      mac_repo_input_candidate: null,
      mac_repo_input_risk: buildMacRepoInputRisk(null),
      mac_repo_input_clear: clearReceipt,
      message: "Cleared the loaded Mac repo input candidate. Repo paths were left untouched.",
    },
  };
}

async function handleSmartApplyMacRepoReportRoute(
  {
    pullTaildropInbox,
    liveRecoveryDir,
    laneConfigStore,
    sessionManager,
    macExecutor,
    pcExecutor,
    taildropInboxDir,
    downloadsDir,
    laneConfigDir,
    readWindowsClipboard,
  },
  body
) {
  try {
    const attempts = [];
    const pullResult = await pullTaildropInbox();
    const pullReceiptPath = path.join(liveRecoveryDir, "last-taildrop-pull.json");
    const pullReceipt = {
      ...pullResult,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(liveRecoveryDir, { recursive: true });
    await writeFile(pullReceiptPath, JSON.stringify(pullReceipt, null, 2));

    const macRepoReport = await loadLatestMacRepoReport({
      taildropInboxDir,
      downloadsDir,
      laneConfigDir,
    });

    if (macRepoReport?.repo_path) {
      attempts.push({
        source: "latest_report",
        ok: true,
        detail: macRepoReport.summary,
      });
      const smartApplyReceipt = {
        ok: true,
        smart_apply_source: "latest_report",
        smart_apply_attempts: attempts,
        repo_path: macRepoReport.repo_path,
        repo_origin: macRepoReport.repo_origin || null,
        session_id: String(body.session_id || "").trim() || null,
        recorded_at: new Date().toISOString(),
      };
      await mkdir(laneConfigDir, { recursive: true });
      await writeFile(
        path.join(laneConfigDir, "last-mac-repo-smart-apply.json"),
        JSON.stringify(smartApplyReceipt, null, 2)
      );
      return applyMacRepoReportObject(
        { laneConfigStore, sessionManager, macExecutor, pcExecutor, laneConfigDir },
        body,
        macRepoReport,
        {
          pull_result: pullReceipt,
          smart_apply_source: "latest_report",
          smart_apply_attempts: attempts,
        }
      );
    }

    attempts.push({
      source: "latest_report",
      ok: false,
      code: "MAC_REPO_REPORT_MISSING",
      detail: "No usable Mac repo report is available after Taildrop pull.",
    });

    const clipboardText = String((await readWindowsClipboard()) || "");
    const clipboardPreview = buildClipboardMacRepoPreview(clipboardText);

    if (clipboardPreview?.repo_path) {
      const persistedClipboardReport = await persistManualMacRepoReportText({
        laneConfigDir,
        reportText: clipboardText,
      });
      attempts.push({
        source: "clipboard",
        ok: true,
        detail: persistedClipboardReport.summary,
      });
      const smartApplyReceipt = {
        ok: true,
        smart_apply_source: "clipboard",
        smart_apply_attempts: attempts,
        repo_path: persistedClipboardReport.repo_path,
        repo_origin: persistedClipboardReport.repo_origin || null,
        clipboard_text_length: String(clipboardText || "").length,
        session_id: String(body.session_id || "").trim() || null,
        recorded_at: new Date().toISOString(),
      };
      await mkdir(laneConfigDir, { recursive: true });
      await writeFile(
        path.join(laneConfigDir, "last-mac-repo-smart-apply.json"),
        JSON.stringify(smartApplyReceipt, null, 2)
      );
      return applyMacRepoReportObject(
        { laneConfigStore, sessionManager, macExecutor, pcExecutor, laneConfigDir },
        body,
        persistedClipboardReport,
        {
          pull_result: pullReceipt,
          smart_apply_source: "clipboard",
          smart_apply_attempts: attempts,
          clipboard_text_length: String(clipboardText || "").length,
        }
      );
    }

    attempts.push({
      source: "clipboard",
      ok: false,
      code: String(clipboardText || "").trim() ? "MAC_REPO_REPORT_TEXT_MISSING_PATH" : "WINDOWS_CLIPBOARD_EMPTY",
      detail: String(clipboardText || "").trim()
        ? "Clipboard text did not contain a usable Mac Gemma repo path."
        : "Windows clipboard is empty.",
    });

    const pastedText = String(body.report_text || "").trim();
    const pastedPreview = buildPastedMacRepoPreview(pastedText);

    if (pastedPreview?.repo_path) {
      const persistedPastedReport = await persistManualMacRepoReportText({
        laneConfigDir,
        reportText: pastedText,
      });
      attempts.push({
        source: "pasted_text",
        ok: true,
        detail: persistedPastedReport.summary,
      });
      const smartApplyReceipt = {
        ok: true,
        smart_apply_source: "pasted_text",
        smart_apply_attempts: attempts,
        repo_path: persistedPastedReport.repo_path,
        repo_origin: persistedPastedReport.repo_origin || null,
        session_id: String(body.session_id || "").trim() || null,
        recorded_at: new Date().toISOString(),
      };
      await mkdir(laneConfigDir, { recursive: true });
      await writeFile(
        path.join(laneConfigDir, "last-mac-repo-smart-apply.json"),
        JSON.stringify(smartApplyReceipt, null, 2)
      );
      return applyMacRepoReportObject(
        { laneConfigStore, sessionManager, macExecutor, pcExecutor, laneConfigDir },
        body,
        persistedPastedReport,
        {
          pull_result: pullReceipt,
          smart_apply_source: "pasted_text",
          smart_apply_attempts: attempts,
        }
      );
    }

    attempts.push({
      source: "pasted_text",
      ok: false,
      code: pastedText ? "MAC_REPO_REPORT_TEXT_MISSING_PATH" : "MAC_REPO_REPORT_TEXT_REQUIRED",
      detail: pastedText
        ? "Pasted text did not contain a usable Mac Gemma repo path."
        : "No pasted Mac repo report text was provided.",
    });

    let inputCandidate = null;
    if (String(clipboardText || "").trim()) {
      inputCandidate = await persistMacRepoInputCandidate({
        laneConfigDir,
        source: "clipboard",
        inputText: clipboardText,
        preview: clipboardPreview,
        message: "Smart Apply could not find a usable Mac repo path yet.",
        code: "MAC_REPO_SMART_APPLY_MISSING",
        sourceLabel: "smart apply needs review",
      });
    } else if (pastedText) {
      inputCandidate = await persistMacRepoInputCandidate({
        laneConfigDir,
        source: "pasted_text",
        inputText: pastedText,
        preview: pastedPreview,
        message: "Smart Apply could not find a usable Mac repo path yet.",
        code: "MAC_REPO_SMART_APPLY_MISSING",
        sourceLabel: "smart apply needs review",
      });
    }

    return {
      statusCode: 409,
      payload: {
        ok: false,
        code: "MAC_REPO_SMART_APPLY_MISSING",
        message:
          "Smart Apply did not find a usable Mac repo path in the latest report, the Windows clipboard, or the pasted text.",
        pull_result: pullReceipt,
        mac_repo_report: macRepoReport,
        smart_apply_attempts: attempts,
        clipboard_text: redactSensitiveText(clipboardText).text,
        clipboard_text_length: clipboardText.length,
        clipboard_preview: clipboardPreview,
        pasted_text: redactSensitiveText(pastedText).text,
        pasted_preview: pastedPreview,
        mac_repo_input_candidate: inputCandidate,
        mac_repo_input_risk: buildMacRepoInputRisk(inputCandidate),
        best_manual_source: String(clipboardText || "").trim()
          ? "clipboard"
          : pastedText
            ? "pasted_text"
            : null,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleGetSessionRoute({ sessionManager, macExecutor, pcExecutor }, url) {
  const sessionId = String(url.searchParams.get("session_id") || "").trim();
  if (!sessionId) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        code: "SESSION_ID_REQUIRED",
        message: "A session_id query parameter is required.",
      },
    };
  }

  try {
    const session = await refreshSessionRepoContexts({
      sessionManager,
      sessionId,
      macExecutor,
      pcExecutor,
    });

    return {
      statusCode: 200,
      payload: {
        ok: true,
        session,
      },
    };
  } catch (error) {
    return {
      statusCode: 404,
      payload: {
        ok: false,
        code: "SESSION_NOT_FOUND",
        message: error.message,
      },
    };
  }
}

async function handleListSessionsRoute({ sessionManager }, url) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 8, 1), 50);
  const sessions = sessionManager
    .listSessions()
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
    .slice(0, limit)
    .map(summarizeSessionListItem);

  return {
    statusCode: 200,
    payload: {
      ok: true,
      sessions,
    },
  };
}

async function handleAppStatusRoute({ sessionManager }) {
  const sessions = sessionManager
    .listSessions()
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  const latestSession = sessions[0] || null;

  return {
    statusCode: 200,
    payload: {
      ok: true,
      available_routes: ["send_mac", "send_pc", "send_both", "execute_critique", "compare"],
      latest_session: latestSession ? summarizeSessionListItem(latestSession) : null,
      session_count: sessions.length,
    },
  };
}

async function handleLiveRecoveryRoute({ liveRecoveryDir, taildropInboxDir, downloadsDir, artifactsDir }) {
  const summaryPath = path.join(liveRecoveryDir, "latest-dual-verify.json");
  const macActionSendPath = path.join(liveRecoveryDir, "last-mac-action-pack-send.json");
  const macFallbackSendPath = path.join(liveRecoveryDir, "last-mac-fallback-send.json");
  const taildropPullPath = path.join(liveRecoveryDir, "last-taildrop-pull.json");
  const watcherOutputPath = path.join(liveRecoveryDir, "watcher-output.txt");
  const watcherPidPath = path.join(liveRecoveryDir, "watcher.pid");
  const taildropWatcherOutputPath = path.join(taildropInboxDir, "taildrop-watcher-output.txt");
  const taildropWatcherPidPath = path.join(taildropInboxDir, "taildrop-watcher.pid");
  const [
    { data: summary, stat: summaryStat },
    { data: macActionSend },
    { data: macFallbackSend },
    { data: taildropPull },
    { data: watcherOutput, stat: watcherOutputStat },
    { data: watcherMeta },
    { data: taildropWatcherOutput, stat: taildropWatcherOutputStat },
    { data: taildropWatcherMeta },
    taildropFiles,
    latestBridgeReport,
  ] = await Promise.all([
    readOptionalJsonFile(summaryPath),
    readOptionalJsonFile(macActionSendPath),
    readOptionalJsonFile(macFallbackSendPath),
    readOptionalJsonFile(taildropPullPath),
    readOptionalTextFile(watcherOutputPath),
    readOptionalJsonFile(watcherPidPath),
    readOptionalTextFile(taildropWatcherOutputPath),
    readOptionalJsonFile(taildropWatcherPidPath),
    listOptionalDirectoryFiles(taildropInboxDir),
    findLatestMatchingFile([
      {
        dirPath: taildropInboxDir,
        source: "taildrop-inbox",
      },
      {
        dirPath: downloadsDir,
        source: "downloads",
      },
    ]),
  ]);

  const watcher = buildWatcherStatus({
    watcherMeta,
    watcherOutputStat,
    recoverySummary: summary,
  });
  const taildropWatcher = buildWatcherStatus({
    watcherMeta: taildropWatcherMeta,
    watcherOutputStat: taildropWatcherOutputStat,
  });
  const macBridgeReport = parseMacBridgeReport(latestBridgeReport.data, latestBridgeReport);
  const macActionPack = buildMacActionPack({
    artifactsDir,
    macBridgeReport,
  });

  return {
    statusCode: 200,
    payload: {
      ok: true,
      summary_path: summaryPath,
      mac_action_send_path: macActionSendPath,
      mac_fallback_send_path: macFallbackSendPath,
      taildrop_pull_path: taildropPullPath,
      watcher_output_path: watcherOutputPath,
      watcher_pid_path: watcherPidPath,
      taildrop_inbox_path: taildropInboxDir,
      downloads_dir_path: downloadsDir,
      summary,
      watcher,
      taildrop_watcher: taildropWatcher,
      taildrop_files: taildropFiles,
      mac_action_send: macActionSend,
      mac_fallback_send: macFallbackSend,
      taildrop_pull: taildropPull,
      mac_action_pack: macActionPack,
      mac_bridge_report: macBridgeReport,
      recovery_action: buildRecoveryAction(summary, macBridgeReport, macActionSend, taildropPull, macFallbackSend),
      mac_diagnostics: summarizeMacDiagnostics(summary?.last_health),
      watcher_output_lines: summarizeWatcherOutput(watcherOutput),
      watcher_output_updated_at: watcherOutputStat?.mtime?.toISOString?.() || null,
      taildrop_output_lines: summarizeWatcherOutput(taildropWatcherOutput),
      taildrop_output_updated_at: taildropWatcherOutputStat?.mtime?.toISOString?.() || null,
      live_summary: buildLiveRecoverySummary(summary, summaryStat),
    },
  };
}

async function defaultSendMacActionPack({
  scriptPath = DEFAULT_SEND_MAC_ACTION_PACK_SCRIPT,
} = {}) {
  const { stdout } = await execFileAsync(
    "pwsh",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const output = String(stdout || "").trim();
  return output ? JSON.parse(output) : { ok: true };
}

async function defaultSendMacFallbackBlock({
  scriptPath = DEFAULT_SEND_MAC_FALLBACK_SCRIPT,
} = {}) {
  const { stdout } = await execFileAsync(
    "pwsh",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const output = String(stdout || "").trim();
  return output ? JSON.parse(output) : { ok: true };
}

async function defaultSendMacRepoFallbackBlock({
  scriptPath = DEFAULT_SEND_MAC_REPO_FALLBACK_SCRIPT,
} = {}) {
  const { stdout } = await execFileAsync(
    "pwsh",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const output = String(stdout || "").trim();
  return output ? JSON.parse(output) : { ok: true };
}

async function defaultSendMacRepoManualBlock({
  scriptPath = DEFAULT_SEND_MAC_REPO_MANUAL_SCRIPT,
} = {}) {
  const { stdout } = await execFileAsync(
    "pwsh",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const output = String(stdout || "").trim();
  return output ? JSON.parse(output) : { ok: true };
}

async function defaultSendMacRepoReportRequest({
  scriptPath = DEFAULT_SEND_MAC_REPO_REPORT_REQUEST_SCRIPT,
} = {}) {
  const { stdout } = await execFileAsync(
    "pwsh",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const output = String(stdout || "").trim();
  return output ? JSON.parse(output) : { ok: true };
}

async function defaultSendMacRepoNudge({
  scriptPath = DEFAULT_SEND_MAC_REPO_NUDGE_SCRIPT,
} = {}) {
  const { stdout } = await execFileAsync(
    "pwsh",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const output = String(stdout || "").trim();
  return output ? JSON.parse(output) : { ok: true };
}

async function defaultStartMacRepoReportWatcher({
  scriptPath = DEFAULT_START_MAC_REPO_REPORT_WATCHER_SCRIPT,
  laneConfigDir = DEFAULT_LANE_CONFIG_DIR,
  sessionId = "",
  resendEveryAttempts = 8,
  nudgeEveryAttempts = 24,
  fallbackEveryAttempts = 12,
  manualEveryAttempts = 36,
  manualPreferredAtAttempts = DEFAULT_MAC_REPO_MANUAL_PREFERRED_ATTEMPTS,
} = {}) {
  const args = [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Attempts",
    "0",
    "-IntervalSeconds",
    "15",
    "-ResendEveryAttempts",
    String(resendEveryAttempts),
    "-NudgeEveryAttempts",
    String(nudgeEveryAttempts),
    "-FallbackEveryAttempts",
    String(fallbackEveryAttempts),
    "-ManualEveryAttempts",
    String(manualEveryAttempts),
    "-ManualPreferredAtAttempts",
    String(manualPreferredAtAttempts),
  ];

  if (sessionId) {
    args.push("-SessionId", sessionId);
  }

  const pidPath = path.join(laneConfigDir, "mac-repo-report-watcher.pid");
  const { data: previousPidData, stat: previousPidStat } = await readOptionalJsonFile(pidPath);
  const previousPid = previousPidData?.process_id || null;
  const previousUpdatedAt = previousPidStat?.mtimeMs || 0;

  const launched = spawn("pwsh", args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  launched.unref();

  const deadline = Date.now() + 6_000;

  while (Date.now() < deadline) {
    const { data, stat } = await readOptionalJsonFile(pidPath);
    const isRefreshedPid = Boolean(
      data?.process_id && (
        !previousPid ||
        data.process_id !== previousPid ||
        (stat?.mtimeMs || 0) > previousUpdatedAt
      )
    );

    if (isRefreshedPid) {
      return {
        ok: true,
        ...data,
        launcher_pid: launched.pid,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const watcherProcess = await findNewestMacRepoWatcherProcess({ sessionId });
  if (watcherProcess?.process_id && watcherProcess.process_id !== previousPid) {
    return {
      ok: true,
      process_id: watcherProcess.process_id,
      created_at: watcherProcess.created_at,
      attempts: 0,
      interval_seconds: 15,
      resend_every_attempts: resendEveryAttempts,
      nudge_every_attempts: nudgeEveryAttempts,
      fallback_every_attempts: fallbackEveryAttempts,
      manual_every_attempts: manualEveryAttempts,
      manual_preferred_at_attempts: manualPreferredAtAttempts,
      session_id: sessionId || null,
      launcher_pid: launched.pid,
      detail: "Watcher is running, but the pid file has not refreshed yet.",
    };
  }

  return {
    ok: true,
    launcher_pid: launched.pid,
    process_id: null,
    detail: "Watcher launch requested, but the pid file has not appeared yet.",
    nudge_every_attempts: nudgeEveryAttempts,
    fallback_every_attempts: fallbackEveryAttempts,
    manual_every_attempts: manualEveryAttempts,
    manual_preferred_at_attempts: manualPreferredAtAttempts,
  };
}

async function defaultPullTaildropInbox({
  scriptPath = DEFAULT_PULL_TAILDROP_SCRIPT,
} = {}) {
  const { stdout } = await execFileAsync(
    "pwsh",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  const output = String(stdout || "").trim();
  return output ? JSON.parse(output) : { ok: true };
}

async function defaultReadWindowsClipboard() {
  const { stdout } = await execFileAsync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      "Get-Clipboard -Raw",
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  return String(stdout || "");
}

async function handleSendMacActionPackRoute({
  sendMacActionPack,
  liveRecoveryDir,
}) {
  try {
    const result = await sendMacActionPack();
    const receiptPath = path.join(liveRecoveryDir, "last-mac-action-pack-send.json");
    const receipt = {
      ...result,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(liveRecoveryDir, { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    return {
      statusCode: 200,
      payload: {
        ok: true,
        result: receipt,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleSendMacRepoReportRequestRoute({
  sendMacRepoReportRequest,
  liveRecoveryDir,
}) {
  try {
    const result = await sendMacRepoReportRequest();
    const receiptPath = path.join(liveRecoveryDir, "last-mac-repo-report-request-send.json");
    const receipt = {
      ...result,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(liveRecoveryDir, { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    return {
      statusCode: 200,
      payload: {
        ok: true,
        result: receipt,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleSendMacRepoFallbackBlockRoute({
  sendMacRepoFallbackBlock,
  laneConfigDir,
}) {
  try {
    const result = await sendMacRepoFallbackBlock();
    const receiptPath = path.join(laneConfigDir, "last-mac-repo-fallback-send.json");
    const receipt = {
      ...result,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(laneConfigDir, { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    return {
      statusCode: 200,
      payload: {
        ok: true,
        result: receipt,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleSendMacRepoManualBlockRoute({
  sendMacRepoManualBlock,
  laneConfigDir,
}) {
  try {
    const result = await sendMacRepoManualBlock();
    const receiptPath = path.join(laneConfigDir, "last-mac-repo-manual-send.json");
    const receipt = {
      ...result,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(laneConfigDir, { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    return {
      statusCode: 200,
      payload: {
        ok: true,
        result: receipt,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleSendMacRepoNudgeRoute({
  sendMacRepoNudge,
  sendMacRepoReportRequest,
  sendMacRepoFallbackBlock,
  laneConfigDir,
}) {
  try {
    const receipt = sendMacRepoNudge
      ? {
          ...(await sendMacRepoNudge()),
          recorded_at: new Date().toISOString(),
        }
      : await (async () => {
          const [requestResult, fallbackResult] = await Promise.all([
            sendMacRepoReportRequest(),
            sendMacRepoFallbackBlock(),
          ]);
          return {
            ok: true,
            sent_at: new Date().toISOString(),
            target: requestResult?.target || fallbackResult?.target || "jessys-mac-studio",
            repo_request_result: requestResult,
            repo_fallback_result: fallbackResult,
            deliveries: [
              ...(Array.isArray(requestResult?.deliveries) ? requestResult.deliveries : []),
              ...(Array.isArray(fallbackResult?.deliveries) ? fallbackResult.deliveries : []),
            ],
            recorded_at: new Date().toISOString(),
          };
        })();
    const receiptPath = path.join(laneConfigDir, "last-mac-repo-nudge-send.json");
    await mkdir(laneConfigDir, { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    return {
      statusCode: 200,
      payload: {
        ok: true,
        result: receipt,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleStartMacRepoReportWatcherRoute({
  startMacRepoReportWatcher,
  laneConfigDir,
}, body) {
  try {
    const sessionId = String(body.session_id || "").trim();
    const resendEveryAttempts = Number(body.resend_every_attempts || 8) || 8;
    const nudgeEveryAttempts = Number(body.nudge_every_attempts || 24) || 24;
    const fallbackEveryAttempts = Number(body.fallback_every_attempts || 12) || 12;
    const manualEveryAttempts = Number(body.manual_every_attempts || 36) || 36;
    const manualPreferredAtAttempts =
      Number(body.manual_preferred_at_attempts || DEFAULT_MAC_REPO_MANUAL_PREFERRED_ATTEMPTS) ||
      DEFAULT_MAC_REPO_MANUAL_PREFERRED_ATTEMPTS;
    const result = await startMacRepoReportWatcher({
      sessionId,
      resendEveryAttempts,
      nudgeEveryAttempts,
      fallbackEveryAttempts,
      manualEveryAttempts,
      manualPreferredAtAttempts,
    });
    const receiptPath = path.join(laneConfigDir, "last-mac-repo-report-watcher-start.json");
    const receipt = {
      ...result,
      resend_every_attempts: resendEveryAttempts,
      nudge_every_attempts: nudgeEveryAttempts,
      fallback_every_attempts: fallbackEveryAttempts,
      manual_every_attempts: manualEveryAttempts,
      manual_preferred_at_attempts: manualPreferredAtAttempts,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(laneConfigDir, { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    return {
      statusCode: 200,
      payload: {
        ok: true,
        result: receipt,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handlePullAndApplyMacRepoReportRoute({
  pullTaildropInbox,
  liveRecoveryDir,
  laneConfigStore,
  sessionManager,
  macExecutor,
  pcExecutor,
  taildropInboxDir,
  downloadsDir,
  laneConfigDir,
}, body) {
  try {
    const pullResult = await pullTaildropInbox();
    const pullReceiptPath = path.join(liveRecoveryDir, "last-taildrop-pull.json");
    const pullReceipt = {
      ...pullResult,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(liveRecoveryDir, { recursive: true });
    await writeFile(pullReceiptPath, JSON.stringify(pullReceipt, null, 2));

    const macRepoReport = await loadLatestMacRepoReport({
      taildropInboxDir,
      downloadsDir,
      laneConfigDir,
    });

    if (!macRepoReport?.repo_path) {
      return {
        statusCode: 409,
        payload: {
          ok: false,
          code: "MAC_REPO_REPORT_MISSING",
          message: "Taildrop pull completed, but no Mac repo-path report is available yet.",
          pull_result: pullReceipt,
          mac_repo_report: macRepoReport,
        },
      };
    }

    const laneConfig = laneConfigStore.updateConfig({
      activeRepo: body.active_repo,
      macRepoPath: macRepoReport.repo_path,
    });

    await refreshAllSessionRepoContexts({
      sessionManager,
      macExecutor,
      pcExecutor,
    });

    const sessionId = String(body.session_id || "").trim();
    const session = sessionId ? sessionManager.getSession(sessionId) : null;

    return {
      statusCode: 200,
      payload: {
        ok: true,
        pull_result: pullReceipt,
        mac_repo_report: macRepoReport,
        lane_config: laneConfig,
        session,
        updated_sessions_count: sessionManager.listSessions().length,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleSendMacFallbackBlockRoute({
  sendMacFallbackBlock,
  liveRecoveryDir,
}) {
  try {
    const result = await sendMacFallbackBlock();
    const receiptPath = path.join(liveRecoveryDir, "last-mac-fallback-send.json");
    const receipt = {
      ...result,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(liveRecoveryDir, { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    return {
      statusCode: 200,
      payload: {
        ok: true,
        result: receipt,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handlePullTaildropInboxRoute({
  pullTaildropInbox,
  liveRecoveryDir,
}) {
  try {
    const result = await pullTaildropInbox();
    const receiptPath = path.join(liveRecoveryDir, "last-taildrop-pull.json");
    const receipt = {
      ...result,
      recorded_at: new Date().toISOString(),
    };
    await mkdir(liveRecoveryDir, { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    return {
      statusCode: 200,
      payload: {
        ok: true,
        result: receipt,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function serveStaticAsset(res, publicDir, pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const candidatePath = path.normalize(path.join(publicDir, normalizedPath));
  const relativePath = path.relative(publicDir, candidatePath);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    res.writeHead(403, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end("Forbidden");
    return true;
  }

  try {
    const content = await readFile(candidatePath);
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": resolveContentType(candidatePath),
    });
    res.end(content);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function executeLaneSet({
  sessionManager,
  sessionId,
  operatorMode,
  executions,
  macConfirmationGatePipeline = null,
  macVerificationPipeline = null,
  pcCritiquePromotionPipeline = null,
}) {
  const repo = sessionManager.getSession(sessionId).mission_state.active_repo;
  const preflightResults = await Promise.all(
    executions.map(async (execution) => {
      const repoContext = await captureLaneRepoContext({
        sessionManager,
        sessionId,
        lane: execution.lane,
        executor: execution.executor,
        repo,
      });

      if (repoContext && isRepoScopeBlocking(repoContext)) {
        return {
          lane: execution.lane,
          ok: false,
          statusCode: 409,
          error: new Error(repoContext.detail),
        };
      }

      return {
        lane: execution.lane,
        ok: true,
      };
    })
  );

  const baseSession = sessionManager.getSession(sessionId);
  const outcomes = await Promise.allSettled(
    executions.map((execution, index) => {
      const preflight = preflightResults[index];
      if (!preflight.ok) {
        return Promise.reject(preflight.error);
      }

      const executionOperatorMode = execution.operatorMode || operatorMode;
      return execution.executor.execute({
        prompt: execution.prompt,
        sharedInstruction: execution.sharedInstruction,
        session: baseSession,
        operatorMode: executionOperatorMode,
      });
    })
  );

  const payload = {
    ok: true,
    session: null,
  };
  let statusCode = 200;
  const settled = [];

  for (let index = 0; index < executions.length; index += 1) {
    const execution = executions[index];
    const outcome = outcomes[index];
    const preflight = preflightResults[index];

    if (outcome.status === "fulfilled") {
      const transcriptOperatorMode = execution.transcriptOperatorMode || operatorMode;
      let normalizedResult = normalizeLaneExecutionResult(outcome.value, {
        lane: execution.lane,
        fallbackEventType:
          execution.fallbackEventType ||
          (execution.lane === "pc" ? "critique" : "agent_reply"),
      });
      if (typeof execution.normalizeResult === "function") {
        normalizedResult = execution.normalizeResult(normalizedResult);
      }
      normalizedResult = await runMacVerificationIfNeeded({
        macVerificationPipeline,
        sessionManager,
        sessionId,
        operatorMode: transcriptOperatorMode,
        lane: execution.lane,
        executionResult: normalizedResult,
      });
      const macConfirmationOutcome = await runMacConfirmationGateIfNeeded({
        macConfirmationGatePipeline,
        executionResult: normalizedResult,
        lane: execution.lane,
      });
      normalizedResult = macConfirmationOutcome.executionResult;
      const pcPromotionOutcome = await runPcCritiquePromotionIfNeeded({
        pcCritiquePromotionPipeline,
        executionResult: normalizedResult,
        lane: execution.lane,
      });
      normalizedResult = pcPromotionOutcome.executionResult;
      clearRecoveredLaneGapIfNeeded({
        sessionManager,
        sessionId,
        lane: execution.lane,
        executionResult: normalizedResult,
        promotion: pcPromotionOutcome.promotion,
        confirmationGate: macConfirmationOutcome.confirmationGate,
      });
      sessionManager.recordLaneHeartbeat(sessionId, execution.lane, normalizedResult.heartbeat);
      const laneResult = await applyLaneExecutionResult({
        sessionManager,
        sessionId,
        lane: execution.lane,
        operatorMode: transcriptOperatorMode,
        taskEventId: execution.taskEventId,
        executionResult: normalizedResult,
      });
      applyPcCritiquePromotion({
        sessionManager,
        sessionId,
        operatorMode: transcriptOperatorMode,
        laneResult,
        promotion: pcPromotionOutcome.promotion,
      });
      applyMacConfirmationGate({
        sessionManager,
        sessionId,
        operatorMode: transcriptOperatorMode,
        laneResult,
        confirmationGate: macConfirmationOutcome.confirmationGate,
      });
      payload[`${execution.lane}_result`] = laneResult;
      settled.push({
        lane: execution.lane,
        ok: true,
        result: normalizedResult,
        promotion: pcPromotionOutcome.promotion,
        confirmationGate: macConfirmationOutcome.confirmationGate,
      });
      continue;
    }

    statusCode = preflight?.statusCode || 502;
    payload.ok = false;
    const error = toError(outcome.reason);
    recordLaneFailure({
      sessionManager,
      sessionId,
      lane: execution.lane,
      error,
    });
    payload[`${execution.lane}_result`] = null;
    settled.push({
      lane: execution.lane,
      ok: false,
      error,
    });
  }

  payload.session = sessionManager.getSession(sessionId);
  return {
    statusCode,
    payload,
    settled,
  };
}

async function handleSingleLaneRoute(
  {
    sessionManager,
    executor,
    lane,
    operatorMode,
    fallbackEventType,
    macConfirmationGatePipeline = null,
    macVerificationPipeline = null,
    pcCritiquePromotionPipeline = null,
  },
  body
) {
  const prompt = ensurePrompt(body);
  const sharedInstruction = String(body.shared_instruction || "").trim();
  const sessionId = ensureSession({
    sessionManager,
    sessionId: body.session_id,
    prompt,
    operatorMode,
  });

  const sharedEventId = appendSharedPromptEvent({
    sessionManager,
    sessionId,
    prompt,
    operatorMode,
  });
  const taskEventId = appendLaneTaskEvent({
    sessionManager,
    sessionId,
    lane,
    prompt,
    sharedInstruction,
    operatorMode,
    sharedEventId,
  });

  try {
    if (lane === "mac") {
      const pendingConfirmation = resolvePendingMacConfirmation({
        sessionManager,
        sessionId,
        body,
        operatorMode,
      });
      if (pendingConfirmation.blocked) {
        return {
          statusCode: 409,
          payload: {
            ok: false,
            code: "OPERATOR_CONFIRMATION_REQUIRED",
            message: pendingConfirmation.pendingGate.summary,
            required_confirmation: pendingConfirmation.pendingGate,
            session: sessionManager.getSession(sessionId),
          },
        };
      }
    }

    const repoContext = await captureLaneRepoContext({
      sessionManager,
      sessionId,
      lane,
      executor,
      repo: sessionManager.getSession(sessionId).mission_state.active_repo,
    });

    if (repoContext && isRepoScopeBlocking(repoContext)) {
      recordLaneFailure({
        sessionManager,
        sessionId,
        lane,
        error: new Error(repoContext.detail),
      });

      return {
        statusCode: 409,
        payload: {
          ok: false,
          code: "REPO_SCOPE_UNAVAILABLE",
          message: repoContext.detail,
          session: sessionManager.getSession(sessionId),
        },
      };
    }

    const rawExecutionResult = await executor.execute({
      prompt,
      sharedInstruction,
      session: sessionManager.getSession(sessionId),
      operatorMode,
    });

    let executionResult = normalizeLaneExecutionResult(rawExecutionResult, {
      lane,
      fallbackEventType:
        fallbackEventType || (lane === "pc" ? "critique" : "agent_reply"),
    });
    executionResult = await runMacVerificationIfNeeded({
      macVerificationPipeline,
      sessionManager,
      sessionId,
      operatorMode,
      lane,
      executionResult,
    });
    const macConfirmationOutcome = await runMacConfirmationGateIfNeeded({
      macConfirmationGatePipeline,
      executionResult,
      lane,
    });
    executionResult = macConfirmationOutcome.executionResult;
    const pcPromotionOutcome = await runPcCritiquePromotionIfNeeded({
      pcCritiquePromotionPipeline,
      executionResult,
      lane,
    });
    executionResult = pcPromotionOutcome.executionResult;
    clearRecoveredLaneGapIfNeeded({
      sessionManager,
      sessionId,
      lane,
      executionResult,
      promotion: pcPromotionOutcome.promotion,
      confirmationGate: macConfirmationOutcome.confirmationGate,
    });

    const laneResult = await applyLaneExecutionResult({
      sessionManager,
      sessionId,
      lane,
      operatorMode,
      taskEventId,
      executionResult,
    });
    applyMacConfirmationGate({
      sessionManager,
      sessionId,
      operatorMode,
      laneResult,
      confirmationGate: macConfirmationOutcome.confirmationGate,
    });
    applyPcCritiquePromotion({
      sessionManager,
      sessionId,
      operatorMode,
      laneResult,
      promotion: pcPromotionOutcome.promotion,
    });

    return {
      statusCode: 200,
      payload: {
        ok: true,
        session: sessionManager.getSession(sessionId),
        [`${lane}_result`]: laneResult,
      },
    };
  } catch (error) {
    recordLaneFailure({
      sessionManager,
      sessionId,
      lane,
      error,
    });

    return {
      statusCode: 502,
      payload: {
        ok: false,
        message: error.message,
        session: sessionManager.getSession(sessionId),
      },
    };
  }
}

async function handleSendMacRoute(
  {
    sessionManager,
    macExecutor,
    macConfirmationGatePipeline,
    macVerificationPipeline,
  },
  body
) {
  try {
    return await handleSingleLaneRoute(
      {
        sessionManager,
        executor: macExecutor,
        lane: "mac",
        operatorMode: "send_mac",
        fallbackEventType: "agent_reply",
        macConfirmationGatePipeline,
        macVerificationPipeline,
      },
      body
    );
  } catch (error) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleSendPcRoute(
  { sessionManager, pcExecutor, pcCritiquePromotionPipeline },
  body
) {
  try {
    return await handleSingleLaneRoute(
      {
        sessionManager,
        executor: pcExecutor,
        lane: "pc",
        operatorMode: "send_pc",
        fallbackEventType: "critique",
        pcCritiquePromotionPipeline,
      },
      body
    );
  } catch (error) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleSendBothRoute(
  {
    sessionManager,
    macExecutor,
    pcExecutor,
    macConfirmationGatePipeline,
    macVerificationPipeline,
    pcCritiquePromotionPipeline,
  },
  body
) {
  try {
    const prompt = ensurePrompt(body);
    const macSharedInstruction = String(
      body.mac_shared_instruction || body.shared_instruction || ""
    ).trim();
    const pcSharedInstruction = String(
      body.pc_shared_instruction || body.shared_instruction || ""
    ).trim();
    const sessionId = ensureSession({
      sessionManager,
      sessionId: body.session_id,
      prompt,
      operatorMode: "send_both",
    });

    const sharedEventId = appendSharedPromptEvent({
      sessionManager,
      sessionId,
      prompt,
      operatorMode: "send_both",
    });
    const macTaskEventId = appendLaneTaskEvent({
      sessionManager,
      sessionId,
      lane: "mac",
      prompt,
      sharedInstruction: macSharedInstruction,
      operatorMode: "send_both",
      sharedEventId,
    });
    const pcTaskEventId = appendLaneTaskEvent({
      sessionManager,
      sessionId,
      lane: "pc",
      prompt,
      sharedInstruction: pcSharedInstruction,
      operatorMode: "send_both",
      sharedEventId,
    });

    const pendingConfirmation = resolvePendingMacConfirmation({
      sessionManager,
      sessionId,
      body,
      operatorMode: "send_both",
    });
    if (pendingConfirmation.blocked) {
      return {
        statusCode: 409,
        payload: {
          ok: false,
          code: "OPERATOR_CONFIRMATION_REQUIRED",
          message: pendingConfirmation.pendingGate.summary,
          required_confirmation: pendingConfirmation.pendingGate,
          session: sessionManager.getSession(sessionId),
        },
      };
    }

    const result = await executeLaneSet({
      sessionManager,
      sessionId,
      operatorMode: "send_both",
      macConfirmationGatePipeline,
      macVerificationPipeline,
      pcCritiquePromotionPipeline,
      executions: [
        {
          lane: "mac",
          executor: macExecutor,
          prompt,
          sharedInstruction: macSharedInstruction,
          taskEventId: macTaskEventId,
        },
        {
          lane: "pc",
          executor: pcExecutor,
          prompt,
          sharedInstruction: pcSharedInstruction,
          taskEventId: pcTaskEventId,
        },
      ],
    });

    const successfulMac = result.settled.find((item) => item.lane === "mac" && item.ok)?.result;
    const successfulPc = result.settled.find((item) => item.lane === "pc" && item.ok)?.result;
    const pcPromotion = result.settled.find((item) => item.lane === "pc" && item.ok)?.promotion;

    if (successfulMac && successfulPc) {
      const arbitrationDecision = evaluateConflictArbitration({
        macResult: successfulMac,
        pcResult: successfulPc,
      });
      finalizeConflictArbitration({
        sessionManager,
        sessionId,
        operatorMode: "send_both",
        decision: arbitrationDecision,
        relatedEventIds: [
          result.payload.mac_result?.reply_event_id,
          result.payload.pc_result?.reply_event_id,
        ],
        suppressEvent: Boolean(
          pcPromotion && arbitrationDecision.arbitration_state === "needs_review"
        ),
      });
      result.payload.arbitration = arbitrationDecision;
      result.payload.session = sessionManager.getSession(sessionId);
    }

    if (!result.payload.ok) {
      result.payload.message = "One or more lane executions failed.";
    }

    return result;
  } catch (error) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

function buildExecutionCritiqueSummary({
  prompt,
  macResult,
  pcResult,
}) {
  const macSummary = summarizeText(macResult?.content || "");
  const pcSummary = summarizeText(pcResult?.content || "");
  return [
    `Execution + critique for "${summarizeText(prompt, 120)}".`,
    macSummary ? `Mac: ${macSummary}` : "",
    pcSummary ? `PC critique: ${pcSummary}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildCompareCardFromLaneResults({
  prompt,
  macResult,
  pcResult,
  arbitrationDecision,
}) {
  const macSummary = summarizeText(macResult?.content || "", 220);
  const pcSummary = summarizeText(pcResult?.content || "", 220);
  const alignment = compareLaneAnswerSimilarity(macResult, pcResult);
  const sameAnswer = alignment.equivalent;
  const convergedLabel =
    alignment.macSignature.kind !== "text" && alignment.macSignature.label
      ? alignment.macSignature.label
      : macSummary;

  return {
    question: prompt,
    mac_answer_summary: macSummary || "No Mac answer returned.",
    pc_answer_summary: pcSummary || "No PC answer returned.",
    overlap: sameAnswer
      ? `Both lanes converged on a shared ${convergedLabel}.`
      : "Both lanes addressed the same operator goal from different angles.",
    disagreement: sameAnswer
      ? "No material disagreement detected."
      : `Mac emphasized: ${macSummary || "n/a"} | PC emphasized: ${pcSummary || "n/a"}`,
    recommended_next_step:
      arbitrationDecision?.recommended_next_step ||
      (sameAnswer
        ? "Proceed with the converged direction and keep monitoring for new risks."
        : "Review the two lane outputs and choose whether to follow the Mac path or revise it."),
    arbitration_status:
      arbitrationDecision?.arbitration_state || (sameAnswer ? "clear" : "operator_decision"),
  };
}

const DEFAULT_COMPARE_OPERATIONAL_PROBE_PROMPT =
  "Return exactly READY if your lane is currently routable for this request. Otherwise return BLOCKED.";

function isCompareOperationalProbe(body = {}) {
  if (body?.operational_probe === true) {
    return true;
  }

  const contract = String(body?.compare_contract || "").trim().toLowerCase();
  return contract === "operational_probe" || contract === "health_check";
}

function buildComparePrompt(body = {}) {
  if (!isCompareOperationalProbe(body)) {
    return ensurePrompt(body);
  }

  return String(body.prompt || "").trim() || DEFAULT_COMPARE_OPERATIONAL_PROBE_PROMPT;
}

function buildCompareSharedInstruction(body = {}, lane) {
  const explicit = String(
    (lane === "mac" ? body.mac_shared_instruction : body.pc_shared_instruction) ||
      body.shared_instruction ||
      ""
  ).trim();

  if (!isCompareOperationalProbe(body)) {
    const fallback =
      lane === "mac"
        ? "Answer independently from the Mac lane perspective."
        : "Answer independently from the PC lane perspective.";
    return explicit || fallback;
  }

  const laneSpecific =
    lane === "mac"
      ? "Treat routability as the ability of the Mac execution lane to answer this compare request successfully over its normal transport right now."
      : "Treat routability as the ability of the PC reviewer lane to answer this compare request successfully over its normal transport right now.";

  return [
    "This is an operational health check, not an open-ended design comparison.",
    "Return exactly READY if your lane is healthy for this request right now.",
    "Return exactly BLOCKED if your lane is unavailable, timed out, or cannot complete this request right now.",
    "Do not add explanation outside READY or BLOCKED.",
    laneSpecific,
    explicit,
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeOperationalProbeContent(content) {
  const text = String(content || "").trim();
  const normalized = text.toLowerCase();

  if (!text) {
    return "BLOCKED";
  }

  if (/^\s*ready\s*$/i.test(text)) {
    return "READY";
  }

  if (/^\s*blocked\s*$/i.test(text)) {
    return "BLOCKED";
  }

  if (
    /\b(blocked|unavailable|unreachable|down|failed|failure|error|stalled|offline|degraded|timeout|timed out|cannot|can t|unable|unknown|unclear|indeterminate|unverifiable|not routable|not reachable|not healthy)\b/i.test(
      normalized
    )
  ) {
    return "BLOCKED";
  }

  return "READY";
}

function normalizeOperationalProbeLaneResult(executionResult) {
  return {
    ...executionResult,
    content: normalizeOperationalProbeContent(executionResult?.content),
  };
}

async function handleExecuteCritiqueRoute(
  {
    sessionManager,
    macExecutor,
    pcExecutor,
    macConfirmationGatePipeline,
    macVerificationPipeline,
    pcCritiquePromotionPipeline,
  },
  body
) {
  try {
    const prompt = ensurePrompt(body);
    const macSharedInstruction = String(
      body.mac_shared_instruction ||
        body.shared_instruction ||
        "Execute the operator goal and surface concrete verification steps."
    ).trim();
    const pcSharedInstruction = String(
      body.pc_shared_instruction ||
        body.shared_instruction ||
        "Critique the Mac path, surface concrete risks, and call out missing verification."
    ).trim();
    const sessionId = ensureSession({
      sessionManager,
      sessionId: body.session_id,
      prompt,
      operatorMode: "execute_critique",
    });

    const sharedEventId = appendSharedPromptEvent({
      sessionManager,
      sessionId,
      prompt,
      operatorMode: "execute_critique",
    });
    const macTaskEventId = appendLaneTaskEvent({
      sessionManager,
      sessionId,
      lane: "mac",
      prompt,
      sharedInstruction: macSharedInstruction,
      operatorMode: "execute_critique",
      sharedEventId,
    });
    const pcTaskEventId = appendLaneTaskEvent({
      sessionManager,
      sessionId,
      lane: "pc",
      prompt,
      sharedInstruction: pcSharedInstruction,
      operatorMode: "execute_critique",
      sharedEventId,
    });

    const pendingConfirmation = resolvePendingMacConfirmation({
      sessionManager,
      sessionId,
      body,
      operatorMode: "execute_critique",
    });
    if (pendingConfirmation.blocked) {
      return {
        statusCode: 409,
        payload: {
          ok: false,
          code: "OPERATOR_CONFIRMATION_REQUIRED",
          message: pendingConfirmation.pendingGate.summary,
          required_confirmation: pendingConfirmation.pendingGate,
          session: sessionManager.getSession(sessionId),
        },
      };
    }

    const result = await executeLaneSet({
      sessionManager,
      sessionId,
      operatorMode: "execute_critique",
      macConfirmationGatePipeline,
      macVerificationPipeline,
      pcCritiquePromotionPipeline,
      executions: [
        {
          lane: "mac",
          executor: macExecutor,
          prompt,
          sharedInstruction: macSharedInstruction,
          taskEventId: macTaskEventId,
        },
        {
          lane: "pc",
          executor: pcExecutor,
          prompt,
          sharedInstruction: pcSharedInstruction,
          taskEventId: pcTaskEventId,
        },
      ],
    });

    const successfulMac = result.settled.find((item) => item.lane === "mac" && item.ok)?.result;
    const successfulPc = result.settled.find((item) => item.lane === "pc" && item.ok)?.result;
    const pcPromotion = result.settled.find((item) => item.lane === "pc" && item.ok)?.promotion;

    if (successfulMac && successfulPc) {
      const arbitrationDecision = evaluateConflictArbitration({
        macResult: successfulMac,
        pcResult: successfulPc,
      });
      const summary = buildExecutionCritiqueSummary({
        prompt,
        macResult: successfulMac,
        pcResult: successfulPc,
      });
      sessionManager.appendTranscriptEvent(sessionId, {
        lane: "shared",
        type: "compare",
        content: summary,
        routing_mode: "execute_critique",
        round: 1,
      });
      finalizeConflictArbitration({
        sessionManager,
        sessionId,
        operatorMode: "execute_critique",
        decision: arbitrationDecision,
        relatedEventIds: [
          result.payload.mac_result?.reply_event_id,
          result.payload.pc_result?.reply_event_id,
        ],
        suppressEvent: Boolean(
          pcPromotion && arbitrationDecision.arbitration_state === "needs_review"
        ),
        updateSummary: false,
      });
      sessionManager.updateMissionState(sessionId, {
        arbitration_state: arbitrationDecision.arbitration_state,
        current_compare_summary: summary,
      });
      result.payload.arbitration = arbitrationDecision;
    }

    result.payload.session = sessionManager.getSession(sessionId);
    if (!result.payload.ok) {
      result.payload.message = "Execution + critique did not complete cleanly across both lanes.";
    }

    return result;
  } catch (error) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

async function handleCompareRoute(
  {
    sessionManager,
    macExecutor,
    pcExecutor,
    macConfirmationGatePipeline,
    macVerificationPipeline,
    pcCritiquePromotionPipeline,
  },
  body
) {
  try {
    const executionOperatorMode = isCompareOperationalProbe(body) ? "compare_probe" : "compare";
    const prompt = buildComparePrompt(body);
    const macSharedInstruction = buildCompareSharedInstruction(body, "mac");
    const pcSharedInstruction = buildCompareSharedInstruction(body, "pc");
    const sessionId = ensureSession({
      sessionManager,
      sessionId: body.session_id,
      prompt,
      operatorMode: "compare",
    });

    const sharedEventId = appendSharedPromptEvent({
      sessionManager,
      sessionId,
      prompt,
      operatorMode: "compare",
    });
    const macTaskEventId = appendLaneTaskEvent({
      sessionManager,
      sessionId,
      lane: "mac",
      prompt,
      sharedInstruction: macSharedInstruction,
      operatorMode: "compare",
      sharedEventId,
    });
    const pcTaskEventId = appendLaneTaskEvent({
      sessionManager,
      sessionId,
      lane: "pc",
      prompt,
      sharedInstruction: pcSharedInstruction,
      operatorMode: "compare",
      sharedEventId,
    });

    const result = await executeLaneSet({
      sessionManager,
      sessionId,
      operatorMode: "compare",
      macConfirmationGatePipeline,
      macVerificationPipeline,
      pcCritiquePromotionPipeline,
      executions: [
        {
          lane: "mac",
          executor: macExecutor,
          prompt,
          sharedInstruction: macSharedInstruction,
          operatorMode: executionOperatorMode,
          normalizeResult: isCompareOperationalProbe(body)
            ? normalizeOperationalProbeLaneResult
            : null,
          taskEventId: macTaskEventId,
        },
        {
          lane: "pc",
          executor: pcExecutor,
          prompt,
          sharedInstruction: pcSharedInstruction,
          operatorMode: executionOperatorMode,
          normalizeResult: isCompareOperationalProbe(body)
            ? normalizeOperationalProbeLaneResult
            : null,
          taskEventId: pcTaskEventId,
        },
      ],
    });

    const successfulMac = result.settled.find((item) => item.lane === "mac" && item.ok)?.result;
    const successfulPc = result.settled.find((item) => item.lane === "pc" && item.ok)?.result;
    const pcPromotion = result.settled.find((item) => item.lane === "pc" && item.ok)?.promotion;

    if (successfulMac && successfulPc) {
      const arbitrationDecision = evaluateConflictArbitration({
        macResult: successfulMac,
        pcResult: successfulPc,
      });
      const compareCard = sessionManager.addCompareCard(
        sessionId,
        buildCompareCardFromLaneResults({
          prompt,
          macResult: successfulMac,
          pcResult: successfulPc,
          arbitrationDecision,
        })
      );
      const latestCompareCard = compareCard.compare_cards.at(-1);
      const compareSummary = [
        latestCompareCard?.overlap || "",
        latestCompareCard?.disagreement || "",
        latestCompareCard?.recommended_next_step || "",
      ]
        .filter(Boolean)
        .join(" ");

      sessionManager.appendTranscriptEvent(sessionId, {
        lane: "shared",
        type: "compare",
        content: compareSummary || "Compare complete.",
        routing_mode: "compare",
        round: 1,
      });
      finalizeConflictArbitration({
        sessionManager,
        sessionId,
        operatorMode: "compare",
        decision: arbitrationDecision,
        relatedEventIds: [
          result.payload.mac_result?.reply_event_id,
          result.payload.pc_result?.reply_event_id,
        ],
        suppressEvent: Boolean(
          pcPromotion && arbitrationDecision.arbitration_state === "needs_review"
        ),
        updateSummary: false,
      });
      result.payload.arbitration = arbitrationDecision;
    }

    result.payload.session = sessionManager.getSession(sessionId);
    if (!result.payload.ok) {
      result.payload.message = "Compare route did not complete cleanly across both lanes.";
    }

    return result;
  } catch (error) {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        message: error.message,
      },
    };
  }
}

export function createMissionControlApp({
  sessionManager,
  sessionStore = null,
  publicDir = null,
  artifactsDir = DEFAULT_ARTIFACTS_DIR,
  liveRecoveryDir = DEFAULT_LIVE_RECOVERY_DIR,
  taildropInboxDir = DEFAULT_TAILDROP_INBOX_DIR,
  laneConfigStore = null,
  laneConfigPath = DEFAULT_LANE_CONFIG_PATH,
  laneConfigDir = DEFAULT_LANE_CONFIG_DIR,
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  githubTooling = new GitHubTooling(),
  macExecutor = null,
  macConfirmationGatePipeline = new MacConfirmationGatePipeline(),
  macVerificationPipeline = new MacVerificationPipeline(),
  pcCritiquePromotionPipeline = new PcCritiquePromotionPipeline(),
  pcExecutor = null,
  sendMacActionPack = () => defaultSendMacActionPack(),
  sendMacFallbackBlock = () => defaultSendMacFallbackBlock(),
  sendMacRepoFallbackBlock = () => defaultSendMacRepoFallbackBlock(),
  sendMacRepoManualBlock = () => defaultSendMacRepoManualBlock(),
  sendMacRepoReportRequest = () => defaultSendMacRepoReportRequest(),
  sendMacRepoNudge = () => defaultSendMacRepoNudge(),
  startMacRepoReportWatcher = ({
    sessionId = "",
    resendEveryAttempts = 8,
    nudgeEveryAttempts = 24,
    fallbackEveryAttempts = 12,
    manualEveryAttempts = 36,
  } = {}) =>
    defaultStartMacRepoReportWatcher({
      sessionId,
      resendEveryAttempts,
      nudgeEveryAttempts,
      fallbackEveryAttempts,
      manualEveryAttempts,
      laneConfigDir,
    }),
  pullTaildropInbox = () => defaultPullTaildropInbox(),
  readWindowsClipboard = () => defaultReadWindowsClipboard(),
} = {}) {
  const resolvedSessionManager =
    sessionManager || new AgroSessionManager({ snapshotStore: sessionStore });
  const resolvedLaneConfigStore =
    laneConfigStore || new FileBackedLaneConfigStore({ filePath: laneConfigPath });
  const sharedRepoPaths = resolvedLaneConfigStore.getRepoPathsReference();
  const resolvedMacExecutor =
    macExecutor || new MacLaneAdapter({ repoPaths: sharedRepoPaths });
  const resolvedPcExecutor =
    pcExecutor || new PcLaneAdapter({ repoPaths: sharedRepoPaths });

  if (
    macExecutor &&
    Object.prototype.hasOwnProperty.call(macExecutor, "repoPaths") &&
    (!macExecutor.repoPaths || !Object.keys(macExecutor.repoPaths).length)
  ) {
    macExecutor.repoPaths = sharedRepoPaths;
  }

  if (
    pcExecutor &&
    Object.prototype.hasOwnProperty.call(pcExecutor, "repoPaths") &&
    (!pcExecutor.repoPaths || !Object.keys(pcExecutor.repoPaths).length)
  ) {
    pcExecutor.repoPaths = sharedRepoPaths;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/health") {
        return jsonResponse(res, 200, {
          ok: true,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        const { statusCode, payload } = await handleAppStatusRoute({
          sessionManager: resolvedSessionManager,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "GET" && url.pathname === "/api/session") {
        const { statusCode, payload } = await handleGetSessionRoute(
          {
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
          },
          url
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "GET" && url.pathname === "/api/sessions") {
        const { statusCode, payload } = await handleListSessionsRoute(
          {
            sessionManager: resolvedSessionManager,
          },
          url
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "GET" && url.pathname === "/api/live-recovery") {
        const { statusCode, payload } = await handleLiveRecoveryRoute({
          artifactsDir,
          liveRecoveryDir,
          taildropInboxDir,
          downloadsDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "GET" && url.pathname === "/api/lane-config") {
        const { statusCode, payload } = await handleGetLaneConfigRoute({
          artifactsDir,
          laneConfigStore: resolvedLaneConfigStore,
          taildropInboxDir,
          downloadsDir,
          liveRecoveryDir,
          laneConfigDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleUpdateLaneConfigRoute(
          {
            laneConfigStore: resolvedLaneConfigStore,
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
            taildropInboxDir,
            downloadsDir,
            laneConfigDir,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/apply-mac-repo-report-text") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleApplyMacRepoReportTextRoute(
          {
            laneConfigStore: resolvedLaneConfigStore,
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
            taildropInboxDir,
            downloadsDir,
            laneConfigDir,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/apply-mac-repo-report-clipboard") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleApplyMacRepoReportClipboardRoute(
          {
            laneConfigStore: resolvedLaneConfigStore,
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
            taildropInboxDir,
            downloadsDir,
            laneConfigDir,
            readWindowsClipboard,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/load-mac-repo-report-clipboard") {
        const { statusCode, payload } = await handleLoadMacRepoReportClipboardRoute({
          readWindowsClipboard,
          laneConfigDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/probe-mac-repo-clipboard") {
        const { statusCode, payload } = await handleProbeMacRepoClipboardRoute({
          readWindowsClipboard,
          laneConfigDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/clear-mac-repo-input-candidate") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleClearMacRepoInputCandidateRoute(
          {
            laneConfigDir,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/run-recommended-action") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleRunRecommendedLaneConfigActionRoute(
          {
            artifactsDir,
            laneConfigStore: resolvedLaneConfigStore,
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
            taildropInboxDir,
            downloadsDir,
            liveRecoveryDir,
            laneConfigDir,
            readWindowsClipboard,
            pullTaildropInbox,
            sendMacRepoNudge,
            sendMacRepoReportRequest,
            sendMacRepoFallbackBlock,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/request-mac-repo-report") {
        const { statusCode, payload } = await handleSendMacRepoReportRequestRoute({
          sendMacRepoReportRequest,
          liveRecoveryDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/send-mac-repo-nudge") {
        const { statusCode, payload } = await handleSendMacRepoNudgeRoute({
          sendMacRepoNudge,
          sendMacRepoReportRequest,
          sendMacRepoFallbackBlock,
          laneConfigDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/send-mac-repo-fallback-block") {
        const { statusCode, payload } = await handleSendMacRepoFallbackBlockRoute({
          sendMacRepoFallbackBlock,
          laneConfigDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/send-mac-repo-manual-block") {
        const { statusCode, payload } = await handleSendMacRepoManualBlockRoute({
          sendMacRepoManualBlock,
          laneConfigDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/start-mac-repo-report-watcher") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleStartMacRepoReportWatcherRoute(
          {
            startMacRepoReportWatcher,
            laneConfigDir,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/smart-apply-mac-repo-report") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleSmartApplyMacRepoReportRoute(
          {
            pullTaildropInbox,
            liveRecoveryDir,
            laneConfigStore: resolvedLaneConfigStore,
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
            taildropInboxDir,
            downloadsDir,
            laneConfigDir,
            readWindowsClipboard,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/lane-config/pull-and-apply-mac-repo-report") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handlePullAndApplyMacRepoReportRoute(
          {
            pullTaildropInbox,
            liveRecoveryDir,
            laneConfigStore: resolvedLaneConfigStore,
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
            taildropInboxDir,
            downloadsDir,
            laneConfigDir,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/recovery/send-mac-action-pack") {
        const { statusCode, payload } = await handleSendMacActionPackRoute({
          sendMacActionPack,
          liveRecoveryDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/recovery/send-mac-fallback-block") {
        const { statusCode, payload } = await handleSendMacFallbackBlockRoute({
          sendMacFallbackBlock,
          liveRecoveryDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/recovery/pull-taildrop-inbox") {
        const { statusCode, payload } = await handlePullTaildropInboxRoute({
          pullTaildropInbox,
          liveRecoveryDir,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/routes/send-mac") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleSendMacRoute(
          {
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            macConfirmationGatePipeline,
            macVerificationPipeline,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/routes/send-pc") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleSendPcRoute(
          {
            sessionManager: resolvedSessionManager,
            pcExecutor: resolvedPcExecutor,
            pcCritiquePromotionPipeline,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/routes/send-both") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleSendBothRoute(
          {
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
            macConfirmationGatePipeline,
            macVerificationPipeline,
            pcCritiquePromotionPipeline,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/routes/execute-critique") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleExecuteCritiqueRoute(
          {
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
            macConfirmationGatePipeline,
            macVerificationPipeline,
            pcCritiquePromotionPipeline,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/routes/compare") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleCompareRoute(
          {
            sessionManager: resolvedSessionManager,
            macExecutor: resolvedMacExecutor,
            pcExecutor: resolvedPcExecutor,
            macConfirmationGatePipeline,
            macVerificationPipeline,
            pcCritiquePromotionPipeline,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "GET" && url.pathname === "/api/tools/github/auth-status") {
        const { statusCode, payload } = await handleGitHubAuthStatusRoute({
          githubTooling,
        });
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/tools/github/repo") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleGitHubRepoRoute(
          {
            githubTooling,
            sessionManager: resolvedSessionManager,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/tools/github/issues") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleGitHubIssuesRoute(
          {
            githubTooling,
            sessionManager: resolvedSessionManager,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/tools/github/pull-requests") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleGitHubPullRequestsRoute(
          {
            githubTooling,
            sessionManager: resolvedSessionManager,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "POST" && url.pathname === "/api/tools/github/workflows") {
        const body = await readJsonBody(req);
        const { statusCode, payload } = await handleGitHubWorkflowsRoute(
          {
            githubTooling,
            sessionManager: resolvedSessionManager,
          },
          body
        );
        return jsonResponse(res, statusCode, payload);
      }

      if (req.method === "GET" && publicDir) {
        const served = await serveStaticAsset(res, publicDir, url.pathname);
        if (served) {
          return;
        }
      }

      return jsonResponse(res, 404, {
        ok: false,
        message: "Not found.",
      });
    } catch (error) {
      return jsonResponse(res, 500, {
        ok: false,
        message: error.message,
      });
    }
  });

  return {
    server,
    sessionManager: resolvedSessionManager,
    laneConfigStore: resolvedLaneConfigStore,
  };
}

export {
  handleGitHubAuthStatusRoute,
  handleGitHubIssuesRoute,
  handleGetLaneConfigRoute,
  handleGitHubPullRequestsRoute,
  handleGitHubRepoRoute,
  handleGitHubWorkflowsRoute,
  handleLiveRecoveryRoute,
  handleCompareRoute,
  handleExecuteCritiqueRoute,
  handlePullAndApplyMacRepoReportRoute,
  handleSmartApplyMacRepoReportRoute,
  handleSendBothRoute,
  handleSendMacFallbackBlockRoute,
  handleSendMacRepoNudgeRoute,
  handleSendMacRepoFallbackBlockRoute,
  handleSendMacRepoManualBlockRoute,
  handleSendMacRepoReportRequestRoute,
  handleStartMacRepoReportWatcherRoute,
  handleSendMacRoute,
  handleSendPcRoute,
  handleUpdateLaneConfigRoute,
};

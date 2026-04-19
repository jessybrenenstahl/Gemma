import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_REPO = "jessybrenenstahl/Gemma";
const DEFAULT_TIMEOUT_MS = 15_000;
const SAFE_LIMIT_DEFAULT = 10;
const SAFE_LIMIT_MAX = 20;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function buildGitHubToolError(message, code, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function sanitizeRepo(repo) {
  const value = String(repo || "").trim();
  if (!value) {
    throw buildGitHubToolError(
      "GitHub repo context is required in owner/name form.",
      "REPO_CONTEXT_REQUIRED"
    );
  }

  if (!REPO_PATTERN.test(value)) {
    throw buildGitHubToolError(
      "GitHub repo context must be in owner/name form.",
      "INVALID_REPO"
    );
  }

  return value;
}

function clampLimit(limit, fallback = SAFE_LIMIT_DEFAULT) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(numeric), SAFE_LIMIT_MAX);
}

function trimLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseAuthStatus(stdout) {
  const lines = trimLines(stdout);
  const host = lines[0] || "github.com";
  const loggedInLine = lines.find((line) => /Logged in to .* account /.test(line)) || "";
  const accountMatch = loggedInLine.match(/account\s+([A-Za-z0-9-]+)/i);
  const protocolMatch = lines
    .find((line) => line.startsWith("- Git operations protocol:"))
    ?.match(/:\s*(.+)$/);
  const activeMatch = lines
    .find((line) => line.startsWith("- Active account:"))
    ?.match(/:\s*(.+)$/);
  const scopesMatch = lines
    .find((line) => line.startsWith("- Token scopes:"))
    ?.match(/:\s*(.+)$/);
  const scopes = scopesMatch?.[1]
    ? scopesMatch[1]
        .split(",")
        .map((item) => item.replace(/['"]/g, "").trim())
        .filter(Boolean)
    : [];

  return {
    authenticated: Boolean(accountMatch),
    host,
    account: accountMatch?.[1] || "",
    active: activeMatch?.[1]?.toLowerCase() === "true",
    protocol: protocolMatch?.[1] || "",
    scopes,
  };
}

async function runGh(execFileImpl, args) {
  try {
    const result = await execFileImpl("gh", args, {
      windowsHide: true,
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });

    return {
      stdout: String(result?.stdout || ""),
      stderr: String(result?.stderr || ""),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw buildGitHubToolError(
        "GitHub CLI `gh` is not installed or is not available on PATH.",
        "GH_UNAVAILABLE",
        error
      );
    }

    const stderr = String(error?.stderr || "");
    const stdout = String(error?.stdout || "");
    const details = `${stderr}\n${stdout}`.trim();

    if (/not logged into/i.test(details) || /authentication required/i.test(details)) {
      throw buildGitHubToolError(
        "GitHub auth is missing. Run `gh auth login` on this machine before using GitHub tools.",
        "AUTH_REQUIRED",
        error
      );
    }

    if (
      /Could not resolve to a Repository/i.test(details) ||
      /HTTP 404/i.test(details) ||
      /not found/i.test(details)
    ) {
      throw buildGitHubToolError(
        "GitHub repo context is missing or inaccessible. Check the selected repo and current auth.",
        "REPO_UNAVAILABLE",
        error
      );
    }

    throw buildGitHubToolError(
      details ? `GitHub tooling failed: ${details.split(/\r?\n/)[0]}` : "GitHub tooling failed.",
      "GITHUB_TOOL_ERROR",
      error
    );
  }
}

function parseJsonOutput(stdout, fallbackValue) {
  const text = String(stdout || "").trim();
  if (!text) {
    return fallbackValue;
  }

  return JSON.parse(text);
}

export class GitHubTooling {
  constructor({
    execFileImpl = execFileAsync,
    defaultRepo = DEFAULT_REPO,
  } = {}) {
    this.execFileImpl = execFileImpl;
    this.defaultRepo = defaultRepo;
  }

  resolveRepo({ repo, session } = {}) {
    return sanitizeRepo(repo || session?.mission_state?.active_repo || this.defaultRepo);
  }

  async getAuthStatus() {
    const { stdout } = await runGh(this.execFileImpl, ["auth", "status"]);
    return parseAuthStatus(stdout);
  }

  async inspectRepo({ repo, session } = {}) {
    const resolvedRepo = this.resolveRepo({ repo, session });
    const { stdout } = await runGh(this.execFileImpl, [
      "repo",
      "view",
      resolvedRepo,
      "--json",
      "nameWithOwner,defaultBranchRef,isPrivate,url,description",
    ]);

    return {
      repo: resolvedRepo,
      repo_details: parseJsonOutput(stdout, {}),
    };
  }

  async listIssues({ repo, session, limit } = {}) {
    const resolvedRepo = this.resolveRepo({ repo, session });
    const { stdout } = await runGh(this.execFileImpl, [
      "issue",
      "list",
      "--repo",
      resolvedRepo,
      "--limit",
      String(clampLimit(limit)),
      "--json",
      "number,title,state,author,labels,url",
    ]);

    return {
      repo: resolvedRepo,
      issues: parseJsonOutput(stdout, []),
    };
  }

  async listPullRequests({ repo, session, limit } = {}) {
    const resolvedRepo = this.resolveRepo({ repo, session });
    const { stdout } = await runGh(this.execFileImpl, [
      "pr",
      "list",
      "--repo",
      resolvedRepo,
      "--limit",
      String(clampLimit(limit)),
      "--json",
      "number,title,state,author,headRefName,baseRefName,isDraft,url",
    ]);

    return {
      repo: resolvedRepo,
      pull_requests: parseJsonOutput(stdout, []),
    };
  }

  async listWorkflows({ repo, session, limit } = {}) {
    const resolvedRepo = this.resolveRepo({ repo, session });
    const { stdout } = await runGh(this.execFileImpl, [
      "workflow",
      "list",
      "--repo",
      resolvedRepo,
      "--limit",
      String(clampLimit(limit)),
      "--json",
      "id,name,state,path",
    ]);

    return {
      repo: resolvedRepo,
      workflows: parseJsonOutput(stdout, []),
    };
  }
}

export { buildGitHubToolError };

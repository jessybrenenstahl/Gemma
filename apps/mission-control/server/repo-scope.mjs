import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_REPO = "jessybrenenstahl/Gemma";
const DEFAULT_PC_REPO_PATH = "C:\\Users\\jessy\\Documents\\GitHub\\Gemma";

function normalizeRepo(repo) {
  return String(repo || "").trim() || DEFAULT_REPO;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/[\\/]+$/, "");
}

function resolveMappedLanePath(mappedPath, lane) {
  if (!mappedPath) {
    return "";
  }

  if (typeof mappedPath === "string") {
    return trimTrailingSlash(mappedPath);
  }

  if (typeof mappedPath !== "object") {
    return "";
  }

  const candidate =
    mappedPath?.[lane] ??
    mappedPath?.[`${lane}_repo_path`] ??
    mappedPath?.path ??
    mappedPath?.default ??
    "";

  return trimTrailingSlash(candidate);
}

function looksLikeRemoteMacPath(localPath) {
  const normalized = String(localPath || "").trim();
  return /^~?[\\/]/.test(normalized);
}

function makeRepoContext({
  repo,
  localPath = null,
  presence = "unknown",
  usability = "unknown",
  lastCheckedAt = null,
  detail = "",
}) {
  return {
    repo: normalizeRepo(repo),
    local_path: localPath ? trimTrailingSlash(localPath) : null,
    presence,
    usability,
    last_checked_at: lastCheckedAt,
    detail: String(detail || ""),
  };
}

function resolveGitMetadataPath(repoPath) {
  const dotGitPath = path.join(repoPath, ".git");
  if (!existsSync(dotGitPath)) {
    return null;
  }

  const stats = statSync(dotGitPath);
  if (stats.isDirectory()) {
    return dotGitPath;
  }

  if (!stats.isFile()) {
    return null;
  }

  const raw = readFileSync(dotGitPath, "utf8");
  const match = raw.match(/gitdir:\s*(.+)\s*$/im);
  if (!match) {
    return null;
  }

  const gitDir = match[1].trim();
  return path.isAbsolute(gitDir) ? gitDir : path.resolve(repoPath, gitDir);
}

function extractOriginUrl(repoPath) {
  const gitDir = resolveGitMetadataPath(repoPath);
  if (!gitDir) {
    return null;
  }

  const configPath = path.join(gitDir, "config");
  if (!existsSync(configPath)) {
    return null;
  }

  const raw = readFileSync(configPath, "utf8");
  const originMatch = raw.match(/\[remote "origin"\][\s\S]*?url = (.+)\r?$/im);
  return originMatch?.[1]?.trim() || null;
}

function repoMatchesOrigin(repo, originUrl) {
  if (!originUrl) {
    return false;
  }

  const normalizedOrigin = originUrl.replace(/[\\/]+$/, "");
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`[:/]${escapedRepo}(?:\\.git)?$`, "i").test(normalizedOrigin);
}

function resolveLanePath({
  lane,
  repo,
  repoPaths = {},
}) {
  const repoId = normalizeRepo(repo);
  const mappedPath = resolveMappedLanePath(repoPaths?.[repoId], lane);
  if (mappedPath) {
    return mappedPath;
  }

  if (lane === "pc") {
    return trimTrailingSlash(process.env.AGRO_PC_REPO_PATH || DEFAULT_PC_REPO_PATH);
  }

  return trimTrailingSlash(process.env.AGRO_MAC_REPO_PATH || "");
}

export function inspectRepoScope({
  lane,
  repo,
  repoPaths = {},
  now = new Date().toISOString(),
}) {
  const repoId = normalizeRepo(repo);
  const localPath = resolveLanePath({ lane, repo: repoId, repoPaths });

  if (!localPath) {
    return makeRepoContext({
      repo: repoId,
      localPath: null,
      presence: "unknown",
      usability: "unknown",
      lastCheckedAt: now,
      detail: `No local repo path is configured for the ${lane} lane.`,
    });
  }

  if (lane === "mac" && looksLikeRemoteMacPath(localPath)) {
    return makeRepoContext({
      repo: repoId,
      localPath,
      presence: "present",
      usability: "usable",
      lastCheckedAt: now,
      detail:
        "Mac repo path is configured for the remote lane and cannot be locally verified from Windows.",
    });
  }

  if (!existsSync(localPath)) {
    return makeRepoContext({
      repo: repoId,
      localPath,
      presence: "missing",
      usability: "unusable",
      lastCheckedAt: now,
      detail: `Configured repo path for the ${lane} lane does not exist: ${localPath}`,
    });
  }

  const stats = statSync(localPath);
  if (!stats.isDirectory()) {
    return makeRepoContext({
      repo: repoId,
      localPath,
      presence: "present",
      usability: "unusable",
      lastCheckedAt: now,
      detail: `Configured repo path for the ${lane} lane is not a directory: ${localPath}`,
    });
  }

  const gitDir = resolveGitMetadataPath(localPath);
  if (!gitDir) {
    return makeRepoContext({
      repo: repoId,
      localPath,
      presence: "present",
      usability: "unusable",
      lastCheckedAt: now,
      detail: `Configured repo path for the ${lane} lane is not a Git checkout: ${localPath}`,
    });
  }

  const originUrl = extractOriginUrl(localPath);
  if (originUrl && !repoMatchesOrigin(repoId, originUrl)) {
    return makeRepoContext({
      repo: repoId,
      localPath,
      presence: "present",
      usability: "unusable",
      lastCheckedAt: now,
      detail: `Configured repo path for the ${lane} lane points to a different origin than ${repoId}.`,
    });
  }

  return makeRepoContext({
    repo: repoId,
    localPath,
    presence: "present",
    usability: "usable",
    lastCheckedAt: now,
    detail: `Repo checkout for the ${lane} lane matches ${repoId}.`,
  });
}

export function isRepoScopeBlocking(repoContext) {
  return repoContext?.usability === "unusable";
}

export { makeRepoContext, normalizeRepo, repoMatchesOrigin, resolveLanePath };

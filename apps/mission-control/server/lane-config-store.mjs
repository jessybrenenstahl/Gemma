import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { normalizeRepo, resolveLanePath } from "./repo-scope.mjs";

const DEFAULT_REPO = "jessybrenenstahl/Gemma";

function trimRepoPath(value) {
  return String(value || "").trim().replace(/[\\/]+$/, "");
}

function normalizeRepoRecord(record = {}) {
  return {
    mac_repo_path: trimRepoPath(record.mac_repo_path),
    pc_repo_path: trimRepoPath(record.pc_repo_path),
  };
}

function makeDefaultState(defaultRepo) {
  return {
    version: 1,
    active_repo: defaultRepo,
    repos: {
      [defaultRepo]: normalizeRepoRecord(),
    },
    updated_at: null,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function inferPathSource(lane, configuredPath, effectivePath) {
  if (configuredPath) {
    return "config";
  }

  const envPath =
    lane === "mac"
      ? trimRepoPath(process.env.AGRO_MAC_REPO_PATH)
      : trimRepoPath(process.env.AGRO_PC_REPO_PATH);

  if (envPath) {
    return "env";
  }

  if (effectivePath) {
    return lane === "pc" ? "default" : "derived";
  }

  return "unset";
}

export class FileBackedLaneConfigStore {
  constructor({
    filePath,
    defaultRepo = DEFAULT_REPO,
  } = {}) {
    this.filePath = filePath;
    this.defaultRepo = normalizeRepo(defaultRepo);
    this.repoPaths = {};
    this.state = this.#readState();
    this.#syncRepoPaths();
  }

  getRepoPathsReference() {
    return this.repoPaths;
  }

  getConfig({ activeRepo } = {}) {
    const repoId = normalizeRepo(activeRepo || this.state.active_repo || this.defaultRepo);
    const record = this.#getRepoRecord(repoId);
    const configuredRepoPaths = {
      mac: record.mac_repo_path,
      pc: record.pc_repo_path,
    };
    const configuredOverrides = {};
    if (configuredRepoPaths.mac) {
      configuredOverrides.mac = configuredRepoPaths.mac;
    }
    if (configuredRepoPaths.pc) {
      configuredOverrides.pc = configuredRepoPaths.pc;
    }
    const repoPaths = Object.keys(configuredOverrides).length
      ? { [repoId]: configuredOverrides }
      : {};
    const effectiveRepoPaths = {
      mac: resolveLanePath({
        lane: "mac",
        repo: repoId,
        repoPaths,
      }),
      pc: resolveLanePath({
        lane: "pc",
        repo: repoId,
        repoPaths,
      }),
    };

    return {
      active_repo: repoId,
      updated_at: this.state.updated_at,
      file_path: this.filePath,
      configured_repo_paths: configuredRepoPaths,
      effective_repo_paths: effectiveRepoPaths,
      sources: {
        mac: inferPathSource("mac", configuredRepoPaths.mac, effectiveRepoPaths.mac),
        pc: inferPathSource("pc", configuredRepoPaths.pc, effectiveRepoPaths.pc),
      },
    };
  }

  updateConfig({
    activeRepo,
    macRepoPath,
    pcRepoPath,
  } = {}) {
    const repoId = normalizeRepo(activeRepo || this.state.active_repo || this.defaultRepo);
    const repos = cloneJson(this.state.repos || {});
    const currentRecord = this.#getRepoRecord(repoId);

    repos[repoId] = normalizeRepoRecord({
      mac_repo_path:
        macRepoPath === undefined ? currentRecord.mac_repo_path : macRepoPath,
      pc_repo_path:
        pcRepoPath === undefined ? currentRecord.pc_repo_path : pcRepoPath,
    });

    this.state = {
      version: 1,
      active_repo: repoId,
      repos,
      updated_at: new Date().toISOString(),
    };
    this.#writeState();
    this.#syncRepoPaths();
    return this.getConfig();
  }

  #getRepoRecord(repoId) {
    return normalizeRepoRecord(this.state?.repos?.[repoId]);
  }

  #readState() {
    if (!this.filePath || !existsSync(this.filePath)) {
      return makeDefaultState(this.defaultRepo);
    }

    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const activeRepo = normalizeRepo(parsed?.active_repo || this.defaultRepo);
      const repos = {};

      for (const [repoId, record] of Object.entries(parsed?.repos || {})) {
        repos[normalizeRepo(repoId)] = normalizeRepoRecord(record);
      }

      if (!repos[activeRepo]) {
        repos[activeRepo] = normalizeRepoRecord();
      }

      return {
        version: 1,
        active_repo: activeRepo,
        repos,
        updated_at: parsed?.updated_at || null,
      };
    } catch {
      return makeDefaultState(this.defaultRepo);
    }
  }

  #syncRepoPaths() {
    for (const repoId of Object.keys(this.repoPaths)) {
      delete this.repoPaths[repoId];
    }

    for (const [repoId, record] of Object.entries(this.state.repos || {})) {
      const normalized = normalizeRepoRecord(record);
      const lanePaths = {};
      if (normalized.mac_repo_path) {
        lanePaths.mac = normalized.mac_repo_path;
      }
      if (normalized.pc_repo_path) {
        lanePaths.pc = normalized.pc_repo_path;
      }
      if (Object.keys(lanePaths).length) {
        this.repoPaths[normalizeRepo(repoId)] = lanePaths;
      }
    }
  }

  #writeState() {
    if (!this.filePath) {
      return;
    }

    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }
}

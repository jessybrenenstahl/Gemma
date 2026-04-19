import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export class FileBackedSessionStore {
  constructor({ rootDir }) {
    this.rootDir = rootDir;
    mkdirSync(this.rootDir, { recursive: true });
  }

  sessionPath(sessionId) {
    return path.join(this.rootDir, `${sessionId}.json`);
  }

  loadSessions() {
    const entries = readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name));

    return entries.map((entry) => {
      const raw = readFileSync(path.join(this.rootDir, entry.name), "utf8");
      return JSON.parse(raw);
    });
  }

  saveSession(session) {
    const targetPath = this.sessionPath(session.session_id);
    const tempPath = `${targetPath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(session, null, 2), "utf8");
    renameSync(tempPath, targetPath);
  }

  deleteSession(sessionId) {
    rmSync(this.sessionPath(sessionId), { force: true });
  }
}

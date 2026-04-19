import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createMissionControlApp, inspectRepoScope, PcLaneAdapter } from "../server/index.mjs";

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 13, 23, 30, tick)).toISOString();
  };
}

function createGitCheckout(rootDir, repo = "jessybrenenstahl/Gemma") {
  mkdirSync(path.join(rootDir, ".git"), { recursive: true });
  writeFileSync(
    path.join(rootDir, ".git", "config"),
    [
      "[core]",
      "\trepositoryformatversion = 0",
      '[remote "origin"]',
      `\turl = https://github.com/${repo}.git`,
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
      "",
    ].join("\n"),
    "utf8"
  );
}

async function withServer(app, callback) {
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) =>
      app.server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("inspectRepoScope reports usable and wrong-repo states", () => {
  const matchingDir = mkdtempSync(path.join(os.tmpdir(), "agro-repo-good-"));
  const wrongDir = mkdtempSync(path.join(os.tmpdir(), "agro-repo-wrong-"));
  createGitCheckout(matchingDir, "jessybrenenstahl/Gemma");
  createGitCheckout(wrongDir, "someone-else/OtherRepo");

  const usable = inspectRepoScope({
    lane: "pc",
    repo: "jessybrenenstahl/Gemma",
    repoPaths: {
      "jessybrenenstahl/Gemma": matchingDir,
    },
    now: new Date(Date.UTC(2026, 3, 13, 23, 31, 0)).toISOString(),
  });
  const wrong = inspectRepoScope({
    lane: "pc",
    repo: "jessybrenenstahl/Gemma",
    repoPaths: {
      "jessybrenenstahl/Gemma": wrongDir,
    },
    now: new Date(Date.UTC(2026, 3, 13, 23, 31, 1)).toISOString(),
  });

  assert.equal(usable.usability, "usable");
  assert.equal(usable.presence, "present");
  assert.equal(wrong.usability, "unusable");
  assert.match(wrong.detail, /different origin/i);
});

test("inspectRepoScope supports separate Mac and PC repo path mappings", () => {
  const macDir = mkdtempSync(path.join(os.tmpdir(), "agro-repo-mac-"));
  const pcDir = mkdtempSync(path.join(os.tmpdir(), "agro-repo-pc-"));
  createGitCheckout(macDir, "jessybrenenstahl/Gemma");
  createGitCheckout(pcDir, "jessybrenenstahl/Gemma");

  const repoPaths = {
    "jessybrenenstahl/Gemma": {
      mac: macDir,
      pc: pcDir,
    },
  };

  const macContext = inspectRepoScope({
    lane: "mac",
    repo: "jessybrenenstahl/Gemma",
    repoPaths,
    now: new Date(Date.UTC(2026, 3, 13, 23, 31, 2)).toISOString(),
  });
  const pcContext = inspectRepoScope({
    lane: "pc",
    repo: "jessybrenenstahl/Gemma",
    repoPaths,
    now: new Date(Date.UTC(2026, 3, 13, 23, 31, 3)).toISOString(),
  });

  assert.equal(macContext.local_path, macDir);
  assert.equal(pcContext.local_path, pcDir);
  assert.equal(macContext.usability, "usable");
  assert.equal(pcContext.usability, "usable");
});

test("inspectRepoScope treats configured Mac POSIX paths as remote-usable", () => {
  const macContext = inspectRepoScope({
    lane: "mac",
    repo: "jessybrenenstahl/Gemma",
    repoPaths: {
      "jessybrenenstahl/Gemma": {
        mac: "/Users/jessy/Documents/GitHub/Gemma",
      },
    },
    now: new Date(Date.UTC(2026, 3, 13, 23, 31, 4)).toISOString(),
  });

  assert.equal(macContext.local_path, "/Users/jessy/Documents/GitHub/Gemma");
  assert.equal(macContext.presence, "present");
  assert.equal(macContext.usability, "usable");
  assert.match(macContext.detail, /remote lane/i);
});

test("send-pc route fails clearly when the selected repo checkout is missing or wrong", async () => {
  let executeCalls = 0;
  const app = createMissionControlApp({
    pcExecutor: new PcLaneAdapter({
      endpoint: "http://127.0.0.1:1234",
      model: "gemma4-26b-128k",
      repoPaths: {
        "jessybrenenstahl/Gemma": "C:\\definitely-missing\\Gemma",
      },
      fetchImpl: async () => {
        executeCalls += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              content: "This should never execute because repo scope should fail first.",
            };
          },
        };
      },
    }),
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routes/send-pc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Review the AGRO route plan with explicit repo scope.",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 409);
    assert.equal(data.ok, false);
    assert.equal(data.code, "REPO_SCOPE_UNAVAILABLE");
    assert.equal(data.session.pc_state.repo_context.usability, "unusable");
    assert.equal(data.session.pc_state.latest_error_gap.severity, "high");
    assert.match(data.session.derived.repo_header.label, /PC: unusable/);
    assert.equal(executeCalls, 0);
  });
});

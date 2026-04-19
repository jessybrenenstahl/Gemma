import test from "node:test";
import assert from "node:assert/strict";

import { createMissionControlApp, GitHubTooling } from "../server/index.mjs";

function createExecFileStub(handlers = []) {
  const calls = [];

  const stub = async (file, args) => {
    calls.push({ file, args });

    for (const handler of handlers) {
      if (handler.match({ file, args })) {
        if (handler.error) {
          throw handler.error;
        }
        return handler.result;
      }
    }

    throw new Error(`Unexpected gh invocation: ${file} ${args.join(" ")}`);
  };

  stub.calls = calls;
  return stub;
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

test("GitHub tooling parses gh auth status without exposing token details", async () => {
  const execFileStub = createExecFileStub([
    {
      match: ({ args }) => args[0] === "auth" && args[1] === "status",
      result: {
        stdout: `github.com
  ✓ Logged in to github.com account jessybrenenstahl (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'
`,
      },
    },
  ]);
  const githubTooling = new GitHubTooling({
    execFileImpl: execFileStub,
  });

  const auth = await githubTooling.getAuthStatus();

  assert.deepEqual(auth, {
    authenticated: true,
    host: "github.com",
    account: "jessybrenenstahl",
    active: true,
    protocol: "https",
    scopes: ["gist", "read:org", "repo", "workflow"],
  });
  assert.equal(Object.hasOwn(auth, "token"), false);
});

test("mission-control GitHub routes use session repo context and clamp list limits", async () => {
  const execFileStub = createExecFileStub([
    {
      match: ({ args }) =>
        args.slice(0, 3).join(" ") === "repo view jessybrenenstahl/Gemma",
      result: {
        stdout: JSON.stringify({
          nameWithOwner: "jessybrenenstahl/Gemma",
          defaultBranchRef: { name: "main" },
          isPrivate: false,
          url: "https://github.com/jessybrenenstahl/Gemma",
          description: "AGRO mission control",
        }),
      },
    },
    {
      match: ({ args }) =>
        args[0] === "issue" && args[1] === "list" && args.includes("jessybrenenstahl/Gemma"),
      result: {
        stdout: JSON.stringify([
          {
            number: 1,
            title: "Mission state card",
            state: "OPEN",
            url: "https://github.com/jessybrenenstahl/Gemma/issues/1",
          },
        ]),
      },
    },
    {
      match: ({ args }) =>
        args[0] === "pr" && args[1] === "list" && args.includes("jessybrenenstahl/Gemma"),
      result: {
        stdout: JSON.stringify([
          {
            number: 7,
            title: "Add mission-control routes",
            state: "OPEN",
            isDraft: true,
            url: "https://github.com/jessybrenenstahl/Gemma/pull/7",
          },
        ]),
      },
    },
    {
      match: ({ args }) =>
        args[0] === "workflow" &&
        args[1] === "list" &&
        args.includes("jessybrenenstahl/Gemma"),
      result: {
        stdout: "",
      },
    },
  ]);

  const app = createMissionControlApp({
    githubTooling: new GitHubTooling({
      execFileImpl: execFileStub,
      defaultRepo: null,
    }),
  });
  const session = app.sessionManager.createSession({
    missionGoal: "Inspect the AGRO repo state",
    activeRepo: "jessybrenenstahl/Gemma",
  });

  await withServer(app, async (baseUrl) => {
    const repoResponse = await fetch(`${baseUrl}/api/tools/github/repo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: session.session_id,
      }),
    });
    const repoData = await repoResponse.json();
    assert.equal(repoResponse.status, 200);
    assert.equal(repoData.repo, "jessybrenenstahl/Gemma");
    assert.equal(repoData.repo_details.defaultBranchRef.name, "main");

    const issuesResponse = await fetch(`${baseUrl}/api/tools/github/issues`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: session.session_id,
        limit: 99,
      }),
    });
    const issuesData = await issuesResponse.json();
    assert.equal(issuesResponse.status, 200);
    assert.equal(issuesData.issues.length, 1);

    const pullsResponse = await fetch(`${baseUrl}/api/tools/github/pull-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: session.session_id,
        limit: 30,
      }),
    });
    const pullsData = await pullsResponse.json();
    assert.equal(pullsResponse.status, 200);
    assert.equal(pullsData.pull_requests.length, 1);

    const workflowsResponse = await fetch(`${baseUrl}/api/tools/github/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: session.session_id,
      }),
    });
    const workflowsData = await workflowsResponse.json();
    assert.equal(workflowsResponse.status, 200);
    assert.deepEqual(workflowsData.workflows, []);
  });

  const issueCall = execFileStub.calls.find((call) => call.args[0] === "issue");
  const prCall = execFileStub.calls.find((call) => call.args[0] === "pr");
  assert.deepEqual(issueCall.args.slice(0, 7), [
    "issue",
    "list",
    "--repo",
    "jessybrenenstahl/Gemma",
    "--limit",
    "20",
    "--json",
  ]);
  assert.deepEqual(prCall.args.slice(0, 7), [
    "pr",
    "list",
    "--repo",
    "jessybrenenstahl/Gemma",
    "--limit",
    "20",
    "--json",
  ]);
});

test("mission-control GitHub routes return clear auth and repo-context errors", async () => {
  const authError = new Error("auth required");
  authError.stderr = "You are not logged into any GitHub hosts. Run gh auth login";

  const authStub = createExecFileStub([
    {
      match: ({ args }) => args[0] === "auth" && args[1] === "status",
      error: authError,
    },
  ]);

  const authApp = createMissionControlApp({
    githubTooling: new GitHubTooling({
      execFileImpl: authStub,
      defaultRepo: null,
    }),
  });

  await withServer(authApp, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tools/github/auth-status`);
    const data = await response.json();
    assert.equal(response.status, 401);
    assert.equal(data.code, "AUTH_REQUIRED");
    assert.match(data.message, /gh auth login/i);
  });

  const repoApp = createMissionControlApp({
    githubTooling: new GitHubTooling({
      execFileImpl: createExecFileStub([]),
      defaultRepo: null,
    }),
  });

  await withServer(repoApp, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tools/github/issues`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const data = await response.json();
    assert.equal(response.status, 400);
    assert.equal(data.code, "REPO_CONTEXT_REQUIRED");
    assert.match(data.message, /owner\/name/i);
  });
});

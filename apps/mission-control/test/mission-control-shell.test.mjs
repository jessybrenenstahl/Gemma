import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createMissionControlApp, FileBackedLaneConfigStore } from "../server/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "..", "public");

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 14, 2, 0, tick)).toISOString();
  };
}

async function createGitCheckout(rootDir, repo = "jessybrenenstahl/Gemma") {
  await mkdir(path.join(rootDir, ".git"), { recursive: true });
  return writeFile(
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

function assertMatchOrEqual(actual, expected) {
  if (expected instanceof RegExp) {
    assert.match(actual, expected);
    return;
  }

  assert.equal(actual, expected);
}

function getLaneConfigRecommendedAction(data) {
  return data.lane_config_manual_surface?.recommended_action || null;
}

function getLaneConfigRecommendedRun(data) {
  return data.lane_config_manual_surface?.recommended_run || null;
}

function getLaneConfigRecommendedRunState(data) {
  return data.lane_config_manual_surface?.recommended_run_state || null;
}

function getLaneConfigRunRecommendedAction(data) {
  return getLaneConfigRecommendedRun(data)?.recommended_action || null;
}

function getLaneConfigRunExecutedAction(data) {
  return getLaneConfigRecommendedRun(data)?.executed_action || null;
}

function assertLaneConfigManualSurfaceState(data, expected) {
  const manualSurface = data.lane_config_manual_surface;
  assert.ok(manualSurface);

  if (Object.hasOwn(expected, "blocked_by")) {
    assertMatchOrEqual(manualSurface.blocked_by, expected.blocked_by);
  }

  if (Object.hasOwn(expected, "manual_ingest_hint")) {
    assertMatchOrEqual(
      manualSurface.manual_ingest_hint,
      expected.manual_ingest_hint
    );
  }

  if (Object.hasOwn(expected, "next_action")) {
    assertMatchOrEqual(manualSurface.next_action, expected.next_action);
  }

  if (Object.hasOwn(expected, "action")) {
    assertMatchOrEqual(manualSurface.action, expected.action);
  }

  if (expected.recommended_run) {
    if (Object.hasOwn(expected.recommended_run, "summary")) {
      assertMatchOrEqual(
        manualSurface.recommended_run?.summary,
        expected.recommended_run.summary
      );
    }
    if (Object.hasOwn(expected.recommended_run, "code")) {
      assert.equal(manualSurface.recommended_run?.code, expected.recommended_run.code);
    }
    if (Object.hasOwn(expected.recommended_run, "ok")) {
      assert.equal(manualSurface.recommended_run?.ok, expected.recommended_run.ok);
    }
    if (Object.hasOwn(expected.recommended_run, "executed_action_key")) {
      assert.equal(
        manualSurface.recommended_run?.executed_action?.key,
        expected.recommended_run.executed_action_key
      );
    }
  }

  if (expected.recommended_run_state) {
    if (Object.hasOwn(expected.recommended_run_state, "state")) {
      assert.equal(
        manualSurface.recommended_run_state?.state,
        expected.recommended_run_state.state
      );
    }
    if (Object.hasOwn(expected.recommended_run_state, "summary")) {
      assertMatchOrEqual(
        manualSurface.recommended_run_state?.summary,
        expected.recommended_run_state.summary
      );
    }
  }

  if (Object.hasOwn(expected, "retry_path")) {
    assertMatchOrEqual(manualSurface.retry_path, expected.retry_path);
  }

  if (Object.hasOwn(expected, "success_path")) {
    assertMatchOrEqual(manualSurface.success_path, expected.success_path);
  }

  if (Object.hasOwn(expected, "summary")) {
    const summaryExpected = Array.isArray(expected.summary)
      ? expected.summary
      : [expected.summary];
    for (const matcher of summaryExpected) {
      assertMatchOrEqual(manualSurface.summary, matcher);
    }
  }

  if (expected.run_recommended) {
    if (Object.hasOwn(expected.run_recommended, "label")) {
      assertMatchOrEqual(
        manualSurface.run_recommended.label,
        expected.run_recommended.label
      );
    }
    if (Object.hasOwn(expected.run_recommended, "disabled")) {
      assert.equal(
        manualSurface.run_recommended.disabled,
        expected.run_recommended.disabled
      );
    }
      if (Object.hasOwn(expected.run_recommended, "mode")) {
        assert.equal(
          manualSurface.run_recommended.mode,
          expected.run_recommended.mode
        );
      }
      if (Object.hasOwn(expected.run_recommended, "retryable")) {
        assert.equal(
          manualSurface.run_recommended.retryable,
          expected.run_recommended.retryable
        );
      }
      if (Object.hasOwn(expected.run_recommended, "refreshable")) {
        assert.equal(
          manualSurface.run_recommended.refreshable,
          expected.run_recommended.refreshable
        );
      }
    }
  }

test("mission-control shell serves the repo UI assets", async () => {
  const app = createMissionControlApp({
    publicDir,
  });

  await withServer(app, async (baseUrl) => {
  const htmlResponse = await fetch(`${baseUrl}/`);
  const html = await htmlResponse.text();
  assert.equal(htmlResponse.status, 200);
  assert.match(html, /AGRO Mission Control/i);
  assert.match(html, /Ask Mac to Execute \+ PC to Critique/i);
  assert.match(html, /Manual Ingest Hint/i);
  assert.match(html, /Lane Config Summary/i);
  assert.match(html, /Recommended Action/i);
  assert.match(html, /Blocked By/i);
  assert.match(html, /Next Success Path/i);
  assert.match(html, /Run Path/i);
  assert.match(html, /Run Recommended Action/i);
  assert.match(html, /Refresh Clipboard/i);
      assert.match(html, /Last Recommended Run/i);
      assert.match(html, /Recommended Run State/i);
      assert.match(html, /Input Risk/i);
      assert.match(html, /Last Auto-Probe/i);
      assert.match(html, /Auto-Probe Mode/i);

  const cssResponse = await fetch(`${baseUrl}/styles.css`);
  const css = await cssResponse.text();
  assert.equal(cssResponse.status, 200);
  assert.match(css, /\.app-shell/);

  const jsResponse = await fetch(`${baseUrl}/app.js`);
  const js = await jsResponse.text();
  assert.equal(jsResponse.status, 200);
  assert.match(js, /async function maybeAutoProbeLaneConfig\(\)/);
  assert.match(js, /function formatMacRepoAutoProbe\(receipt\)/);
  assert.match(js, /function formatMacRepoAutoProbeMode\(\)/);
  assert.match(js, /function formatAutoProbeAgePart\(recordedAt\)/);
  assert.match(js, /const AUTO_PROBE_UI_TICK_MS = 1000/);
  assert.match(js, /function renderAutoProbeFacts\(\)/);
  assert.match(js, /function ensureAutoProbeTicker\(\)/);
  assert.match(js, /manualBlockedBy: document\.querySelector\("#manualBlockedBy"\)/);
  assert.match(js, /laneConfigManualSurface: null/);
  assert.match(js, /manualRunPathLabel: document\.querySelector\("#manualRunPathLabel"\)/);
  assert.match(js, /manualRetryPath: document\.querySelector\("#manualRetryPath"\)/);
  assert.match(js, /manualSuccessPath: document\.querySelector\("#manualSuccessPath"\)/);
  assert.match(js, /manualSummary: document\.querySelector\("#manualSummary"\)/);
  assert.match(js, /function renderManualSurface\(\{/);
  assert.match(js, /macRepoRecommendedRunState: document\.querySelector\("#macRepoRecommendedRunState"\)/);
  assert.match(js, /const shouldUseServerSurface =/);
  assert.match(js, /function getRecommendedManualAction\(status, preview, pastedText\)/);
  assert.match(js, /function formatLaneConfigRecommendedRunState\(runState\)/);
  assert.match(js, /renderAutoProbeFacts\(\);/);
  assert.match(js, /window\.setInterval\(\(\) => \{\s*renderAutoProbeFacts\(\);[\s\S]*AUTO_PROBE_UI_TICK_MS/);
  assert.match(js, /No active manual-ingest blocker\./);
  assert.match(js, /recommendation\.blocked_code/);
  assert.match(js, /function buildServerRecommendedManualAction\(serverRecommendation, overrides = \{\}\)/);
  assert.match(js, /Copy a fresh Mac repo reply into Windows, then click Run Recommended Action once\./);
  assert.match(js, /Run Recommended: Recheck Clipboard/);
  assert.match(js, /Refresh Path/);
  assert.match(js, /This button will recheck the current Windows clipboard when you click it\./);
  assert.match(js, /function getLaneConfigRunActionLabel\(runReceipt\)/);
  assert.match(js, /Windows clipboard still has the same stale Mac repo input\./);
  assert.match(js, /const retryPath = runRecommendedMode === "refresh"/);
  assert.match(js, /const executedAction = runReceipt\?\.executed_action \|\| null;/);
  assert.match(js, /mode:/);
  assert.match(js, /function formatRunPathLabelFromMode\(mode\)/);
  assert.match(js, /Refresh Clipboard/);
  assert.match(js, /refreshLaneConfig\(\)\s*\.then\(\(\) => maybeAutoProbeLaneConfig\(\)\)/);
  assert.match(js, /recommendedAction\?\.key === "probe_clipboard"/);
  assert.match(js, /recommendedAction\?\.key === "load_clipboard"/);
  assert.match(js, /recommendedAction\?\.blocked_code === "WINDOWS_CLIPBOARD_UNCHANGED"/);
  assert.match(js, /next background clipboard probe in/);
  assert.match(js, /last auto-probe/);
  assert.match(js, /ready now/);
  });
});

test("mission-control shell exposes status, session list, and session detail routes for the UI", async () => {
  const app = createMissionControlApp({
    publicDir,
    macExecutor: {
      async execute({ prompt }) {
        return {
          content: `Mac shell route handled ${prompt}`,
          verified: true,
          verification: {
            summary: "Mac verified the shell route.",
            verification_type: "tool",
            status: "verified",
          },
          metrics: {
            latency_ms: 320,
            tokens_in: 44,
            tokens_out: 12,
          },
        };
      },
    },
  });
  app.sessionManager.now = makeClock();

  await withServer(app, async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/routes/send-mac`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "bootstrap the mission-control shell",
      }),
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 200);

    const statusResponse = await fetch(`${baseUrl}/api/status`);
    const statusData = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusData.session_count, 1);
    assert.deepEqual(statusData.available_routes, [
      "send_mac",
      "send_pc",
      "send_both",
      "execute_critique",
      "compare",
    ]);

    const sessionsResponse = await fetch(`${baseUrl}/api/sessions?limit=4`);
    const sessionsData = await sessionsResponse.json();
    assert.equal(sessionsResponse.status, 200);
    assert.equal(sessionsData.sessions.length, 1);
    assert.equal(sessionsData.sessions[0].session_id, created.session.session_id);

    const sessionResponse = await fetch(
      `${baseUrl}/api/session?session_id=${encodeURIComponent(created.session.session_id)}`
    );
    const sessionData = await sessionResponse.json();
    assert.equal(sessionResponse.status, 200);
    assert.equal(sessionData.session.session_id, created.session.session_id);
    assert.equal(sessionData.session.mac_state.last_verified_result.verification_type, "tool");
  });
});

test("mission-control shell persists lane config and refreshes repo context in the current session", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-lane-config-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  const macRepoDir = path.join(tempDir, "mac-Gemma");
  const pcRepoDir = path.join(tempDir, "pc-Gemma");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(macRepoDir, { recursive: true });
  await mkdir(pcRepoDir, { recursive: true });
  await Promise.all([
    createGitCheckout(macRepoDir),
    createGitCheckout(pcRepoDir),
  ]);

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Configure lane repo paths",
    operatorMode: "send_both",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const initialConfigResponse = await fetch(`${baseUrl}/api/lane-config`);
      const initialConfig = await initialConfigResponse.json();
      assert.equal(initialConfigResponse.status, 200);
      assert.equal(initialConfig.ok, true);
      assert.equal(initialConfig.lane_config.active_repo, "jessybrenenstahl/Gemma");
      assert.equal(initialConfig.lane_config_status.state, "waiting");
      assert.equal(initialConfig.lane_config_status.can_apply_report, false);
      assert.equal(initialConfig.lane_config_status.can_clear_mac_repo_path, false);
      assert.equal(getLaneConfigRecommendedAction(initialConfig).key, "send_nudge");
      assertLaneConfigManualSurfaceState(initialConfig, {
        blocked_by: "No active manual-ingest blocker.",
        manual_ingest_hint:
          /Use Nudge Mac Now to push the full repo-path prompt bundle again/i,
        next_action:
          /Nudge Mac Now · No returned or copied Mac repo input is available yet/i,
        retry_path: "No retry needed.",
        success_path:
          "Push the Mac repo prompt bundle again or wait for a returned report.",
        summary: /ready · Nudge Mac Now/i,
        run_recommended: {
          label: "Run Recommended: Nudge Mac Now",
          disabled: false,
        },
      });
      assert.match(getLaneConfigRecommendedAction(initialConfig).reason, /safest next move/i);
      assert.equal(initialConfig.mac_repo_action_pack.inline_command, "~/Downloads/mac-report-gemma-repo-path.sh");
      assert.match(initialConfig.mac_repo_action_pack.summary, /repo-path reporter/i);
      assert.match(initialConfig.mac_repo_action_pack.fallback_block, /Documents\/Codex\/Gemma/i);
      assert.match(initialConfig.mac_repo_action_pack.fallback_block, /find_by_origin/i);
      assert.match(initialConfig.mac_repo_action_pack.fallback_block, /jessybrenenstahl\/Gemma/i);
      assert.match(initialConfig.mac_repo_action_pack.fallback_block, /jessy\.tail972f90\.ts\.net/i);
      assert.match(initialConfig.mac_repo_action_pack.manual_block, /GEMMA_REPO_PATH=/i);
      assert.match(initialConfig.mac_repo_action_pack.manual_block, /MISSING: gemma-repo-path/i);
      assert.deepEqual(
        initialConfig.mac_repo_action_pack.return_targets,
        ["jessy", "Jessy", "jessy.tail972f90.ts.net", "jessy.tail972f90.ts.net.", "100.113.117.95"]
      );

      const updateResponse = await fetch(`${baseUrl}/api/lane-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
          mac_repo_path: macRepoDir,
          pc_repo_path: pcRepoDir,
        }),
      });
      const updated = await updateResponse.json();
      assert.equal(updateResponse.status, 200);
      assert.equal(updated.ok, true);
      assert.equal(updated.lane_config.configured_repo_paths.mac, macRepoDir);
      assert.equal(updated.lane_config.configured_repo_paths.pc, pcRepoDir);
      assert.equal(updated.session.mac_state.repo_context.local_path, macRepoDir);
      assert.equal(updated.session.pc_state.repo_context.local_path, pcRepoDir);
      assert.equal(updated.session.mac_state.repo_context.usability, "usable");
      assert.equal(updated.session.pc_state.repo_context.usability, "usable");

      const configuredResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configuredData = await configuredResponse.json();
      assert.equal(configuredResponse.status, 200);
      assert.equal(configuredData.lane_config_status.state, "configured");
      assert.equal(configuredData.lane_config_status.can_apply_report, false);
      assert.equal(configuredData.lane_config_status.can_clear_mac_repo_path, true);
      assert.equal(Object.hasOwn(configuredData, "lane_config_action"), false);
      assert.equal(getLaneConfigRecommendedAction(configuredData).key, "clear_mac_repo_path");
      assertLaneConfigManualSurfaceState(configuredData, {
        action: /Clear Mac Repo Path/i,
        blocked_by: "No active manual-ingest blocker.",
        manual_ingest_hint:
          "Load Clipboard, paste a Mac reply, or wait for a returned Mac repo report.",
        next_action:
          "Clear Mac Repo Path · A Mac repo path is already configured. Clear it only if the checkout moved or was applied by mistake.",
        retry_path: "No retry needed.",
        success_path:
          "Only clear the Mac repo path if the checkout moved or was applied by mistake.",
        summary: /ready · Clear Mac Repo Path/i,
        run_recommended: {
          label: "Run Recommended: Clear Mac Repo Path",
          disabled: false,
        },
      });
      assert.match(getLaneConfigRecommendedAction(configuredData).reason, /already configured/i);

      const persistedConfig = JSON.parse(await readFile(laneConfigPath, "utf8"));
      assert.equal(
        persistedConfig.repos["jessybrenenstahl/Gemma"].mac_repo_path,
        macRepoDir
      );
      assert.equal(
        persistedConfig.repos["jessybrenenstahl/Gemma"].pc_repo_path,
        pcRepoDir
      );
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell surfaces a Mac repo report and can apply it into lane config", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-mac-repo-report-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(downloadsDir, "agro-mac-repo-path-report.txt"),
    [
      "USER=example",
      "HOST=mac-studio",
      "REPORT_STATUS=found",
      "GEMMA_REPO_PATH=/Users/example/Documents/GitHub/Gemma",
      "GEMMA_REPO_ORIGIN=https://github.com/jessybrenenstahl/Gemma.git",
      "",
    ].join("\n")
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Apply the Mac repo report",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(configData.mac_repo_report.repo_path, "/Users/example/Documents/GitHub/Gemma");
      assert.equal(configData.lane_config_status.state, "report_ready");
      assert.equal(configData.lane_config_status.can_apply_report, true);
      assert.equal(Object.hasOwn(configData, "lane_config_action"), false);
      assert.equal(getLaneConfigRecommendedAction(configData).key, "apply_report");
      assertLaneConfigManualSurfaceState(configData, {
        action: /Apply the reported Mac repo path/i,
        blocked_by: "No active manual-ingest blocker.",
        manual_ingest_hint:
          "A returned Mac repo report is ready. Apply Report is the fastest next step.",
        next_action: "Apply Report · A returned Mac repo report is ready right now.",
        retry_path: "No retry needed.",
        success_path: "Click Apply Report now.",
        summary: /ready · Apply Report/i,
        run_recommended: {
          label: "Run Recommended: Apply Report",
          disabled: false,
        },
      });
      assert.match(getLaneConfigRecommendedAction(configData).reason, /ready right now/i);
      assert.equal(configData.mac_repo_action_pack.inline_command, "~/Downloads/mac-report-gemma-repo-path.sh");
      assert.match(configData.mac_repo_action_pack.summary, /Mac repo report received/i);
      assert.match(configData.mac_repo_action_pack.manual_block, /GEMMA_REPO_ORIGIN=/i);
      assert.equal(configData.mac_repo_action_pack.return_targets[0], "jessy");

      const applyResponse = await fetch(`${baseUrl}/api/lane-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
          apply_mac_repo_report: true,
        }),
      });
      const applyData = await applyResponse.json();
      assert.equal(applyResponse.status, 200);
      assert.equal(
        applyData.lane_config.configured_repo_paths.mac,
        "/Users/example/Documents/GitHub/Gemma"
      );
      assert.equal(
        applyData.session.mac_state.repo_context.local_path,
        "/Users/example/Documents/GitHub/Gemma"
      );
      assert.equal(applyData.session.mac_state.repo_context.usability, "usable");

      const persistedConfig = JSON.parse(await readFile(laneConfigPath, "utf8"));
      assert.equal(
        persistedConfig.repos["jessybrenenstahl/Gemma"].mac_repo_path,
        "/Users/example/Documents/GitHub/Gemma"
      );
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell makes lane config action receipt-aware after a repo nudge", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-lane-config-action-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-nudge-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T02:20:00.000Z",
        recorded_at: "2026-04-14T02:20:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json"),
    JSON.stringify(
      {
        status: "waiting",
        attempts_completed: 1,
        last_nudge_attempt: 1,
        last_nudge_status_code: 200,
        last_nudge_message: "Sent the combined Mac repo nudge.",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watcher.pid"),
    JSON.stringify(
      {
        process_id: process.pid,
        attempts: 0,
        interval_seconds: 15,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watcher.pid"),
    JSON.stringify(
      {
        process_id: process.pid,
        attempts: 0,
        interval_seconds: 15,
      },
      null,
      2
    )
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config`);
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.mac_repo_report, null);
      assert.equal(Object.hasOwn(data, "lane_config_action"), false);
      assert.match(data.lane_config_manual_surface.action, /run `~\/Downloads\/mac-report-gemma-repo-path\.sh`/i);
      assert.match(data.lane_config_manual_surface.action, /Pull \+ Apply/i);
      assert.match(data.lane_config_manual_surface.action, /Mac Repo Run Block/i);
      assert.equal(getLaneConfigRecommendedAction(data).key, "load_clipboard");
      assert.match(getLaneConfigRecommendedAction(data).reason, /bypasses the watcher/i);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell prioritizes the manual repo path after a manual send", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-lane-config-manual-action-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-manual-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T02:30:00.000Z",
        recorded_at: "2026-04-14T02:30:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json"),
    JSON.stringify(
      {
        status: "waiting",
        attempts_completed: 6,
        last_nudge_attempt: 1,
        last_nudge_status_code: 200,
        last_manual_attempt: 6,
        last_manual_status_code: 200,
      },
      null,
      2
    )
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config`);
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.mac_repo_report, null);
      assert.equal(data.lane_config_status.state, "manual_preferred");
      assert.equal(data.lane_config_status.recommended_source, "manual");
      assert.equal(data.lane_config_status.watcher_attempts, 6);
      assert.match(data.lane_config_status.summary, /tried 6 times/i);
      assert.match(data.lane_config_status.summary, /Manual Mac Repo Report/i);
      assert.ok(data.mac_repo_manual_send);
      assert.equal(getLaneConfigRecommendedAction(data).key, "apply_clipboard");
      assert.match(getLaneConfigRecommendedAction(data).reason, /fastest one-click path/i);
      assert.equal(Object.hasOwn(data, "lane_config_action"), false);
      assert.match(data.lane_config_manual_surface.action, /manual repo block/i);
      assert.match(data.lane_config_manual_surface.action, /# Manual Paste/i);
      assert.match(data.lane_config_manual_surface.action, /Smart Apply/i);
      assert.match(data.lane_config_manual_surface.action, /Apply Clipboard/i);
      assert.match(data.lane_config_manual_surface.action, /Apply Pasted Report/i);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell keeps manual-first lane config after a manual send even before the watcher threshold", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-lane-config-manual-persist-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-manual-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T02:31:00.000Z",
        recorded_at: "2026-04-14T02:31:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json"),
    JSON.stringify(
      {
        status: "waiting",
        attempts_completed: 1,
        manual_preferred_at_attempts: 6,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watcher.pid"),
    JSON.stringify(
      {
        process_id: process.pid,
        attempts: 0,
        interval_seconds: 15,
      },
      null,
      2
    )
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config`);
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.mac_repo_report, null);
      assert.equal(data.lane_config_status.state, "manual_preferred");
      assert.equal(data.lane_config_status.recommended_source, "manual");
      assert.equal(data.lane_config_status.watcher_attempts, 1);
      assert.match(data.lane_config_status.summary, /already sent the manual repo block/i);
      assert.match(data.lane_config_status.summary, /tried 1 time without/i);
      assert.equal(getLaneConfigRecommendedAction(data).key, "apply_clipboard");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell pivots the recommended action after a failed Apply Clipboard run", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-lane-config-recommendation-pivot-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-manual-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T02:31:00.000Z",
        recorded_at: "2026-04-14T02:31:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "last-lane-config-recommended-run.json"),
    JSON.stringify(
      {
        ok: false,
        status_code: 409,
        code: "MAC_REPO_REPORT_TEXT_MISSING_PATH",
        recommended_action: {
          key: "apply_clipboard",
          label: "Apply Clipboard",
        },
        executed_action: {
          key: "apply_clipboard",
          label: "Apply Clipboard",
        },
        recorded_at: "2026-04-14T02:31:30.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json"),
    JSON.stringify(
      {
        status: "waiting",
        attempts_completed: 2,
        manual_preferred_at_attempts: 6,
      },
      null,
      2
    )
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config`);
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.lane_config_status.state, "manual_preferred");
      assert.equal(getLaneConfigRecommendedAction(data).key, "load_clipboard");
      assert.equal(getLaneConfigRecommendedAction(data).source, "recommended_run");
      assert.match(getLaneConfigRecommendedAction(data).reason, /current clipboard is not a usable Mac repo reply yet/i);
      assert.equal(Object.hasOwn(data, "lane_config_recommended_run"), false);
      assert.equal(getLaneConfigRunExecutedAction(data).key, "apply_clipboard");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell does not treat a stale applied Mac repo watcher summary as current success", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-lane-config-stale-watcher-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json"),
    JSON.stringify(
      {
        status: "applied",
        applied_at: "2026-04-14T02:40:00.000Z",
        attempts_completed: 4,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watcher.pid"),
    JSON.stringify(
      {
        process_id: 999999,
        attempts: 0,
        interval_seconds: 15,
      },
      null,
      2
    )
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config`);
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.mac_repo_report, null);
      assert.equal(data.lane_config.configured_repo_paths.mac, "");
      assert.equal(data.mac_repo_watcher.status, "stopped");
      assert.doesNotMatch(data.mac_repo_watcher.summary, /completed successfully after recovery/i);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell exposes live recovery status for the UI", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-live-recovery-"));
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  const artifactsDir = path.join(tempDir, "artifacts");
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(
    path.join(recoveryDir, "latest-dual-verify.json"),
    JSON.stringify(
      {
        status: "waiting",
        recovered_at: null,
        continuous: true,
        attempts_completed: 3,
        attempts_configured: 0,
        last_checked_at: "2026-04-14T02:00:03.000Z",
        last_health: [
          {
            label: "mac-dns-jessys-mac-studio.tail972f90.ts.net",
            ok: true,
            status: 1,
            body: "Resolved to: 100.106.61.53",
          },
          {
            label: "mac-tcp-jessys-mac-studio.tail972f90.ts.net_1234",
            ok: true,
            status: 1,
            body: "TCP 1234 reachable at 100.106.61.53",
          },
          {
            label: "mac-http-jessys-mac-studio.tail972f90.ts.net_1234",
            ok: false,
            status: 0,
            body: "Socket opened and the HTTP request was sent, then the connection was reset.",
          },
          {
            label: "mac-ssh-jessy_100.106.61.53",
            ok: false,
            status: 0,
            body: "jessy@100.106.61.53: Permission denied (publickey,password,keyboard-interactive).",
          },
          {
            label: "mac-models-jessys-mac-studio.tail972f90.ts.net_1234",
            ok: false,
            status: 0,
            body: "Connection closed.",
          },
          {
            label: "mac-models-jessys-mac-studio.tail972f90.ts.net",
            ok: false,
            status: 502,
            body: [],
          },
        ],
        message:
          "Still waiting for a healthy Mac endpoint. The recovery watcher is running continuously.",
        ssh_bridge: {
          label: "mac-ssh-jessy_100.106.61.53",
          ok: false,
          status: 0,
          body: "jessy@100.106.61.53: Permission denied (publickey,password,keyboard-interactive).",
        },
        ssh_repair: null,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(recoveryDir, "watcher-output.txt"),
    "Recovery attempt 1 of uncapped...\nNo healthy Mac endpoint yet.\n"
  );
  await writeFile(
    path.join(recoveryDir, "watcher.pid"),
    JSON.stringify(
      {
        process_id: process.pid,
        attempts: 0,
        interval_seconds: 15,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(downloadsDir, "agro-mac-ssh-bridge-report.txt"),
    "USER=example\nHOST=mac-studio\n\n[authorized_keys]\n-rw------- 1 example staff 123 Apr 13 11:00 /Users/example/.ssh/authorized_keys\nMISSING: agro-mac-bridge\n"
  );
  await writeFile(
    path.join(taildropDir, "taildrop-watcher.pid"),
    JSON.stringify(
      {
        process_id: process.pid,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(taildropDir, "taildrop-watcher-output.txt"),
    "waiting for taildrop files\n"
  );

  const app = createMissionControlApp({
    artifactsDir,
    publicDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/live-recovery`);
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.live_summary.status, "waiting");
      assert.equal(data.live_summary.tone, "warn");
      assert.match(data.live_summary.message, /running continuously/i);
      assert.equal(data.live_summary.mac_probes.length, 2);
      assert.equal(data.mac_diagnostics.length, 4);
      assert.match(data.mac_diagnostics[0].body, /Resolved to/i);
      assert.match(data.mac_diagnostics[1].body, /TCP 1234 reachable/i);
      assert.match(data.mac_diagnostics[2].body, /connection was reset/i);
      assert.match(data.mac_diagnostics[3].body, /Permission denied/i);
      assert.equal(data.live_summary.ssh_bridge.label, "mac-ssh-jessy_100.106.61.53");
      assert.equal(data.live_summary.ssh_bridge.ok, false);
      assert.equal(data.live_summary.ssh_repair, null);
      assert.match(data.recovery_action, /authorized_keys/i);
      assert.equal(data.watcher.status, "running");
      assert.equal(data.taildrop_watcher.status, "running");
      assert.equal(data.taildrop_files.length, 2);
      assert.equal(data.watcher.process_id, process.pid);
      assert.match(data.watcher.summary, /continuous mode/i);
      assert.equal(data.summary.attempts_completed, 3);
      assert.equal(data.summary.attempts_configured, 0);
      assert.equal(data.mac_bridge_report.user, "example");
      assert.equal(data.mac_bridge_report.host, "mac-studio");
      assert.equal(data.mac_bridge_report.source, "downloads");
      assert.equal(data.mac_bridge_report.key_missing, true);
      assert.match(data.mac_bridge_report.summary, /bridge key missing/i);
      assert.match(data.mac_action_pack.summary, /Mac report received/i);
      assert.match(data.mac_action_pack.script_path, /mac-install-and-report-agro-ssh-key\.sh$/);
      assert.match(data.mac_action_pack.note_path, /to-codex-on-mac-install-and-report-ssh\.txt$/);
      assert.equal(data.mac_action_pack.inline_command, "~/Downloads/mac-install-and-report-agro-ssh-key.sh");
      assert.match(data.mac_action_pack.run_block, /mac-install-and-report-agro-ssh-key\.sh/);
      assert.match(data.mac_action_pack.fallback_block, /agro-mac-bridge/);
      assert.match(data.mac_action_pack.fallback_block, /tailscale file cp/);
      assert.match(data.recovery_action, /still missing for example/i);
      assert.deepEqual(data.watcher_output_lines, [
        "Recovery attempt 1 of uncapped...",
        "No healthy Mac endpoint yet.",
      ]);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell reports a completed watcher after successful recovery", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-live-recovery-complete-"));
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  const artifactsDir = path.join(tempDir, "artifacts");
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(
    path.join(recoveryDir, "latest-dual-verify.json"),
    JSON.stringify(
      {
        status: "recovered",
        recovered_at: "2026-04-14T02:10:00.000Z",
        continuous: true,
        attempts_completed: 12,
        attempts_configured: 0,
        last_health: [],
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(recoveryDir, "watcher.pid"),
    JSON.stringify(
      {
        process_id: 999999,
        attempts: 0,
        interval_seconds: 15,
      },
      null,
      2
    )
  );

  const app = createMissionControlApp({
    artifactsDir,
    publicDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/live-recovery`);
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.live_summary.status, "recovered");
      assert.equal(data.watcher.status, "completed");
      assert.equal(data.watcher.tone, "online");
      assert.match(data.watcher.summary, /completed successfully after recovery/i);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can trigger a Mac action-pack resend route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-send-mac-action-pack-"));
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  await mkdir(recoveryDir, { recursive: true });

  const app = createMissionControlApp({
    publicDir,
    liveRecoveryDir: recoveryDir,
    sendMacActionPack: async () => ({
      ok: true,
      target: "jessys-mac-studio",
      deliveries: [
        {
          channel: "clipboard-bridge",
          ok: true,
        },
        {
          channel: "taildrop",
          ok: true,
          file: "mac-install-and-report-agro-ssh-key.sh",
        },
      ],
    }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/recovery/send-mac-action-pack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.result.target, "jessys-mac-studio");
      assert.equal(data.result.deliveries.length, 2);
      assert.equal(data.result.deliveries[0].channel, "clipboard-bridge");
      assert.ok(data.result.recorded_at);

      const receiptPath = path.join(recoveryDir, "last-mac-action-pack-send.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.target, "jessys-mac-studio");
      assert.equal(receipt.deliveries.length, 2);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can trigger a direct Mac fallback send route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-send-mac-fallback-"));
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  await mkdir(recoveryDir, { recursive: true });

  const app = createMissionControlApp({
    publicDir,
    liveRecoveryDir: recoveryDir,
    sendMacFallbackBlock: async () => ({
      ok: true,
      target: "jessys-mac-studio",
      deliveries: [
        {
          channel: "clipboard-bridge",
          ok: true,
        },
        {
          channel: "taildrop",
          ok: true,
          file: "mac-fallback-block.txt",
        },
      ],
    }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/recovery/send-mac-fallback-block`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.result.target, "jessys-mac-studio");
      assert.equal(data.result.deliveries.length, 2);
      assert.equal(data.result.deliveries[1].file, "mac-fallback-block.txt");
      assert.ok(data.result.recorded_at);

      const receiptPath = path.join(recoveryDir, "last-mac-fallback-send.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.target, "jessys-mac-studio");
      assert.equal(receipt.deliveries.length, 2);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can trigger a Mac repo report request route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-send-mac-repo-report-"));
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  await mkdir(recoveryDir, { recursive: true });

  const app = createMissionControlApp({
    publicDir,
    liveRecoveryDir: recoveryDir,
    sendMacRepoReportRequest: async () => ({
      ok: true,
      target: "jessys-mac-studio",
      return_targets: ["Jessy", "jessy.tail972f90.ts.net."],
      deliveries: [
        {
          channel: "clipboard-bridge",
          ok: true,
        },
        {
          channel: "taildrop",
          ok: true,
          file: "mac-report-gemma-repo-path.sh",
        },
      ],
    }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/request-mac-repo-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.result.target, "jessys-mac-studio");
      assert.equal(data.result.deliveries.length, 2);
      assert.equal(data.result.deliveries[1].file, "mac-report-gemma-repo-path.sh");
      assert.deepEqual(data.result.return_targets, ["Jessy", "jessy.tail972f90.ts.net."]);
      assert.ok(data.result.recorded_at);

      const receiptPath = path.join(recoveryDir, "last-mac-repo-report-request-send.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.target, "jessys-mac-studio");
      assert.equal(receipt.deliveries.length, 2);
      assert.deepEqual(receipt.return_targets, ["Jessy", "jessy.tail972f90.ts.net."]);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can trigger a combined Mac repo nudge route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-send-mac-repo-nudge-"));
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });

  const app = createMissionControlApp({
    publicDir,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    sendMacRepoNudge: async () => ({
      ok: true,
      target: "jessys-mac-studio",
      inline_command: "~/Downloads/mac-report-gemma-repo-path.sh",
      expected_return_file: "agro-mac-repo-path-report.txt",
      return_targets: ["Jessy", "jessy.tail972f90.ts.net."],
      deliveries: [
        {
          channel: "clipboard-bridge",
          ok: true,
        },
        {
          channel: "taildrop",
          ok: true,
          file: "mac-report-gemma-repo-path.sh",
        },
        {
          channel: "taildrop",
          ok: true,
          file: "to-codex-on-mac-report-gemma-repo-path.txt",
        },
        {
          channel: "taildrop",
          ok: true,
          file: "mac-repo-fallback-block.txt",
        },
      ],
    }),
    sendMacRepoReportRequest: async () => ({
      ok: true,
      target: "jessys-mac-studio",
      deliveries: [
        {
          channel: "clipboard-bridge",
          ok: true,
        },
        {
          channel: "taildrop",
          ok: true,
          file: "mac-report-gemma-repo-path.sh",
        },
      ],
    }),
    sendMacRepoFallbackBlock: async () => ({
      ok: true,
      target: "jessys-mac-studio",
      deliveries: [
        {
          channel: "clipboard-bridge",
          ok: true,
        },
        {
          channel: "taildrop",
          ok: true,
          file: "mac-repo-fallback-block.txt",
        },
      ],
    }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/send-mac-repo-nudge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.deepEqual(data.result.return_targets, ["Jessy", "jessy.tail972f90.ts.net."]);
      assert.equal(data.result.target, "jessys-mac-studio");
      assert.equal(data.result.deliveries.length, 4);
      assert.equal(data.result.deliveries[1].file, "mac-report-gemma-repo-path.sh");
      assert.equal(data.result.deliveries[2].file, "to-codex-on-mac-report-gemma-repo-path.txt");
      assert.equal(data.result.deliveries[3].file, "mac-repo-fallback-block.txt");
      assert.equal(data.result.inline_command, "~/Downloads/mac-report-gemma-repo-path.sh");
      assert.equal(data.result.expected_return_file, "agro-mac-repo-path-report.txt");
      assert.ok(data.result.recorded_at);

      const receiptPath = path.join(laneConfigDir, "last-mac-repo-nudge-send.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.target, "jessys-mac-studio");
      assert.equal(receipt.deliveries.length, 4);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can trigger a direct Mac repo fallback send route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-send-mac-repo-fallback-"));
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  await mkdir(laneConfigDir, { recursive: true });

  const app = createMissionControlApp({
    publicDir,
    laneConfigDir,
    sendMacRepoFallbackBlock: async () => ({
      ok: true,
      target: "jessys-mac-studio",
      deliveries: [
        {
          channel: "clipboard-bridge",
          ok: true,
        },
        {
          channel: "taildrop",
          ok: true,
          file: "mac-repo-fallback-block.txt",
        },
      ],
    }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/send-mac-repo-fallback-block`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.result.target, "jessys-mac-studio");
      assert.equal(data.result.deliveries.length, 2);
      assert.equal(data.result.deliveries[1].file, "mac-repo-fallback-block.txt");
      assert.ok(data.result.recorded_at);

      const receiptPath = path.join(laneConfigDir, "last-mac-repo-fallback-send.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.target, "jessys-mac-studio");
      assert.equal(receipt.deliveries.length, 2);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can trigger a direct Mac repo manual send route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-send-mac-repo-manual-"));
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  await mkdir(laneConfigDir, { recursive: true });

  const app = createMissionControlApp({
    publicDir,
    laneConfigDir,
    sendMacRepoManualBlock: async () => ({
      ok: true,
      target: "jessys-mac-studio",
      deliveries: [
        {
          channel: "clipboard-bridge",
          ok: true,
        },
        {
          channel: "taildrop",
          ok: true,
          file: "mac-repo-manual-block.txt",
        },
      ],
    }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/send-mac-repo-manual-block`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.result.target, "jessys-mac-studio");
      assert.equal(data.result.deliveries.length, 2);
      assert.equal(data.result.deliveries[1].file, "mac-repo-manual-block.txt");
      assert.ok(data.result.recorded_at);

      const receiptPath = path.join(laneConfigDir, "last-mac-repo-manual-send.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.target, "jessys-mac-studio");
      assert.equal(receipt.deliveries.length, 2);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can start a Mac repo watcher route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-start-mac-repo-watcher-"));
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  await mkdir(laneConfigDir, { recursive: true });
  let capturedResendEveryAttempts = null;
  let capturedNudgeEveryAttempts = null;
  let capturedFallbackEveryAttempts = null;
  let capturedManualEveryAttempts = null;
  let capturedManualPreferredAtAttempts = null;

  const app = createMissionControlApp({
    publicDir,
    laneConfigDir,
    startMacRepoReportWatcher: async ({
      sessionId = "",
      resendEveryAttempts = 8,
      nudgeEveryAttempts = 24,
      fallbackEveryAttempts = 12,
      manualEveryAttempts = 36,
      manualPreferredAtAttempts = 6,
    } = {}) => {
      capturedResendEveryAttempts = resendEveryAttempts;
      capturedNudgeEveryAttempts = nudgeEveryAttempts;
      capturedFallbackEveryAttempts = fallbackEveryAttempts;
      capturedManualEveryAttempts = manualEveryAttempts;
      capturedManualPreferredAtAttempts = manualPreferredAtAttempts;
      return {
        ok: true,
        process_id: 12345,
        attempts: 0,
        interval_seconds: 15,
        resend_every_attempts: resendEveryAttempts,
        nudge_every_attempts: nudgeEveryAttempts,
        fallback_every_attempts: fallbackEveryAttempts,
        manual_every_attempts: manualEveryAttempts,
        manual_preferred_at_attempts: manualPreferredAtAttempts,
        session_id: sessionId || null,
      };
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/start-mac-repo-report-watcher`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: "session-demo",
          resend_every_attempts: 5,
          nudge_every_attempts: 9,
          fallback_every_attempts: 7,
          manual_every_attempts: 11,
          manual_preferred_at_attempts: 4,
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.result.process_id, 12345);
      assert.equal(data.result.session_id, "session-demo");
      assert.equal(data.result.resend_every_attempts, 5);
      assert.equal(data.result.nudge_every_attempts, 9);
      assert.equal(data.result.fallback_every_attempts, 7);
      assert.equal(data.result.manual_every_attempts, 11);
      assert.equal(data.result.manual_preferred_at_attempts, 4);
      assert.equal(capturedResendEveryAttempts, 5);
      assert.equal(capturedNudgeEveryAttempts, 9);
      assert.equal(capturedFallbackEveryAttempts, 7);
      assert.equal(capturedManualEveryAttempts, 11);
      assert.equal(capturedManualPreferredAtAttempts, 4);

      const receiptPath = path.join(laneConfigDir, "last-mac-repo-report-watcher-start.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.process_id, 12345);
      assert.equal(receipt.session_id, "session-demo");
      assert.equal(receipt.resend_every_attempts, 5);
      assert.equal(receipt.nudge_every_attempts, 9);
      assert.equal(receipt.fallback_every_attempts, 7);
      assert.equal(receipt.manual_every_attempts, 11);
      assert.equal(receipt.manual_preferred_at_attempts, 4);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can pull and apply a returned Mac repo report in one route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-pull-apply-mac-repo-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(taildropDir, "agro-mac-repo-path-report.txt"),
    [
      "USER=example",
      "HOST=mac-studio",
      "REPORT_STATUS=found",
      "GEMMA_REPO_PATH=/Users/example/Documents/GitHub/Gemma",
      "GEMMA_REPO_ORIGIN=https://github.com/jessybrenenstahl/Gemma.git",
      "",
    ].join("\n")
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    laneConfigStore,
    pullTaildropInbox: async () => ({
      ok: true,
      pulled_at: "2026-04-14T02:00:09.000Z",
      inbox_dir: taildropDir,
      command_output: "moved 1/1 files",
      moved: 1,
      total_reported: 1,
      files: [
        {
          name: "agro-mac-repo-path-report.txt",
          length: 180,
        },
      ],
    }),
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Pull and apply the Mac repo report",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/pull-and-apply-mac-repo-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.pull_result.moved, 1);
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/GitHub/Gemma");
      assert.equal(
        data.lane_config.configured_repo_paths.mac,
        "/Users/example/Documents/GitHub/Gemma"
      );
      assert.equal(
        data.session.mac_state.repo_context.local_path,
        "/Users/example/Documents/GitHub/Gemma"
      );
      assert.equal(data.session.mac_state.repo_context.usability, "usable");

      const receiptPath = path.join(recoveryDir, "last-taildrop-pull.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.moved, 1);
      assert.equal(receipt.total_reported, 1);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can apply a pasted Mac repo report text", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-manual-mac-repo-report-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Apply a pasted Mac repo report",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/apply-mac-repo-report-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
          report_text: [
            "USER=example",
            "HOST=mac-studio",
            "REPORT_STATUS=found",
            "GEMMA_REPO_PATH=/Users/example/Documents/Codex/Gemma",
            "GEMMA_REPO_ORIGIN=https://github.com/jessybrenenstahl/Gemma.git",
          ].join("\n"),
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.mac_repo_report.source, "lane-config");
      assert.equal(data.lane_config.configured_repo_paths.mac, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.session.mac_state.repo_context.local_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.session.mac_state.repo_context.usability, "usable");

      const manualReportPath = path.join(laneConfigDir, "agro-mac-repo-path-report-manual.txt");
      const manualReport = await readFile(manualReportPath, "utf8");
      assert.match(manualReport, /GEMMA_REPO_PATH=\/Users\/example\/Documents\/Codex\/Gemma/);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can apply a loosely formatted pasted Mac repo path reply", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-loose-mac-repo-report-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Apply a loosely formatted pasted Mac repo report",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/apply-mac-repo-report-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
          report_text: [
            "Mac Codex says the Gemma checkout is here:",
            "",
            "`/Users/example/Documents/Codex/Gemma`",
            "",
            "origin: https://github.com/jessybrenenstahl/Gemma.git",
          ].join("\n"),
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.mac_repo_report.repo_origin, "https://github.com/jessybrenenstahl/Gemma.git");
      assert.equal(data.mac_repo_report.report_status, "found");
      assert.equal(data.lane_config.configured_repo_paths.mac, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.session.mac_state.repo_context.local_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.session.mac_state.repo_context.usability, "usable");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell returns preview details when Apply Pasted Report cannot parse a usable path", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-pasted-mac-repo-apply-preview-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const reportText = [
    "Mac Codex is still checking the Gemma checkout.",
    "No confirmed repo path yet.",
    "Will send it once verified.",
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/apply-mac-repo-report-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report_text: reportText,
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 409);
      assert.equal(data.ok, false);
      assert.equal(data.code, "MAC_REPO_REPORT_TEXT_MISSING_PATH");
      assert.equal(data.report_text, reportText);
      assert.equal(data.report_text_length, reportText.length);
      assert.equal(data.has_usable_repo_path, false);
      assert.ok(data.mac_repo_report_preview);
      assert.equal(data.mac_repo_report_preview.repo_path, null);
      assert.match(
        data.mac_repo_report_preview.summary,
        /does not include a usable Mac repo path yet/i
      );
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell clears the configured Mac repo path and removes the manual report file", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-clear-manual-mac-repo-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Clear the configured Mac repo path",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const applyResponse = await fetch(`${baseUrl}/api/lane-config/apply-mac-repo-report-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
          report_text: [
            "Mac Codex says the Gemma checkout is here:",
            "",
            "`/Users/example/Documents/Codex/Gemma`",
            "",
            "origin: https://github.com/jessybrenenstahl/Gemma.git",
          ].join("\n"),
        }),
      });
      const applyData = await applyResponse.json();
      assert.equal(applyResponse.status, 200);
      assert.equal(applyData.ok, true);

      const clearResponse = await fetch(`${baseUrl}/api/lane-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
          mac_repo_path: "",
        }),
      });
      const clearData = await clearResponse.json();
      assert.equal(clearResponse.status, 200);
      assert.equal(clearData.ok, true);
      assert.equal(clearData.lane_config.configured_repo_paths.mac, "");

      const manualReportPath = path.join(laneConfigDir, "agro-mac-repo-path-report-manual.txt");
      await assert.rejects(() => readFile(manualReportPath, "utf8"));

      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(configData.mac_repo_clear.previous_mac_repo_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(configData.mac_repo_clear.removed_manual_report, true);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can apply a Mac repo report from the Windows clipboard", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-clipboard-mac-repo-report-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () =>
      [
        "Mac Codex says the Gemma checkout is here:",
        "",
        "`/Users/example/Documents/Codex/Gemma`",
        "",
        "origin: https://github.com/jessybrenenstahl/Gemma.git",
      ].join("\n"),
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Apply a Mac repo report from clipboard",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const preloadResponse = await fetch(`${baseUrl}/api/lane-config/load-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const preloadData = await preloadResponse.json();
      assert.equal(preloadResponse.status, 200);
      assert.equal(preloadData.ok, true);
      assert.equal(preloadData.mac_repo_input_candidate.source, "clipboard");

      const response = await fetch(`${baseUrl}/api/lane-config/apply-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.mac_repo_report.repo_origin, "https://github.com/jessybrenenstahl/Gemma.git");
      assert.equal(data.lane_config.configured_repo_paths.mac, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.session.mac_state.repo_context.local_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.session.mac_state.repo_context.usability, "usable");
      assert.ok(data.clipboard_text_length > 0);
      assert.equal(data.mac_repo_input_candidate, null);

      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(configData.mac_repo_input_candidate, null);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can run the recommended lane-config action through the server route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-run-recommended-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-manual-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T02:30:00.000Z",
        recorded_at: "2026-04-14T02:30:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json"),
    JSON.stringify(
      {
        status: "waiting",
        attempts_completed: 7,
        last_manual_attempt: 6,
        last_manual_status_code: 200,
      },
      null,
      2
    )
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () =>
      [
        "USER=example",
        "HOST=mac-studio",
        "REPORT_STATUS=found",
        "GEMMA_REPO_PATH=/Users/example/Documents/GitHub/Gemma",
        "GEMMA_REPO_ORIGIN=https://github.com/jessybrenenstahl/Gemma.git",
        "",
      ].join("\n"),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/run-recommended-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(Object.hasOwn(data, "recommended_action"), false);
      assert.equal(Object.hasOwn(data, "executed_action"), false);
      assert.equal(getLaneConfigRunRecommendedAction(data).key, "apply_clipboard");
      assert.equal(Object.hasOwn(data, "lane_config_recommended_run"), false);
      assert.equal(getLaneConfigRunExecutedAction(data).key, "apply_clipboard");
      assert.match(getLaneConfigRecommendedRun(data).summary, /Apply Clipboard completed/i);
      assert.equal(
        data.lane_config.configured_repo_paths.mac,
        "/Users/example/Documents/GitHub/Gemma"
      );
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/GitHub/Gemma");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell reloads the clipboard when the latest candidate is stale and unusable", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-run-recommended-reload-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-manual-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T03:20:00.000Z",
        recorded_at: "2026-04-14T03:20:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json"),
    JSON.stringify(
      {
        status: "waiting",
        attempts_completed: 11,
        last_manual_attempt: 10,
        last_manual_status_code: 200,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-input-candidate.json"),
    JSON.stringify(
      {
        source: "pasted_text",
        source_label: "pasted text loaded",
        input_text: "Mac said to use the Gemma repo and keep working on AGRO.",
        input_text_length: 54,
        preview: {
          source: "lane-config",
          summary: "Pasted text is loaded, but it does not include a usable Mac repo path yet.",
          repo_path: null,
          repo_origin: null,
        },
        has_usable_repo_path: false,
        repo_path: null,
        repo_origin: null,
        message: "Pasted text is loaded, but it does not include a usable Mac repo path yet.",
        code: "MAC_REPO_PATH_NOT_FOUND",
        recorded_at: "2026-04-14T03:20:02.000Z",
      },
      null,
      2
    )
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => "still not a Mac repo report",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/run-recommended-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(Object.hasOwn(data, "recommended_action"), false);
      assert.equal(Object.hasOwn(data, "executed_action"), false);
      assert.equal(getLaneConfigRunRecommendedAction(data).key, "load_clipboard");
      assert.equal(Object.hasOwn(data, "lane_config_recommended_run"), false);
      assert.equal(getLaneConfigRunExecutedAction(data).key, "load_clipboard");
      assert.equal(data.mac_repo_input_candidate.source, "clipboard");
      assert.equal(data.mac_repo_input_candidate.has_usable_repo_path, false);
      assert.match(getLaneConfigRecommendedRun(data).summary, /Load Clipboard completed/i);

      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(getLaneConfigRecommendedAction(configData).key, "load_clipboard");
      assert.equal(configData.mac_repo_input_candidate.source, "clipboard");
      assert.equal(configData.mac_repo_input_candidate.has_usable_repo_path, false);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can nudge through the recommended lane-config route when no Mac input exists yet", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-run-recommended-nudge-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => "",
    sendMacRepoNudge: async () => ({
      ok: true,
      sent_at: "2026-04-14T02:50:00.000Z",
      recorded_at: "2026-04-14T02:50:01.000Z",
      deliveries: [{ channel: "stub", ok: true }],
    }),
    sendMacRepoReportRequest: async () => ({
      ok: true,
      recorded_at: "2026-04-14T02:49:58.000Z",
      deliveries: [{ channel: "stub", ok: true }],
    }),
    sendMacRepoFallbackBlock: async () => ({
      ok: true,
      recorded_at: "2026-04-14T02:49:59.000Z",
      deliveries: [{ channel: "stub", ok: true }],
    }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/run-recommended-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(Object.hasOwn(data, "recommended_action"), false);
      assert.equal(Object.hasOwn(data, "executed_action"), false);
      assert.equal(getLaneConfigRunRecommendedAction(data).key, "send_nudge");
      assert.equal(Object.hasOwn(data, "lane_config_recommended_run"), false);
      assert.equal(getLaneConfigRunExecutedAction(data).key, "send_nudge");
      assert.match(getLaneConfigRecommendedRun(data).summary, /Nudge Mac Now completed/i);
      assert.equal(data.result.ok, true);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell reports an empty Windows clipboard for repo apply", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-clipboard-mac-repo-empty-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => "",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/apply-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 409);
      assert.equal(data.ok, false);
      assert.equal(data.code, "WINDOWS_CLIPBOARD_EMPTY");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell returns clipboard preview details when Apply Clipboard cannot parse a usable path", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-clipboard-mac-repo-apply-preview-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const clipboardText = [
    "Mac Codex is still checking the Gemma checkout.",
    "No confirmed repo path yet.",
    "Will send it once verified.",
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => clipboardText,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/apply-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 409);
      assert.equal(data.ok, false);
      assert.equal(data.code, "MAC_REPO_REPORT_TEXT_MISSING_PATH");
      assert.equal(data.clipboard_text, clipboardText);
      assert.equal(data.clipboard_text_length, clipboardText.length);
      assert.equal(data.has_usable_repo_path, false);
      assert.ok(data.mac_repo_report_preview);
      assert.equal(data.mac_repo_report_preview.repo_path, null);
      assert.match(
        data.mac_repo_report_preview.summary,
        /does not look like a Mac repo report yet/i
      );
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can load a Mac repo report from the Windows clipboard without applying it", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-load-clipboard-mac-repo-report-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const clipboardText = [
    "Mac Codex says the Gemma checkout is here:",
    "",
    "`/Users/example/Documents/Codex/Gemma`",
    "",
    "origin: https://github.com/jessybrenenstahl/Gemma.git",
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => clipboardText,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/load-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.clipboard_text, clipboardText);
      assert.equal(data.clipboard_text_length, clipboardText.length);
      assert.equal(data.has_usable_repo_path, true);
      assert.equal(data.mac_repo_report_preview.repo_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(
        data.mac_repo_report_preview.repo_origin,
        "https://github.com/jessybrenenstahl/Gemma.git"
      );
      assert.equal(data.mac_repo_input_candidate.source, "clipboard");
      assert.equal(data.mac_repo_input_candidate.input_text, clipboardText);
      assert.equal(
        data.mac_repo_input_candidate.preview.repo_path,
        "/Users/example/Documents/Codex/Gemma"
      );

      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(configData.mac_repo_input_candidate.source, "clipboard");
      assert.equal(configData.mac_repo_input_candidate.input_text, clipboardText);
      assert.equal(
        configData.mac_repo_input_candidate.preview.repo_path,
        "/Users/example/Documents/Codex/Gemma"
      );
      assert.equal(getLaneConfigRecommendedAction(configData).key, "smart_apply");
      assert.equal(getLaneConfigRecommendedAction(configData).source, "input_candidate");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell reports an empty Windows clipboard for clipboard load", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-load-clipboard-mac-repo-empty-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => "",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/load-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 409);
      assert.equal(data.ok, false);
      assert.equal(data.code, "WINDOWS_CLIPBOARD_EMPTY");
      assert.equal(data.clipboard_text_length, 0);
      assert.equal(data.mac_repo_report_preview, null);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell previews non-empty clipboard text that is not a Mac repo report yet", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-load-clipboard-mac-repo-unusable-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const clipboardText = [
    "Mac Codex is still checking the Gemma checkout.",
    "No confirmed repo path yet.",
    "Will send it once verified.",
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => clipboardText,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/load-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.clipboard_text, clipboardText);
      assert.equal(data.clipboard_text_length, clipboardText.length);
      assert.equal(data.has_usable_repo_path, false);
      assert.ok(data.mac_repo_report_preview);
      assert.equal(data.mac_repo_report_preview.repo_path, null);
      assert.match(
        data.mac_repo_report_preview.summary,
        /does not look like a Mac repo report yet/i
      );
      assert.match(data.message, /does not include a usable Mac repo path yet/i);

      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(configData.mac_repo_input_candidate.source, "clipboard");
      assert.equal(getLaneConfigRecommendedAction(configData).key, "load_clipboard");
      assert.equal(getLaneConfigRecommendedAction(configData).source, "input_candidate");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell redacts sensitive clipboard tokens before persisting an input candidate", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-load-clipboard-mac-repo-redacted-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const rawToken = ["ghp", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join("_");
  const clipboardText = [
    "use the right repo and work on the agro project, use https://github.com/jessybrenenstahl/Gemma",
    rawToken,
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => clipboardText,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/load-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.match(data.message, /redacted secret-looking text/i);
      assert.doesNotMatch(data.clipboard_text, new RegExp(rawToken, "i"));
      assert.match(data.clipboard_text, /\[REDACTED_GITHUB_TOKEN\]/);
      assert.equal(data.mac_repo_input_risk.state, "secret_like_text");
      assert.match(data.mac_repo_input_risk.summary, /redacted secret-looking text/i);
      assert.equal(data.mac_repo_input_candidate.source, "clipboard");
      assert.doesNotMatch(data.mac_repo_input_candidate.input_text, new RegExp(rawToken, "i"));
      assert.match(data.mac_repo_input_candidate.input_text, /\[REDACTED_GITHUB_TOKEN\]/);
      assert.ok(data.mac_repo_input_candidate.redaction_count >= 1);
      assert.ok(Array.isArray(data.mac_repo_report_preview.raw_excerpt));
      assert.ok(
        data.mac_repo_report_preview.raw_excerpt.some((line) =>
          /\[REDACTED_GITHUB_TOKEN\]/.test(line)
        )
      );

      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(configData.mac_repo_input_candidate.source, "clipboard");
      assert.equal(configData.mac_repo_input_risk.state, "secret_like_text");
      assert.equal(getLaneConfigRecommendedAction(configData).key, "load_clipboard");
      assert.match(
        getLaneConfigRecommendedAction(configData).reason,
        /redacted secret-looking text/i
      );
      assert.doesNotMatch(
        configData.mac_repo_input_candidate.input_text,
        new RegExp(rawToken, "i")
      );
      assert.match(configData.mac_repo_input_candidate.input_text, /\[REDACTED_GITHUB_TOKEN\]/);
      assert.ok(configData.mac_repo_input_candidate.redaction_count >= 1);

      const secondLoadResponse = await fetch(`${baseUrl}/api/lane-config/load-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const secondLoadData = await secondLoadResponse.json();
      assert.equal(secondLoadResponse.status, 409);
      assert.equal(secondLoadData.ok, false);
      assert.equal(secondLoadData.code, "WINDOWS_CLIPBOARD_UNCHANGED");
      assert.equal(secondLoadData.unchanged_candidate, true);
      assert.match(secondLoadData.message, /redacted secret-looking text/i);

      const runResponse = await fetch(`${baseUrl}/api/lane-config/run-recommended-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const runData = await runResponse.json();
      assert.equal(runResponse.status, 409);
      assert.equal(runData.ok, false);
      assert.equal(Object.hasOwn(runData, "recommended_action"), false);
      assert.equal(Object.hasOwn(runData, "executed_action"), false);
      assert.equal(getLaneConfigRunRecommendedAction(runData).key, "load_clipboard");
      assert.match(getLaneConfigRunRecommendedAction(runData).reason, /redacted secret-looking text/i);
      assert.equal(getLaneConfigRunExecutedAction(runData).key, "load_clipboard");
      assert.equal(runData.code, "WINDOWS_CLIPBOARD_UNCHANGED");
      assert.match(runData.message, /Copy a fresh Mac reply first/i);

      const postRunConfigResponse = await fetch(`${baseUrl}/api/lane-config`);
      const postRunConfigData = await postRunConfigResponse.json();
      assert.equal(postRunConfigResponse.status, 200);
      assert.equal(getLaneConfigRecommendedAction(postRunConfigData).key, "load_clipboard");
      assert.equal(getLaneConfigRecommendedAction(postRunConfigData).blocked, true);
      assert.equal(getLaneConfigRecommendedAction(postRunConfigData).retryable, true);
      assert.equal(
        getLaneConfigRecommendedAction(postRunConfigData).blocked_code,
        "WINDOWS_CLIPBOARD_UNCHANGED"
      );
      assert.match(
        getLaneConfigRecommendedAction(postRunConfigData).blocked_reason,
        /Copy a fresh Mac reply first/i
      );
      assert.equal(Object.hasOwn(postRunConfigData, "lane_config_recommended_run"), false);
      assert.equal(getLaneConfigRecommendedRun(postRunConfigData).ok, false);
      assert.equal(
        getLaneConfigRecommendedRun(postRunConfigData).code,
        "WINDOWS_CLIPBOARD_UNCHANGED"
      );
      assert.match(
        getLaneConfigRecommendedRun(postRunConfigData).summary,
        /waiting on fresh clipboard input/i
      );
      assert.equal(
        getLaneConfigRecommendedRunState(postRunConfigData).state,
        "waiting_for_clipboard"
      );
      assert.match(
        getLaneConfigRecommendedRunState(postRunConfigData).summary,
        /fresh Mac repo reply in the Windows clipboard/i
      );

      const clearResponse = await fetch(`${baseUrl}/api/lane-config/clear-mac-repo-input-candidate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const clearData = await clearResponse.json();
      assert.equal(clearResponse.status, 200);
      assert.equal(clearData.ok, true);
      assert.equal(clearData.mac_repo_input_candidate, null);
      assert.equal(clearData.mac_repo_input_risk.state, "clear");
      assert.equal(clearData.mac_repo_input_clear.previous_source, "clipboard");
      assert.ok(clearData.mac_repo_input_clear.previous_redaction_count >= 1);
      assert.equal(clearData.mac_repo_input_clear.previous_has_usable_repo_path, false);

      const postClearConfigResponse = await fetch(`${baseUrl}/api/lane-config`);
      const postClearConfigData = await postClearConfigResponse.json();
      assert.equal(postClearConfigResponse.status, 200);
      assert.equal(postClearConfigData.mac_repo_input_candidate, null);
      assert.equal(postClearConfigData.mac_repo_input_risk.state, "clear");
      assert.equal(postClearConfigData.lane_config_status.can_clear_mac_repo_input_candidate, false);
      assert.equal(postClearConfigData.mac_repo_input_clear.previous_source, "clipboard");
      assert.equal(getLaneConfigRecommendedAction(postClearConfigData).key, "load_clipboard");
      assert.equal(getLaneConfigRecommendedAction(postClearConfigData).source, "clipboard_probe");
      assert.match(
        getLaneConfigRecommendedAction(postClearConfigData).reason,
        /same stale Mac repo text/i
      );
      assert.equal(Object.hasOwn(postClearConfigData, "lane_config_recommended_run_state"), false);
      assert.equal(getLaneConfigRecommendedRunState(postClearConfigData).state, "superseded");
      assert.match(
        getLaneConfigRecommendedRunState(postClearConfigData).summary,
        /Superseded by Clear Input Candidate/i
      );

      const postClearRunResponse = await fetch(`${baseUrl}/api/lane-config/run-recommended-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const postClearRunData = await postClearRunResponse.json();
      assert.equal(postClearRunResponse.status, 409);
      assert.equal(postClearRunData.code, "WINDOWS_CLIPBOARD_UNCHANGED");
      assert.equal(Object.hasOwn(postClearRunData, "executed_action"), false);
      assert.equal(getLaneConfigRunExecutedAction(postClearRunData).key, "load_clipboard");
      assert.equal(postClearRunData.mac_repo_clipboard_probe.state, "unchanged_after_input_clear");
      assert.equal(postClearRunData.mac_repo_clipboard_probe.unchanged_after_input_clear, true);

      const finalConfigResponse = await fetch(`${baseUrl}/api/lane-config`);
      const finalConfigData = await finalConfigResponse.json();
      assert.equal(finalConfigResponse.status, 200);
      assert.equal(getLaneConfigRecommendedAction(finalConfigData).key, "load_clipboard");
      assert.equal(getLaneConfigRecommendedAction(finalConfigData).blocked, true);
      assert.equal(getLaneConfigRecommendedAction(finalConfigData).retryable, true);
      assertLaneConfigManualSurfaceState(finalConfigData, {
        blocked_by:
          "WINDOWS_CLIPBOARD_UNCHANGED · The Windows clipboard is unchanged and still does not contain a fresh usable Mac repo reply. Copy a fresh Mac reply first.",
        manual_ingest_hint:
          "The Windows clipboard is unchanged and still does not contain a fresh usable Mac repo reply. Copy a fresh Mac reply first.",
        next_action:
          "Load Clipboard blocked · The Windows clipboard is unchanged and still does not contain a fresh usable Mac repo reply. Copy a fresh Mac reply first.",
        retry_path: "retryable · Run Recommended: Recheck Clipboard",
        success_path:
          "Copy a fresh Mac repo reply into Windows, then click Run Recommended Action once.",
        summary: [
          /blocked · Load Clipboard/i,
          /retryable · Run Recommended: Recheck Clipboard/i,
        ],
        run_recommended: {
          label: "Run Recommended: Recheck Clipboard",
          disabled: false,
          mode: "retry",
          retryable: true,
        },
      });
      assert.match(
        finalConfigData.lane_config_manual_surface.action,
        /Windows clipboard is unchanged/i
      );
      assert.match(
        finalConfigData.lane_config_manual_surface.action,
        /Run Recommended Action/i
      );
      assert.equal(
        getLaneConfigRecommendedAction(finalConfigData).blocked_code,
        "WINDOWS_CLIPBOARD_UNCHANGED"
      );
      assert.equal(
        getLaneConfigRecommendedRunState(finalConfigData).state,
        "waiting_for_clipboard"
      );
      assert.match(
        getLaneConfigRecommendedRun(finalConfigData).summary,
        /waiting on fresh clipboard input/i
      );
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can finish the one-click path after input clear when the clipboard becomes usable", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-run-recommended-after-input-clear-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-manual-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T05:30:00.000Z",
        recorded_at: "2026-04-14T05:30:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json"),
    JSON.stringify(
      {
        status: "waiting",
        attempts_completed: 9,
        last_manual_attempt: 8,
        last_manual_status_code: 200,
      },
      null,
      2
    )
  );

  let clipboardText = [
    "use the right repo and work on the agro project, use https://github.com/jessybrenenstahl/Gemma",
    "[REDACTED_GITHUB_TOKEN]",
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => clipboardText,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const preloadResponse = await fetch(`${baseUrl}/api/lane-config/load-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(preloadResponse.status, 200);

      const clearResponse = await fetch(`${baseUrl}/api/lane-config/clear-mac-repo-input-candidate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(clearResponse.status, 200);

      clipboardText = [
        "USER=example",
        "HOST=mac-studio",
        "REPORT_STATUS=found",
        "GEMMA_REPO_PATH=/Users/example/Documents/GitHub/Gemma",
        "GEMMA_REPO_ORIGIN=https://github.com/jessybrenenstahl/Gemma.git",
        "",
      ].join("\n");

      const response = await fetch(`${baseUrl}/api/lane-config/run-recommended-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(Object.hasOwn(data, "recommended_action"), false);
      assert.equal(Object.hasOwn(data, "executed_action"), false);
      assert.equal(getLaneConfigRunRecommendedAction(data).key, "apply_clipboard");
      assert.equal(getLaneConfigRunRecommendedAction(data).source, "clipboard_probe");
      assert.equal(Object.hasOwn(data, "lane_config_recommended_run"), false);
      assert.equal(getLaneConfigRunExecutedAction(data).key, "apply_clipboard");
      assert.equal(
        data.lane_config.configured_repo_paths.mac,
        "/Users/example/Documents/GitHub/Gemma"
      );
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/GitHub/Gemma");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can probe the Windows clipboard without mutating lane config", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-probe-clipboard-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  let clipboardText = [
    "use the right repo and work on the agro project, use https://github.com/jessybrenenstahl/Gemma",
    "[REDACTED_GITHUB_TOKEN]",
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => clipboardText,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const preloadResponse = await fetch(`${baseUrl}/api/lane-config/load-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(preloadResponse.status, 200);

      const clearResponse = await fetch(`${baseUrl}/api/lane-config/clear-mac-repo-input-candidate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(clearResponse.status, 200);

      const staleProbeResponse = await fetch(`${baseUrl}/api/lane-config/probe-mac-repo-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const staleProbeData = await staleProbeResponse.json();
      assert.equal(staleProbeResponse.status, 200);
      assert.equal(staleProbeData.mac_repo_clipboard_probe.state, "unchanged_after_input_clear");
      assert.equal(staleProbeData.mac_repo_clipboard_probe.unchanged_after_input_clear, true);

      const staleConfigResponse = await fetch(`${baseUrl}/api/lane-config`);
      const staleConfigData = await staleConfigResponse.json();
      assert.equal(staleConfigResponse.status, 200);
      assert.equal(staleConfigData.mac_repo_clipboard_probe.state, "unchanged_after_input_clear");
      assert.equal(staleConfigData.mac_repo_clipboard_probe_freshness.state, "fresh");
      assert.equal(getLaneConfigRecommendedAction(staleConfigData).key, "load_clipboard");
      assert.equal(getLaneConfigRecommendedAction(staleConfigData).source, "clipboard_probe");
      assert.equal(getLaneConfigRecommendedAction(staleConfigData).blocked, true);

      const staleProbeFile = {
        ...staleConfigData.mac_repo_clipboard_probe,
        recorded_at: "2000-01-01T00:00:00.000Z",
      };
      await writeFile(
        path.join(laneConfigDir, "last-mac-repo-clipboard-probe.json"),
        JSON.stringify(staleProbeFile, null, 2),
        "utf8"
      );

      const expiredConfigResponse = await fetch(`${baseUrl}/api/lane-config`);
      const expiredConfigData = await expiredConfigResponse.json();
      assert.equal(expiredConfigResponse.status, 200);
      assert.equal(expiredConfigData.mac_repo_clipboard_probe.state, "unchanged_after_input_clear");
      assert.equal(expiredConfigData.mac_repo_clipboard_probe_freshness.state, "stale");
      assert.equal(getLaneConfigRecommendedAction(expiredConfigData).key, "probe_clipboard");
      assert.equal(getLaneConfigRecommendedAction(expiredConfigData).source, "clipboard_probe_freshness");
      assert.match(
        getLaneConfigRecommendedAction(expiredConfigData).reason,
        /stale/i
      );
      assert.match(
        expiredConfigData.lane_config_manual_surface.action,
        /Last clipboard probe is stale/i
      );
      assert.match(
        expiredConfigData.lane_config_manual_surface.action,
        /Refresh Clipboard|Run Recommended Action/i
      );
      assert.match(
        expiredConfigData.lane_config_manual_surface.blocked_by,
        /STALE_CLIPBOARD_PROBE · The last clipboard probe is stale/i
      );
      assert.match(expiredConfigData.lane_config_manual_surface.summary, /refresh · Refresh Clipboard/i);
      assert.equal(
        expiredConfigData.lane_config_manual_surface.retry_path,
        "refresh-needed · Run Recommended: Refresh Clipboard"
      );
      assert.equal(
        expiredConfigData.lane_config_manual_surface.run_recommended.refreshable,
        true
      );
      assert.equal(
        expiredConfigData.lane_config_manual_surface.run_recommended.mode,
        "refresh"
      );
      assert.match(
        expiredConfigData.lane_config_manual_surface.run_recommended.title,
        /refresh the Windows clipboard truth when you click it/i
      );

      clipboardText = [
        "USER=example",
        "HOST=mac-studio",
        "REPORT_STATUS=found",
        "GEMMA_REPO_PATH=/Users/example/Documents/GitHub/Gemma",
        "GEMMA_REPO_ORIGIN=https://github.com/jessybrenenstahl/Gemma.git",
        "",
      ].join("\n");

      const usableProbeResponse = await fetch(`${baseUrl}/api/lane-config/probe-mac-repo-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const usableProbeData = await usableProbeResponse.json();
      assert.equal(usableProbeResponse.status, 200);
      assert.equal(usableProbeData.mac_repo_clipboard_probe.state, "usable");
      assert.equal(usableProbeData.mac_repo_clipboard_probe.has_usable_repo_path, true);
      assert.equal(
        usableProbeData.mac_repo_clipboard_probe.preview.repo_path,
        "/Users/example/Documents/GitHub/Gemma"
      );

      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(configData.mac_repo_clipboard_probe.state, "usable");
      assert.equal(getLaneConfigRecommendedAction(configData).key, "apply_clipboard");
      assert.equal(getLaneConfigRecommendedAction(configData).source, "clipboard_probe");
      assert.equal(configData.mac_repo_input_candidate, null);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can promote a stale clipboard-probe recommendation into apply-clipboard", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-run-recommended-stale-probe-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-manual-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T05:30:00.000Z",
        recorded_at: "2026-04-14T05:30:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "mac-repo-report-watch.json"),
    JSON.stringify(
      {
        status: "waiting",
        attempts_completed: 12,
        last_manual_attempt: 9,
        last_manual_status_code: 200,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(laneConfigDir, "last-mac-repo-clipboard-probe.json"),
    JSON.stringify(
      {
        state: "unchanged_after_input_clear",
        summary: "Windows clipboard still matches the stale Mac repo input that was already cleared.",
        recorded_at: "2000-01-01T00:00:00.000Z",
        clipboard_text_length: 142,
        redaction_count: 1,
        has_usable_repo_path: false,
        preview: {
          name: "windows-clipboard",
          source: "windows-clipboard",
          repo_path: null,
          repo_origin: "https://github.com/jessybrenenstahl/Gemma",
          summary: "Clipboard loaded, but it does not look like a Mac repo report yet.",
        },
        unchanged_candidate: false,
        unchanged_after_input_clear: true,
      },
      null,
      2
    )
  );

  let clipboardText = [
    "USER=example",
    "HOST=mac-studio",
    "REPORT_STATUS=found",
    "GEMMA_REPO_PATH=/Users/example/Documents/GitHub/Gemma",
    "GEMMA_REPO_ORIGIN=https://github.com/jessybrenenstahl/Gemma.git",
    "",
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => clipboardText,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const beforeResponse = await fetch(`${baseUrl}/api/lane-config`);
      const beforeData = await beforeResponse.json();
      assert.equal(beforeResponse.status, 200);
      assert.equal(beforeData.mac_repo_clipboard_probe_freshness.state, "stale");
      assert.equal(getLaneConfigRecommendedAction(beforeData).key, "probe_clipboard");
      assert.equal(getLaneConfigRecommendedAction(beforeData).source, "clipboard_probe_freshness");

      const response = await fetch(`${baseUrl}/api/lane-config/run-recommended-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(Object.hasOwn(data, "recommended_action"), false);
      assert.equal(Object.hasOwn(data, "executed_action"), false);
      assert.equal(getLaneConfigRunRecommendedAction(data).key, "apply_clipboard");
      assert.equal(getLaneConfigRunRecommendedAction(data).source, "clipboard_probe");
      assert.equal(Object.hasOwn(data, "lane_config_recommended_run"), false);
      assert.equal(getLaneConfigRunExecutedAction(data).key, "apply_clipboard");
      assert.equal(
        data.lane_config.configured_repo_paths.mac,
        "/Users/example/Documents/GitHub/Gemma"
      );
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/GitHub/Gemma");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can smart-apply through the recommended route after loading a usable clipboard candidate", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-run-recommended-smart-apply-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const clipboardText = [
    "Mac Codex says the Gemma checkout is here:",
    "",
    "`/Users/example/Documents/Codex/Gemma`",
    "",
    "origin: https://github.com/jessybrenenstahl/Gemma.git",
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    readWindowsClipboard: async () => clipboardText,
    pullTaildropInbox: async () => ({
      ok: true,
      moved: 0,
      total_reported: 0,
      files: [],
    }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const preloadResponse = await fetch(`${baseUrl}/api/lane-config/load-mac-repo-report-clipboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const preloadData = await preloadResponse.json();
      assert.equal(preloadResponse.status, 200);
      assert.equal(preloadData.ok, true);
      assert.equal(preloadData.mac_repo_input_candidate.preview.repo_path, "/Users/example/Documents/Codex/Gemma");

      const response = await fetch(`${baseUrl}/api/lane-config/run-recommended-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(Object.hasOwn(data, "recommended_action"), false);
      assert.equal(Object.hasOwn(data, "executed_action"), false);
      assert.equal(getLaneConfigRunRecommendedAction(data).key, "smart_apply");
      assert.equal(getLaneConfigRunExecutedAction(data).key, "smart_apply");
      assert.equal(data.smart_apply_source, "clipboard");
      assert.equal(data.lane_config.configured_repo_paths.mac, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.mac_repo_input_candidate, null);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell smart-apply prefers the latest Mac repo report when it exists", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-smart-apply-latest-report-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await writeFile(
    path.join(downloadsDir, "agro-mac-repo-path-report.txt"),
    [
      "USER=example",
      "HOST=mac-studio",
      "REPORT_STATUS=found",
      "GEMMA_REPO_PATH=/Users/example/Documents/GitHub/Gemma",
      "GEMMA_REPO_ORIGIN=https://github.com/jessybrenenstahl/Gemma.git",
      "",
    ].join("\n")
  );

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    pullTaildropInbox: async () => ({
      ok: true,
      moved: 0,
      total_reported: 0,
      files: [],
    }),
    readWindowsClipboard: async () => "",
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Smart apply the latest Mac repo report",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/smart-apply-mac-repo-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.smart_apply_source, "latest_report");
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/GitHub/Gemma");
      assert.equal(data.session.mac_state.repo_context.local_path, "/Users/example/Documents/GitHub/Gemma");
      assert.equal(data.session.mac_state.repo_context.usability, "usable");
      assert.equal(data.smart_apply_attempts[0].source, "latest_report");
      assert.equal(data.smart_apply_attempts[0].ok, true);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell smart-apply falls back to the Windows clipboard", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-smart-apply-clipboard-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    pullTaildropInbox: async () => ({
      ok: true,
      moved: 0,
      total_reported: 0,
      files: [],
    }),
    readWindowsClipboard: async () =>
      [
        "Mac Codex says the Gemma checkout is here:",
        "",
        "`/Users/example/Documents/Codex/Gemma`",
        "",
        "origin: https://github.com/jessybrenenstahl/Gemma.git",
      ].join("\n"),
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Smart apply from clipboard",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/smart-apply-mac-repo-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.smart_apply_source, "clipboard");
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.clipboard_text_length > 0, true);
      assert.equal(data.smart_apply_attempts[0].source, "latest_report");
      assert.equal(data.smart_apply_attempts[0].ok, false);
      assert.equal(data.smart_apply_attempts[1].source, "clipboard");
      assert.equal(data.smart_apply_attempts[1].ok, true);

      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(configData.mac_repo_smart_apply.smart_apply_source, "clipboard");
      assert.equal(configData.mac_repo_smart_apply.repo_path, "/Users/example/Documents/Codex/Gemma");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell returns the best manual-review candidate when Smart Apply cannot find a usable path", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-smart-apply-manual-candidate-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const clipboardText = [
    "Mac Codex is still checking the Gemma checkout.",
    "No confirmed repo path yet.",
    "Will send it once verified.",
  ].join("\n");

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    pullTaildropInbox: async () => ({
      ok: true,
      moved: 0,
      total_reported: 0,
      files: [],
    }),
    readWindowsClipboard: async () => clipboardText,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/smart-apply-mac-repo-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 409);
      assert.equal(data.ok, false);
      assert.equal(data.code, "MAC_REPO_SMART_APPLY_MISSING");
      assert.equal(data.best_manual_source, "clipboard");
      assert.equal(data.clipboard_text, clipboardText);
      assert.equal(data.clipboard_text_length, clipboardText.length);
      assert.ok(data.clipboard_preview);
      assert.equal(data.clipboard_preview.repo_path, null);
      assert.match(data.clipboard_preview.summary, /does not look like a Mac repo report yet/i);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell marks the last smart apply as superseded after a later clear", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-smart-apply-cleared-state-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    pullTaildropInbox: async () => ({
      ok: true,
      moved: 0,
      total_reported: 0,
      files: [],
    }),
    readWindowsClipboard: async () =>
      [
        "Mac Codex says the Gemma checkout is here:",
        "",
        "`/Users/example/Documents/Codex/Gemma`",
        "",
        "origin: https://github.com/jessybrenenstahl/Gemma.git",
      ].join("\n"),
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Supersede a prior smart apply",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const smartApplyResponse = await fetch(`${baseUrl}/api/lane-config/smart-apply-mac-repo-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
        }),
      });
      const smartApplyData = await smartApplyResponse.json();
      assert.equal(smartApplyResponse.status, 200);
      assert.equal(smartApplyData.ok, true);
      assert.equal(smartApplyData.smart_apply_source, "clipboard");

      const clearResponse = await fetch(`${baseUrl}/api/lane-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
          mac_repo_path: "",
        }),
      });
      const clearData = await clearResponse.json();
      assert.equal(clearResponse.status, 200);
      assert.equal(clearData.ok, true);

      const configResponse = await fetch(`${baseUrl}/api/lane-config`);
      const configData = await configResponse.json();
      assert.equal(configResponse.status, 200);
      assert.equal(configData.mac_repo_smart_apply.smart_apply_source, "clipboard");
      assert.equal(configData.mac_repo_smart_apply_state.state, "superseded");
      assert.equal(configData.mac_repo_smart_apply_state.superseded_by, "clear");
      assert.match(configData.mac_repo_smart_apply_state.summary, /Superseded by Clear Mac Repo Path/i);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell smart-apply falls back to pasted Mac repo text", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-smart-apply-pasted-text-"));
  const laneConfigPath = path.join(tempDir, ".data", "lane-config.json");
  const laneConfigDir = path.join(tempDir, ".data", "lane-config");
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  await mkdir(laneConfigDir, { recursive: true });
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const laneConfigStore = new FileBackedLaneConfigStore({
    filePath: laneConfigPath,
  });
  const app = createMissionControlApp({
    publicDir,
    laneConfigStore,
    laneConfigDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
    pullTaildropInbox: async () => ({
      ok: true,
      moved: 0,
      total_reported: 0,
      files: [],
    }),
    readWindowsClipboard: async () => "",
  });
  app.sessionManager.now = makeClock();
  const session = app.sessionManager.createSession({
    missionGoal: "Smart apply from pasted text",
    operatorMode: "send_mac",
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/lane-config/smart-apply-mac-repo-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.session_id,
          report_text: [
            "Mac Codex says the Gemma checkout is here:",
            "",
            "`/Users/example/Documents/Codex/Gemma`",
            "",
            "origin: https://github.com/jessybrenenstahl/Gemma.git",
          ].join("\n"),
        }),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.smart_apply_source, "pasted_text");
      assert.equal(data.mac_repo_report.repo_path, "/Users/example/Documents/Codex/Gemma");
      assert.equal(data.smart_apply_attempts[0].source, "latest_report");
      assert.equal(data.smart_apply_attempts[1].source, "clipboard");
      assert.equal(data.smart_apply_attempts[1].ok, false);
      assert.equal(data.smart_apply_attempts[2].source, "pasted_text");
      assert.equal(data.smart_apply_attempts[2].ok, true);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell can trigger a one-shot Taildrop pull route", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-taildrop-pull-"));
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  await mkdir(recoveryDir, { recursive: true });

  const app = createMissionControlApp({
    publicDir,
    liveRecoveryDir: recoveryDir,
    pullTaildropInbox: async () => ({
      ok: true,
      pulled_at: "2026-04-14T02:00:09.000Z",
      inbox_dir: "C:\\taildrop-inbox",
      command_output: "moved 1/1 files",
      moved: 1,
      total_reported: 1,
      files: [
        {
          name: "agro-mac-ssh-bridge-report.txt",
          length: 123,
        },
      ],
    }),
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/recovery/pull-taildrop-inbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.result.moved, 1);
      assert.equal(data.result.total_reported, 1);
      assert.ok(data.result.recorded_at);

      const receiptPath = path.join(recoveryDir, "last-taildrop-pull.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.moved, 1);
      assert.equal(receipt.total_reported, 1);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell makes recovery action receipt-aware when no Mac report exists", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-live-recovery-receipts-"));
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  const artifactsDir = path.join(tempDir, "artifacts");
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  await writeFile(
    path.join(recoveryDir, "latest-dual-verify.json"),
    JSON.stringify(
      {
        status: "waiting",
        recovered_at: null,
        continuous: true,
        attempts_completed: 7,
        attempts_configured: 0,
        last_checked_at: "2026-04-14T02:05:00.000Z",
        last_health: [
          {
            label: "mac-ssh-jessy_100.106.61.53",
            ok: false,
            status: 0,
            body: "jessy@100.106.61.53: Permission denied (publickey,password,keyboard-interactive).",
          },
        ],
        ssh_bridge: {
          label: "mac-ssh-jessy_100.106.61.53",
          ok: false,
          status: 0,
          body: "jessy@100.106.61.53: Permission denied (publickey,password,keyboard-interactive).",
        },
        ssh_repair: null,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(recoveryDir, "last-mac-action-pack-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T02:04:00.000Z",
        recorded_at: "2026-04-14T02:04:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(recoveryDir, "last-taildrop-pull.json"),
    JSON.stringify(
      {
        ok: true,
        pulled_at: "2026-04-14T02:04:30.000Z",
        recorded_at: "2026-04-14T02:04:31.000Z",
        moved: 0,
        total_reported: 0,
      },
      null,
      2
    )
  );

  const app = createMissionControlApp({
    artifactsDir,
    publicDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/live-recovery`);
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.mac_bridge_report, null);
      assert.ok(data.mac_action_send);
      assert.ok(data.taildrop_pull);
      assert.match(data.recovery_action, /Send Fallback to Mac/i);
      assert.match(data.recovery_action, /Mac Run Block/i);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mission-control shell updates recovery action after a direct fallback send", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agro-live-recovery-fallback-sent-"));
  const recoveryDir = path.join(tempDir, ".data", "live-recovery");
  const taildropDir = path.join(tempDir, ".data", "taildrop-inbox");
  const downloadsDir = path.join(tempDir, "Downloads");
  const artifactsDir = path.join(tempDir, "artifacts");
  await mkdir(recoveryDir, { recursive: true });
  await mkdir(taildropDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  await writeFile(
    path.join(recoveryDir, "latest-dual-verify.json"),
    JSON.stringify(
      {
        status: "waiting",
        recovered_at: null,
        continuous: true,
        attempts_completed: 8,
        attempts_configured: 0,
        last_checked_at: "2026-04-14T02:06:00.000Z",
        last_health: [
          {
            label: "mac-ssh-jessy_100.106.61.53",
            ok: false,
            status: 0,
            body: "jessy@100.106.61.53: Permission denied (publickey,password,keyboard-interactive).",
          },
        ],
        ssh_bridge: {
          label: "mac-ssh-jessy_100.106.61.53",
          ok: false,
          status: 0,
          body: "jessy@100.106.61.53: Permission denied (publickey,password,keyboard-interactive).",
        },
        ssh_repair: null,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(recoveryDir, "last-mac-action-pack-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T02:04:00.000Z",
        recorded_at: "2026-04-14T02:04:01.000Z",
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(recoveryDir, "last-taildrop-pull.json"),
    JSON.stringify(
      {
        ok: true,
        pulled_at: "2026-04-14T02:04:30.000Z",
        recorded_at: "2026-04-14T02:04:31.000Z",
        moved: 0,
        total_reported: 0,
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(recoveryDir, "last-mac-fallback-send.json"),
    JSON.stringify(
      {
        ok: true,
        sent_at: "2026-04-14T02:05:00.000Z",
        recorded_at: "2026-04-14T02:05:01.000Z",
      },
      null,
      2
    )
  );

  const app = createMissionControlApp({
    artifactsDir,
    publicDir,
    liveRecoveryDir: recoveryDir,
    taildropInboxDir: taildropDir,
    downloadsDir,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/live-recovery`);
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.ok(data.mac_fallback_send);
      assert.match(data.recovery_action, /already sent the direct fallback block/i);
      assert.match(data.recovery_action, /paste and run/i);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

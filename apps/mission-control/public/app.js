const STORAGE_KEY = "agro-mission-control-state";
const DEFAULT_APPROVAL_PROMPT = "Continue after operator approval.";
const POLL_MS = 4000;
const AUTO_PROBE_MS = 30000;
const AUTO_PROBE_UI_TICK_MS = 1000;

const ROUTES = {
  send_mac: {
    endpoint: "/api/routes/send-mac",
    label: "Send to Mac",
  },
  send_pc: {
    endpoint: "/api/routes/send-pc",
    label: "Send to PC",
  },
  send_both: {
    endpoint: "/api/routes/send-both",
    label: "Send to Both",
  },
  execute_critique: {
    endpoint: "/api/routes/execute-critique",
    label: "Ask Mac to Execute + PC to Critique",
  },
  compare: {
    endpoint: "/api/routes/compare",
    label: "Ask Both then Compare",
  },
};

const state = {
  currentSession: null,
  laneConfigAutoProbeReceipt: null,
  laneConfig: null,
  laneConfigClipboardPreview: null,
  laneConfigClipboardProbe: null,
  laneConfigClipboardProbeFreshness: null,
  laneConfigInputCandidate: null,
  laneConfigInputRisk: null,
  laneConfigManualSurface: null,
  laneConfigStatus: null,
  laneConfigAutoProbeAt: 0,
  laneConfigAutoProbing: false,
  laneConfigUiTickHandle: null,
  pollHandle: null,
  recovery: null,
  sending: false,
  sessions: [],
  status: null,
};

const elements = {
  approveMacButton: document.querySelector("#approveMacButton"),
  applyMacRepoReportButton: document.querySelector("#applyMacRepoReportButton"),
  applyMacRepoReportClipboardButton: document.querySelector("#applyMacRepoReportClipboardButton"),
  applyMacRepoReportTextButton: document.querySelector("#applyMacRepoReportTextButton"),
  arbitrationPill: document.querySelector("#arbitrationPill"),
  compareCards: document.querySelector("#compareCards"),
  compareCardTemplate: document.querySelector("#compareCardTemplate"),
  compareCount: document.querySelector("#compareCount"),
  compareSummary: document.querySelector("#compareSummary"),
  composerState: document.querySelector("#composerState"),
  clearMacRepoInputCandidateButton: document.querySelector("#clearMacRepoInputCandidateButton"),
  clearMacRepoPathButton: document.querySelector("#clearMacRepoPathButton"),
  feedItemTemplate: document.querySelector("#feedItemTemplate"),
  flashMessage: document.querySelector("#flashMessage"),
  latestSessionLabel: document.querySelector("#latestSessionLabel"),
  laneConfigRepoLabel: document.querySelector("#laneConfigRepoLabel"),
  laneConfigStatus: document.querySelector("#laneConfigStatus"),
  laneConfigUpdatedAt: document.querySelector("#laneConfigUpdatedAt"),
  laneConfigAction: document.querySelector("#laneConfigAction"),
  loadMacRepoReportClipboardButton: document.querySelector("#loadMacRepoReportClipboardButton"),
  macBridgeReport: document.querySelector("#macBridgeReport"),
  macActionBlock: document.querySelector("#macActionBlock"),
  macActionPack: document.querySelector("#macActionPack"),
  macActionSend: document.querySelector("#macActionSend"),
  macFallbackSend: document.querySelector("#macFallbackSend"),
  macAction: document.querySelector("#macAction"),
  macAuthority: document.querySelector("#macAuthority"),
  macConfirmation: document.querySelector("#macConfirmation"),
  macConfirmationSummary: document.querySelector("#macConfirmationSummary"),
  macCount: document.querySelector("#macCount"),
  macGap: document.querySelector("#macGap"),
  macHeartbeat: document.querySelector("#macHeartbeat"),
  macLaneFeed: document.querySelector("#macLaneFeed"),
  macLatency: document.querySelector("#macLatency"),
  macRepoActionBlock: document.querySelector("#macRepoActionBlock"),
  macRepoActionPack: document.querySelector("#macRepoActionPack"),
  macRepoAutoProbe: document.querySelector("#macRepoAutoProbe"),
  macRepoAutoProbeMode: document.querySelector("#macRepoAutoProbeMode"),
  macRepoClipboardPreview: document.querySelector("#macRepoClipboardPreview"),
  macRepoClipboardProbe: document.querySelector("#macRepoClipboardProbe"),
  macRepoFallbackSend: document.querySelector("#macRepoFallbackSend"),
  macRepoClear: document.querySelector("#macRepoClear"),
  macRepoInputClear: document.querySelector("#macRepoInputClear"),
  macRepoInputRisk: document.querySelector("#macRepoInputRisk"),
  macRepoManualSend: document.querySelector("#macRepoManualSend"),
  macRepoNudgeSend: document.querySelector("#macRepoNudgeSend"),
  macRepoPathHint: document.querySelector("#macRepoPathHint"),
  macRepoPathInput: document.querySelector("#macRepoPathInput"),
  macRepoRecommendedRun: document.querySelector("#macRepoRecommendedRun"),
  macRepoRecommendedRunState: document.querySelector("#macRepoRecommendedRunState"),
  macRepoReportTextInput: document.querySelector("#macRepoReportTextInput"),
  macRepoReport: document.querySelector("#macRepoReport"),
  macRepoRequestSend: document.querySelector("#macRepoRequestSend"),
  macRepoSmartApply: document.querySelector("#macRepoSmartApply"),
  macRepoWatcher: document.querySelector("#macRepoWatcher"),
  macRepoWatcherOutput: document.querySelector("#macRepoWatcherOutput"),
  macRepo: document.querySelector("#macRepo"),
  macStatusPill: document.querySelector("#macStatusPill"),
  macTask: document.querySelector("#macTask"),
  macVerified: document.querySelector("#macVerified"),
  missionGoal: document.querySelector("#missionGoal"),
  missionStatusPill: document.querySelector("#missionStatusPill"),
  modePill: document.querySelector("#modePill"),
  manualIngestHint: document.querySelector("#manualIngestHint"),
  manualSummary: document.querySelector("#manualSummary"),
  manualBlockedBy: document.querySelector("#manualBlockedBy"),
  manualNextAction: document.querySelector("#manualNextAction"),
  manualRunPathLabel: document.querySelector("#manualRunPathLabel"),
  manualRetryPath: document.querySelector("#manualRetryPath"),
  manualSuccessPath: document.querySelector("#manualSuccessPath"),
  newSessionButton: document.querySelector("#newSessionButton"),
  pcAction: document.querySelector("#pcAction"),
  pcAuthority: document.querySelector("#pcAuthority"),
  pcCount: document.querySelector("#pcCount"),
  pcGap: document.querySelector("#pcGap"),
  pcHeartbeat: document.querySelector("#pcHeartbeat"),
  pcLaneFeed: document.querySelector("#pcLaneFeed"),
  pcLatency: document.querySelector("#pcLatency"),
  pcRepoPathHint: document.querySelector("#pcRepoPathHint"),
  pcRepoPathInput: document.querySelector("#pcRepoPathInput"),
  pcRepo: document.querySelector("#pcRepo"),
  pcStatusPill: document.querySelector("#pcStatusPill"),
  pcTask: document.querySelector("#pcTask"),
  pcVerified: document.querySelector("#pcVerified"),
  probeMacRepoClipboardButton: document.querySelector("#probeMacRepoClipboardButton"),
  pullApplyMacRepoReportButton: document.querySelector("#pullApplyMacRepoReportButton"),
  pullTaildropButton: document.querySelector("#pullTaildropButton"),
  promptInput: document.querySelector("#promptInput"),
  recentCount: document.querySelector("#recentCount"),
  recentSessionTemplate: document.querySelector("#recentSessionTemplate"),
  recentSessions: document.querySelector("#recentSessions"),
  recoveryAction: document.querySelector("#recoveryAction"),
  sendMacFallbackButton: document.querySelector("#sendMacFallbackButton"),
  sendMacActionPackButton: document.querySelector("#sendMacActionPackButton"),
  sendMacRepoFallbackButton: document.querySelector("#sendMacRepoFallbackButton"),
  sendMacRepoManualButton: document.querySelector("#sendMacRepoManualButton"),
  sendMacRepoNudgeButton: document.querySelector("#sendMacRepoNudgeButton"),
  recoveryOutput: document.querySelector("#recoveryOutput"),
  recoveryDiagnostics: document.querySelector("#recoveryDiagnostics"),
  recoveryProbeList: document.querySelector("#recoveryProbeList"),
  recoveryRepair: document.querySelector("#recoveryRepair"),
  recoverySshBridge: document.querySelector("#recoverySshBridge"),
  recoverySshUser: document.querySelector("#recoverySshUser"),
  recoveryStatusBadge: document.querySelector("#recoveryStatusBadge"),
  recoverySummary: document.querySelector("#recoverySummary"),
  recoveryUpdatedAt: document.querySelector("#recoveryUpdatedAt"),
  recoveryWatcher: document.querySelector("#recoveryWatcher"),
  taildropInbox: document.querySelector("#taildropInbox"),
  taildropPull: document.querySelector("#taildropPull"),
  taildropWatcher: document.querySelector("#taildropWatcher"),
  refreshButton: document.querySelector("#refreshButton"),
  repoLabel: document.querySelector("#repoLabel"),
  riskPill: document.querySelector("#riskPill"),
  routeButtons: Array.from(document.querySelectorAll(".route-button[data-route]")),
  routeList: document.querySelector("#routeList"),
  requestMacRepoReportButton: document.querySelector("#requestMacRepoReportButton"),
  runRecommendedActionButton: document.querySelector("#runRecommendedActionButton"),
  saveLaneConfigButton: document.querySelector("#saveLaneConfigButton"),
  serverBadge: document.querySelector("#serverBadge"),
  smartApplyMacRepoReportButton: document.querySelector("#smartApplyMacRepoReportButton"),
  startMacRepoWatcherButton: document.querySelector("#startMacRepoWatcherButton"),
  sessionCount: document.querySelector("#sessionCount"),
  sessionIdPill: document.querySelector("#sessionIdPill"),
  sharedCount: document.querySelector("#sharedCount"),
  sharedInstructionInput: document.querySelector("#sharedInstructionInput"),
  sharedLaneFeed: document.querySelector("#sharedLaneFeed"),
  updatedAtLabel: document.querySelector("#updatedAtLabel"),
};

function saveUiState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      prompt: elements.promptInput.value,
      sessionId: state.currentSession?.session_id || null,
      sharedInstruction: elements.sharedInstructionInput.value,
    })
  );
}

function loadUiState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function formatTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function formatDurationMs(ms) {
  const numericValue = Number(ms);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return "unknown age";
  }

  if (numericValue < 60_000) {
    return `${Math.max(1, Math.round(numericValue / 1000))}s`;
  }

  if (numericValue < 3_600_000) {
    return `${Math.max(1, Math.round(numericValue / 60_000))}m`;
  }

  return `${Math.max(1, Math.round(numericValue / 3_600_000))}h`;
}

function getRecordedAgeMs(recordedAt) {
  if (!recordedAt) {
    return null;
  }

  const recordedMs = new Date(recordedAt).getTime();
  if (!Number.isFinite(recordedMs)) {
    return null;
  }

  const ageMs = Date.now() - recordedMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return null;
  }

  return ageMs;
}

function formatAutoProbeAgePart(recordedAt) {
  const ageMs = getRecordedAgeMs(recordedAt);
  if (!Number.isFinite(ageMs)) {
    return null;
  }

  return `last auto-probe ${formatDurationMs(ageMs)} ago`;
}

function formatRunPathLabelFromMode(mode) {
  if (mode === "refresh") {
    return "Refresh Path";
  }

  if (mode === "retry") {
    return "Retry Path";
  }

  return "Run Path";
}

function buildServerRecommendedManualAction(serverRecommendation, overrides = {}) {
  return {
    key: serverRecommendation?.key || null,
    label: serverRecommendation?.label || "Recommended Action",
    reason: serverRecommendation?.reason || "Use the server-backed recommended action.",
    blocked: Boolean(serverRecommendation?.blocked),
    blocked_reason: serverRecommendation?.blocked_reason || null,
    ...overrides,
  };
}

function getEffectiveLaneConfigRecommendedAction() {
  return state.laneConfigManualSurface?.recommended_action || null;
}

function formatLatencyHint(latencyHint) {
  if (!latencyHint) {
    return "Latency: -";
  }

  return `Latency: ${latencyHint.label} · ${formatCount(latencyHint.ms_estimate)} ms`;
}

function formatHeartbeat(heartbeat) {
  if (!heartbeat || !heartbeat.last_heartbeat_at) {
    return "Heartbeat: idle";
  }

  return `Heartbeat: ${heartbeat.state} · ${formatCount(heartbeat.age_ms || 0)} ms ago`;
}

function formatRepoContext(repoContext) {
  if (!repoContext) {
    return "-";
  }

  const parts = [repoContext.repo || "-", repoContext.usability || "unknown"];
  if (repoContext.local_path) {
    parts.push(repoContext.local_path);
  } else if (repoContext.detail) {
    parts.push(repoContext.detail);
  }
  return parts.join(" | ");
}

function formatLaneConfigHint(pathValue, source) {
  const sourceLabel = source || "unset";
  if (!pathValue) {
    return `Current source: ${sourceLabel}`;
  }

  return `Current source: ${sourceLabel} | ${pathValue}`;
}

function statusTone(status) {
  if (!status || status === "idle") {
    return "offline";
  }
  if (status === "blocked" || status === "error") {
    return "danger";
  }
  if (status === "awaiting_operator" || status === "verifying") {
    return "warn";
  }
  return "online";
}

function formatRecoveryProbe(entry) {
  if (!entry) {
    return "-";
  }

  const label = String(entry.label || "")
    .replace(/^mac-models-/, "")
    .replace(/_/g, ":");
  const status = entry.ok ? "ok" : entry.status || "down";
  return `${label} (${status})`;
}

function formatRecoveryDiagnostic(entry) {
  if (!entry) {
    return "-";
  }

  const label = String(entry.label || "")
    .replace(/^mac-dns-/, "dns ")
    .replace(/^mac-tcp-/, "tcp ")
    .replace(/^mac-http-/, "http ")
    .replace(/_/g, ":");
  const body = String(entry.body || "").trim();
  return body ? `${label} -> ${body}` : label;
}

function formatRecoverySshBridge(entry) {
  if (!entry) {
    return "No SSH probe yet.";
  }

  const status = entry.ok ? "ready" : "blocked";
  const body = String(entry.body || "").trim();
  return body ? `${status} · ${body}` : status;
}

function formatRecoveryRepair(entry) {
  if (!entry) {
    return "No auto-repair attempt yet.";
  }

  const status = entry.ok ? "repair ok" : "repair failed";
  const attemptedAt = entry.attempted_at ? formatTime(entry.attempted_at) : "-";
  const body = String(entry.body || "").trim().replace(/\s+/g, " ");
  return body ? `${status} @ ${attemptedAt} · ${body}` : `${status} @ ${attemptedAt}`;
}

function formatRecoverySshUser(summary, report) {
  const effectiveUser = summary?.effective_ssh_user || report?.user || null;
  if (!effectiveUser) {
    return "jessy";
  }

  return effectiveUser;
}

function formatTaildropWatcher(entry) {
  if (!entry) {
    return "No Taildrop watcher metadata yet.";
  }

  return entry.summary || "No Taildrop watcher metadata yet.";
}

function formatTaildropFiles(files) {
  if (!Array.isArray(files) || !files.length) {
    return "No Taildrop files received yet.";
  }

  return files
    .map((file) => `${file.name} (${formatTime(file.updated_at)})`)
    .join(" | ");
}

function formatMacBridgeReport(report) {
  if (!report) {
    return "No Mac SSH bridge report received yet.";
  }

  const source = report.source || "unknown source";
  const updatedAt = formatTime(report.updated_at);
  const summary = report.summary || "Mac SSH bridge report received.";
  return `${summary} · ${source} @ ${updatedAt}`;
}

function formatMacActionPack(actionPack) {
  if (!actionPack) {
    return "No Mac action pack available yet.";
  }

  const parts = [actionPack.summary || "Mac action pack ready."];
  if (actionPack.inline_command) {
    parts.push(`Run: ${actionPack.inline_command}`);
  }
  if (actionPack.script_path) {
    parts.push(`Script: ${actionPack.script_path}`);
  }
  if (actionPack.note_path) {
    parts.push(`Note: ${actionPack.note_path}`);
  }
  return parts.join(" | ");
}

function formatMacActionBlock(actionPack) {
  if (!actionPack) {
    return "No Mac action block available yet.";
  }

  const parts = [];
  if (actionPack.run_block) {
    parts.push("# Preferred");
    parts.push(actionPack.run_block);
  }
  if (actionPack.fallback_block) {
    parts.push("");
    parts.push("# Fallback");
    parts.push(actionPack.fallback_block);
  }
  if (!parts.length) {
    return "No Mac action block available yet.";
  }

  return parts.join("\n");
}

function formatMacActionSend(actionSend) {
  if (!actionSend) {
    return "No resend receipt yet.";
  }

  const when = formatTime(actionSend.recorded_at || actionSend.sent_at);
  const deliveries = Array.isArray(actionSend.deliveries)
    ? actionSend.deliveries
        .map((entry) => {
          const channel = entry.channel || "delivery";
          const target = entry.file ? `${channel}:${entry.file}` : channel;
          return entry.ok ? target : `${target} failed`;
        })
        .join(" | ")
    : "no delivery details";
  return `${when} · ${deliveries}`;
}

function formatMacRepoReport(report) {
  if (!report) {
    return "No Mac repo-path report received yet.";
  }

  const when = formatTime(report.updated_at);
  return `${report.summary || "Mac repo-path report received."} · ${report.source || "unknown source"} @ ${when}`;
}

function formatMacRepoRequestSend(requestSend) {
  if (!requestSend) {
    return "No Mac repo-path request sent yet.";
  }

  const when = formatTime(requestSend.recorded_at || requestSend.sent_at);
  const deliveries = Array.isArray(requestSend.deliveries)
    ? requestSend.deliveries
        .map((entry) => {
          const channel = entry.channel || "delivery";
          const target = entry.file ? `${channel}:${entry.file}` : channel;
          return entry.ok ? target : `${target} failed`;
        })
        .join(" | ")
    : "no delivery details";
  const returnTargets = Array.isArray(requestSend.return_targets) && requestSend.return_targets.length
    ? ` · return ${requestSend.return_targets.join(", ")}`
    : "";
  return `${when} · ${deliveries}${returnTargets}`;
}

function formatMacRepoActionPack(actionPack) {
  if (!actionPack) {
    return "No Mac repo action pack available yet.";
  }

  const parts = [actionPack.summary || "Mac repo action pack ready."];
  if (actionPack.inline_command) {
    parts.push(`Run: ${actionPack.inline_command}`);
  }
  if (actionPack.script_path) {
    parts.push(`Script: ${actionPack.script_path}`);
  }
  if (actionPack.note_path) {
    parts.push(`Note: ${actionPack.note_path}`);
  }
  if (Array.isArray(actionPack.return_targets) && actionPack.return_targets.length) {
    parts.push(`Return: ${actionPack.return_targets.join(", ")}`);
  }
  return parts.join(" | ");
}

function formatMacRepoActionBlock(actionPack) {
  if (!actionPack) {
    return "No Mac repo action block available yet.";
  }

  const parts = [];
  if (actionPack.run_block) {
    parts.push("# Preferred");
    parts.push(actionPack.run_block);
  }
  if (actionPack.fallback_block) {
    parts.push("");
    parts.push("# Fallback");
    parts.push(actionPack.fallback_block);
  }
  if (actionPack.manual_block) {
    parts.push("");
    parts.push("# Manual Paste");
    parts.push(actionPack.manual_block);
  }
  if (!parts.length) {
    return "No Mac repo action block available yet.";
  }

  return parts.join("\n");
}

function formatMacRepoFallbackSend(fallbackSend) {
  if (!fallbackSend) {
    return "No Mac repo fallback send yet.";
  }

  const when = formatTime(fallbackSend.recorded_at || fallbackSend.sent_at);
  const deliveries = Array.isArray(fallbackSend.deliveries)
    ? fallbackSend.deliveries
        .map((entry) => {
          const channel = entry.channel || "delivery";
          const target = entry.file ? `${channel}:${entry.file}` : channel;
          return entry.ok ? target : `${target} failed`;
        })
        .join(" | ")
    : "no delivery details";
  return `${when} · ${deliveries}`;
}

function formatMacRepoManualSend(manualSend) {
  if (!manualSend) {
    return "No Mac repo manual send yet.";
  }

  const when = formatTime(manualSend.recorded_at || manualSend.sent_at);
  const deliveries = Array.isArray(manualSend.deliveries)
    ? manualSend.deliveries
        .map((entry) => {
          const channel = entry.channel || "delivery";
          const target = entry.file ? `${channel}:${entry.file}` : channel;
          return entry.ok ? target : `${target} failed`;
        })
        .join(" | ")
    : "no delivery details";
  return `${when} · ${deliveries}`;
}

function formatMacRepoSmartApply(smartApply, smartApplyState) {
  if (!smartApply) {
    return "No smart-apply receipt yet.";
  }

  const when = formatTime(smartApply.recorded_at);
  const source = smartApply.smart_apply_source || "unknown source";
  const repoPath = smartApply.repo_path || "unknown path";
  const stateSummary = String(smartApplyState?.summary || "").trim();
  if (stateSummary) {
    return `${when} · ${source} · ${repoPath} · ${stateSummary}`;
  }
  return `${when} · ${source} · ${repoPath}`;
}

function formatMacRepoClear(clearReceipt) {
  if (!clearReceipt) {
    return "No Mac repo clear receipt yet.";
  }

  const when = formatTime(clearReceipt.recorded_at);
  const previousPath = clearReceipt.previous_mac_repo_path || "already empty";
  const removed = clearReceipt.removed_manual_report ? "manual report removed" : "no manual report";
  return `${when} · ${previousPath} · ${removed}`;
}

function formatMacRepoInputClear(clearReceipt) {
  if (!clearReceipt) {
    return "No input clear yet.";
  }

  const when = formatTime(clearReceipt.recorded_at);
  const parts = [when];
  if (clearReceipt.previous_source_label) {
    parts.push(clearReceipt.previous_source_label);
  } else if (clearReceipt.previous_source) {
    parts.push(String(clearReceipt.previous_source).replace(/_/g, " "));
  }
  if (Number.isFinite(Number(clearReceipt.previous_input_text_length)) && Number(clearReceipt.previous_input_text_length) > 0) {
    parts.push(`${clearReceipt.previous_input_text_length} chars`);
  }
  if (Number(clearReceipt.previous_redaction_count) > 0) {
    parts.push(
      `${clearReceipt.previous_redaction_count} redaction${Number(clearReceipt.previous_redaction_count) === 1 ? "" : "s"}`
    );
  }
  if (clearReceipt.previous_has_usable_repo_path && clearReceipt.previous_repo_path) {
    parts.push(clearReceipt.previous_repo_path);
  } else {
    parts.push("repo paths untouched");
  }
  return parts.join(" · ");
}

function formatLaneConfigRecommendedRun(runReceipt, runState) {
  if (!runReceipt) {
    return "No recommended run receipt yet.";
  }

  const when = formatTime(runReceipt.recorded_at);
  const action = getLaneConfigRunActionLabel(runReceipt);
  const statusCode = Number.isFinite(Number(runReceipt.status_code))
    ? `status ${runReceipt.status_code}`
    : "status unknown";
  const summary = String(runReceipt.summary || "").trim();
  const stateSummary = String(runState?.summary || "").trim();
  const base = summary ? `${when} · ${summary}` : `${when} · ${action} · ${statusCode}`;
  return stateSummary ? `${base} · ${stateSummary}` : base;
}

function formatLaneConfigRecommendedRunState(runState) {
  if (!runState) {
    return "No recommended run state yet.";
  }

  const stateLabel = String(runState.state || "unknown").replace(/_/g, " ");
  const summary = String(runState.summary || "").trim();
  return summary ? `${stateLabel} · ${summary}` : stateLabel;
}

function getLaneConfigRunActionLabel(runReceipt) {
  return (
    runReceipt?.executed_action?.label ||
    runReceipt?.recommended_action?.label ||
    "Recommended Action"
  );
}

function formatMacRepoNudgeSend(nudgeSend) {
  if (!nudgeSend) {
    return "No Mac repo nudge send yet.";
  }

  const when = formatTime(nudgeSend.recorded_at || nudgeSend.sent_at);
  const deliveries = Array.isArray(nudgeSend.deliveries)
    ? nudgeSend.deliveries
        .map((entry) => {
          const channel = entry.channel || "delivery";
          const target = entry.file ? `${channel}:${entry.file}` : channel;
          return entry.ok ? target : `${target} failed`;
        })
        .join(" | ")
    : "no delivery details";
  const returnTargets = Array.isArray(nudgeSend.return_targets) && nudgeSend.return_targets.length
    ? ` · return ${nudgeSend.return_targets.join(", ")}`
    : "";
  return `${when} · ${deliveries}${returnTargets}`;
}

function formatMacRepoWatcher(watcher, watcherSummary) {
  if (!watcher && !watcherSummary) {
    return "No Mac repo watcher metadata yet.";
  }

  const base = watcher?.summary || "No Mac repo watcher metadata yet.";
  if (!watcherSummary) {
    return base;
  }

  const details = [];
  if (watcherSummary.status) {
    details.push(`status ${watcherSummary.status}`);
  }
  if (Number.isFinite(Number(watcherSummary.attempts_completed))) {
    details.push(`attempt ${watcherSummary.attempts_completed}`);
  }
  if (Number.isFinite(Number(watcherSummary.resend_every_attempts)) && Number(watcherSummary.resend_every_attempts) > 0) {
    details.push(`re-request every ${watcherSummary.resend_every_attempts} pulls`);
  }
  if (Number.isFinite(Number(watcherSummary.nudge_every_attempts)) && Number(watcherSummary.nudge_every_attempts) > 0) {
    details.push(`auto-nudge every ${watcherSummary.nudge_every_attempts} pulls`);
  }
  if (Number.isFinite(Number(watcherSummary.fallback_every_attempts)) && Number(watcherSummary.fallback_every_attempts) > 0) {
    details.push(`auto-fallback every ${watcherSummary.fallback_every_attempts} pulls`);
  }
  if (Number.isFinite(Number(watcherSummary.manual_every_attempts)) && Number(watcherSummary.manual_every_attempts) > 0) {
    details.push(`auto-manual every ${watcherSummary.manual_every_attempts} pulls`);
  }
  if (Number.isFinite(Number(watcherSummary.last_request_attempt)) && Number(watcherSummary.last_request_attempt) > 0) {
    details.push(`last resend @ ${watcherSummary.last_request_attempt}`);
  }
  if (Number.isFinite(Number(watcherSummary.last_nudge_attempt)) && Number(watcherSummary.last_nudge_attempt) > 0) {
    details.push(`last nudge @ ${watcherSummary.last_nudge_attempt}`);
  }
  if (Number.isFinite(Number(watcherSummary.last_fallback_attempt)) && Number(watcherSummary.last_fallback_attempt) > 0) {
    details.push(`last fallback @ ${watcherSummary.last_fallback_attempt}`);
  }
  if (Number.isFinite(Number(watcherSummary.last_manual_attempt)) && Number(watcherSummary.last_manual_attempt) > 0) {
    details.push(`last manual @ ${watcherSummary.last_manual_attempt}`);
  }

  return details.length ? `${base} | ${details.join(" | ")}` : base;
}

function formatTaildropPull(taildropPull) {
  if (!taildropPull) {
    return "No manual pull receipt yet.";
  }

  const when = formatTime(taildropPull.recorded_at || taildropPull.pulled_at);
  const moved = `${taildropPull.moved ?? 0}/${taildropPull.total_reported ?? 0}`;
  return `${when} · moved ${moved}`;
}

function formatMacFallbackSend(fallbackSend) {
  if (!fallbackSend) {
    return "No direct fallback send yet.";
  }

  const when = formatTime(fallbackSend.recorded_at || fallbackSend.sent_at);
  const deliveries = Array.isArray(fallbackSend.deliveries)
    ? fallbackSend.deliveries
        .map((entry) => {
          const channel = entry.channel || "delivery";
          const target = entry.file ? `${channel}:${entry.file}` : channel;
          return entry.ok ? target : `${target} failed`;
        })
        .join(" | ")
    : "no delivery details";
  return `${when} · ${deliveries}`;
}

function setFlash(message = "", tone = "info") {
  if (!message) {
    elements.flashMessage.hidden = true;
    elements.flashMessage.textContent = "";
    elements.flashMessage.className = "flash-message";
    return;
  }

  elements.flashMessage.hidden = false;
  elements.flashMessage.textContent = message;
  elements.flashMessage.className = `flash-message ${tone}`;
}

function formatLaneConfigStatus(status) {
  if (!status) {
    return "No lane-config status yet.";
  }

  const stateLabel = String(status.state || "unknown").replace(/_/g, " ");
  const summary = status.summary || "No lane-config status yet.";
  const attempts = Number(status.watcher_attempts);
  const detailParts = [];

  if (Number.isFinite(attempts) && attempts > 0) {
    detailParts.push(`attempts ${attempts}`);
  }

  if (status.recommended_source) {
    detailParts.push(`recommended ${String(status.recommended_source).replace(/_/g, " ")}`);
  }

  return [stateLabel, summary, ...detailParts].join(" · ");
}

function formatMacRepoClipboardPreview(preview) {
  if (!preview) {
    return "No input preview loaded.";
  }

  const parts = [];
  if (preview.repo_path) {
    parts.push(preview.repo_path);
  } else {
    parts.push(preview.summary || "No usable repo path found");
  }

  if (preview.repo_origin) {
    parts.push(preview.repo_origin);
  }

  if (Number.isFinite(Number(preview.clipboard_text_length)) && Number(preview.clipboard_text_length) > 0) {
    parts.push(`${preview.clipboard_text_length} chars`);
  }

  if (preview.source_label) {
    parts.push(preview.source_label);
  }

  if (!preview.repo_path && preview.raw_excerpt) {
    const excerpt = String(preview.raw_excerpt).replace(/\s+/g, " ").trim();
    if (excerpt) {
      parts.push(excerpt.length > 120 ? `${excerpt.slice(0, 117)}...` : excerpt);
    }
  }

  return parts.join(" · ");
}

function formatMacRepoClipboardProbe(probe, freshness = null) {
  if (!probe) {
    return "No clipboard probe yet.";
  }

  const parts = [];
  if (probe.recorded_at) {
    parts.push(formatTime(probe.recorded_at));
  }
  parts.push(probe.summary || "Clipboard probe complete.");
  if (probe.state) {
    parts.push(String(probe.state).replace(/_/g, " "));
  }
  if (probe.preview?.repo_path) {
    parts.push(probe.preview.repo_path);
  }
  if (Number.isFinite(Number(probe.clipboard_text_length)) && Number(probe.clipboard_text_length) > 0) {
    parts.push(`${probe.clipboard_text_length} chars`);
  }
  if (probe.redaction_count > 0) {
    parts.push(`${probe.redaction_count} redaction${probe.redaction_count === 1 ? "" : "s"}`);
  }
  if (freshness?.state === "stale") {
    parts.push(`stale after ${formatDurationMs(freshness.age_ms)}`);
  } else if (freshness?.state === "fresh") {
    parts.push(`fresh ${formatDurationMs(freshness.age_ms)} old`);
  } else if (freshness?.state === "unknown") {
    parts.push("probe age unknown");
  }
  return parts.join(" · ");
}

function formatMacRepoAutoProbe(receipt) {
  if (!receipt) {
    return "No auto-probe yet.";
  }

  const parts = [];
  if (receipt.recorded_at) {
    parts.push(formatTime(receipt.recorded_at));
  }
  const agePart = formatAutoProbeAgePart(receipt.recorded_at);
  if (agePart) {
    parts.push(agePart);
  }
  parts.push(receipt.ok ? "auto-probe ok" : "auto-probe failed");
  if (receipt.summary) {
    parts.push(receipt.summary);
  }
  if (receipt.probe_state) {
    parts.push(String(receipt.probe_state).replace(/_/g, " "));
  }
  if (receipt.freshness_state) {
    parts.push(`freshness ${String(receipt.freshness_state).replace(/_/g, " ")}`);
  }
  return parts.join(" · ");
}

function formatMacRepoAutoProbeMode() {
  const hasConfiguredMacPath = Boolean(
    state.laneConfig?.effective_repo_paths?.mac || state.laneConfig?.configured_repo_paths?.mac
  );
  const hasLoadedCandidate = Boolean(state.laneConfigInputCandidate?.input_text_length);
  const recommendedAction = getEffectiveLaneConfigRecommendedAction();
  const probeClipboardRecommended = recommendedAction?.key === "probe_clipboard";
  const blockedClipboardReloadRecommended =
    recommendedAction?.key === "load_clipboard" &&
    recommendedAction?.source === "clipboard_probe" &&
    recommendedAction?.blocked &&
    recommendedAction?.blocked_code === "WINDOWS_CLIPBOARD_UNCHANGED";
  const armed =
    state.laneConfigStatus?.state === "manual_preferred" &&
    !hasConfiguredMacPath &&
    !hasLoadedCandidate &&
    (probeClipboardRecommended || blockedClipboardReloadRecommended);
  const agePart = formatAutoProbeAgePart(state.laneConfigAutoProbeReceipt?.recorded_at);

  if (state.laneConfigAutoProbing) {
    const parts = ["probing now", "background clipboard check in progress"];
    if (agePart) {
      parts.push(agePart);
    }
    return parts.join(" · ");
  }

  if (armed) {
    const remainingMs = AUTO_PROBE_MS - (Date.now() - Number(state.laneConfigAutoProbeAt || 0));
    if (Number.isFinite(remainingMs) && remainingMs > 0 && Number(state.laneConfigAutoProbeAt || 0) > 0) {
      const parts = [
        "throttled",
        `next background clipboard probe in ${formatDurationMs(remainingMs)}`,
      ];
      if (agePart) {
        parts.push(agePart);
      }
      return parts.join(" · ");
    }

    const parts = [
      "armed",
      "ready now",
      `background clipboard probe every ${formatDurationMs(AUTO_PROBE_MS)} while waiting for a fresh Mac reply`,
    ];
    if (agePart) {
      parts.push(agePart);
    }
    return parts.join(" · ");
  }

  if (hasConfiguredMacPath) {
    const parts = ["idle", "Mac repo path already configured"];
    if (agePart) {
      parts.push(agePart);
    }
    return parts.join(" · ");
  }

  if (hasLoadedCandidate) {
    const parts = ["idle", "manual input candidate is loaded"];
    if (agePart) {
      parts.push(agePart);
    }
    return parts.join(" · ");
  }

  if (state.laneConfigStatus?.state !== "manual_preferred") {
    const parts = [
      "idle",
      `lane config state is ${String(state.laneConfigStatus?.state || "unknown").replace(/_/g, " ")}`,
    ];
    if (agePart) {
      parts.push(agePart);
    }
    return parts.join(" · ");
  }

  const parts = ["idle", "no auto-probe condition is active"];
  if (agePart) {
    parts.push(agePart);
  }
  return parts.join(" · ");
}

function renderAutoProbeFacts() {
  elements.macRepoAutoProbe.textContent = formatMacRepoAutoProbe(
    state.laneConfigAutoProbeReceipt
  );
  elements.macRepoAutoProbeMode.textContent = formatMacRepoAutoProbeMode();
}

function formatMacRepoInputRisk(risk) {
  if (!risk) {
    return "No input risk detected.";
  }

  const parts = [risk.summary || "No input risk detected."];
  if (risk.redaction_count > 0) {
    parts.push(`${risk.redaction_count} redaction${risk.redaction_count === 1 ? "" : "s"}`);
  }
  if (risk.source) {
    parts.push(String(risk.source).replace(/_/g, " "));
  }
  return parts.join(" · ");
}

function buildPreviewFromInputCandidate(candidate) {
  if (!candidate?.preview) {
    return null;
  }

  return {
    ...candidate.preview,
    clipboard_text_length:
      candidate.input_text_length ||
      candidate.preview?.clipboard_text_length ||
      0,
    source_label:
      candidate.source_label ||
      candidate.preview?.source_label ||
      null,
  };
}

function hydrateMacRepoInputCandidate(candidate) {
  state.laneConfigInputCandidate = candidate || null;
  const candidateText = String(candidate?.input_text || "");
  const candidateTrimmed = candidateText.trim();
  const currentText = String(elements.macRepoReportTextInput.value || "");
  const currentTrimmed = currentText.trim();
  const preview = buildPreviewFromInputCandidate(candidate);

  if (!currentTrimmed) {
    elements.macRepoReportTextInput.value = candidateText;
    state.laneConfigClipboardPreview = preview;
    return;
  }

  if (candidateTrimmed && currentTrimmed === candidateTrimmed) {
    state.laneConfigClipboardPreview = preview;
    return;
  }

  if (!state.laneConfigClipboardPreview && preview) {
    state.laneConfigClipboardPreview = preview;
  }
}

function getRecommendedManualAction(status, preview, pastedText) {
  const serverRecommendation = getEffectiveLaneConfigRecommendedAction();
  const trimmedPastedText = String(pastedText || "").trim();
  const hasPastedText = Boolean(trimmedPastedText);
  const loadedCandidate = state.laneConfigInputCandidate || null;
  const loadedCandidateText = String(loadedCandidate?.input_text || "").trim();
  const isLoadedCandidateText =
    Boolean(loadedCandidateText) &&
    Boolean(trimmedPastedText) &&
    loadedCandidateText === trimmedPastedText;

  if (status?.can_apply_report) {
    return {
      key: "apply_report",
      label: "Apply Report",
      reason: "A returned Mac repo report is ready right now.",
    };
  }

  if (preview?.repo_path) {
    return {
      key: "smart_apply",
      label: "Smart Apply",
      reason: "The current input preview already contains a usable Mac repo path.",
    };
  }

  if (
    serverRecommendation?.key &&
    isLoadedCandidateText &&
    !loadedCandidate?.has_usable_repo_path
  ) {
    return buildServerRecommendedManualAction(serverRecommendation);
  }

  if (
    serverRecommendation?.key &&
    !hasPastedText &&
    !preview?.repo_path &&
    (
      serverRecommendation.blocked ||
      serverRecommendation.source === "input_clear" ||
      serverRecommendation.key === "probe_clipboard" ||
      serverRecommendation.source === "clipboard_probe_freshness"
    )
  ) {
    return buildServerRecommendedManualAction(serverRecommendation);
  }

  if (hasPastedText) {
    return {
      key: "apply_pasted_report",
      label: "Apply Pasted Report",
      reason: "Manual Mac Repo Report already has text loaded for review.",
    };
  }

  if (status?.can_clear_mac_repo_path || status?.state === "configured") {
    return {
      key: "clear_mac_repo_path",
      label: "Clear Mac Repo Path",
      reason: "A Mac repo path is already configured, so only clear it if the checkout moved or was applied by mistake.",
    };
  }

  if (status?.state === "manual_preferred") {
    return {
      key: "apply_clipboard",
      label: "Apply Clipboard",
      reason: "This is the fastest one-click path if the Mac reply has already been copied into Windows.",
    };
  }

  if (status?.state === "watching") {
    return {
      key: "load_clipboard",
      label: "Load Clipboard",
      reason: "This lets you bypass the watcher as soon as a Mac reply is copied into Windows.",
    };
  }

  if (serverRecommendation?.key) {
    return buildServerRecommendedManualAction(serverRecommendation, {
      blocked: false,
      blocked_reason: null,
    });
  }

  return {
    key: "send_nudge",
    label: "Nudge Mac Now",
    reason: "No manual candidate is loaded yet, so the safest next move is to push the repo-path prompt bundle again.",
  };
}

function updateManualActionRecommendation(status, preview, pastedText) {
  const recommendation = getRecommendedManualAction(status, preview, pastedText);
  const trimmedPastedText = String(pastedText || "").trim();
  const loadedCandidateText = String(state.laneConfigInputCandidate?.input_text || "").trim();
  const shouldUseServerSurface =
    !trimmedPastedText ||
    (Boolean(loadedCandidateText) && trimmedPastedText === loadedCandidateText);
  const hasPastedText = Boolean(trimmedPastedText);
  const inputRisk = state.laneConfigInputRisk;
  const manualHintRecommendation = getEffectiveLaneConfigRecommendedAction();
  const clipboardProbe = state.laneConfigClipboardProbe;
  const clipboardProbeFreshness = state.laneConfigClipboardProbeFreshness;
  const manualSurface =
    (shouldUseServerSurface
      ? state.laneConfigManualSurface || null
      : null) || (() => {
      const retryableBlocked = Boolean(
        recommendation?.blocked &&
          (recommendation?.retryable ||
            recommendation?.blocked_code === "WINDOWS_CLIPBOARD_UNCHANGED")
      );
      const runRecommendedMode = recommendation?.key === "probe_clipboard"
        ? "refresh"
        : retryableBlocked
        ? "retry"
        : "run";
      const runPathState = {
        mode: runRecommendedMode,
        label: formatRunPathLabelFromMode(runRecommendedMode),
      };
      const runRecommendedControl = {
        action_key: recommendation.key,
        label: retryableBlocked
          ? "Run Recommended: Recheck Clipboard"
          : recommendation.blocked
          ? `Waiting: ${recommendation.label}`
          : `Run Recommended: ${recommendation.label}`,
        disabled:
          !recommendation.key || (Boolean(recommendation.blocked) && !retryableBlocked),
        title: recommendation?.key === "probe_clipboard"
          ? `${recommendation.reason} This button will refresh the Windows clipboard truth when you click it.`
          : retryableBlocked
            ? `${recommendation.blocked_reason || recommendation.reason} This button will recheck the current Windows clipboard when you click it.`
            : recommendation.blocked_reason || recommendation.reason,
        blocked: Boolean(recommendation.blocked),
        mode: runRecommendedMode,
        retryable: retryableBlocked,
        refreshable: recommendation?.key === "probe_clipboard",
      };
      const retryPath = runRecommendedMode === "refresh"
        ? `refresh-needed · ${runRecommendedControl.label}`
        : runRecommendedMode === "retry"
        ? `retryable · ${runRecommendedControl.label}`
        : !runRecommendedControl.blocked
        ? "No retry needed."
        : "not retryable yet · wait for new input or a different recommendation";
      const manualIngestHint = manualHintRecommendation?.blocked
        ? clipboardProbe?.state === "usable"
          ? "Clipboard probe found a usable Mac repo path. Run Recommended Action should now finish in one click."
          : status?.can_clear_mac_repo_input_candidate
          ? `${
              manualHintRecommendation.blocked_reason ||
              manualHintRecommendation.reason ||
              "Waiting for a fresh Mac repo reply in the clipboard."
            } If this is just stale loaded text, use Clear Input Candidate to reset it without touching repo paths.`
          : manualHintRecommendation.blocked_reason ||
            manualHintRecommendation.reason ||
            "Waiting for a fresh Mac repo reply in the clipboard."
        : manualHintRecommendation?.key === "probe_clipboard" ||
          clipboardProbeFreshness?.state === "stale"
        ? "Last clipboard probe is stale. Use Refresh Clipboard or Run Recommended Action to refresh it before trusting the current clipboard recommendation."
        : clipboardProbe?.state === "usable"
        ? "Clipboard probe found a usable Mac repo path. Run Recommended Action should now finish in one click."
        : clipboardProbe?.state === "unchanged_after_input_clear"
        ? "Clipboard probe says Windows still holds the same stale cleared input. Copy a fresh Mac reply first."
        : inputRisk?.state === "secret_like_text"
        ? "Current input includes redacted secret-looking text and no usable repo path. Copy a fresh Mac repo reply into Windows, then use Load Clipboard."
        : preview?.repo_path
        ? "Clipboard preview found a usable Mac repo path. Smart Apply is the fastest next step."
        : hasPastedText
        ? "Manual Mac Repo Report has text loaded. If it looks right, use Apply Pasted Report or Smart Apply."
        : status?.can_apply_report
        ? "A returned Mac repo report is ready. Apply Report is the fastest next step."
        : status?.state === "manual_preferred"
        ? "Best next step: copy the Mac repo reply into Windows, click Load Clipboard, then Smart Apply if the preview finds a path."
        : status?.state === "watching"
        ? "Watcher is still trying, but you can bypass it by copying a Mac repo reply into Windows and using Load Clipboard."
        : "Load Clipboard, paste a Mac reply, or wait for a returned Mac repo report.";
      const successPath = status?.can_apply_report
        ? "Click Apply Report now."
        : clipboardProbe?.state === "usable"
        ? "A usable Mac repo path is already in the clipboard flow. Click Run Recommended Action once."
        : preview?.repo_path
        ? "A usable Mac repo path is already loaded. Click Smart Apply or Run Recommended Action now."
        : hasPastedText
        ? "Review the loaded text, then click Smart Apply or Apply Pasted Report."
        : status?.can_clear_mac_repo_path || status?.state === "configured"
        ? "Only clear the Mac repo path if the checkout moved or was applied by mistake."
        : recommendation?.blocked_code === "WINDOWS_CLIPBOARD_UNCHANGED"
        ? "Copy a fresh Mac repo reply into Windows, then click Run Recommended Action once."
        : manualHintRecommendation?.key === "probe_clipboard"
        ? "Let the app refresh the Windows clipboard truth again, or click Run Recommended Action to refresh it now."
        : status?.state === "manual_preferred"
        ? "Copy a fresh Mac repo reply into Windows, then click Run Recommended Action once."
        : status?.state === "watching"
        ? "Wait for a returned Mac repo report, or bypass the watcher by copying a Mac reply into Windows."
        : "Load clipboard or wait for a returned Mac repo report.";
      const summary = recommendation?.blocked
        ? [
            "blocked",
            recommendation.label || "recommended action",
            recommendation.blocked_reason || recommendation.reason,
            ...(retryableBlocked ? [retryPath] : []),
            successPath,
          ]
            .filter(Boolean)
            .join(" · ")
        : recommendation?.key === "probe_clipboard"
        ? [
            "refresh",
            recommendation.label || "recommended action",
            recommendation?.reason ||
              "Refresh the clipboard truth before trusting the current recommendation.",
            successPath,
          ]
            .filter(Boolean)
            .join(" · ")
        : [
            "ready",
            recommendation?.label || "recommended action",
            recommendation?.reason || "No manual-ingest summary yet.",
            successPath,
          ]
            .filter(Boolean)
            .join(" · ");

        return {
          manual_ingest_hint: manualIngestHint,
          blocked_by: recommendation?.blocked
            ? [recommendation.blocked_code, recommendation.blocked_reason || recommendation.reason]
                .filter(Boolean)
                .join(" · ")
            : recommendation?.key === "probe_clipboard"
            ? [
                "STALE_CLIPBOARD_PROBE",
                recommendation?.reason ||
                  "The last clipboard probe is stale, so refresh the Windows clipboard truth before trusting it.",
              ]
                .filter(Boolean)
                .join(" · ")
            : "No active manual-ingest blocker.",
          next_action: recommendation?.blocked
            ? `${recommendation.label} blocked · ${recommendation.blocked_reason || recommendation.reason}`
            : `${recommendation.label} · ${recommendation.reason}`,
          recommended_action: recommendation,
          retry_path: retryPath,
          run_recommended: runRecommendedControl,
        success_path: successPath,
        summary,
        };
      })();
    const runRecommendedControl = manualSurface.run_recommended;
    const runPathMode = runRecommendedControl?.mode || "run";
    const runPathState = {
      mode: runPathMode,
      label: formatRunPathLabelFromMode(runPathMode),
    };
  const buttonMap = {
    apply_report: elements.applyMacRepoReportButton,
    clear_input_candidate: elements.clearMacRepoInputCandidateButton,
    clear_mac_repo_path: elements.clearMacRepoPathButton,
    smart_apply: elements.smartApplyMacRepoReportButton,
    apply_pasted_report: elements.applyMacRepoReportTextButton,
    apply_clipboard: elements.applyMacRepoReportClipboardButton,
    load_clipboard: elements.loadMacRepoReportClipboardButton,
    probe_clipboard: elements.probeMacRepoClipboardButton,
    send_nudge: elements.sendMacRepoNudgeButton,
  };

  Object.values(buttonMap).forEach((button) => {
    button?.classList.remove("recommended");
  });

  const recommendedButton = buttonMap[manualSurface.recommended_action?.key];
  recommendedButton?.classList.add("recommended");
  elements.manualNextAction.textContent = manualSurface.next_action;
  elements.manualBlockedBy.textContent = manualSurface.blocked_by;
  elements.runRecommendedActionButton.textContent = runRecommendedControl.label;
  elements.runRecommendedActionButton.disabled =
    state.sending || Boolean(runRecommendedControl.disabled);
  elements.runRecommendedActionButton.dataset.actionKey = runRecommendedControl.action_key || "";
  elements.runRecommendedActionButton.title = runRecommendedControl.title || "";
  elements.manualRunPathLabel.textContent = runPathState.label;
  elements.manualIngestHint.textContent = manualSurface.manual_ingest_hint;
  elements.manualSummary.textContent = manualSurface.summary;
  elements.manualRetryPath.textContent = manualSurface.retry_path;
  elements.manualSuccessPath.textContent = manualSurface.success_path;
  return manualSurface;
}

function renderManualSurface({
  status = state.laneConfigStatus,
  preview = state.laneConfigClipboardPreview,
  pastedText = elements.macRepoReportTextInput.value,
} = {}) {
  const manualSurface = updateManualActionRecommendation(
    status,
    preview,
    pastedText
  );
  elements.laneConfigAction.textContent = manualSurface?.action || "No lane-config action yet.";
  elements.macRepoRecommendedRun.textContent = formatLaneConfigRecommendedRun(
    manualSurface?.recommended_run || null,
    manualSurface?.recommended_run_state || null
  );
  elements.macRepoRecommendedRunState.textContent = formatLaneConfigRecommendedRunState(
    manualSurface?.recommended_run_state || null
  );
  updateLaneConfigControlStates();
}

function updateLaneConfigControlStates() {
  const isBusy = state.sending;
  const laneConfigStatus = state.laneConfigStatus || {};
  const hasPastedRepoText = Boolean(elements.macRepoReportTextInput.value.trim());

  elements.applyMacRepoReportButton.disabled = isBusy || !laneConfigStatus.can_apply_report;
  elements.clearMacRepoInputCandidateButton.disabled =
    isBusy || !laneConfigStatus.can_clear_mac_repo_input_candidate;
  elements.clearMacRepoPathButton.disabled = isBusy || !laneConfigStatus.can_clear_mac_repo_path;
  elements.applyMacRepoReportTextButton.disabled = isBusy || !hasPastedRepoText;
  if (isBusy) {
    elements.runRecommendedActionButton.disabled = true;
  }
}

function setComposerBusy(isBusy, label = "Idle") {
  state.sending = isBusy;
  elements.composerState.textContent = label;
  elements.routeButtons.forEach((button) => {
    button.disabled = isBusy;
  });
  elements.approveMacButton.disabled = isBusy;
  elements.applyMacRepoReportClipboardButton.disabled = isBusy;
  elements.loadMacRepoReportClipboardButton.disabled = isBusy;
  elements.probeMacRepoClipboardButton.disabled = isBusy;
  elements.clearMacRepoInputCandidateButton.disabled = isBusy;
  elements.pullApplyMacRepoReportButton.disabled = isBusy;
  elements.pullTaildropButton.disabled = isBusy;
  elements.sendMacRepoFallbackButton.disabled = isBusy;
  elements.sendMacRepoManualButton.disabled = isBusy;
  elements.sendMacRepoNudgeButton.disabled = isBusy;
  elements.requestMacRepoReportButton.disabled = isBusy;
  elements.runRecommendedActionButton.disabled = isBusy;
  elements.saveLaneConfigButton.disabled = isBusy;
  elements.smartApplyMacRepoReportButton.disabled = isBusy;
  elements.startMacRepoWatcherButton.disabled = isBusy;
  elements.sendMacFallbackButton.disabled = isBusy;
  elements.sendMacActionPackButton.disabled = isBusy;
  updateLaneConfigControlStates();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  return { response, data };
}

async function refreshStatus() {
  const { data } = await fetchJson("/api/status");
  state.status = data;
  elements.serverBadge.textContent = data.ok ? "Online" : "Offline";
  elements.serverBadge.className = data.ok ? "status-badge online" : "status-badge offline";
  elements.sessionCount.textContent = formatCount(data.session_count);
  elements.routeList.textContent = Array.isArray(data.available_routes)
    ? data.available_routes.join(", ")
    : "-";
  elements.latestSessionLabel.textContent = data.latest_session
    ? `${data.latest_session.operator_mode} · ${data.latest_session.mission_goal}`
    : "No saved session yet";
}

async function refreshLaneConfig() {
  const { data } = await fetchJson("/api/lane-config");
  const laneConfig = data.lane_config || null;
  const manualSurface = data.lane_config_manual_surface || null;
  state.laneConfig = laneConfig;
  hydrateMacRepoInputCandidate(data.mac_repo_input_candidate || null);
  state.laneConfigClipboardProbe = data.mac_repo_clipboard_probe || null;
  state.laneConfigClipboardProbeFreshness = data.mac_repo_clipboard_probe_freshness || null;
  state.laneConfigManualSurface = manualSurface;
  state.laneConfigStatus = data.lane_config_status || null;
  state.laneConfigInputRisk = data.mac_repo_input_risk || null;

  elements.laneConfigRepoLabel.textContent = laneConfig?.active_repo || "-";
  elements.laneConfigUpdatedAt.textContent = formatTime(laneConfig?.updated_at);
  elements.macRepoPathInput.value = laneConfig?.effective_repo_paths?.mac || "";
  elements.pcRepoPathInput.value = laneConfig?.effective_repo_paths?.pc || "";
  elements.macRepoPathHint.textContent = formatLaneConfigHint(
    laneConfig?.effective_repo_paths?.mac,
    laneConfig?.sources?.mac
  );
  elements.pcRepoPathHint.textContent = formatLaneConfigHint(
    laneConfig?.effective_repo_paths?.pc,
    laneConfig?.sources?.pc
  );
  elements.macRepoReport.textContent = formatMacRepoReport(data.mac_repo_report);
  elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(
    state.laneConfigClipboardPreview
  );
  elements.macRepoClipboardProbe.textContent = formatMacRepoClipboardProbe(
    state.laneConfigClipboardProbe,
    state.laneConfigClipboardProbeFreshness
  );
  renderAutoProbeFacts();
  elements.macRepoInputRisk.textContent = formatMacRepoInputRisk(state.laneConfigInputRisk);
  renderManualSurface({
    status: state.laneConfigStatus,
    preview: state.laneConfigClipboardPreview,
    pastedText: elements.macRepoReportTextInput.value,
  });
  elements.laneConfigStatus.textContent = formatLaneConfigStatus(data.lane_config_status);
  elements.macRepoRequestSend.textContent = formatMacRepoRequestSend(data.mac_repo_request_send);
  elements.macRepoNudgeSend.textContent = formatMacRepoNudgeSend(data.mac_repo_nudge_send);
  elements.macRepoFallbackSend.textContent = formatMacRepoFallbackSend(data.mac_repo_fallback_send);
  elements.macRepoManualSend.textContent = formatMacRepoManualSend(data.mac_repo_manual_send);
  elements.macRepoSmartApply.textContent = formatMacRepoSmartApply(
    data.mac_repo_smart_apply,
    data.mac_repo_smart_apply_state
  );
  elements.macRepoInputClear.textContent = formatMacRepoInputClear(data.mac_repo_input_clear);
  elements.macRepoClear.textContent = formatMacRepoClear(data.mac_repo_clear);
  elements.macRepoActionPack.textContent = formatMacRepoActionPack(data.mac_repo_action_pack);
  elements.macRepoActionBlock.textContent = formatMacRepoActionBlock(data.mac_repo_action_pack);
  elements.macRepoWatcher.textContent = formatMacRepoWatcher(
    data.mac_repo_watcher,
    data.mac_repo_watcher_summary
  );
  elements.macRepoWatcherOutput.textContent =
    Array.isArray(data.mac_repo_watcher_output_lines) && data.mac_repo_watcher_output_lines.length
      ? data.mac_repo_watcher_output_lines.join("\n")
      : "No Mac repo watcher output yet.";
}

async function maybeAutoProbeLaneConfig() {
  if (state.sending || state.laneConfigAutoProbing) {
    return false;
  }

  if (state.laneConfigStatus?.state !== "manual_preferred") {
    return false;
  }

  if (state.laneConfig?.effective_repo_paths?.mac || state.laneConfig?.configured_repo_paths?.mac) {
    return false;
  }

  if (state.laneConfigInputCandidate?.input_text_length) {
    return false;
  }

  const recommendedAction = getEffectiveLaneConfigRecommendedAction();
  const probeClipboardRecommended = recommendedAction?.key === "probe_clipboard";
  const blockedClipboardReloadRecommended =
    recommendedAction?.key === "load_clipboard" &&
    recommendedAction?.source === "clipboard_probe" &&
    recommendedAction?.blocked &&
    recommendedAction?.blocked_code === "WINDOWS_CLIPBOARD_UNCHANGED";

  if (!probeClipboardRecommended && !blockedClipboardReloadRecommended) {
    return false;
  }

  const now = Date.now();
  if (now - Number(state.laneConfigAutoProbeAt || 0) < AUTO_PROBE_MS) {
    return false;
  }

  state.laneConfigAutoProbing = true;
  state.laneConfigAutoProbeAt = now;
  renderAutoProbeFacts();

  try {
    const { response } = await fetchJson("/api/lane-config/probe-mac-repo-clipboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    state.laneConfigAutoProbeReceipt = {
      ok: response.ok,
      recorded_at: new Date().toISOString(),
      summary: getEffectiveLaneConfigRecommendedAction()?.reason || "Background clipboard probe ran.",
      probe_state: null,
      freshness_state: null,
    };

    if (response.ok) {
      await refreshLaneConfig();
      state.laneConfigAutoProbeReceipt = {
        ok: true,
        recorded_at: new Date().toISOString(),
        summary:
          state.laneConfigClipboardProbe?.summary || "Background clipboard probe completed.",
        probe_state: state.laneConfigClipboardProbe?.state || null,
        freshness_state: state.laneConfigClipboardProbeFreshness?.state || null,
      };
      renderAutoProbeFacts();
      return true;
    }
  } catch {
    // Keep background auto-probe silent; the normal poll loop will try again later.
    state.laneConfigAutoProbeReceipt = {
      ok: false,
      recorded_at: new Date().toISOString(),
      summary: "Background clipboard probe failed.",
      probe_state: null,
      freshness_state: null,
    };
    renderAutoProbeFacts();
  } finally {
    state.laneConfigAutoProbing = false;
    renderAutoProbeFacts();
  }

  return false;
}

async function runRecommendedManualAction() {
  setComposerBusy(true, "Running recommended lane-config action...");
  setFlash("");

  try {
    const body = {
      report_text: elements.macRepoReportTextInput.value.trim(),
    };
    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config/run-recommended-action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const runReceipt = data.lane_config_manual_surface?.recommended_run || null;
    const executedAction = runReceipt?.executed_action || null;
    const executedLabel = executedAction?.label || "Recommended Action";

    if (!response.ok) {
      if (data.code === "MAC_REPO_REPORT_TEXT_MISSING_PATH" && data.clipboard_text) {
        const clipboardText = String(data.clipboard_text || "");
        elements.macRepoReportTextInput.value = clipboardText;
        state.laneConfigClipboardPreview = {
          ...(data.mac_repo_report_preview || {}),
          clipboard_text_length: data.clipboard_text_length || clipboardText.length,
          source_label: "recommended action needs review",
        };
        elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(
          state.laneConfigClipboardPreview
        );
        renderManualSurface({
          preview: state.laneConfigClipboardPreview,
          pastedText: clipboardText,
        });
        setFlash(
          `${executedLabel} could not finish yet, so the clipboard text was loaded into Manual Mac Repo Report for review.`,
          "warn"
        );
        await refreshLaneConfig();
        return;
      }

      if (data.code === "MAC_REPO_REPORT_TEXT_MISSING_PATH" && data.report_text) {
        const reportText = String(data.report_text || "");
        state.laneConfigClipboardPreview = {
          ...(data.mac_repo_report_preview || {}),
          clipboard_text_length: data.report_text_length || reportText.length,
          source_label: "recommended action needs review",
        };
        elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(
          state.laneConfigClipboardPreview
        );
        renderManualSurface({
          preview: state.laneConfigClipboardPreview,
          pastedText: reportText,
        });
        setFlash(
          `${executedLabel} could not finish yet, but the pasted text is still loaded for review.`,
          "warn"
        );
        await refreshLaneConfig();
        return;
      }

      if (data.best_manual_source === "clipboard" && data.clipboard_text) {
        const clipboardText = String(data.clipboard_text || "");
        elements.macRepoReportTextInput.value = clipboardText;
        state.laneConfigClipboardPreview = {
          ...(data.clipboard_preview || {}),
          clipboard_text_length: data.clipboard_text_length || clipboardText.length,
          source_label: "recommended action needs review",
        };
        elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(
          state.laneConfigClipboardPreview
        );
        renderManualSurface({
          preview: state.laneConfigClipboardPreview,
          pastedText: clipboardText,
        });
        setFlash(
          `${executedLabel} could not finish yet, so the best clipboard candidate was loaded for review.`,
          "warn"
        );
        await refreshLaneConfig();
        await refreshRecovery();
        return;
      }

      if (data.best_manual_source === "pasted_text" && data.pasted_text) {
        const pastedText = String(data.pasted_text || "");
        elements.macRepoReportTextInput.value = pastedText;
        state.laneConfigClipboardPreview = null;
        elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
        renderManualSurface({
          preview: null,
          pastedText,
        });
        setFlash(
          `${executedLabel} could not finish yet, but the pasted text is still loaded for review.`,
          "warn"
        );
        await refreshLaneConfig();
        await refreshRecovery();
        return;
      }

      if (data.code === "WINDOWS_CLIPBOARD_UNCHANGED") {
        await refreshLaneConfig();
        setFlash(
          data.message ||
            "Windows clipboard still has the same stale Mac repo input. Copy a fresh Mac reply, then click Run Recommended: Recheck Clipboard again.",
          "info"
        );
        return;
      }

      const tone = response.status === 409 || response.status === 400 ? "warn" : "error";
      setFlash(data.message || `${executedLabel} failed.`, tone);
      await refreshLaneConfig();
      return;
    }

    if (data.session) {
      setCurrentSession(data.session);
    }

    if (executedAction?.key === "load_clipboard") {
      const clipboardText = String(data.clipboard_text || "");
      elements.macRepoReportTextInput.value = clipboardText;
      state.laneConfigClipboardPreview = {
        ...(data.mac_repo_report_preview || {}),
        clipboard_text_length: data.clipboard_text_length || clipboardText.length,
        source_label: data.has_usable_repo_path ? "usable Mac repo path found" : "clipboard loaded",
      };
      elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(
        state.laneConfigClipboardPreview
      );
    }

    await refreshLaneConfig();
    await refreshRecovery();
    await refreshSessions();

    if (executedAction?.key === "load_clipboard") {
      renderManualSurface({
        preview: state.laneConfigClipboardPreview,
        pastedText: elements.macRepoReportTextInput.value,
      });
      const previewSummary = String(data.mac_repo_report_preview?.summary || "").trim();
      setFlash(
        data.has_usable_repo_path
          ? "Loaded the Windows clipboard and found a usable Mac repo path."
          : `${previewSummary || "Loaded the Windows clipboard."} Review or edit it, then run the next recommended action.`,
        data.has_usable_repo_path ? "info" : "warn"
      );
      return;
    }

    if (executedAction?.key === "apply_pasted_report") {
      elements.macRepoReportTextInput.value = "";
      state.laneConfigClipboardPreview = null;
      elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
      renderManualSurface({
        preview: null,
        pastedText: "",
      });
    }

    if (executedAction?.key === "apply_clipboard") {
      state.laneConfigClipboardPreview = null;
      elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
      renderManualSurface({
        preview: null,
        pastedText: "",
      });
    }

    const successMessage =
      data.message ||
      {
        apply_report: "Applied the returned Mac repo report.",
        smart_apply: "Smart Apply completed using the recommended path.",
        apply_pasted_report: "Applied the pasted Mac repo report.",
        apply_clipboard: "Applied the Mac repo report from the Windows clipboard.",
        load_clipboard: "Loaded the Windows clipboard into Manual Mac Repo Report.",
        probe_clipboard: "Refreshed the Windows clipboard truth.",
        clear_mac_repo_path: "Cleared the Mac repo path.",
        send_nudge: "Sent the repo nudge to the Mac.",
      }[executedAction?.key] ||
      `${executedLabel} completed.`;
    setFlash(successMessage);
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function refreshRecovery() {
  const { data } = await fetchJson("/api/live-recovery");
  state.recovery = data;
  const summary = data.live_summary || {};
  const watcher = data.watcher || {};
  elements.recoveryStatusBadge.textContent = summary.status || "unavailable";
  elements.recoveryStatusBadge.className = `status-badge ${summary.tone || "offline"}`;
  elements.recoverySummary.textContent = summary.message || "No recovery summary yet.";
  elements.recoveryUpdatedAt.textContent = formatTime(summary.updated_at);
  elements.recoveryWatcher.textContent = watcher.summary || "No watcher metadata yet.";
  elements.recoveryProbeList.textContent = Array.isArray(summary.mac_probes) && summary.mac_probes.length
    ? summary.mac_probes.map(formatRecoveryProbe).join(" | ")
    : "-";
  elements.recoveryDiagnostics.textContent =
    Array.isArray(data.mac_diagnostics) && data.mac_diagnostics.length
      ? data.mac_diagnostics.map(formatRecoveryDiagnostic).join(" | ")
      : "-";
  elements.recoverySshBridge.textContent = formatRecoverySshBridge(summary.ssh_bridge);
  elements.recoverySshUser.textContent = formatRecoverySshUser(data.summary, data.mac_bridge_report);
  elements.recoveryRepair.textContent = formatRecoveryRepair(summary.ssh_repair);
  elements.recoveryAction.textContent = data.recovery_action || "No recovery action yet.";
  elements.taildropWatcher.textContent = formatTaildropWatcher(data.taildrop_watcher);
  elements.taildropInbox.textContent = formatTaildropFiles(data.taildrop_files);
  elements.taildropPull.textContent = formatTaildropPull(data.taildrop_pull);
  elements.macBridgeReport.textContent = formatMacBridgeReport(data.mac_bridge_report);
  elements.macActionPack.textContent = formatMacActionPack(data.mac_action_pack);
  elements.macActionSend.textContent = formatMacActionSend(data.mac_action_send);
  elements.macFallbackSend.textContent = formatMacFallbackSend(data.mac_fallback_send);
  elements.macActionBlock.textContent = formatMacActionBlock(data.mac_action_pack);
  elements.recoveryOutput.textContent =
    Array.isArray(data.watcher_output_lines) && data.watcher_output_lines.length
      ? data.watcher_output_lines.join("\n")
      : "No watcher output yet.";
}

async function refreshSessions() {
  const { data } = await fetchJson("/api/sessions?limit=8");
  state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  renderRecentSessions();
}

async function refreshCurrentSession({ quiet = false } = {}) {
  const sessionId = state.currentSession?.session_id;
  if (!sessionId) {
    return null;
  }

  try {
    const { response, data } = await fetchJson(
      `/api/session?session_id=${encodeURIComponent(sessionId)}`
    );
    if (!response.ok) {
      throw new Error(data.message || "Failed to load session.");
    }
    setCurrentSession(data.session);
    return data.session;
  } catch (error) {
    if (!quiet) {
      setFlash(error.message, "error");
    }
    clearCurrentSession(false);
    return null;
  }
}

function ensurePolling() {
  if (state.pollHandle) {
    window.clearInterval(state.pollHandle);
    state.pollHandle = null;
  }

  state.pollHandle = window.setInterval(() => {
    if (!state.sending) {
      refreshStatus().catch(() => {});
      refreshLaneConfig()
        .then(() => maybeAutoProbeLaneConfig())
        .catch(() => {});
      refreshRecovery().catch(() => {});
      refreshCurrentSession({ quiet: true }).catch(() => {});
    }
  }, POLL_MS);
}

function ensureAutoProbeTicker() {
  if (state.laneConfigUiTickHandle) {
    window.clearInterval(state.laneConfigUiTickHandle);
    state.laneConfigUiTickHandle = null;
  }

  state.laneConfigUiTickHandle = window.setInterval(() => {
    renderAutoProbeFacts();
  }, AUTO_PROBE_UI_TICK_MS);
}

function clearFeed(container, emptyMessage) {
  container.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = emptyMessage;
  container.appendChild(empty);
}

function renderFeed(container, events, emptyMessage) {
  container.innerHTML = "";

  if (!events.length) {
    clearFeed(container, emptyMessage);
    return;
  }

  for (const event of events) {
    const fragment = elements.feedItemTemplate.content.cloneNode(true);
    const root = fragment.querySelector(".feed-item");
    const type = fragment.querySelector(".feed-type");
    const meta = fragment.querySelector(".feed-meta");
    const content = fragment.querySelector(".feed-content");

    root.classList.add(`lane-${event.lane}`);
    if (event.verified) {
      root.classList.add("verified");
    }

    type.textContent = `${event.type} · ${event.routing_mode}`;
    meta.textContent = `${formatTime(event.timestamp)}${event.verified ? " · verified" : ""}`;
    content.textContent = event.content || "No content.";
    container.appendChild(fragment);
  }
}

function renderCompareCards(compareCards) {
  elements.compareCards.innerHTML = "";
  elements.compareCount.textContent = `${formatCount(compareCards.length)} cards`;

  if (!compareCards.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Compare cards appear here after compare routes complete.";
    elements.compareCards.appendChild(empty);
    return;
  }

  for (const card of [...compareCards].reverse()) {
    const fragment = elements.compareCardTemplate.content.cloneNode(true);
    fragment.querySelector(".compare-status").textContent = card.arbitration_status || "clear";
    fragment.querySelector(".compare-time").textContent = formatTime(card.created_at);
    fragment.querySelector(".compare-question").textContent = card.question || "Compare card";
    fragment.querySelector(".compare-mac").textContent = card.mac_answer_summary || "-";
    fragment.querySelector(".compare-pc").textContent = card.pc_answer_summary || "-";
    fragment.querySelector(".compare-overlap").textContent = card.overlap || "-";
    fragment.querySelector(".compare-disagreement").textContent = card.disagreement || "-";
    fragment.querySelector(".compare-next-step").textContent = card.recommended_next_step || "-";
    elements.compareCards.appendChild(fragment);
  }
}

function updateLanePanel(lane, laneState, heartbeat, laneEventCount) {
  const prefix = lane === "mac" ? "mac" : "pc";
  elements[`${prefix}StatusPill`].textContent = laneState?.status || "idle";
  elements[`${prefix}StatusPill`].className = `status-badge ${statusTone(laneState?.status)}`;
  elements[`${prefix}Authority`].textContent = laneState?.authority_badge || "-";
  elements[`${prefix}Latency`].textContent = formatLatencyHint(laneState?.latency_hint);
  elements[`${prefix}Heartbeat`].textContent = formatHeartbeat(heartbeat);
  elements[`${prefix}Task`].textContent = laneState?.current_task || "No task yet.";
  elements[`${prefix}Action`].textContent = laneState?.last_action || "No action yet.";
  elements[`${prefix}Verified`].textContent =
    laneState?.last_verified_result?.summary || "No verified result yet.";
  elements[`${prefix}Gap`].textContent =
    laneState?.latest_error_gap?.summary || "No active gaps.";
  elements[`${prefix}Repo`].textContent = formatRepoContext(laneState?.repo_context);
  elements[`${prefix}Count`].textContent = `${formatCount(laneEventCount)} events`;
}

function renderMission(session) {
  if (!session) {
    elements.missionStatusPill.textContent = "No Session";
    elements.missionStatusPill.className = "status-badge offline";
    elements.missionGoal.textContent = "No active mission yet.";
    elements.sessionIdPill.textContent = "Session: -";
    elements.modePill.textContent = "Mode: -";
    elements.arbitrationPill.textContent = "Arbitration: -";
    elements.riskPill.textContent = "Risk: -";
    elements.repoLabel.textContent = "-";
    elements.compareSummary.textContent = "-";
    elements.updatedAtLabel.textContent = "-";
    updateLanePanel("mac", null, null, 0);
    updateLanePanel("pc", null, null, 0);
    elements.sharedCount.textContent = "0 events";
    renderFeed(elements.sharedLaneFeed, [], "Shared lane events will appear here.");
    renderFeed(elements.macLaneFeed, [], "Mac lane events will appear here.");
    renderFeed(elements.pcLaneFeed, [], "PC lane events will appear here.");
    renderCompareCards([]);
    elements.macConfirmation.hidden = true;
    return;
  }

  const sharedEvents = session.transcript.filter((event) => event.lane === "shared");
  const macEvents = session.transcript.filter((event) => event.lane === "mac");
  const pcEvents = session.transcript.filter((event) => event.lane === "pc");
  const missionState = session.mission_state;

  elements.missionStatusPill.textContent = session.status;
  elements.missionStatusPill.className = `status-badge ${statusTone(session.status)}`;
  elements.missionGoal.textContent = missionState.mission_goal || "No mission goal recorded yet.";
  elements.sessionIdPill.textContent = `Session: ${session.session_id}`;
  elements.modePill.textContent = `Mode: ${missionState.operator_mode}`;
  elements.arbitrationPill.textContent = `Arbitration: ${missionState.arbitration_state}`;
  elements.riskPill.textContent = `Risk: ${formatCount(missionState.active_risk_count)}`;
  elements.repoLabel.textContent = session.derived?.repo_header?.label || missionState.active_repo;
  elements.compareSummary.textContent =
    missionState.current_compare_summary || "No compare summary yet.";
  elements.updatedAtLabel.textContent = formatTime(session.updated_at);

  updateLanePanel(
    "mac",
    session.mac_state,
    session.derived?.heartbeat_by_lane?.mac,
    macEvents.length
  );
  updateLanePanel(
    "pc",
    session.pc_state,
    session.derived?.heartbeat_by_lane?.pc,
    pcEvents.length
  );

  elements.sharedCount.textContent = `${formatCount(sharedEvents.length)} events`;
  renderFeed(elements.sharedLaneFeed, sharedEvents, "Shared lane events will appear here.");
  renderFeed(elements.macLaneFeed, macEvents, "Mac lane events will appear here.");
  renderFeed(elements.pcLaneFeed, pcEvents, "PC lane events will appear here.");
  renderCompareCards(session.compare_cards || []);

  const confirmationGate = session.mac_state?.confirmation_gate;
  const showConfirmation = confirmationGate?.status === "pending";
  elements.macConfirmation.hidden = !showConfirmation;
  if (showConfirmation) {
    elements.macConfirmationSummary.textContent = confirmationGate.summary;
  }
}

function renderRecentSessions() {
  elements.recentSessions.innerHTML = "";
  elements.recentCount.textContent = `${formatCount(state.sessions.length)}`;

  if (!state.sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No saved sessions yet.";
    elements.recentSessions.appendChild(empty);
    return;
  }

  for (const session of state.sessions) {
    const fragment = elements.recentSessionTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".session-chip");
    button.classList.toggle("active", session.session_id === state.currentSession?.session_id);
    fragment.querySelector(".session-chip-mode").textContent = `${session.operator_mode} · ${session.status}`;
    fragment.querySelector(".session-chip-text").textContent = session.mission_goal || "Untitled mission";
    button.addEventListener("click", () => {
      loadSessionById(session.session_id).catch((error) => setFlash(error.message, "error"));
    });
    elements.recentSessions.appendChild(fragment);
  }
}

function setCurrentSession(session) {
  state.currentSession = session;
  renderMission(session);
  ensurePolling();
  saveUiState();
  renderRecentSessions();
}

function clearCurrentSession(updateStorage = true) {
  state.currentSession = null;
  renderMission(null);
  ensurePolling();
  if (updateStorage) {
    saveUiState();
  }
  renderRecentSessions();
}

async function loadSessionById(sessionId) {
  const { response, data } = await fetchJson(
    `/api/session?session_id=${encodeURIComponent(sessionId)}`
  );
  if (!response.ok) {
    throw new Error(data.message || "Failed to load session.");
  }
  setCurrentSession(data.session);
  setFlash(`Loaded session ${sessionId}.`);
}

async function runRoute(routeKey, overrides = {}) {
  const route = ROUTES[routeKey];
  if (!route) {
    return;
  }

  const prompt = String(
    overrides.prompt !== undefined ? overrides.prompt : elements.promptInput.value
  ).trim();
  if (!prompt) {
    setFlash("Add a prompt before routing the mission.", "warn");
    elements.promptInput.focus();
    return;
  }

  const body = {
    prompt,
    shared_instruction: elements.sharedInstructionInput.value.trim(),
  };

  if (state.currentSession?.session_id) {
    body.session_id = state.currentSession.session_id;
  }

  if (overrides.operator_confirmation) {
    body.operator_confirmation = overrides.operator_confirmation;
  }

  setComposerBusy(true, `${route.label} running...`);
  setFlash("");

  try {
    const { response, data } = await fetchJson(route.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (data.session) {
      setCurrentSession(data.session);
    }

    if (!response.ok) {
      const tone = response.status === 409 ? "warn" : "error";
      setFlash(data.message || `${route.label} failed.`, tone);
      return;
    }

    elements.promptInput.value = "";
    saveUiState();
    setFlash(`${route.label} complete.`);
    await refreshStatus();
    await refreshSessions();
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function approveMacContinuation() {
  const confirmationGate = state.currentSession?.mac_state?.confirmation_gate;
  if (!confirmationGate || confirmationGate.status !== "pending") {
    setFlash("No pending Mac confirmation gate is active.", "warn");
    return;
  }

  await runRoute("send_mac", {
    operator_confirmation: {
      approve: true,
      gate_id: confirmationGate.id,
    },
    prompt: elements.promptInput.value.trim() || DEFAULT_APPROVAL_PROMPT,
  });
}

async function resendMacActionPack() {
  setComposerBusy(true, "Sending Mac action pack...");
  setFlash("");

  try {
    const { response, data } = await fetchJson("/api/recovery/send-mac-action-pack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      setFlash(data.message || "Failed to send the Mac action pack.", "error");
      return;
    }

    const deliveryCount = Array.isArray(data.result?.deliveries) ? data.result.deliveries.length : 0;
    setFlash(`Resent the Mac action pack via ${deliveryCount || 1} delivery path(s).`);
    await refreshRecovery();
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function sendMacFallbackBlock() {
  setComposerBusy(true, "Sending Mac fallback block...");
  setFlash("");

  try {
    const { response, data } = await fetchJson("/api/recovery/send-mac-fallback-block", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      setFlash(data.message || "Failed to send the direct Mac fallback block.", "error");
      return;
    }

    const deliveryCount = Array.isArray(data.result?.deliveries) ? data.result.deliveries.length : 0;
    setFlash(`Sent the direct Mac fallback block via ${deliveryCount || 1} delivery path(s).`);
    await refreshRecovery();
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function pullTaildropInbox() {
  setComposerBusy(true, "Pulling Taildrop...");
  setFlash("");

  try {
    const { response, data } = await fetchJson("/api/recovery/pull-taildrop-inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      setFlash(data.message || "Failed to pull the Taildrop inbox.", "error");
      return;
    }

    const moved = `${data.result?.moved ?? 0}/${data.result?.total_reported ?? 0}`;
    setFlash(`Taildrop pull complete (${moved} files).`);
    await refreshRecovery();
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function saveLaneConfig() {
  setComposerBusy(true, "Saving lane config...");
  setFlash("");

  try {
    const body = {
      mac_repo_path: elements.macRepoPathInput.value.trim(),
      pc_repo_path: elements.pcRepoPathInput.value.trim(),
    };

    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      setFlash(data.message || "Failed to save lane config.", "error");
      return;
    }

    state.laneConfig = data.lane_config || null;
    if (data.session) {
      setCurrentSession(data.session);
    }
    await refreshLaneConfig();
    await refreshSessions();
    setFlash("Lane config saved.");
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function requestMacRepoReport() {
  setComposerBusy(true, "Requesting Mac repo path...");
  setFlash("");

  try {
    const { response, data } = await fetchJson("/api/lane-config/request-mac-repo-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      setFlash(data.message || "Failed to request the Mac repo path.", "error");
      return;
    }

    const deliveryCount = Array.isArray(data.result?.deliveries) ? data.result.deliveries.length : 0;
    setFlash(`Sent the Mac repo-path request via ${deliveryCount || 1} delivery path(s).`);
    await refreshLaneConfig();
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function sendMacRepoNudge() {
  setComposerBusy(true, "Sending Mac repo nudge...");
  setFlash("");

  try {
    const { response, data } = await fetchJson("/api/lane-config/send-mac-repo-nudge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      setFlash(data.message || "Failed to send the Mac repo nudge.", "error");
      return;
    }

    const deliveryCount = Array.isArray(data.result?.deliveries) ? data.result.deliveries.length : 0;
    setFlash(`Sent the Mac repo nudge via ${deliveryCount || 1} delivery path(s).`);
    await refreshLaneConfig();
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function sendMacRepoFallbackBlock() {
  setComposerBusy(true, "Sending Mac repo fallback...");
  setFlash("");

  try {
    const { response, data } = await fetchJson("/api/lane-config/send-mac-repo-fallback-block", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      setFlash(data.message || "Failed to send the Mac repo fallback block.", "error");
      return;
    }

    const deliveryCount = Array.isArray(data.result?.deliveries) ? data.result.deliveries.length : 0;
    setFlash(`Sent the Mac repo fallback block via ${deliveryCount || 1} delivery path(s).`);
    await refreshLaneConfig();
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function sendMacRepoManualBlock() {
  setComposerBusy(true, "Sending Mac repo manual block...");
  setFlash("");

  try {
    const { response, data } = await fetchJson("/api/lane-config/send-mac-repo-manual-block", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      setFlash(data.message || "Failed to send the Mac repo manual block.", "error");
      return;
    }

    const deliveryCount = Array.isArray(data.result?.deliveries) ? data.result.deliveries.length : 0;
    setFlash(`Sent the Mac repo manual block via ${deliveryCount || 1} delivery path(s).`);
    await refreshLaneConfig();
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function loadMacRepoReportClipboard() {
  setComposerBusy(true, "Loading clipboard into manual report...");
  setFlash("");

  try {
    const { response, data } = await fetchJson("/api/lane-config/load-mac-repo-report-clipboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      state.laneConfigClipboardPreview = null;
      elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
      renderManualSurface({
        preview: null,
        pastedText: "",
      });
      const tone = response.status === 409 || response.status === 400 ? "warn" : "error";
      setFlash(data.message || "Failed to load the Windows clipboard into the manual Mac repo report.", tone);
      return;
    }

    const clipboardText = String(data.clipboard_text || "");
    elements.macRepoReportTextInput.value = clipboardText;
    state.laneConfigClipboardPreview = {
      ...(data.mac_repo_report_preview || {}),
      clipboard_text_length: data.clipboard_text_length || clipboardText.length,
      source_label: data.has_usable_repo_path ? "usable Mac repo path found" : "clipboard loaded",
    };
    elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(
      state.laneConfigClipboardPreview
    );
    renderManualSurface({
      preview: state.laneConfigClipboardPreview,
      pastedText: clipboardText,
    });

    if (data.has_usable_repo_path) {
      setFlash("Loaded the Windows clipboard into Manual Mac Repo Report and found a usable Mac repo path.");
    } else {
      const previewSummary = String(data.mac_repo_report_preview?.summary || "").trim();
      setFlash(
        `${previewSummary || "Loaded the Windows clipboard into Manual Mac Repo Report."} Review or edit it, then use Apply Pasted Report or Smart Apply.`,
        "warn"
      );
    }
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function probeMacRepoClipboard() {
  setComposerBusy(true, "Probing Windows clipboard...");
  setFlash("");

  try {
    const { response, data } = await fetchJson("/api/lane-config/probe-mac-repo-clipboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    state.laneConfigClipboardProbe = data.mac_repo_clipboard_probe || null;
    state.laneConfigClipboardProbeFreshness = data.mac_repo_clipboard_probe_freshness || null;
    elements.macRepoClipboardProbe.textContent = formatMacRepoClipboardProbe(
      state.laneConfigClipboardProbe,
      state.laneConfigClipboardProbeFreshness
    );
    renderManualSurface({
      preview: state.laneConfigClipboardPreview,
      pastedText: elements.macRepoReportTextInput.value,
    });
    await refreshLaneConfig();

    if (!response.ok) {
      const tone = response.status === 409 || response.status === 400 ? "warn" : "error";
      setFlash(data.message || "Failed to refresh the Windows clipboard truth.", tone);
      return;
    }

    setFlash(data.message || "Refreshed the Windows clipboard truth.");
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function clearMacRepoInputCandidate() {
  setComposerBusy(true, "Clearing loaded input candidate...");
  setFlash("");

  try {
    const body = {};
    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config/clear-mac-repo-input-candidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const tone = response.status === 409 || response.status === 400 ? "warn" : "error";
      setFlash(data.message || "Failed to clear the loaded Mac repo input candidate.", tone);
      await refreshLaneConfig();
      return;
    }

    state.laneConfigInputCandidate = null;
    state.laneConfigInputRisk = data.mac_repo_input_risk || null;
    state.laneConfigClipboardPreview = null;
    elements.macRepoReportTextInput.value = "";
    elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
    elements.macRepoInputRisk.textContent = formatMacRepoInputRisk(state.laneConfigInputRisk);
    renderManualSurface({
      preview: null,
      pastedText: "",
    });

    await refreshLaneConfig();
    setFlash(data.message || "Cleared the loaded Mac repo input candidate.");
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function startMacRepoWatcher() {
  setComposerBusy(true, "Starting Mac repo watcher...");
  setFlash("");

  try {
    const body = {};
    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config/start-mac-repo-report-watcher", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      setFlash(data.message || "Failed to start the Mac repo watcher.", "error");
      return;
    }

    setFlash("Started the Mac repo watcher.");
    await refreshLaneConfig();
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function applyMacRepoReport() {
  setComposerBusy(true, "Applying Mac repo report...");
  setFlash("");

  try {
    const body = {
      apply_mac_repo_report: true,
    };

    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const tone = response.status === 409 ? "warn" : "error";
      setFlash(data.message || "Failed to apply the Mac repo report.", tone);
      return;
    }

    if (data.session) {
      setCurrentSession(data.session);
    }

    await refreshLaneConfig();
    await refreshSessions();
    setFlash("Applied the Mac repo path from the latest report.");
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function smartApplyMacRepoReport() {
  setComposerBusy(true, "Smart-applying Mac repo report...");
  setFlash("");

  try {
    const body = {
      report_text: elements.macRepoReportTextInput.value.trim(),
    };

    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config/smart-apply-mac-repo-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 409 && data.best_manual_source === "clipboard" && data.clipboard_text) {
        const clipboardText = String(data.clipboard_text || "");
        elements.macRepoReportTextInput.value = clipboardText;
        state.laneConfigClipboardPreview = {
          ...(data.clipboard_preview || {}),
          clipboard_text_length: data.clipboard_text_length || clipboardText.length,
          source_label: "smart apply needs review",
        };
        elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(
          state.laneConfigClipboardPreview
        );
        renderManualSurface({
          preview: state.laneConfigClipboardPreview,
          pastedText: clipboardText,
        });
        setFlash(
          "Smart Apply could not finish yet, so the best clipboard candidate was loaded into Manual Mac Repo Report for review.",
          "warn"
        );
        await refreshLaneConfig();
        await refreshRecovery();
        return;
      }

      if (response.status === 409 && data.best_manual_source === "pasted_text" && data.pasted_text) {
        const pastedText = String(data.pasted_text || "");
        elements.macRepoReportTextInput.value = pastedText;
        state.laneConfigClipboardPreview = null;
        elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
        renderManualSurface({
          preview: null,
          pastedText,
        });
        setFlash(
          "Smart Apply could not finish yet, but your pasted text is still loaded in Manual Mac Repo Report for review.",
          "warn"
        );
        await refreshLaneConfig();
        await refreshRecovery();
        return;
      }

      const tone = response.status === 409 || response.status === 400 ? "warn" : "error";
      setFlash(data.message || "Smart Apply could not find a usable Mac repo path yet.", tone);
      await refreshLaneConfig();
      await refreshRecovery();
      return;
    }

    if (data.session) {
      setCurrentSession(data.session);
    }

    await refreshLaneConfig();
    await refreshRecovery();
    await refreshSessions();

    if (data.smart_apply_source === "pasted_text") {
      elements.macRepoReportTextInput.value = "";
      state.laneConfigClipboardPreview = null;
      elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
      renderManualSurface({
        preview: null,
        pastedText: "",
      });
    }

    const sourceLabel = {
      latest_report: "latest Mac repo report",
      clipboard: "Windows clipboard",
      pasted_text: "pasted Mac repo text",
    }[data.smart_apply_source] || "best available source";
    setFlash(`Smart Apply used the ${sourceLabel}.`);
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function clearMacRepoPath() {
  setComposerBusy(true, "Clearing Mac repo path...");
  setFlash("");

  try {
    const body = {
      mac_repo_path: "",
    };

    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const tone = response.status === 409 || response.status === 400 ? "warn" : "error";
      setFlash(data.message || "Failed to clear the Mac repo path.", tone);
      await refreshLaneConfig();
      return;
    }

    if (data.session) {
      setCurrentSession(data.session);
    }

    elements.macRepoPathInput.value = "";
    await refreshLaneConfig();
    await refreshSessions();
    setFlash("Cleared the Mac repo path and removed the manual lane-config report.");
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function applyMacRepoReportText() {
  setComposerBusy(true, "Applying pasted Mac repo report...");
  setFlash("");

  try {
    const body = {
      report_text: elements.macRepoReportTextInput.value.trim(),
    };

    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config/apply-mac-repo-report-text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (data.code === "MAC_REPO_REPORT_TEXT_MISSING_PATH" && data.report_text) {
        const reportText = String(data.report_text || "");
        state.laneConfigClipboardPreview = {
          ...(data.mac_repo_report_preview || {}),
          clipboard_text_length: data.report_text_length || reportText.length,
          source_label: "pasted text needs review",
        };
        elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(
          state.laneConfigClipboardPreview
        );
        renderManualSurface({
          preview: state.laneConfigClipboardPreview,
          pastedText: reportText,
        });
        setFlash(
          "Pasted text did not contain a directly usable Mac repo path, but it is still loaded for review.",
          "warn"
        );
        await refreshLaneConfig();
        return;
      }

      const tone = response.status === 409 || response.status === 400 ? "warn" : "error";
      setFlash(data.message || "Failed to apply the pasted Mac repo report.", tone);
      await refreshLaneConfig();
      return;
    }

    if (data.session) {
      setCurrentSession(data.session);
    }

    await refreshLaneConfig();
    await refreshSessions();
    elements.macRepoReportTextInput.value = "";
    state.laneConfigClipboardPreview = null;
    elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
    renderManualSurface({
      preview: null,
      pastedText: "",
    });
    setFlash("Applied the pasted Mac repo report.");
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function applyMacRepoReportClipboard() {
  setComposerBusy(true, "Applying Mac repo report from clipboard...");
  setFlash("");

  try {
    const body = {};
    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config/apply-mac-repo-report-clipboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (data.code === "MAC_REPO_REPORT_TEXT_MISSING_PATH" && data.clipboard_text) {
        const clipboardText = String(data.clipboard_text || "");
        elements.macRepoReportTextInput.value = clipboardText;
        state.laneConfigClipboardPreview = {
          ...(data.mac_repo_report_preview || {}),
          clipboard_text_length: data.clipboard_text_length || clipboardText.length,
          source_label: "clipboard apply needs review",
        };
        elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(
          state.laneConfigClipboardPreview
        );
        renderManualSurface({
          preview: state.laneConfigClipboardPreview,
          pastedText: clipboardText,
        });
        setFlash(
          "Clipboard text did not contain a directly usable Mac repo path, so it was loaded into Manual Mac Repo Report for review.",
          "warn"
        );
        await refreshLaneConfig();
        return;
      }

      const tone = response.status === 409 || response.status === 400 ? "warn" : "error";
      setFlash(data.message || "Failed to apply the Mac repo report from clipboard.", tone);
      await refreshLaneConfig();
      return;
    }

    if (data.session) {
      setCurrentSession(data.session);
    }

    await refreshLaneConfig();
    await refreshSessions();
    state.laneConfigClipboardPreview = null;
    elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
    renderManualSurface({
      preview: null,
      pastedText: "",
    });
    setFlash("Applied the Mac repo report from the Windows clipboard.");
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

async function pullAndApplyMacRepoReport() {
  setComposerBusy(true, "Pulling and applying Mac repo report...");
  setFlash("");

  try {
    const body = {};
    if (state.currentSession?.session_id) {
      body.session_id = state.currentSession.session_id;
    }

    const { response, data } = await fetchJson("/api/lane-config/pull-and-apply-mac-repo-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const tone = response.status === 409 ? "warn" : "error";
      setFlash(data.message || "Failed to pull and apply the Mac repo report.", tone);
      await refreshLaneConfig();
      await refreshRecovery();
      return;
    }

    if (data.session) {
      setCurrentSession(data.session);
    }

    await refreshLaneConfig();
    await refreshRecovery();
    await refreshSessions();
    setFlash("Pulled Taildrop and applied the Mac repo path.");
  } catch (error) {
    setFlash(error.message, "error");
  } finally {
    setComposerBusy(false, "Idle");
  }
}

function hydrateFromLocalState() {
  const saved = loadUiState();
  if (!saved) {
    return null;
  }

  if (typeof saved.prompt === "string") {
    elements.promptInput.value = saved.prompt;
  }

  if (typeof saved.sharedInstruction === "string") {
    elements.sharedInstructionInput.value = saved.sharedInstruction;
  }

  return saved.sessionId || null;
}

async function initialize() {
  const savedSessionId = hydrateFromLocalState();
  try {
    await refreshStatus();
    await refreshLaneConfig();
    await refreshRecovery();
    await refreshSessions();

    if (savedSessionId) {
      await loadSessionById(savedSessionId);
    } else if (state.status?.latest_session?.session_id) {
      await loadSessionById(state.status.latest_session.session_id);
    } else {
      renderMission(null);
    }

    ensurePolling();
    ensureAutoProbeTicker();
  } catch (error) {
    setFlash(error.message, "error");
    renderMission(null);
    ensurePolling();
    ensureAutoProbeTicker();
  }
}

elements.routeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    runRoute(button.dataset.route);
  });
});

elements.refreshButton.addEventListener("click", async () => {
  try {
    await refreshStatus();
    await refreshLaneConfig();
    await refreshRecovery();
    await refreshSessions();
    await refreshCurrentSession();
    setFlash("Mission-control state refreshed.");
  } catch (error) {
    setFlash(error.message, "error");
  }
});

elements.newSessionButton.addEventListener("click", () => {
  clearCurrentSession();
  setFlash("Starting a fresh mission on the next route action.");
});

elements.approveMacButton.addEventListener("click", () => {
  approveMacContinuation().catch((error) => setFlash(error.message, "error"));
});

elements.sendMacActionPackButton.addEventListener("click", () => {
  resendMacActionPack().catch((error) => setFlash(error.message, "error"));
});

elements.sendMacFallbackButton.addEventListener("click", () => {
  sendMacFallbackBlock().catch((error) => setFlash(error.message, "error"));
});

elements.pullTaildropButton.addEventListener("click", () => {
  pullTaildropInbox().catch((error) => setFlash(error.message, "error"));
});

elements.requestMacRepoReportButton.addEventListener("click", () => {
  requestMacRepoReport().catch((error) => setFlash(error.message, "error"));
});

elements.runRecommendedActionButton.addEventListener("click", () => {
  runRecommendedManualAction().catch((error) => setFlash(error.message, "error"));
});

elements.sendMacRepoNudgeButton.addEventListener("click", () => {
  sendMacRepoNudge().catch((error) => setFlash(error.message, "error"));
});

elements.sendMacRepoFallbackButton.addEventListener("click", () => {
  sendMacRepoFallbackBlock().catch((error) => setFlash(error.message, "error"));
});

elements.sendMacRepoManualButton.addEventListener("click", () => {
  sendMacRepoManualBlock().catch((error) => setFlash(error.message, "error"));
});

elements.loadMacRepoReportClipboardButton.addEventListener("click", () => {
  loadMacRepoReportClipboard().catch((error) => setFlash(error.message, "error"));
});

elements.clearMacRepoInputCandidateButton.addEventListener("click", () => {
  clearMacRepoInputCandidate().catch((error) => setFlash(error.message, "error"));
});

elements.startMacRepoWatcherButton.addEventListener("click", () => {
  startMacRepoWatcher().catch((error) => setFlash(error.message, "error"));
});

elements.pullApplyMacRepoReportButton.addEventListener("click", () => {
  pullAndApplyMacRepoReport().catch((error) => setFlash(error.message, "error"));
});

elements.smartApplyMacRepoReportButton.addEventListener("click", () => {
  smartApplyMacRepoReport().catch((error) => setFlash(error.message, "error"));
});

elements.clearMacRepoPathButton.addEventListener("click", () => {
  clearMacRepoPath().catch((error) => setFlash(error.message, "error"));
});

elements.applyMacRepoReportButton.addEventListener("click", () => {
  applyMacRepoReport().catch((error) => setFlash(error.message, "error"));
});

elements.applyMacRepoReportTextButton.addEventListener("click", () => {
  applyMacRepoReportText().catch((error) => setFlash(error.message, "error"));
});

elements.probeMacRepoClipboardButton.addEventListener("click", () => {
  probeMacRepoClipboard().catch((error) => setFlash(error.message, "error"));
});

elements.applyMacRepoReportClipboardButton.addEventListener("click", () => {
  applyMacRepoReportClipboard().catch((error) => setFlash(error.message, "error"));
});

elements.saveLaneConfigButton.addEventListener("click", () => {
  saveLaneConfig().catch((error) => setFlash(error.message, "error"));
});

elements.macRepoReportTextInput.addEventListener("input", () => {
  state.laneConfigClipboardPreview = null;
  elements.macRepoClipboardPreview.textContent = formatMacRepoClipboardPreview(null);
  renderManualSurface({
    preview: null,
    pastedText: elements.macRepoReportTextInput.value,
  });
});
elements.promptInput.addEventListener("change", saveUiState);
elements.sharedInstructionInput.addEventListener("change", saveUiState);

window.addEventListener("beforeunload", saveUiState);

initialize();

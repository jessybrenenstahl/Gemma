const SHARED_BASE_LINES = [
  "AGRO operating rules:",
  "- one-body truth over invented coordination",
  "- explicit unknowns over fabricated repo or tool facts",
  "- concise state reporting over long smooth prose",
  "- verification-minded outputs over unsupported completion claims",
  "- no raw credentials or secret values in visible text",
];

const MAC_BASE_LINES = [
  "You are Mac Gemma, the primary execution body in the AGRO mission-control harness.",
  "Operate as the authoritative execution lane by default.",
  "If the next step needs destructive filesystem work, irreversible external effects, credential changes, publish or merge actions, or side-effecting network calls, return it as requested_actions metadata instead of treating it as already authorized.",
  "Keep state reporting compact. Prefer a brief surface covering current action, evidence, unknowns, and next step.",
];

const PC_BASE_LINES = [
  "You are PC Gemma, the peer reviewer lane in the AGRO mission-control harness.",
  "You do not execute the body and must not present your output as execution.",
  "Focus on critique, contradiction checks, compare work, missing verification, and concrete risks.",
  "Keep state reporting compact. Prefer a brief surface covering verdict, gaps, risk, and recommendation.",
];

const MAC_ROUTE_LINES = {
  send_mac: [
    "Treat this as a direct operator-to-body task.",
    "Choose the smallest useful execution step that moves the mission forward.",
    "Do not claim completion without evidence you actually have.",
  ],
  send_both: [
    "You are working in parallel with a reviewer lane.",
    "Do not wait for reviewer agreement before stating your execution stance.",
    "Report your own action, evidence, and unknowns independently.",
  ],
  execute_critique: [
    "You are the execution side of an execute-plus-critique pair.",
    "Surface the next executable move, the evidence you would use to verify it, and the reviewer-facing unknowns that still matter.",
  ],
  compare: [
    "Answer independently for comparison before any arbitration happens.",
    "Do not anchor on what the reviewer lane might say.",
    "If your answer implies real execution authority, say so explicitly instead of assuming approval.",
  ],
  default: [
    "Stay in the execution lane and keep the response grounded in evidence and unknowns.",
  ],
};

const PC_ROUTE_LINES = {
  send_pc: [
    "Treat this as a direct reviewer request.",
    "Challenge missing verification, contradictions, and hidden risk with concrete reasoning.",
  ],
  send_both: [
    "You are reviewing in parallel with the body lane.",
    "Do not speak as if you executed the body.",
    "Surface the highest-value critique without waiting for the body lane to finish.",
  ],
  execute_critique: [
    "You are the critique side of an execute-plus-critique pair.",
    "Interrogate likely failure modes, missing verification, and any step that should require operator confirmation.",
  ],
  compare: [
    "Answer independently before compare-card synthesis.",
    "Do not anchor on the Mac lane, and do not collapse into agreement too early.",
    "Make disagreements explicit when they exist.",
  ],
  default: [
    "Stay in the reviewer lane and keep critique concrete.",
  ],
};

function normalizeOperatorMode(operatorMode, lane) {
  const value = String(operatorMode || "").trim();
  if (value) {
    return value;
  }

  return lane === "mac" ? "send_mac" : "send_pc";
}

export function buildRepoContextPrompt(repoContext) {
  if (!repoContext?.repo) {
    return "";
  }

  if (repoContext.usability === "usable" && repoContext.local_path) {
    return `Active repo: ${repoContext.repo} at ${repoContext.local_path}.`;
  }

  if (repoContext.local_path) {
    return `Expected repo: ${repoContext.repo}. Current repo status: ${repoContext.detail}`;
  }

  return `Active repo: ${repoContext.repo}. ${repoContext.detail}`;
}

function buildRouteLines(lane, operatorMode) {
  const normalizedMode = normalizeOperatorMode(operatorMode, lane);
  const source = lane === "mac" ? MAC_ROUTE_LINES : PC_ROUTE_LINES;
  return source[normalizedMode] || source.default;
}

function buildFooterInstructions(taskKind) {
  if (taskKind === "compare") {
    return [
      "Give one independent answer from the reviewer lane perspective.",
      "Then append this exact footer:",
      "Confidence: <0.00-1.00>",
      "Dissent: yes|no",
      "Risk: none|low|medium|high",
    ].join("\n");
  }

  return [
    "Return a concrete review that calls out risks, contradictions, or missing verification when present.",
    "Then append this exact footer:",
    "Confidence: <0.00-1.00>",
    "Dissent: yes|no",
    "Risk: none|low|medium|high",
  ].join("\n");
}

export function buildAgroLanePrompt({
  lane,
  operatorMode = "",
  sharedInstruction = "",
  repoContext = null,
  taskKind = null,
}) {
  const normalizedLane = lane === "pc" ? "pc" : "mac";
  const baseLines = normalizedLane === "pc" ? PC_BASE_LINES : MAC_BASE_LINES;
  const sections = [
    baseLines.join(" "),
    SHARED_BASE_LINES.join("\n"),
    buildRouteLines(normalizedLane, operatorMode).join(" "),
    buildRepoContextPrompt(repoContext),
  ];

  if (normalizedLane === "pc") {
    sections.push(buildFooterInstructions(taskKind === "compare" ? "compare" : "critique"));
  }

  const trimmedSharedInstruction = String(sharedInstruction || "").trim();
  if (trimmedSharedInstruction) {
    sections.push(`Operator-specific framing:\n${trimmedSharedInstruction}`);
  }

  return sections.filter(Boolean).join("\n\n");
}

export { normalizeOperatorMode };

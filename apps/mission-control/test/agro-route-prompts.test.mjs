import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAgroLanePrompt,
  buildRepoContextPrompt,
  normalizeOperatorMode,
} from "../server/index.mjs";

test("buildAgroLanePrompt shapes the Mac compare prompt with independent-answer and authority cues", () => {
  const prompt = buildAgroLanePrompt({
    lane: "mac",
    operatorMode: "compare",
    sharedInstruction: "Stay anchored on the canonical Gemma repo.",
    repoContext: {
      repo: "jessybrenenstahl/Gemma",
      usability: "usable",
      local_path: "C:\\Users\\jessy\\Documents\\GitHub\\Gemma",
    },
  });

  assert.match(prompt, /primary execution body/i);
  assert.match(prompt, /answer independently for comparison/i);
  assert.match(prompt, /requested_actions metadata/i);
  assert.match(prompt, /current action, evidence, unknowns, and next step/i);
  assert.match(prompt, /Active repo: jessybrenenstahl\/Gemma/i);
  assert.match(prompt, /Operator-specific framing:/i);
});

test("buildAgroLanePrompt shapes the PC execute-critique prompt with reviewer and footer rules", () => {
  const prompt = buildAgroLanePrompt({
    lane: "pc",
    operatorMode: "execute_critique",
    sharedInstruction: "Review the Mac lane for missing verification.",
    repoContext: {
      repo: "jessybrenenstahl/Gemma",
      usability: "unknown",
      detail: "Mac repo path is not configured yet.",
    },
    taskKind: "critique",
  });

  assert.match(prompt, /peer reviewer lane/i);
  assert.match(prompt, /critique side of an execute-plus-critique pair/i);
  assert.match(prompt, /should require operator confirmation/i);
  assert.match(prompt, /Confidence: <0\.00-1\.00>/i);
  assert.match(prompt, /Active repo: jessybrenenstahl\/Gemma\./i);
});

test("repo prompt and operator-mode normalization stay stable for missing values", () => {
  assert.equal(normalizeOperatorMode("", "mac"), "send_mac");
  assert.equal(normalizeOperatorMode("", "pc"), "send_pc");
  assert.equal(buildRepoContextPrompt(null), "");
});

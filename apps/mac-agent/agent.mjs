#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }

  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
  const options = {
    once: false,
    intervalMs: parseNumber(process.env.AGRO_MAC_AGENT_INTERVAL_MS, 2000),
    stateDir: expandHome(process.env.AGRO_MAC_AGENT_DIR || "~/.agent-mac"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--once") {
      options.once = true;
      continue;
    }

    if (arg === "--state-dir") {
      options.stateDir = expandHome(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--interval-ms") {
      options.intervalMs = parseNumber(argv[index + 1], options.intervalMs);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureFile(targetPath, defaultContents = "") {
  if (await pathExists(targetPath)) {
    return;
  }

  await fs.writeFile(targetPath, defaultContents, "utf8");
}

function sha256(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function buildConfig(cliOptions) {
  const stateDir = cliOptions.stateDir;

  return {
    once: cliOptions.once,
    intervalMs: cliOptions.intervalMs,
    stateDir,
    promptFile: expandHome(process.env.AGRO_MAC_AGENT_PROMPT_FILE || path.join(stateDir, "prompt.md")),
    resultFile: expandHome(process.env.AGRO_MAC_AGENT_RESULT_FILE || path.join(stateDir, "result.md")),
    statusFile: expandHome(process.env.AGRO_MAC_AGENT_STATUS_FILE || path.join(stateDir, "status.json")),
    responseFile: expandHome(process.env.AGRO_MAC_AGENT_RESPONSE_FILE || path.join(stateDir, "response.json")),
    endpoint: (process.env.AGRO_MAC_ENDPOINT || "http://127.0.0.1:1234").replace(/\/+$/, ""),
    model: process.env.AGRO_MAC_MODEL || "google/gemma-4-26b-a4b",
    apiKey: process.env.AGRO_MAC_API_KEY || process.env.OPENAI_API_KEY || "",
    temperature: parseNumber(process.env.AGRO_MAC_TEMPERATURE, 0.2),
    maxTokens: parseNumber(process.env.AGRO_MAC_MAX_TOKENS, 1200),
  };
}

async function ensureState(config) {
  await fs.mkdir(config.stateDir, { recursive: true });

  await ensureFile(
    config.promptFile,
    [
      "# Mac AGRO prompt",
      "",
      "Replace this file with the next task for the Mac agent.",
      "",
    ].join("\n"),
  );
  await ensureFile(config.resultFile, "");
  await ensureFile(config.responseFile, "{}\n");

  if (!(await pathExists(config.statusFile))) {
    await writeStatus(config, {
      state: "idle",
      message: "Waiting for prompt updates.",
      startedAt: nowIso(),
      updatedAt: nowIso(),
      model: config.model,
      endpoint: config.endpoint,
    });
  }
}

async function readStatus(config) {
  try {
    const raw = await fs.readFile(config.statusFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeStatus(config, patch) {
  const existing = (await readStatus(config)) || {};
  const next = {
    ...existing,
    ...patch,
    updatedAt: nowIso(),
    model: config.model,
    endpoint: config.endpoint,
  };

  await fs.writeFile(config.statusFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function extractTextContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item.text === "string") {
          return item.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const choice = payload?.choices?.[0];
  const message = choice?.message;

  const content = extractTextContent(message?.content);
  if (content) {
    return content;
  }

  if (typeof message?.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content.trim();
  }

  if (typeof choice?.text === "string" && choice.text.trim()) {
    return choice.text.trim();
  }

  return JSON.stringify(payload, null, 2);
}

async function runPrompt(prompt, config) {
  const url = `${config.endpoint}/v1/chat/completions`;
  const headers = {
    "content-type": "application/json",
  };

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    }),
  });

  const rawBody = await response.text();
  let payload;

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    throw new Error(`Model response was not valid JSON: ${error.message}\n${rawBody}`);
  }

  if (!response.ok) {
    const message = payload?.error?.message || rawBody || `HTTP ${response.status}`;
    throw new Error(`Model request failed: ${message}`);
  }

  return {
    payload,
    text: extractResponseText(payload),
  };
}

async function readPrompt(promptFile) {
  try {
    const prompt = await fs.readFile(promptFile, "utf8");
    return prompt.trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function processPrompt(prompt, config) {
  const promptHash = sha256(prompt);
  const startedAt = nowIso();

  await writeStatus(config, {
    state: "running",
    message: "Calling model.",
    startedAt,
    lastPromptHash: promptHash,
    lastPromptPreview: prompt.slice(0, 200),
  });

  const result = await runPrompt(prompt, config);

  await fs.writeFile(config.resultFile, `${result.text}\n`, "utf8");
  await fs.writeFile(config.responseFile, `${JSON.stringify(result.payload, null, 2)}\n`, "utf8");

  await writeStatus(config, {
    state: "success",
    message: "Completed prompt.",
    lastSuccessAt: nowIso(),
    lastPromptHash: promptHash,
    lastPromptPreview: prompt.slice(0, 200),
  });
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loop(config) {
  let lastHandledHash = (await readStatus(config))?.lastPromptHash || "";

  for (;;) {
    const prompt = await readPrompt(config.promptFile);

    if (!prompt) {
      if (config.once) {
        await writeStatus(config, {
          state: "idle",
          message: "Prompt file is empty.",
        });
        return;
      }

      await sleep(config.intervalMs);
      continue;
    }

    const promptHash = sha256(prompt);

    if (promptHash !== lastHandledHash) {
      try {
        await processPrompt(prompt, config);
        lastHandledHash = promptHash;
      } catch (error) {
        await writeStatus(config, {
          state: "error",
          message: error.message,
          lastErrorAt: nowIso(),
          lastPromptHash: promptHash,
          lastPromptPreview: prompt.slice(0, 200),
        });

        if (config.once) {
          throw error;
        }
      }
    }

    if (config.once) {
      return;
    }

    await sleep(config.intervalMs);
  }
}

async function main(config) {
  await ensureState(config);
  await loop(config);
}

const cliArgv = process.argv.slice(2);
let cliOptions;

try {
  cliOptions = parseArgs(cliArgv);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const config = buildConfig(cliOptions);

main(config).catch(async (error) => {

  try {
    await fs.mkdir(config.stateDir, { recursive: true });
    await writeStatus(config, {
      state: "error",
      message: error.message,
      lastErrorAt: nowIso(),
    });
  } catch {
    // Best effort only.
  }

  console.error(error.message);
  process.exitCode = 1;
});

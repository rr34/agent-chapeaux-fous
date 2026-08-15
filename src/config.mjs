import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(sourceDirectory, "..");

const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) {
  process.loadEnvFile(environmentFilename);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveFromRoot(value, fallback) {
  return path.resolve(repositoryRoot, value?.trim() || fallback);
}

export function loadConfig(environment = process.env) {
  const allowUnauthenticated = environment.SLAYER_ALLOW_UNAUTHENTICATED === "true";
  const accessToken = environment.SLAYER_ACCESS_TOKEN?.trim() || "";
  if (!allowUnauthenticated && !accessToken) {
    throw new Error(
      "SLAYER_ACCESS_TOKEN is required. Set SLAYER_ALLOW_UNAUTHENTICATED=true only for isolated local development.",
    );
  }

  const stateRoot = path.resolve(
    environment.XDG_STATE_HOME?.trim() || path.join(os.homedir(), ".local", "state"),
    "agent-slayer",
  );
  const codexWorkDirectory = environment.SLAYER_CODEX_WORKDIR?.trim()
    ? resolveFromRoot(environment.SLAYER_CODEX_WORKDIR)
    : path.join(stateRoot, "codex-workspace");
  if (codexWorkDirectory === repositoryRoot || codexWorkDirectory.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error("SLAYER_CODEX_WORKDIR must be outside the Agent Slayer repository so Codex cannot inherit AGENTS.md");
  }

  return {
    repositoryRoot,
    host: environment.SLAYER_HOST?.trim() || "127.0.0.1",
    port: positiveInteger(environment.SLAYER_PORT, 8787),
    accessToken,
    allowUnauthenticated,
    databasePath: resolveFromRoot(environment.SLAYER_DATABASE, "data/agent.sqlite"),
    mediaRoot: resolveFromRoot(environment.SLAYER_MEDIA_ROOT, "media"),
    profilePath: resolveFromRoot(environment.SLAYER_PROFILE, "config/profile.md"),
    systemPromptPath: path.join(repositoryRoot, "config/system-prompt.md"),
    mcpConfigPath: resolveFromRoot(environment.SLAYER_MCP_CONFIG, "config/mcp-servers.json"),
    publicRoot: path.join(repositoryRoot, "public"),
    modelTransport: environment.SLAYER_MODEL_TRANSPORT?.trim() || "codex-app-server",
    codexCommand: environment.SLAYER_CODEX_COMMAND?.trim() || "codex",
    codexRequiredVersion: environment.SLAYER_CODEX_REQUIRED_VERSION?.trim() || "0.148.0-alpha.9",
    codexHome: resolveFromRoot(environment.SLAYER_CODEX_HOME, "data/codex-home"),
    codexWorkDirectory,
    codexRequestTimeoutMs: positiveInteger(environment.SLAYER_CODEX_TIMEOUT_MS, 10 * 60 * 1000),
    model: environment.SLAYER_MODEL?.trim() || "gpt-5.6-terra",
    reasoningEffort: environment.SLAYER_REASONING_EFFORT?.trim() || "high",
    maxToolCalls: positiveInteger(environment.SLAYER_MAX_TOOL_CALLS, 24),
    maxUploadBytes: positiveInteger(environment.SLAYER_MAX_AUDIO_BYTES, 50 * 1024 * 1024),
    pythonExecutable: resolveFromRoot(environment.SLAYER_PYTHON, "voice/.venv/bin/python"),
    whisperWorkerPath: path.join(repositoryRoot, "voice/whisper_worker.py"),
    whisperTimeoutMs: positiveInteger(environment.SLAYER_WHISPER_TIMEOUT_MS, 10 * 60 * 1000),
  };
}

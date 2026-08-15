import fs from "node:fs";
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
    openAiApiKey: environment.OPENAI_API_KEY?.trim() || "",
    openAiBaseUrl: (environment.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: environment.SLAYER_MODEL?.trim() || "gpt-5.6-terra",
    reasoningEffort: environment.SLAYER_REASONING_EFFORT?.trim() || "none",
    maxToolRounds: positiveInteger(environment.SLAYER_MAX_TOOL_ROUNDS, 12),
    maxUploadBytes: positiveInteger(environment.SLAYER_MAX_AUDIO_BYTES, 50 * 1024 * 1024),
    pythonExecutable: resolveFromRoot(environment.SLAYER_PYTHON, "voice/.venv/bin/python"),
    whisperWorkerPath: path.join(repositoryRoot, "voice/whisper_worker.py"),
    whisperTimeoutMs: positiveInteger(environment.SLAYER_WHISPER_TIMEOUT_MS, 10 * 60 * 1000),
  };
}

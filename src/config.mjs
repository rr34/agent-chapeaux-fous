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
  const host = environment.SLAYER_HOST?.trim() || "127.0.0.1";
  const port = positiveInteger(environment.SLAYER_PORT, 8787);
  const defaultPublicHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const publicUrl = new URL(environment.SLAYER_PUBLIC_URL?.trim() || `http://${defaultPublicHost}:${port}`);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    !["http:", "https:"].includes(publicUrl.protocol)
    || (publicUrl.protocol === "http:" && !loopbackHosts.has(publicUrl.hostname))
    || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash
  ) {
    throw new Error("SLAYER_PUBLIC_URL must be an HTTPS origin (or an HTTP loopback origin) without credentials, a path, query parameters, or a fragment");
  }
  const codexWorkDirectory = environment.SLAYER_CODEX_WORKDIR?.trim()
    ? resolveFromRoot(environment.SLAYER_CODEX_WORKDIR)
    : path.join(stateRoot, "codex-workspace");
  if (codexWorkDirectory === repositoryRoot || codexWorkDirectory.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error("SLAYER_CODEX_WORKDIR must be outside the Agent Slayer repository so Codex cannot inherit AGENTS.md");
  }

  return {
    repositoryRoot,
    host,
    port,
    publicUrl: publicUrl.toString(),
    accessToken,
    allowUnauthenticated,
    databasePath: resolveFromRoot(environment.SLAYER_DATABASE, "data/agent.sqlite"),
    mediaRoot: resolveFromRoot(environment.SLAYER_MEDIA_ROOT, "media"),
    systemPromptPath: path.join(repositoryRoot, "config/system-prompt.md"),
    profileFactQuestionsPath: path.join(repositoryRoot, "config/profile-fact-questions.json"),
    mcpConfigPath: resolveFromRoot(environment.SLAYER_MCP_CONFIG, "config/mcp-servers.json"),
    jmapSessionUrl: environment.SLAYER_JMAP_SESSION_URL?.trim() || "",
    jmapAccessToken: environment.SLAYER_JMAP_ACCESS_TOKEN?.trim() || "",
    jmapAccountId: environment.SLAYER_JMAP_ACCOUNT_ID?.trim() || "",
    jmapRequired: environment.SLAYER_JMAP_REQUIRED === "true",
    jmapTimeoutMs: positiveInteger(environment.SLAYER_JMAP_TIMEOUT_MS, 15_000),
    schemaSemanticsPath: path.join(repositoryRoot, "db/schema-semantics.json"),
    mcpOAuthRoot: environment.SLAYER_MCP_OAUTH_ROOT?.trim()
      ? resolveFromRoot(environment.SLAYER_MCP_OAUTH_ROOT)
      : path.join(stateRoot, "mcp-oauth"),
    publicRoot: path.join(repositoryRoot, "public"),
    modelTransport: environment.SLAYER_MODEL_TRANSPORT?.trim() || "codex-app-server",
    codexCommand: environment.SLAYER_CODEX_COMMAND?.trim() || "codex",
    codexRequiredVersion: environment.SLAYER_CODEX_REQUIRED_VERSION?.trim() || "0.148.0-alpha.9",
    codexHome: resolveFromRoot(environment.SLAYER_CODEX_HOME, "data/codex-home"),
    codexWorkDirectory,
    codexRequestTimeoutMs: positiveInteger(environment.SLAYER_CODEX_TIMEOUT_MS, 10 * 60 * 1000),
    model: environment.SLAYER_MODEL?.trim() || "gpt-5.6-terra",
    reasoningEffort: environment.SLAYER_REASONING_EFFORT?.trim() || "high",
    maxToolCalls: positiveInteger(environment.SLAYER_MAX_TOOL_CALLS, 128),
    maxUploadBytes: positiveInteger(environment.SLAYER_MAX_AUDIO_BYTES, 50 * 1024 * 1024),
    maxTextAttachmentBytes: positiveInteger(
      environment.SLAYER_MAX_TEXT_ATTACHMENT_BYTES,
      10 * 1024 * 1024,
    ),
    maxAttachmentContextCharacters: positiveInteger(
      environment.SLAYER_MAX_ATTACHMENT_CONTEXT_CHARACTERS,
      64 * 1024,
    ),
    pythonExecutable: resolveFromRoot(environment.SLAYER_PYTHON, "voice/.venv/bin/python"),
    whisperWorkerPath: path.join(repositoryRoot, "voice/whisper_worker.py"),
    whisperTimeoutMs: positiveInteger(environment.SLAYER_WHISPER_TIMEOUT_MS, 10 * 60 * 1000),
  };
}

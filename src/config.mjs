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

function percentage(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : fallback;
}

function nonnegativeNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function selectedValue(value, allowed, fallback) {
  const selected = String(value ?? "").trim().toLowerCase();
  return allowed.includes(selected) ? selected : fallback;
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
    hatCatalogPath: path.join(repositoryRoot, "config/hats.json"),
    capabilityInstructionsPath: path.join(repositoryRoot, "config/instructions"),
    profileFactQuestionsPath: path.join(repositoryRoot, "config/profile-fact-questions.json"),
    mcpConfigPath: resolveFromRoot(environment.SLAYER_MCP_CONFIG, "config/mcp-servers.json"),
    mcpUserConfigPath: environment.SLAYER_MCP_USER_CONFIG?.trim()
      ? resolveFromRoot(environment.SLAYER_MCP_USER_CONFIG)
      : path.join(stateRoot, "mcp-connections.json"),
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
    openAIApiKey: environment.OPENAI_API_KEY?.trim() || "",
    openAIBaseUrl: environment.SLAYER_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
    openAIRequestTimeoutMs: positiveInteger(environment.SLAYER_OPENAI_TIMEOUT_MS, 10 * 60 * 1000),
    openAIContextWindowTokens: positiveInteger(environment.SLAYER_OPENAI_CONTEXT_WINDOW_TOKENS, 1_050_000),
    openAIImageDetail: selectedValue(
      environment.SLAYER_OPENAI_IMAGE_DETAIL,
      ["auto", "low", "high", "original"],
      "original",
    ),
    aiPricing: {
      inputPerMillion: nonnegativeNumber(environment.SLAYER_AI_INPUT_COST_PER_MILLION, 2),
      cachedInputPerMillion: nonnegativeNumber(environment.SLAYER_AI_CACHED_INPUT_COST_PER_MILLION, 0.2),
      cacheWritePerMillion: nonnegativeNumber(environment.SLAYER_AI_CACHE_WRITE_COST_PER_MILLION, 2.5),
      outputPerMillion: nonnegativeNumber(environment.SLAYER_AI_OUTPUT_COST_PER_MILLION, 12),
    },
    model: environment.SLAYER_MODEL?.trim() || "gpt-5.6-terra",
    reasoningEffort: environment.SLAYER_REASONING_EFFORT?.trim() || "high",
    orientationReasoningEffort: environment.SLAYER_ORIENTATION_REASONING_EFFORT?.trim() || "medium",
    auditReasoningEffort: environment.SLAYER_AUDIT_REASONING_EFFORT?.trim() || "low",
    repairReasoningEffort: environment.SLAYER_REPAIR_REASONING_EFFORT?.trim()
      || environment.SLAYER_REASONING_EFFORT?.trim()
      || "high",
    turnWorkflowEnabled: environment.SLAYER_TURN_WORKFLOW_ENABLED !== "false",
    maxToolCalls: positiveInteger(environment.SLAYER_MAX_TOOL_CALLS, 128),
    contextRolloverPercent: percentage(environment.SLAYER_CONTEXT_ROLLOVER_PERCENT, 65),
    conversationCheckpointCharacters: positiveInteger(
      environment.SLAYER_CONVERSATION_CHECKPOINT_CHARACTERS,
      48 * 1024,
    ),
    maxInlineToolResultCharacters: positiveInteger(
      environment.SLAYER_MAX_INLINE_TOOL_RESULT_CHARACTERS,
      32 * 1024,
    ),
    maxUploadBytes: positiveInteger(environment.SLAYER_MAX_AUDIO_BYTES, 50 * 1024 * 1024),
    maxTextAttachmentBytes: positiveInteger(
      environment.SLAYER_MAX_TEXT_ATTACHMENT_BYTES,
      10 * 1024 * 1024,
    ),
    maxRequestAttachmentBytes: positiveInteger(
      environment.SLAYER_MAX_REQUEST_ATTACHMENT_BYTES,
      50 * 1024 * 1024,
    ),
    maxAttachmentContextCharacters: positiveInteger(
      environment.SLAYER_MAX_ATTACHMENT_CONTEXT_CHARACTERS,
      64 * 1024,
    ),
    webPageTimeoutMs: positiveInteger(environment.SLAYER_WEB_PAGE_TIMEOUT_MS, 15_000),
    webPageMaximumBytes: positiveInteger(environment.SLAYER_WEB_PAGE_MAX_BYTES, 2 * 1024 * 1024),
    pythonExecutable: resolveFromRoot(environment.SLAYER_PYTHON, "voice/.venv/bin/python"),
    whisperWorkerPath: path.join(repositoryRoot, "voice/whisper_worker.py"),
    whisperTimeoutMs: positiveInteger(environment.SLAYER_WHISPER_TIMEOUT_MS, 10 * 60 * 1000),
    videoOutputRoot: resolveFromRoot(environment.SLAYER_VIDEO_OUTPUT_ROOT, "media/videos"),
    videoModel: environment.SLAYER_VIDEO_MODEL?.trim() || "gpt-5.6-sol",
    videoReasoningEffort: environment.SLAYER_VIDEO_REASONING_EFFORT?.trim() || "high",
    remotionBrowserExecutable: environment.REMOTION_BROWSER_EXECUTABLE?.trim() || null,
    ttsModel: environment.SLAYER_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
    ttsAgentVoice: environment.SLAYER_TTS_AGENT_VOICE?.trim()
      || environment.SLAYER_TTS_VOICE?.trim() || "ash",
    ttsUserVoice: environment.SLAYER_TTS_USER_VOICE?.trim() || "shimmer",
    ttsAgentInstructions: environment.SLAYER_TTS_AGENT_INSTRUCTIONS?.trim()
      || environment.SLAYER_TTS_INSTRUCTIONS?.trim()
      || "Be a quick-witted American guy talking casually to a friend. Speak fast, animatedly, and mischievously, with loose natural rhythm and real reactions to the meaning. Never sound like an announcer, presenter, tutorial, corporate demo, audiobook, or polished sales pitch. Slightly goofy is welcome. Pronounce Chapeaux Fou in French as shah-POH FOO, with no final S sound. Speak the supplied words verbatim.",
    ttsUserInstructions: environment.SLAYER_TTS_USER_INSTRUCTIONS?.trim()
      || "Be a quick-witted Parisian woman speaking English with an unmistakably strong native French accent in every sentence. Use French R sounds, rounded vowels, and French rhythm while staying easy to understand. Speak fast, animatedly, warmly, and a little cheekily, like casual banter with a friend. Never sound like an announcer, presenter, tutorial, corporate demo, audiobook, or polished sales pitch. Pronounce Chapeaux Fou as shah-POH FOO, with no final S sound. Speak the supplied words verbatim.",
    ttsTimeoutMs: positiveInteger(environment.SLAYER_TTS_TIMEOUT_MS, 2 * 60 * 1000),
  };
}

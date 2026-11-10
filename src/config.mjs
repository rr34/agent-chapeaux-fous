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

function selectedValue(value, allowed, fallback) {
  const selected = String(value ?? "").trim().toLowerCase();
  return allowed.includes(selected) ? selected : fallback;
}

function resolveFromRoot(value, fallback) {
  return path.resolve(repositoryRoot, value?.trim() || fallback);
}

function databaseConfiguration(environment, prefix = "MARIADB") {
  const engine = environment[`${prefix}_ENGINE`]?.trim().toLowerCase();
  const database = environment[`${prefix}_NAME`]?.trim();
  const user = environment[`${prefix}_USER`]?.trim();
  const password = environment[`${prefix}_PASSWORD`];
  if (engine !== "mariadb") {
    throw new Error(`${prefix}_ENGINE must be mariadb`);
  }
  if (!database || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) {
    throw new Error(`${prefix}_NAME must be a valid MariaDB database name`);
  }
  if (!user || password == null) {
    throw new Error(`${prefix}_USER and ${prefix}_PASSWORD are required`);
  }
  return {
    engine,
    connection: {
      host: environment[`${prefix}_HOST`]?.trim() || "localhost",
      port: positiveInteger(environment[`${prefix}_PORT`], 3306),
      socketPath: environment[`${prefix}_SOCKET`]?.trim() || undefined,
      user,
      password,
      database,
    },
  };
}

export function loadIdentityDatabaseTarget(environment = process.env) {
  return databaseConfiguration(environment, "TIMEV3_IDENTITY_MARIADB");
}

function publicOrigin(value, fallback, label) {
  const origin = new URL(value?.trim() || fallback);
  const loopback = origin.hostname === "localhost"
    || origin.hostname.endsWith(".localhost")
    || origin.hostname === "127.0.0.1"
    || origin.hostname === "[::1]";
  if (
    !["http:", "https:"].includes(origin.protocol)
    || (origin.protocol === "http:" && !loopback)
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
  ) {
    throw new Error(`${label} must be an HTTPS origin (or an HTTP loopback origin) without credentials, a path, query parameters, or a fragment`);
  }
  return origin;
}

export function loadConfig(environment = process.env) {
  const authEnabled = environment.TIMEV3_AUTH_ENABLED === "true";
  const allowUnauthenticated = environment.SLAYER_ALLOW_UNAUTHENTICATED === "true";
  const accessToken = environment.SLAYER_ACCESS_TOKEN?.trim() || "";
  if (!authEnabled && !allowUnauthenticated && !accessToken) {
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
  const publicUrl = publicOrigin(
    environment.SLAYER_PUBLIC_URL,
    `http://${defaultPublicHost}:${port}`,
    "SLAYER_PUBLIC_URL",
  );
  const authPublicUrl = publicOrigin(
    environment.TIMEV3_AUTH_PUBLIC_URL,
    `http://auth.localhost:${port}`,
    "TIMEV3_AUTH_PUBLIC_URL",
  );
  const databaseTarget = databaseConfiguration(environment);
  const identityDatabaseConfigured = authEnabled || Boolean(
    environment.TIMEV3_IDENTITY_MARIADB_ENGINE
    || environment.TIMEV3_IDENTITY_MARIADB_NAME
    || environment.TIMEV3_IDENTITY_MARIADB_USER,
  );
  const identityDatabaseTarget = identityDatabaseConfigured
    ? loadIdentityDatabaseTarget(environment)
    : null;
  const authChallengeSecret = environment.TIMEV3_AUTH_CHALLENGE_SECRET || "";
  if (authEnabled && Buffer.byteLength(authChallengeSecret) < 32) {
    throw new Error("TIMEV3_AUTH_CHALLENGE_SECRET must contain at least 32 bytes when Time v3 Auth is enabled");
  }
  return {
    repositoryRoot,
    host,
    port,
    publicUrl: publicUrl.toString(),
    authEnabled,
    authPublicUrl: authPublicUrl.toString(),
    authSessionDays: positiveInteger(environment.TIMEV3_AUTH_SESSION_DAYS, 30),
    authRegistrationEnabled: environment.TIMEV3_AUTH_REGISTRATION_ENABLED !== "false",
    authChallengeSecret,
    authEmailFrom: environment.TIMEV3_AUTH_EMAIL_FROM?.trim() || environment.SMTP_FROM?.trim() || "",
    smtpUrl: environment.SMTP_URL?.trim() || "",
    smtpHost: environment.SMTP_HOST?.trim() || "",
    smtpPort: positiveInteger(environment.SMTP_PORT, 587),
    smtpSecure: environment.SMTP_SECURE === "true",
    smtpUser: environment.SMTP_USER?.trim() || "",
    smtpPassword: environment.SMTP_PASS || "",
    weeklyAiTokenLimit: positiveInteger(environment.SLAYER_WEEKLY_AI_TOKEN_LIMIT, 19_100_000),
    stripeSecretKey: environment.STRIPE_SECRET_KEY?.trim() || "",
    stripeConnectClientId: environment.STRIPE_CONNECT_CLIENT_ID?.trim() || "",
    stripeConnectStateSecret: environment.STRIPE_CONNECT_STATE_SECRET?.trim() || "",
    stripeConnectWebhookSecret: environment.STRIPE_CONNECT_WEBHOOK_SECRET?.trim() || "",
    accessToken,
    allowUnauthenticated,
    databaseTarget,
    identityDatabaseTarget,
    mediaRoot: resolveFromRoot(environment.SLAYER_MEDIA_ROOT, "media"),
    systemPromptPath: path.join(repositoryRoot, "config/system-prompt.md"),
    hatCatalogPath: path.join(repositoryRoot, "config/hats.json"),
    capabilityPackagesPath: path.join(repositoryRoot, "config/capabilities"),
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
    openAIPdfDetail: selectedValue(
      environment.SLAYER_OPENAI_PDF_DETAIL,
      ["auto", "low", "high"],
      "high",
    ),
    model: environment.SLAYER_MODEL?.trim() || "gpt-5.6-terra",
    reasoningEffort: environment.SLAYER_REASONING_EFFORT?.trim() || "high",
    orientationReasoningEffort: environment.SLAYER_ORIENTATION_REASONING_EFFORT?.trim() || "medium",
    toolSelectionReasoningEffort: environment.SLAYER_TOOL_SELECTION_REASONING_EFFORT?.trim() || "medium",
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
    pdfBrowserExecutable: environment.SLAYER_PDF_BROWSER_EXECUTABLE?.trim() || null,
    ttsModel: environment.SLAYER_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
    ttsAgentVoice: environment.SLAYER_TTS_AGENT_VOICE?.trim()
      || environment.SLAYER_TTS_VOICE?.trim() || "verse",
    ttsMusicNarrationVoice: environment.SLAYER_MUSIC_NARRATION_VOICE?.trim() || "cedar",
    ttsUserVoice: environment.SLAYER_TTS_USER_VOICE?.trim() || "shimmer",
    ttsAgentInstructions: environment.SLAYER_TTS_AGENT_INSTRUCTIONS?.trim()
      || environment.SLAYER_TTS_INSTRUCTIONS?.trim()
      || "Be an energetic American guy bantering with a friend. Talk extremely fast, around 1.3 times normal conversational speed, with almost no dead air, dramatic pauses, or slow emphasis. Stay animated, mischievous, loose, and intelligible. Never sound like an announcer, presenter, tutorial, corporate demo, audiobook, or polished sales pitch. Speak the supplied words verbatim.",
    ttsUserInstructions: environment.SLAYER_TTS_USER_INSTRUCTIONS?.trim()
      || "Be a quick-witted Parisian woman speaking English with an unmistakably strong native French accent in every sentence. Use French R sounds, rounded vowels, and French rhythm while staying easy to understand. Talk extremely fast, around 1.3 times normal conversational speed, with almost no dead air, dramatic pauses, or slow emphasis. Stay animated, warm, cheeky, and intelligible. Never sound like an announcer, presenter, tutorial, corporate demo, audiobook, or polished sales pitch. Speak the supplied words verbatim.",
    ttsTimeoutMs: positiveInteger(environment.SLAYER_TTS_TIMEOUT_MS, 2 * 60 * 1000),
  };
}

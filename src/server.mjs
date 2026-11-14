import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { createStaticHandler } from "./static-files.mjs";
import { createGoogleMessagesExtensionArchive } from "./extension-archive.mjs";
import { createFileArtifactSource } from "./artifact-source.mjs";
import { ContextBuilder } from "./context.mjs";
import { SlayerDatabase } from "./database.mjs";
import { Ledger } from "./ledger.mjs";
import { JmapClient } from "./jmap-client.mjs";
import { DailyPaperService } from "./daily-paper.mjs";
import { DailyPaperWeatherService } from "./daily-paper-weather.mjs";
import { TodoPdfService } from "./todo-pdf.mjs";
import { PrintableReportService } from "./printable-report.mjs";
import { createCalendarInviteDraft } from "./calendar-invite-draft.mjs";
import { OrganizerStore } from "./organizer-store.mjs";
import { CorrespondenceSyncService } from "./correspondence-sync.mjs";
import { MessagesWebSyncService } from "./messages-web-sync.mjs";
import { MessagesWebSyncRequests } from "./messages-web-sync-requests.mjs";
import { CorrespondenceService } from "./correspondence.mjs";
import { ObjectNetworkService } from "./object-network.mjs";
import { PaymentService } from "./payments.mjs";
import { normalizeSelectedObjectCandidates, registerNativeObjectContextView } from "./native-object-search.mjs";
import { createModelTransport } from "./model-transport.mjs";
import { assertNativeCapabilityRegistrations, registerNativeCapabilities, validateNativeCapabilityPackages } from "./native-capabilities.mjs";
import { assertNativeToolDescriptions } from "./native-tool-descriptions.mjs";
import { loadHatCatalog } from "./hat-catalog.mjs";
import { RequestQueue } from "./queue.mjs";
import { capabilityForTool, RequestCompiler } from "./request-compiler.mjs";
import { createNativeSearchCoordinator, registerEmailSearchProvider } from "./search/native-search.mjs";
import { receiveRequestAttachment, safeMediaPath } from "./request-attachments.mjs";
import { musicLibraryEntry, parseMusicMetadataDescription } from "./music-metadata.mjs";
import { normalizeRunLimits } from "./run-limits.mjs";
import { SlayerRuntime } from "./runtime.mjs";
import { runtimeIdentity } from "./runtime-identity.mjs";
import { WhisperTranscriber } from "./transcriber.mjs";
import { OpenAISpeechService } from "./openai-speech.mjs";
import { MusicNarrationService } from "./music-narration.mjs";
import { PreparedConcertService } from "./prepared-concert.mjs";
import { MusicDurationResolver } from "./music-duration.mjs";
import { VideoRenderWorker } from "./video-render-worker.mjs";
import { registerDailyPaperTools } from "./tools/daily-paper-tools.mjs";
import { registerPrintableReportTools } from "./tools/printable-report-tools.mjs";
import { registerDatabaseTools } from "./tools/database-tools.mjs";
import { registerFileTools } from "./tools/file-tools.mjs";
import { registerJmapEmailTools } from "./tools/jmap-email-tools.mjs";
import { registerEmailReceiptTools } from "./tools/email-receipts.mjs";
import { registerCalendarTools } from "./tools/calendar-tools.mjs";
import { registerContactTools } from "./tools/contact-tools.mjs";
import { JournalScheduleService } from "./journal-schedule.mjs";
import { registerJournalScheduleTools } from "./tools/journal-schedule-tools.mjs";
import { registerCorrespondenceTools } from "./tools/correspondence-tools.mjs";
import { registerJournalTools } from "./tools/journal-tools.mjs";
import { McpToolManager } from "./tools/mcp-tools.mjs";
import { ProfileFacts } from "./profile-facts.mjs";
import { loadProfileFactQuestions } from "./profile-fact-questions.mjs";
import { ToolRegistry } from "./tools/registry.mjs";
import { registerProfileFactTools } from "./tools/profile-fact-tools.mjs";
import { registerSearchTools } from "./tools/search-tools.mjs";
import { registerTodoTools } from "./tools/todo-tools.mjs";
import { registerPaymentTools } from "./tools/payment-tools.mjs";
import { registerWebPageTools } from "./tools/web-page-tools.mjs";
import { registerAgentSelfTools } from "./tools/agent-self-tools.mjs";
import { registerVideoScriptTools } from "./tools/video-script-tools.mjs";
import { registerObjectNetworkTools } from "./tools/object-network-tools.mjs";
import { registerThingsTools } from "./tools/things-tools.mjs";
import { VideoScripts } from "./video-scripts.mjs";
import { VideoContent } from "./video-content.mjs";
import { VideoContentReconciler } from "./video-content-reconcile.mjs";
import { PhysicalItems } from "./physical-items.mjs";
import { WebPageClient } from "./web-page-client.mjs";
import { timeZoneFromProfileFacts } from "./temporal-consistency.mjs";
import { IdentityStore } from "./identity-store.mjs";
import { AuthEmailService } from "./auth-email.mjs";
import { assertPersonIsolationReady } from "./person-isolation.mjs";
import { configureDefaultPersonId, currentPersonId, enterPersonContext, runWithPerson } from "./person-context.mjs";

const config = loadConfig();
configureDefaultPersonId(config.legacyPersonId);
const store = new SlayerDatabase(config.databaseTarget);
if (config.authEnabled) {
  if (!store.status.ready) throw new Error(`Time v3 Auth requires the Agent database: ${store.status.reason}`);
  assertPersonIsolationReady(store.requireReady());
}
const identityStore = config.authEnabled ? new IdentityStore({
  databaseTarget: config.identityDatabaseTarget,
  challengeSecret: config.authChallengeSecret,
  sessionDays: config.authSessionDays,
  weeklyAiTokenLimit: config.weeklyAiTokenLimit,
}) : null;
const authEmail = config.authEnabled ? new AuthEmailService(config) : null;
const nativeCapabilities = validateNativeCapabilityPackages({
  capabilityRoot: config.capabilityPackagesPath,
});
const identity = runtimeIdentity(config.repositoryRoot);
const ledger = new Ledger(store);
const organizer = store.status.ready ? new OrganizerStore(config.databaseTarget, {
  resolveTimeV3Handle: identityStore ? (value) => {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0
      ? identityStore.activePerson(numeric)
      : identityStore.activePersonByHandle(value);
  } : null,
}) : null;
const correspondenceSync = store.status.ready
  ? new CorrespondenceSyncService({ databaseTarget: config.databaseTarget })
  : null;
const messagesWebSync = store.status.ready
  ? new MessagesWebSyncService({ databaseTarget: config.databaseTarget })
  : null;
const messagesWebSyncRequests = new MessagesWebSyncRequests();
const profileFacts = new ProfileFacts({ store, ledger });
const payments = store.status.ready ? new PaymentService({
  store,
  config,
  ledger,
  timeZone: () => timeZoneFromProfileFacts(
    profileFacts.list({ status: "active", limit: null }).facts,
  ),
}) : null;
const journalSchedule = store.status.ready ? new JournalScheduleService(store, ledger) : null;
const dailyPaperWeather = new DailyPaperWeatherService({ profileFacts });
const dailyPaper = store.status.ready ? new DailyPaperService({
  organizer,
  trackerSchedule: journalSchedule,
  weather: dailyPaperWeather,
  ledger,
  mediaRoot: config.mediaRoot,
  publicUrl: config.publicUrl,
  accessToken: config.accessToken,
  browserExecutable: config.pdfBrowserExecutable,
  timeZone: () => timeZoneFromProfileFacts(
    profileFacts.list({ status: "active", limit: null }).facts,
  ),
}) : null;
const todoPdf = store.status.ready ? new TodoPdfService({
  ledger,
  mediaRoot: config.mediaRoot,
  browserExecutable: config.pdfBrowserExecutable,
}) : null;
const printableReport = store.status.ready ? new PrintableReportService({
  ledger,
  mediaRoot: config.mediaRoot,
  browserExecutable: config.pdfBrowserExecutable,
  maximumBytes: config.maxRequestAttachmentBytes,
}) : null;
const videoScripts = store.status.ready ? new VideoScripts({ store, ledger }) : null;
const videoContent = store.status.ready ? new VideoContent({ videoScripts, organizer }) : null;
const videoContentReconciler = store.status.ready ? new VideoContentReconciler({
  ledger,
  mediaRoot: config.mediaRoot,
  maximumBytes: config.maxRequestAttachmentBytes,
  videoContent,
}) : null;
const physicalItems = store.status.ready ? new PhysicalItems({ store, ledger }) : null;
let videoRenderWorker = null;
const profileFactQuestions = await loadProfileFactQuestions(config.profileFactQuestionsPath);
const hatCatalog = await loadHatCatalog(config.hatCatalogPath);
const registry = new ToolRegistry();
const legacyIntegrationTool = (tool) => (
  String(tool.source).startsWith("mcp:")
  || /^(?:email_|payment_)/u.test(tool.name)
);
registry.setAccessPolicy((tool) => currentPersonId() === config.legacyPersonId || !legacyIntegrationTool(tool));
registerNativeCapabilities(registry, nativeCapabilities);
const searchCoordinator = store.status.ready
  ? createNativeSearchCoordinator({ store, organizer, ledger })
  : null;
const webPageClient = new WebPageClient({
  timeoutMs: config.webPageTimeoutMs,
  maximumBytes: config.webPageMaximumBytes,
});
registerWebPageTools(registry, webPageClient);
const modelTransport = await createModelTransport(config);
await modelTransport.start().catch((error) => {
  console.error(`[agent-slayer] ${modelTransport.displayName} transport startup failed:`, error);
});
const mcp = new McpToolManager({
  configPath: config.mcpConfigPath,
  userConfigPath: config.mcpUserConfigPath,
  oauthRoot: config.mcpOAuthRoot,
  publicUrl: config.publicUrl,
  artifactSource: createFileArtifactSource({ ledger, mediaRoot: config.mediaRoot }),
  ledger,
});
const jmap = new JmapClient({
  sessionUrl: config.jmapSessionUrl,
  accessToken: config.jmapAccessToken,
  accountId: config.jmapAccountId,
  required: config.jmapRequired,
  timeoutMs: config.jmapTimeoutMs,
});
const correspondence = store.status.ready ? new CorrespondenceService({ store, ledger, jmap, identityStore }) : null;
if (store.status.ready) {
  registerCalendarTools(registry, store, organizer, ledger, searchCoordinator);
  registerContactTools(registry, store, organizer, ledger, searchCoordinator);
  registerDailyPaperTools(registry, dailyPaper);
  registerPrintableReportTools(registry, printableReport);
  registerTodoTools(registry, store, ledger);
  registerPaymentTools(registry, payments);
  registerJournalTools(registry, store, ledger);
  registerJournalScheduleTools(registry, journalSchedule);
  registerProfileFactTools(registry, profileFacts);
  registerDatabaseTools(registry, store, ledger, searchCoordinator);
  registerFileTools(registry, {
    ledger,
    searchCoordinator,
    mediaRoot: config.mediaRoot,
    maximumTextBytes: config.maxTextAttachmentBytes,
    maximumGeneratedBytes: config.maxRequestAttachmentBytes,
  });
  registerNativeObjectContextView(registry, organizer, searchCoordinator);
  registerVideoScriptTools(registry, videoScripts, {
    videoContent,
    videoContentReconciler,
    onRenderQueued: () => videoRenderWorker?.notify(),
  });
  registerThingsTools(registry, physicalItems);
  registerEmailReceiptTools(registry, ledger);
}
const objectNetwork = store.status.ready ? new ObjectNetworkService({
  database: store.requireReady(), organizer, registry, physicalItems,
}) : null;
if (objectNetwork) registerObjectNetworkTools(registry, objectNetwork);
await mcp.initialize(registry);
await jmap.initialize();
if (correspondence) registerCorrespondenceTools(registry, correspondence);
if (jmap.health().ready) {
  registerJmapEmailTools(registry, jmap);
  if (searchCoordinator) registerEmailSearchProvider(searchCoordinator, jmap, {
    available: () => currentPersonId() === config.legacyPersonId,
  });
}
if (searchCoordinator) registerSearchTools(registry, searchCoordinator);
registerAgentSelfTools(registry, {
  runtimeIdentity: identity,
  config,
  modelTransport,
  integrationHealth: () => ({ ...mcp.health(), email: jmap.health(), stripe: payments?.health() ?? { ready: false } }),
  hatCatalog,
});
assertNativeToolDescriptions(registry.toolDefinitions());
assertNativeCapabilityRegistrations(registry.toolDefinitions(), nativeCapabilities);
const contextBuilder = new ContextBuilder({
  ledger,
  profileFacts,
  store,
  profileFactQuestions,
  maximumAttachmentCharacters: config.maxAttachmentContextCharacters,
});
const requestCompiler = new RequestCompiler({
  hatCatalog,
  capabilityManifest: (capabilityId) => registry.capabilityManifest(capabilityId),
});
const runtime = new SlayerRuntime({
  modelTransport, registry, contextBuilder, requestCompiler, ledger, config,
  objectReferenceFilter: (groups) => organizer?.filterModelVisibleObjectReferences(groups) ?? groups,
});
const transcriber = new WhisperTranscriber({
  pythonExecutable: config.pythonExecutable,
  workerPath: config.whisperWorkerPath,
  timeoutMs: config.whisperTimeoutMs,
});
const speech = new OpenAISpeechService({
  apiKey: config.openAIApiKey,
  baseUrl: config.openAIBaseUrl,
  model: config.ttsModel,
  voice: config.ttsAgentVoice,
  instructions: config.ttsAgentInstructions,
  timeoutMs: config.ttsTimeoutMs,
});
const musicNarration = new MusicNarrationService({
  speech,
  voice: config.ttsMusicNarrationVoice,
  maximumEntries: 300,
});
const preparedConcerts = new PreparedConcertService({ narration: musicNarration });
const musicDurationResolver = new MusicDurationResolver({ ledger, mediaRoot: config.mediaRoot });
if (videoScripts) {
  videoRenderWorker = new VideoRenderWorker({
    videoScripts,
    ledger,
    transcriber,
    speech,
    agentVoice: config.ttsAgentVoice,
    agentInstructions: config.ttsAgentInstructions,
    userVoice: config.ttsUserVoice,
    userInstructions: config.ttsUserInstructions,
    mediaRoot: config.mediaRoot,
    outputRoot: config.videoOutputRoot,
    browserExecutable: config.remotionBrowserExecutable,
  });
}
const queue = new RequestQueue({
  ledger,
  runtime,
  transcriber,
  mediaRoot: config.mediaRoot,
  maxTextAttachmentBytes: config.maxTextAttachmentBytes,
  maxRequestAttachmentBytes: config.maxRequestAttachmentBytes,
});

const serveStatic = createStaticHandler(config);

function sendJson(response, statusCode, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": encoded.length,
    "Cache-Control": "no-store",
  });
  response.end(encoded);
}

function byteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return { start, end: Math.min(end, size - 1) };
}

function sendAudioBuffer(request, response, { bytes, mimeType, filename, aiGenerated = false }) {
  const range = byteRange(request.headers.range, bytes.length);
  if (range === false) {
    response.writeHead(416, {
      "Content-Range": `bytes */${bytes.length}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    });
    response.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? bytes.length - 1;
  response.writeHead(range ? 206 : 200, {
    "Content-Type": mimeType,
    "Content-Length": end - start + 1,
    "Content-Disposition": `inline; filename="${filename}"`,
    "Accept-Ranges": "bytes",
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
    "Cache-Control": "private, no-store",
    ...(aiGenerated ? { "X-AI-Generated": "true" } : {}),
  });
  response.end(bytes.subarray(start, end + 1));
}

async function sendStoredMusic(request, response, file) {
  const filename = safeMediaPath(config.mediaRoot, file.storage_path);
  const stat = await fsp.stat(filename).catch(() => null);
  if (!stat?.isFile()) {
    sendJson(response, 404, { error: "The stored music file is missing" });
    return;
  }
  const range = byteRange(request.headers.range, stat.size);
  if (range === false) {
    response.writeHead(416, {
      "Content-Range": `bytes */${stat.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    });
    response.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  const downloadName = String(file.original_filename || `music-${file.file_id}.mp3`)
    .replace(/[^A-Za-z0-9._-]+/g, "-");
  response.writeHead(range ? 206 : 200, {
    "Content-Type": file.mime_type || "audio/mpeg",
    "Content-Length": end - start + 1,
    "Content-Disposition": `inline; filename="${downloadName}"`,
    "Accept-Ranges": "bytes",
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
    "Cache-Control": "private, no-store",
  });
  fs.createReadStream(filename, { start, end }).pipe(response);
}

function sendOAuthPage(response, statusCode, { title, message, redirect = false }) {
  const escapedTitle = String(title).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
  const escapedMessage = String(message).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
  const body = Buffer.from(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapedTitle}</title><body><main><h1>${escapedTitle}</h1><p>${escapedMessage}</p><p><a href="/app">Return to Time v3 Agent</a></p></main>${redirect ? '<script>setTimeout(() => location.replace("/app?oauth=connected"), 800)</script>' : ""}</body></html>`);
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  });
  response.end(body);
}

async function readJson(request, maximumBytes = 64 * 1024) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json"), { statusCode: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw Object.assign(new Error("JSON body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Body must be valid JSON"), { statusCode: 400 }); }
}

async function readRaw(request, maximumBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw Object.assign(new Error("Request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function normalizeReferencedRequestIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 8) {
    throw Object.assign(new Error("Referenced request IDs must be an array of at most 8 exchange IDs"), { statusCode: 400 });
  }
  const requestIds = value.map((requestId) => String(requestId || "").toLowerCase());
  if (requestIds.some((requestId) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId))) {
    throw Object.assign(new Error("Every referenced request ID must be a full exchange UUID"), { statusCode: 400 });
  }
  return [...new Set(requestIds)];
}

function normalizeAttachmentFileIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw Object.assign(new Error("Attachment file IDs must be an array of at most 100 file IDs"), { statusCode: 400 });
  }
  const fileIds = value.map(Number);
  if (fileIds.some((fileId) => !Number.isSafeInteger(fileId) || fileId < 1)) {
    throw Object.assign(new Error("Every attachment file ID must be a positive integer"), { statusCode: 400 });
  }
  if (new Set(fileIds).size !== fileIds.length) {
    throw Object.assign(new Error("Attachment file IDs cannot contain duplicates"), { statusCode: 400 });
  }
  return fileIds;
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return ["", ""];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function cookieName(clientId) {
  const secure = new URL(clientId === "auth" ? config.authPublicUrl : config.publicUrl).protocol === "https:";
  return `${secure ? "__Host-" : ""}timev3_${clientId}`;
}

function stateCookieName() {
  // This cookie is intentionally limited to the callback path. The __Host-
  // prefix requires Path=/, so HTTPS uses __Secure- instead.
  return `${new URL(config.publicUrl).protocol === "https:" ? "__Secure-" : ""}timev3_auth_state`;
}

function sessionCookie(clientId, token, { clear = false } = {}) {
  const origin = new URL(clientId === "auth" ? config.authPublicUrl : config.publicUrl);
  const parts = [
    `${cookieName(clientId)}=${clear ? "" : encodeURIComponent(token)}`,
    "Path=/", "HttpOnly", "SameSite=Lax",
    ...(origin.protocol === "https:" ? ["Secure"] : []),
    clear ? "Max-Age=0" : `Max-Age=${config.authSessionDays * 86_400}`,
  ];
  return parts.join("; ");
}

function stateCookie(value, { clear = false } = {}) {
  const secure = new URL(config.publicUrl).protocol === "https:";
  return [
    `${stateCookieName()}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/api/auth/callback", "HttpOnly", "SameSite=Lax",
    ...(secure ? ["Secure"] : []), clear ? "Max-Age=0" : "Max-Age=600",
  ].join("; ");
}

function requestIp(request) {
  const remote = String(request.socket?.remoteAddress ?? "");
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const forwarded = loopback ? String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
  return (forwarded || remote).slice(0, 64) || null;
}

function requestAgent(request) {
  return String(request.headers["user-agent"] ?? "").slice(0, 500) || null;
}

function requireRequestOrigin(request, expectedOrigin) {
  const supplied = String(request.headers.origin ?? "");
  if (supplied !== new URL(expectedOrigin).origin) {
    throw Object.assign(new Error("The request origin is not allowed."), { statusCode: 403 });
  }
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { Location: location, "Cache-Control": "no-store", ...headers });
  response.end();
}

function authorized(request) {
  if (config.authEnabled) {
    const session = identityStore.session(cookies(request)[cookieName("agent")], "agent");
    if (session) {
      request.timev3Auth = session;
      enterPersonContext(session.person.personId);
      return true;
    }
    const header = String(request.headers.authorization || "");
    const node = header.startsWith("Bearer ")
      ? identityStore.authenticateNode(header.slice(7))
      : null;
    if (node) {
      request.timev3Node = node;
      enterPersonContext(node.person.personId);
      return true;
    }
    return false;
  }
  if (config.allowUnauthenticated) return true;
  const header = String(request.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.accessToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function requireAuthorization(request, response) {
  if (authorized(request)) return true;
  sendJson(response, 401, { error: config.authEnabled
    ? "Sign in to Time v3 Agent to continue"
    : "A valid Time v3 Agent access token is required" });
  return false;
}

function contactScopePersonId(request, url, body = null) {
  const selected = request.timev3Auth?.person ?? request.timev3Node?.person;
  const requested = Number(body?.managedPersonId ?? url.searchParams.get("managedPersonId") ?? selected?.personId ?? currentPersonId());
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw Object.assign(new Error("managedPersonId must be a positive person id."), { statusCode: 400 });
  }
  if (!selected || requested === selected.personId) return requested;
  const accountId = request.timev3Auth?.account?.accountId;
  if (!accountId || !identityStore.canManageContacts(accountId, requested)) {
    throw Object.assign(new Error("You cannot manage that person's contacts."), { statusCode: 403 });
  }
  return requested;
}

function withContactScope(request, url, body, callback) {
  const personId = contactScopePersonId(request, url, body);
  return personId === currentPersonId() ? callback() : runWithPerson(personId, callback);
}

function assertAiAllowance(request) {
  const person = request.timev3Auth?.person ?? request.timev3Node?.person;
  const limit = Number(person?.weeklyAiTokenLimit ?? config.weeklyAiTokenLimit);
  const used = ledger.rollingModelTokens({ days: 7 });
  if (used >= limit) {
    throw Object.assign(new Error("This Agent identity has reached its seven-day AI usage limit."), {
      statusCode: 429, code: "AI_USAGE_LIMIT_REACHED",
    });
  }
  return { used, limit };
}

async function handlePublicAuthRoute(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/auth/mode") {
    sendJson(response, 200, { mode: config.authEnabled ? "session" : "token",
      registrationEnabled: config.authEnabled && config.authRegistrationEnabled,
      authUrl: config.authEnabled ? config.authPublicUrl : null,
      agentUrl: config.publicUrl });
    return true;
  }
  if (!config.authEnabled) return false;
  const authOrigin = new URL(config.authPublicUrl).origin;
  const agentOrigin = new URL(config.publicUrl).origin;
  const callbackUri = new URL("/api/auth/callback", config.publicUrl).toString();
  const metadata = { userAgent: requestAgent(request), ipAddress: requestIp(request) };
  const requestCookies = cookies(request);
  const requestHost = new URL(`http://${request.headers.host || "localhost"}`).host;
  const authHost = requestHost === new URL(config.authPublicUrl).host;

  if (request.method === "GET" && url.pathname === "/" && authHost) {
    redirect(response, new URL("/login", config.authPublicUrl).toString());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/start") {
    const state = randomBytes(24).toString("base64url");
    const destination = new URL("/login", config.authPublicUrl);
    destination.searchParams.set("client_id", "agent");
    destination.searchParams.set("state", state);
    redirect(response, destination.toString(), { "Set-Cookie": stateCookie(state) });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/auth/callback") {
    const state = url.searchParams.get("state") || "";
    const expectedState = requestCookies[stateCookieName()] || "";
    const supplied = Buffer.from(state);
    const expected = Buffer.from(expectedState);
    if (!state || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw Object.assign(new Error("The sign-in state is invalid or expired."), { statusCode: 400 });
    }
    const created = identityStore.consumeAuthorizationCode({
      code: url.searchParams.get("code") || "", clientId: "agent", redirectUri: callbackUri, ...metadata,
    });
    redirect(response, new URL("/app", config.publicUrl).toString(), {
      "Set-Cookie": [sessionCookie("agent", created.token), stateCookie("", { clear: true })],
    });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    const clientId = authHost ? "auth" : "agent";
    const session = identityStore.session(requestCookies[cookieName(clientId)], clientId);
    if (!session) {
      sendJson(response, 401, { error: "No active Time v3 session" });
      return true;
    }
    sendJson(response, 200, { ...session, people: identityStore.listPeople(session.account.accountId) });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    requireRequestOrigin(request, authOrigin);
    if (!config.authRegistrationEnabled) throw Object.assign(new Error("New account registration is temporarily unavailable."), { statusCode: 503 });
    const body = await readJson(request);
    identityStore.assertRegistrationEmailAllowed(body.email, config.authInitialOwnerEmail);
    const ipLimit = identityStore.rateLimit({ action: "register_ip", subject: metadata.ipAddress, maximum: 10, windowSeconds: 3600 });
    const emailLimit = identityStore.rateLimit({ action: "register_email", subject: body.email, maximum: 4, windowSeconds: 3600 });
    if (!ipLimit.allowed || !emailLimit.allowed) throw Object.assign(new Error("Too many registration attempts. Try again later."), { statusCode: 429 });
    const registration = identityStore.register(body);
    const delivery = await authEmail.sendCode({ purpose: "verify_email", email: registration.email,
      displayName: registration.displayName, code: registration.code });
    sendJson(response, 201, { accountId: registration.accountId, maskedEmail: delivery.maskedEmail,
      verificationRequired: true });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/verify") {
    requireRequestOrigin(request, authOrigin);
    const body = await readJson(request);
    const limit = identityStore.rateLimit({ action: "verify_email", subject: `${metadata.ipAddress}:${body.email}`,
      maximum: 12, windowSeconds: 3600 });
    if (!limit.allowed) throw Object.assign(new Error("Too many verification attempts. Try again later."), { statusCode: 429 });
    const created = identityStore.verifyEmail({ ...body, clientId: "auth", ...metadata });
    response.setHeader("Set-Cookie", sessionCookie("auth", created.token));
    sendJson(response, 200, { accountId: created.accountId, person: created.person });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/resend-verification") {
    requireRequestOrigin(request, authOrigin);
    const body = await readJson(request);
    const limit = identityStore.rateLimit({ action: "resend_verification", subject: `${metadata.ipAddress}:${body.email}`,
      maximum: 4, windowSeconds: 3600 });
    if (limit.allowed) {
      const verification = identityStore.resendVerification(body.email);
      if (verification) await authEmail.sendCode({ purpose: "verify_email", email: verification.email,
        displayName: verification.displayName, code: verification.code });
    }
    sendJson(response, 200, { message: "If that email has an unverified account, a new code has been sent." });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    requireRequestOrigin(request, authOrigin);
    const body = await readJson(request);
    const limit = identityStore.rateLimit({ action: "login", subject: `${metadata.ipAddress}:${body.login ?? body.email}`,
      maximum: 10, windowSeconds: 900 });
    if (!limit.allowed) throw Object.assign(new Error("Too many sign-in attempts. Try again later."), { statusCode: 429 });
    const created = identityStore.authenticate({ ...body, clientId: "auth", ...metadata });
    response.setHeader("Set-Cookie", sessionCookie("auth", created.token));
    sendJson(response, 200, { accountId: created.accountId, person: created.person });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/authorize") {
    requireRequestOrigin(request, authOrigin);
    const session = identityStore.session(requestCookies[cookieName("auth")], "auth");
    if (!session) throw Object.assign(new Error("Sign in before opening Agent."), { statusCode: 401 });
    const body = await readJson(request);
    const state = String(body.state ?? "");
    if (!/^[A-Za-z0-9_-]{20,200}$/u.test(state)) throw Object.assign(new Error("The sign-in state is invalid."), { statusCode: 400 });
    const code = identityStore.createAuthorizationCode({ accountId: session.account.accountId,
      personId: session.person.personId, clientId: "agent", redirectUri: callbackUri });
    const destination = new URL(callbackUri);
    destination.searchParams.set("code", code);
    destination.searchParams.set("state", state);
    sendJson(response, 200, { redirectUrl: destination.toString() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/forgot-password") {
    requireRequestOrigin(request, authOrigin);
    const body = await readJson(request);
    const limit = identityStore.rateLimit({ action: "password_reset", subject: `${metadata.ipAddress}:${body.email}`,
      maximum: 5, windowSeconds: 3600 });
    if (limit.allowed) {
      const reset = identityStore.requestPasswordReset(body.email);
      if (reset) await authEmail.sendCode({ purpose: "reset_password", email: reset.email,
        displayName: reset.displayName, code: reset.code });
    }
    sendJson(response, 200, { message: "If that email belongs to an active account, a reset code has been sent." });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/reset-password") {
    requireRequestOrigin(request, authOrigin);
    const body = await readJson(request);
    identityStore.resetPassword(body);
    sendJson(response, 200, { reset: true });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    requireRequestOrigin(request, authHost ? authOrigin : agentOrigin);
    const clientId = authHost ? "auth" : "agent";
    identityStore.revokeSession(requestCookies[cookieName(clientId)], clientId);
    response.setHeader("Set-Cookie", sessionCookie(clientId, "", { clear: true }));
    sendJson(response, 200, { signedOut: true });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/node/pairings") {
    const body = await readJson(request);
    const limit = identityStore.rateLimit({ action: "node_pairing_start", subject: metadata.ipAddress,
      maximum: 20, windowSeconds: 3600 });
    if (!limit.allowed) throw Object.assign(new Error("Too many node pairing attempts. Try again later."), { statusCode: 429 });
    const pairing = identityStore.beginNodePairing(body);
    sendJson(response, 201, { ...pairing,
      verificationUri: new URL("/app", config.publicUrl).toString() });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/node/pairings/token") {
    const body = await readJson(request);
    const limit = identityStore.rateLimit({ action: "node_pairing_poll", subject: `${metadata.ipAddress}:${body.deviceCode}`,
      maximum: 180, windowSeconds: 900 });
    if (!limit.allowed) throw Object.assign(new Error("The node is polling too frequently."), { statusCode: 429 });
    const result = identityStore.exchangeNodePairing(body.deviceCode);
    sendJson(response, result.pending ? 202 : 200, result);
    return true;
  }
  return false;
}

async function receiveAudio(request) {
  const mimeType = String(request.headers["content-type"] || "application/octet-stream").split(";", 1)[0];
  const extensions = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "video/mp4": "m4a", "audio/wav": "wav", "audio/mpeg": "mp3" };
  const extension = extensions[mimeType] || "bin";
  const now = new Date();
  const relativeDirectory = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"));
  const directory = path.join(config.mediaRoot, relativeDirectory);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const storedName = `${randomUUID()}.${extension}`;
  const filename = path.join(directory, storedName);
  const handle = await fsp.open(filename, "wx", 0o600);
  const hash = createHash("sha256");
  let byteSize = 0;
  try {
    for await (const chunk of request) {
      byteSize += chunk.length;
      if (byteSize > config.maxUploadBytes) throw Object.assign(new Error("Audio upload is too large"), { statusCode: 413 });
      hash.update(chunk);
      await handle.write(chunk);
    }
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fsp.unlink(filename).catch(() => {});
    throw error;
  }
  await handle.close();
  if (byteSize === 0) {
    await fsp.unlink(filename).catch(() => {});
    throw Object.assign(new Error("Audio upload was empty"), { statusCode: 400 });
  }
  const storagePath = path.posix.join("media", ...relativeDirectory.split(path.sep), storedName);
  const file = ledger.registerFile({
    storagePath,
    originalFilename: `recording.${extension}`,
    mimeType,
    sha256: hash.digest("hex"),
    byteSize,
  });
  if (file.duplicate && file.storagePath !== storagePath) await fsp.unlink(filename).catch(() => {});
  return file;
}

function health() {
  const model = modelTransport.health();
  return {
    ready: store.status.ready && model.ready,
    reason: store.status.ready ? (model.ready ? null : model.reason) : store.status.reason,
    runtime: identity,
    model: { ...model, id: modelTransport.id, displayName: modelTransport.displayName, model: config.model },
    database: store.status,
    integrations: {
      ...mcp.health(),
      email: jmap.health(),
      stripe: payments?.health() ?? { ready: false },
      webSearch: {
        ready: model.ready,
        provider: "openai-responses",
        hosted: true,
        reason: model.ready ? null : model.reason,
      },
    },
    tools: registry.list().map((tool) => ({
      name: tool.name,
      source: tool.source,
      upstreamName: tool.upstreamName ?? null,
    })),
  };
}

const server = http.createServer(async (request, response) => {
  // HTTP listeners may share an async-resource lineage. Always reset first so
  // an unauthenticated or capability-URL request cannot inherit another
  // request's selected person before authorization establishes its own.
  enterPersonContext(config.legacyPersonId);
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (await handlePublicAuthRoute(request, response, url)) return;
    if (request.method === "GET" && url.pathname === "/api/payments/stripe/oauth/callback") {
      if (!payments) throw Object.assign(new Error("Payments are unavailable while the database is unavailable."), { statusCode: 503 });
      if (url.searchParams.has("error")) {
        sendOAuthPage(response, 400, {
          title: "Stripe authorization failed",
          message: url.searchParams.get("error_description") || url.searchParams.get("error"),
        });
        return;
      }
      try {
        await payments.finishOAuth({ code: url.searchParams.get("code"), state: url.searchParams.get("state") });
        sendOAuthPage(response, 200, {
          title: "Stripe connected",
          message: "Stripe authorization completed. Invoices can be prepared once the account can accept charges.",
          redirect: true,
        });
      } catch (error) {
        sendOAuthPage(response, error.statusCode || 400, {
          title: "Stripe authorization failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/payments/stripe/webhook") {
      if (!payments) throw Object.assign(new Error("Payments are unavailable while the database is unavailable."), { statusCode: 503 });
      const result = await payments.handleWebhook(
        await readRaw(request),
        String(request.headers["stripe-signature"] ?? ""),
      );
      sendJson(response, 200, result);
      return;
    }
    const oauthCallbackMatch = /^\/api\/integrations\/([A-Za-z0-9_-]+)\/oauth\/callback$/.exec(url.pathname);
    if (request.method === "GET" && oauthCallbackMatch) {
      const serverName = oauthCallbackMatch[1];
      if (url.searchParams.has("error")) {
        const description = url.searchParams.get("error_description") || url.searchParams.get("error");
        sendOAuthPage(response, 400, { title: "Authorization failed", message: description });
        return;
      }
      try {
        await mcp.finishOAuth(serverName, {
          code: url.searchParams.get("code"),
          state: url.searchParams.get("state"),
        });
        if (store.status.ready) queue.notify();
        sendOAuthPage(response, 200, {
          title: `${serverName} connected`,
          message: "OAuth authorization completed and the MCP tools are now available.",
          redirect: true,
        });
      } catch (error) {
        sendOAuthPage(response, 400, {
          title: "Authorization failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const body = health();
      sendJson(response, body.ready ? 200 : 503, body);
      return;
    }
    const preparedConcertStreamMatch = /^\/api\/music\/prepared-concerts\/([0-9a-f-]{36})\/items\/(\d+)\/stream$/u.exec(url.pathname);
    if (request.method === "GET" && preparedConcertStreamMatch) {
      const item = preparedConcerts.playbackItem(
        preparedConcertStreamMatch[1],
        Number(preparedConcertStreamMatch[2]),
        url.searchParams.get("token"),
      );
      if (!item) {
        sendJson(response, 404, { error: "Prepared concert audio was not found or has expired" });
        return;
      }
      await runWithPerson(item.personId, async () => {
        if (item.kind === "narration") {
          const narration = musicNarration.get(item.narrationId);
          if (!narration) {
            sendJson(response, 404, { error: "Prepared concert narration was not found or has expired" });
            return;
          }
          sendAudioBuffer(request, response, {
            bytes: narration.bytes,
            mimeType: narration.mimeType,
            filename: `prepared-concert-narration-${narration.narrationId}.wav`,
            aiGenerated: true,
          });
          return;
        }
        const file = ledger.file(item.fileId);
        if (!file || file.media_kind !== "audio" || !parseMusicMetadataDescription(file.description).metadata) {
          sendJson(response, 404, { error: "Prepared concert music was not found" });
          return;
        }
        await sendStoredMusic(request, response, file);
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/daily-paper" && url.searchParams.has("snapshot")) {
      const snapshot = dailyPaper.renderSnapshotCapability(url.searchParams.get("snapshot"));
      if (!snapshot) {
        sendJson(response, 404, { error: "Weekly paper render snapshot is unavailable or expired" });
        return;
      }
      await runWithPerson(snapshot.personId, () => sendJson(response, 200, snapshot.model));
      return;
    }
    if (await serveStatic(request, response)) return;
    if (!requireAuthorization(request, response)) return;
    const nodeRestrictedRoute = url.pathname.startsWith("/api/account/")
      || url.pathname.startsWith("/api/integrations/")
      || url.pathname.startsWith("/api/payments/")
      || url.pathname.startsWith("/api/node/")
      || url.pathname.startsWith("/api/correspondence/email-sync")
      || /\/invite-draft$/u.test(url.pathname);
    if (request.timev3Node && nodeRestrictedRoute) {
      throw Object.assign(new Error("A linked node credential cannot manage accounts or connected services."), { statusCode: 403 });
    }
    const legacyIntegrationRoute = url.pathname.startsWith("/api/integrations/")
      || url.pathname.startsWith("/api/payments/")
      || url.pathname.startsWith("/api/correspondence/email-sync")
      || /\/invite-draft$/u.test(url.pathname);
    const authenticatedPerson = request.timev3Auth?.person ?? request.timev3Node?.person;
    if (config.authEnabled && legacyIntegrationRoute
        && authenticatedPerson.personId !== config.legacyPersonId) {
      throw Object.assign(new Error("That connected service belongs to a different Agent identity."), { statusCode: 403 });
    }
    if (request.timev3Auth?.person.experience === "light") {
      const lightRoute = url.pathname.startsWith("/api/contacts")
        || (url.pathname.startsWith("/api/correspondence")
          && !url.pathname.includes("sync") && !url.pathname.includes("google-messages"))
        || url.pathname.startsWith("/api/account/")
        || url.pathname.startsWith("/api/node/")
        || url.pathname.startsWith("/api/profile-facts")
        || url.pathname === "/api/ai-usage";
      if (!lightRoute) {
        throw Object.assign(new Error("This light account does not include that part of Agent."), { statusCode: 403 });
      }
    }
    if (request.timev3Auth?.account && request.method === "GET" && url.pathname === "/api/account/people") {
      sendJson(response, 200, {
        account: request.timev3Auth.account,
        selectedPerson: request.timev3Auth.person,
        people: identityStore.listPeople(request.timev3Auth.account.accountId),
      });
      return;
    }
    if (request.timev3Auth?.account && request.method === "PATCH" && url.pathname === "/api/account/person/handle") {
      requireRequestOrigin(request, new URL(config.publicUrl).origin);
      const body = await readJson(request);
      sendJson(response, 200, { person: identityStore.setPersonHandle(
        request.timev3Auth.account.accountId, request.timev3Auth.person.personId, body.handle,
      ) });
      return;
    }
    if (request.timev3Auth?.account && request.method === "GET" && url.pathname === "/api/account/provisioned") {
      if (request.timev3Auth.person.experience !== "full") {
        throw Object.assign(new Error("Only a full account can provision or manage other accounts."), { statusCode: 403 });
      }
      sendJson(response, 200, { people: identityStore.listProvisionedPeople(request.timev3Auth.account.accountId) });
      return;
    }
    if (request.timev3Auth?.account && request.method === "POST" && url.pathname === "/api/account/provisioned") {
      if (request.timev3Auth.person.experience !== "full") {
        throw Object.assign(new Error("Only a full account can provision or manage other accounts."), { statusCode: 403 });
      }
      requireRequestOrigin(request, new URL(config.publicUrl).origin);
      sendJson(response, 201, identityStore.createProvisionedAccount(
        request.timev3Auth.account.accountId, await readJson(request),
      ));
      return;
    }
    const provisionedMatch = /^\/api\/account\/provisioned\/(\d+)$/u.exec(url.pathname);
    if (request.timev3Auth?.account && request.method === "PATCH" && provisionedMatch) {
      if (request.timev3Auth.person.experience !== "full") {
        throw Object.assign(new Error("Only a full account can provision or manage other accounts."), { statusCode: 403 });
      }
      requireRequestOrigin(request, new URL(config.publicUrl).origin);
      sendJson(response, 200, { person: identityStore.updateProvisionedPerson(
        request.timev3Auth.account.accountId, Number(provisionedMatch[1]), await readJson(request),
      ) });
      return;
    }
    const provisionedPasswordMatch = /^\/api\/account\/provisioned\/(\d+)\/reset-password$/u.exec(url.pathname);
    if (request.timev3Auth?.account && request.method === "POST" && provisionedPasswordMatch) {
      if (request.timev3Auth.person.experience !== "full") {
        throw Object.assign(new Error("Only a full account can recover a provisioned account."), { statusCode: 403 });
      }
      requireRequestOrigin(request, new URL(config.publicUrl).origin);
      sendJson(response, 200, identityStore.resetProvisionedPassword(
        request.timev3Auth.account.accountId, Number(provisionedPasswordMatch[1]),
      ));
      return;
    }
    const selectedPersonMatch = /^\/api\/account\/people\/(\d+)\/select$/u.exec(url.pathname);
    if (request.timev3Auth?.account && request.method === "POST" && selectedPersonMatch) {
      requireRequestOrigin(request, new URL(config.publicUrl).origin);
      const person = identityStore.switchPerson(
        request.timev3Auth.sessionId,
        request.timev3Auth.account.accountId,
        Number(selectedPersonMatch[1]),
      );
      sendJson(response, 200, { person });
      return;
    }
    if (request.timev3Auth?.account && request.method === "POST" && url.pathname === "/api/node/pairings/approve") {
      requireRequestOrigin(request, new URL(config.publicUrl).origin);
      const body = await readJson(request);
      sendJson(response, 200, identityStore.approveNodePairing({
        accountId: request.timev3Auth.account.accountId,
        personId: request.timev3Auth.person.personId,
        userCode: body.userCode,
      }));
      return;
    }
    if (request.timev3Auth?.account && request.method === "GET" && url.pathname === "/api/node/devices") {
      sendJson(response, 200, { devices: identityStore.listNodeDevices(
        request.timev3Auth.account.accountId, request.timev3Auth.person.personId,
      ) });
      return;
    }
    const nodeDeviceMatch = /^\/api\/node\/devices\/(\d+)$/u.exec(url.pathname);
    if (request.timev3Auth?.account && request.method === "DELETE" && nodeDeviceMatch) {
      requireRequestOrigin(request, new URL(config.publicUrl).origin);
      identityStore.revokeNodeDevice(request.timev3Auth.account.accountId,
        request.timev3Auth.person.personId, Number(nodeDeviceMatch[1]));
      sendJson(response, 200, { revoked: true });
      return;
    }
    const oauthStartMatch = /^\/api\/integrations\/([A-Za-z0-9_-]+)\/oauth\/start$/.exec(url.pathname);
    if (request.method === "POST" && oauthStartMatch) {
      sendJson(response, 200, await mcp.beginOAuth(oauthStartMatch[1]));
      return;
    }
    const oauthDisconnectMatch = /^\/api\/integrations\/([A-Za-z0-9_-]+)\/oauth\/disconnect$/.exec(url.pathname);
    if (request.method === "POST" && oauthDisconnectMatch) {
      sendJson(response, 200, {
        integration: await mcp.disconnectOAuth(oauthDisconnectMatch[1]),
        localCredentialsRemoved: true,
        providerGrantRevoked: false,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/mcp") {
      const body = await readJson(request);
      sendJson(response, 201, { integration: await mcp.addBearerIntegration(body) });
      if (store.status.ready) queue.notify();
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/mcp/refresh") {
      const integrations = await mcp.refreshTools();
      sendJson(response, 200, { integrations });
      if (store.status.ready) queue.notify();
      return;
    }
    const userIntegrationMatch = /^\/api\/integrations\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === "DELETE" && userIntegrationMatch) {
      sendJson(response, 200, { integration: await mcp.removeUserIntegration(userIntegrationMatch[1]) });
      if (store.status.ready) queue.notify();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/hats") {
      sendJson(response, 200, hatCatalog.publicManual(registry.toolDefinitions(), capabilityForTool));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/extensions/google-messages-sync/download") {
      const archive = await createGoogleMessagesExtensionArchive(config.repositoryRoot, {
        serverUrl: config.publicUrl,
      });
      response.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": archive.length,
        "Content-Disposition": 'attachment; filename="time-v3-google-messages-sync.zip"',
        "Cache-Control": "private, no-store",
      });
      response.end(archive);
      return;
    }
    if (!store.status.ready) {
      sendJson(response, 503, { error: store.status.reason });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/mobile/correspondence-sync") {
      sendJson(response, 200, correspondenceSync.synchronize(await readJson(request, 4 * 1024 * 1024)));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/mobile/correspondence-sync/status") {
      sendJson(response, 200, correspondenceSync.status(url.searchParams.get("deviceId")));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/correspondence/google-messages-sync") {
      sendJson(response, 200, messagesWebSync.synchronize(await readJson(request, 16 * 1024 * 1024)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/correspondence/google-messages-sync/request") {
      sendJson(response, 202, messagesWebSyncRequests.create(await readJson(request)));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/correspondence/google-messages-sync/next") {
      const command = messagesWebSyncRequests.next(url.searchParams.get("accountKey") || "default");
      if (!command) {
        response.writeHead(204, { "Cache-Control": "private, no-store" });
        response.end();
      } else sendJson(response, 200, command);
      return;
    }
    const messagesWebSyncRequestMatch = /^\/api\/correspondence\/google-messages-sync\/request\/([0-9a-f-]{36})$/u.exec(url.pathname);
    if (request.method === "GET" && messagesWebSyncRequestMatch) {
      sendJson(response, 200, messagesWebSyncRequests.get(messagesWebSyncRequestMatch[1]));
      return;
    }
    const messagesWebSyncProgressMatch = /^\/api\/correspondence\/google-messages-sync\/request\/([0-9a-f-]{36})\/progress$/u.exec(url.pathname);
    if (request.method === "POST" && messagesWebSyncProgressMatch) {
      sendJson(response, 200, messagesWebSyncRequests.update(
        messagesWebSyncProgressMatch[1],
        await readJson(request),
      ));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/correspondence/google-messages-sync/status") {
      sendJson(response, 200, messagesWebSync.status(url.searchParams.get("accountKey") || "default"));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/correspondence") {
      sendJson(response, 200, correspondence.list({
        q: url.searchParams.get("q") || "",
        medium: url.searchParams.get("medium") || null,
        direction: url.searchParams.get("direction") || null,
        mailboxId: url.searchParams.get("mailbox") || null,
        occurredFromUtc: url.searchParams.get("occurredFromUtc") || null,
        occurredBeforeUtc: url.searchParams.get("occurredBeforeUtc") || null,
        participantTag: url.searchParams.get("participantTag") || null,
        groupBy: url.searchParams.get("groupBy") || "none",
        limit: url.searchParams.get("limit") || 100,
        offset: url.searchParams.get("offset") || 0,
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/correspondence/timev3-recipients") {
      sendJson(response, 200, { recipients: correspondence.timeV3Recipients() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/correspondence/timev3-messages") {
      const person = request.timev3Auth?.person ?? request.timev3Node?.person;
      sendJson(response, 201, correspondence.sendTimeV3Text(await readJson(request), {
        actorType: "user", actorName: person?.displayName || "Time v3 user",
        source: request.timev3Node ? "timev3_node" : "timev3_web",
        channel: request.timev3Node ? "node" : "web",
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/correspondence/email-sync") {
      if (correspondence.emailSyncStatus().status === "running") throw Object.assign(new Error("Email synchronization is already running"), { statusCode: 409 });
      void correspondence.syncEmail({ actorType: "user", actorName: "Nate", channel: "web" }).catch(() => {});
      sendJson(response, 202, correspondence.emailSyncStatus());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/correspondence/email-sync/status") {
      sendJson(response, 200, correspondence.emailSyncStatus());
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/correspondence/todo-links") {
      sendJson(response, 200, correspondence.setTodoLinks(await readJson(request), {
        actorType: "user", actorName: "Nate", channel: "web",
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/profile-facts") {
      sendJson(response, 200, profileFacts.list({ status: url.searchParams.get("status") || "active" }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/profile-facts") {
      const input = await readJson(request);
      sendJson(response, 201, profileFacts.set({
        factType: input.factType, text: input.text, replacesFactId: input.replacesFactId ?? null,
      }, { actorType: "user", actorName: "Nate", channel: "web" }));
      return;
    }
    const profileFactMatch = /^\/api\/profile-facts\/(\d+)$/.exec(url.pathname);
    if (request.method === "DELETE" && profileFactMatch) {
      sendJson(response, 200, profileFacts.archive({ factId: Number(profileFactMatch[1]) }, {
        actorType: "user", actorName: "Nate", channel: "web",
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/payments/stripe/status") {
      sendJson(response, 200, { stripe: await payments.stripeStatus({ refresh: true }) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/payments/stripe/oauth/start") {
      sendJson(response, 200, payments.beginOAuth());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/payment-invoices") {
      const invoices = await payments.listInvoices({ limit: url.searchParams.get("limit") || 100 });
      sendJson(response, 200, { count: invoices.length, invoices });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/payment-invoices/prepare") {
      sendJson(response, 201, await payments.prepareInvoice(
        await readJson(request), { actorType: "user", actorName: "payments_page" },
      ));
      return;
    }
    const paymentInvoiceMatch = /^\/api\/payment-invoices\/(\d+)$/.exec(url.pathname);
    if (request.method === "PATCH" && paymentInvoiceMatch) {
      sendJson(response, 200, payments.updatePreparedInvoice(
        Number(paymentInvoiceMatch[1]),
        await readJson(request),
        { actorType: "user", actorName: "payments_page" },
      ));
      return;
    }
    const paymentInvoicePreviewPdfMatch = /^\/api\/payment-invoices\/(\d+)\/preview-pdf$/.exec(url.pathname);
    if (request.method === "GET" && paymentInvoicePreviewPdfMatch) {
      const pdf = await payments.localInvoicePdf(Number(paymentInvoicePreviewPdfMatch[1]));
      const disposition = url.searchParams.get("download") === "true" ? "attachment" : "inline";
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": pdf.bytes.length,
        "Content-Disposition": `${disposition}; filename="${pdf.filename}"`,
        "Cache-Control": "private, no-store",
      });
      response.end(pdf.bytes);
      return;
    }
    const paymentInvoicePdfMatch = /^\/api\/payment-invoices\/(\d+)\/pdf$/.exec(url.pathname);
    if (request.method === "GET" && paymentInvoicePdfMatch) {
      sendJson(response, 200, await payments.invoicePdf(Number(paymentInvoicePdfMatch[1])));
      return;
    }
    const paymentInvoiceSendMatch = /^\/api\/payment-invoices\/(\d+)\/send$/.exec(url.pathname);
    if (request.method === "POST" && paymentInvoiceSendMatch) {
      const body = await readJson(request);
      sendJson(response, 200, await payments.sendInvoice({
        invoice_id: Number(paymentInvoiceSendMatch[1]),
        preview_digest: body.previewDigest,
      }, { actorType: "user", actorName: "payments_page" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/global-search") {
      const scopes = url.searchParams.getAll("scope");
      sendJson(response, 200, await searchCoordinator.search({
        query: url.searchParams.get("q") || "",
        scopes: scopes.length ? scopes : null,
        mode: url.searchParams.get("mode") || "terms",
        maxDistance: url.searchParams.get("maxDistance") || 12,
        contextTokens: url.searchParams.get("contextTokens") || 24,
        limit: url.searchParams.get("limit") || 50,
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/native-objects/search") {
      const domainTypes = url.searchParams.getAll("domainType");
      sendJson(response, 200, await searchCoordinator.searchNativeObjects({
        query: url.searchParams.get("q") || "",
        limit: url.searchParams.get("limit") || 24,
        ...(domainTypes.length ? { domainTypes } : {}),
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/object-network") {
      sendJson(response, 200, objectNetwork.graph({
        type: url.searchParams.get("type"),
        source: url.searchParams.get("source"),
        id: url.searchParams.get("id"),
        ref: url.searchParams.get("ref"),
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/object-network/connections") {
      sendJson(response, 200, await objectNetwork.setConnection(await readJson(request), {
        actorType: "user", actorName: "object_network", source: "tailnet_web", channel: "web",
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/requests") {
      const presentation = (entries) => entries.map((entry) => ({
        ...entry,
        presentationHats: entry.explicitHats?.length
          ? entry.explicitHats
          : hatCatalog.hatsForCapabilities(entry.capabilities, { limit: 1 }),
      }));
      const afterEventSeq = url.searchParams.get("afterEventSeq");
      if (afterEventSeq !== null) {
        let changes;
        try {
          changes = ledger.recentRequestChanges(
            url.searchParams.get("limit"),
            afterEventSeq,
          );
        } catch (error) {
          throw Object.assign(error, { statusCode: 400 });
        }
        sendJson(response, 200, changes);
        return;
      }
      sendJson(response, 200, {
        requests: presentation(ledger.recentRequests(
          url.searchParams.get("limit"),
          url.searchParams.get("q"),
        )),
      });
      return;
    }
    const turnBriefDecisionMatch = /^\/api\/requests\/([0-9a-f][0-9a-f-]{35})\/turn-brief\/(continue|cancel)$/.exec(url.pathname);
    if (request.method === "POST" && turnBriefDecisionMatch) {
      const body = await readJson(request);
      const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
      if (!/^[0-9a-f][0-9a-f-]{35}$/.test(approvalId)) {
        sendJson(response, 400, { error: "A valid plan approval ID is required" });
        return;
      }
      const [, requestId, decision] = turnBriefDecisionMatch;
      const accepted = decision === "continue"
        ? queue.continueTurnBrief(requestId, approvalId)
        : queue.cancelTurnBrief(requestId, approvalId);
      if (!accepted) {
        sendJson(response, 409, { error: "That plan is no longer waiting for a decision" });
        return;
      }
      sendJson(response, 200, { requestId, approvalId, decision });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/ai-usage") {
      sendJson(response, 200, {
        entries: ledger.modelUsage({
          limit: url.searchParams.get("limit") || 1000,
          query: url.searchParams.get("q"),
        }),
        current: {
          transport: modelTransport.id,
          model: config.model,
        },
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/conversation/reset") {
      const unfinished = ledger.unfinishedRequestCount();
      if (unfinished > 0) {
        sendJson(response, 409, {
          error: `Wait for ${unfinished} active ${unfinished === 1 ? "request" : "requests"} before starting a new conversation`,
        });
        return;
      }
      sendJson(response, 200, {
        reset: true,
        eventId: ledger.resetModelConversation({ channel: "web" }),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/daily-paper") {
      const snapshotId = url.searchParams.get("snapshot");
      const snapshot = snapshotId ? dailyPaper.renderSnapshot(snapshotId) : null;
      if (snapshotId && !snapshot) {
        sendJson(response, 404, { error: "Weekly paper render snapshot is unavailable or expired" });
        return;
      }
      sendJson(response, 200, snapshot ?? await dailyPaper.buildWithWeather({
        date: url.searchParams.get("date"),
        rangeDate: url.searchParams.get("rangeDate"),
        timeZone: url.searchParams.get("timeZone"),
        paperSize: url.searchParams.get("paperSize"),
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/daily-paper/pdf") {
      const generated = await dailyPaper.generate(await readJson(request), {
        actorType: "user",
        actorName: "daily_paper_web",
        channel: "web",
      });
      sendJson(response, 201, {
        status: "complete",
        date: generated.model.date,
        timeZone: generated.model.timeZone,
        paperSize: generated.model.paperSize,
        eventCount: generated.model.printCalendarDays.reduce((count, day) => count + day.events.length, 0),
        todoCount: generated.model.printableTodoGroups.reduce(
          (count, group) => count + group.todos.length, 0,
        ),
        trackerCount: generated.model.scheduledTrackers.length,
        file: generated.file,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/todos/pdf") {
      const generated = await todoPdf.generate(await readJson(request, 8 * 1024 * 1024), {
        actorType: "user",
        actorName: "todo_checklist_web",
        channel: "web",
      });
      sendJson(response, 201, {
        status: "complete",
        groupCount: generated.model.groups.length,
        todoCount: generated.model.todoCount,
        filters: generated.model.filters,
        file: generated.file,
      });
      return;
    }
    const traceMatch = /^\/api\/requests\/([0-9a-f][0-9a-f-]{7,35})\/trace$/.exec(url.pathname);
    if (request.method === "GET" && traceMatch) {
      const resolved = ledger.resolveRequestId(traceMatch[1]);
      if (resolved.status === "missing") {
        sendJson(response, 404, { error: `No request matches ${traceMatch[1]}` });
        return;
      }
      if (resolved.status === "ambiguous") {
        sendJson(response, 409, { error: `More than one request matches ${traceMatch[1]}` });
        return;
      }
      if (resolved.status === "invalid") {
        sendJson(response, 400, { error: "Request ID must be an 8-36 character hexadecimal UUID or prefix" });
        return;
      }
      sendJson(response, 200, { requestId: resolved.requestId, events: ledger.trace(resolved.requestId) });
      return;
    }
    const videoDownloadMatch = /^\/api\/videos\/(\d+)\/download$/.exec(url.pathname);
    if (request.method === "GET" && videoDownloadMatch) {
      const file = ledger.file(Number(videoDownloadMatch[1]));
      if (!file || file.media_kind !== "video") {
        sendJson(response, 404, { error: "Video was not found" });
        return;
      }
      const filename = safeMediaPath(config.mediaRoot, file.storage_path);
      const stat = await fsp.stat(filename).catch(() => null);
      if (!stat?.isFile()) {
        sendJson(response, 404, { error: "The stored video file is missing" });
        return;
      }
      const downloadName = String(file.original_filename || `slayer-video-${file.file_id}.mp4`)
        .replace(/[^A-Za-z0-9._-]+/g, "-");
      response.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "private, no-store",
      });
      fs.createReadStream(filename).pipe(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/contacts") {
      sendJson(response, 200, {
        contacts: withContactScope(request, url, null, () => organizer.listContacts({
          scope: url.searchParams.get("scope") || "active",
          limit: url.searchParams.get("limit") || 500,
          query: url.searchParams.get("q"),
        })),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/mobile/contacts") {
      sendJson(response, 200, {
        contacts: organizer.listMobileContacts({
          deviceId: url.searchParams.get("deviceId"),
          limit: url.searchParams.get("limit") || 500,
          query: url.searchParams.get("q"),
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/contacts") {
      const body = await readJson(request);
      sendJson(response, 201, { contact: withContactScope(request, url, body, () => organizer.createContact(body)) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/contacts/duplicates") {
      sendJson(response, 200, withContactScope(request, url, null, () => organizer.listContactDuplicates({
        limit: url.searchParams.get("limit") || 100,
        offset: url.searchParams.get("offset") || 0,
        contactLimit: 1000,
      })));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/contacts/merge") {
      const body = await readJson(request);
      sendJson(response, 200, withContactScope(request, url, body, () => organizer.mergeContacts(body)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/contacts/bulk") {
      const body = await readJson(request, 2 * 1024 * 1024);
      sendJson(response, 200, withContactScope(request, url, body, () => organizer.bulkContacts(body)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/contacts/tags/rename") {
      const body = await readJson(request);
      sendJson(response, 200, withContactScope(request, url, body, () => organizer.renameContactTag(body)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/contacts/copy-timev3") {
      const body = await readJson(request);
      const sourceContactId = Number(body.sourceContactId);
      if (!Number.isSafeInteger(sourceContactId) || sourceContactId < 1) {
        throw Object.assign(new Error("sourceContactId must be a positive contact id."), { statusCode: 400 });
      }
      const source = organizer.getContact(sourceContactId);
      const method = source?.status === "active"
        ? source.methods.find((item) => item.kind === "timev3_person" && item.canReceive)
        : null;
      if (!source || !method) {
        throw Object.assign(new Error("Choose one of your active contacts with a Time v3 handle."), { statusCode: 404 });
      }
      const targetPersonId = contactScopePersonId(request, url, { managedPersonId: body.managedPersonId });
      if (targetPersonId === currentPersonId()) {
        throw Object.assign(new Error("Choose a managed person's contact list."), { statusCode: 400 });
      }
      const contact = runWithPerson(targetPersonId, () => organizer.createContact({
        kind: "person", displayName: source.displayName,
        methods: [{ kind: "timev3_person", label: "Time v3", value: method.value,
          isPrimary: true, canReceive: true }],
      }));
      sendJson(response, 201, { contact });
      return;
    }
    const contactMatch = /^\/api\/contacts\/(\d+)$/.exec(url.pathname);
    if (request.method === "GET" && contactMatch) {
      const contact = withContactScope(request, url, null, () => organizer.getContact(contactMatch[1]));
      if (!contact) throw Object.assign(new Error("Contact not found"), { statusCode: 404 });
      sendJson(response, 200, { contact });
      return;
    }
    if (request.method === "PATCH" && contactMatch) {
      const body = await readJson(request);
      sendJson(response, 200, { contact: withContactScope(request, url, body,
        () => organizer.updateContact(contactMatch[1], body)) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/calendar-events/search") {
      sendJson(response, 200, organizer.searchCalendar({
        query: url.searchParams.get("q"),
        includeArchived: url.searchParams.get("includeArchived") === "true",
        limit: url.searchParams.get("limit") || 100,
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/calendar-milestones") {
      sendJson(response, 200, {
        events: organizer.listCalendarMilestones({ at: url.searchParams.get("at") || new Date().toISOString() }),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/calendar-events") {
      sendJson(response, 200, {
        events: organizer.listCalendar({
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/calendar-events") {
      sendJson(response, 201, { event: organizer.createCalendar(await readJson(request)) });
      return;
    }
    const calendarContactLinkMatch = /^\/api\/calendar-events\/(\d+)\/contact-links$/.exec(url.pathname);
    if (request.method === "PATCH" && calendarContactLinkMatch) {
      sendJson(response, 200, organizer.changeCalendarEventContactLink(
        calendarContactLinkMatch[1], await readJson(request),
      ));
      return;
    }
    const calendarMatch = /^\/api\/calendar-events\/(\d+)$/.exec(url.pathname);
    if (request.method === "GET" && calendarMatch) {
      const event = organizer.getCalendar(calendarMatch[1]);
      if (!event) throw Object.assign(new Error("Calendar event not found"), { statusCode: 404 });
      sendJson(response, 200, { event });
      return;
    }
    if (request.method === "PATCH" && calendarMatch) {
      sendJson(response, 200, {
        event: organizer.updateCalendar(calendarMatch[1], await readJson(request)),
      });
      return;
    }
    if (request.method === "DELETE" && calendarMatch) {
      sendJson(response, 200, organizer.deleteCalendar(calendarMatch[1], await readJson(request)));
      return;
    }
    const calendarInviteDraftMatch = /^\/api\/calendar-events\/(\d+)\/invite-draft$/.exec(url.pathname);
    if (request.method === "POST" && calendarInviteDraftMatch) {
      if (!jmap.health().ready) {
        throw Object.assign(new Error("Fastmail email is not connected; the invitation draft was not created."), { statusCode: 503 });
      }
      const body = await readJson(request);
      const draft = await createCalendarInviteDraft({
        organizer,
        ledger,
        createEmailDraft: (input) => registry.execute("email_draft_create", input, { channel: "web" }),
      }, {
        calendarEventId: calendarInviteDraftMatch[1],
        contactIds: body.contactIds,
      });
      sendJson(response, 201, { draft });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/todos") {
      sendJson(response, 200, {
        todos: organizer.listTodos({
          scope: url.searchParams.get("scope") || "active",
          limit: url.searchParams.get("limit") || 500,
          query: url.searchParams.get("q"),
        }),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/calendar-routines/preview") {
      sendJson(response, 200, organizer.previewCalendarRoutines({
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/calendar-routines/generate") {
      sendJson(response, 200, organizer.generateCalendarRoutines(
        await readJson(request), { actorType: "user", actorName: "routines_page" },
      ));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/calendar-routines") {
      sendJson(response, 201, organizer.createCalendarRoutine(await readJson(request)));
      return;
    }
    const routineMatch = /^\/api\/calendar-routines\/(\d+)$/.exec(url.pathname);
    if (request.method === "GET" && routineMatch) {
      sendJson(response, 200, { routine: organizer.getCalendarRoutine(routineMatch[1]) });
      return;
    }
    if (request.method === "PATCH" && routineMatch) {
      sendJson(response, 200, {
        routine: organizer.updateCalendarRoutine(routineMatch[1], await readJson(request)),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/todo-groups") {
      sendJson(response, 200, { groups: organizer.listTodoGroups() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/todo-groups") {
      sendJson(response, 201, { group: organizer.createTodoGroup(await readJson(request)) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/todo-groups/reorder") {
      sendJson(response, 200, { groups: organizer.reorderTodoGroups(await readJson(request)) });
      return;
    }
    const todoGroupMatch = /^\/api\/todo-groups\/(\d+)$/.exec(url.pathname);
    if (request.method === "PATCH" && todoGroupMatch) {
      sendJson(response, 200, organizer.renameTodoGroup(todoGroupMatch[1], await readJson(request)));
      return;
    }
    const todoGroupArchiveMatch = /^\/api\/todo-groups\/(\d+)\/archive$/.exec(url.pathname);
    if (request.method === "POST" && todoGroupArchiveMatch) {
      sendJson(response, 200, organizer.archiveTodoGroup(todoGroupArchiveMatch[1]));
      return;
    }
    const todoGroupSequenceMatch = /^\/api\/todo-groups\/(\d+)\/sequence$/.exec(url.pathname);
    if (request.method === "POST" && todoGroupSequenceMatch) {
      sendJson(response, 200, organizer.setTodoGroupSequenceMode(
        todoGroupSequenceMatch[1], await readJson(request),
      ));
      return;
    }
    const todoGroupDailyPaperPinMatch = /^\/api\/todo-groups\/(\d+)\/daily-paper-pin$/.exec(url.pathname);
    if (request.method === "POST" && todoGroupDailyPaperPinMatch) {
      sendJson(response, 200, organizer.setTodoGroupDailyPaperPinned(
        todoGroupDailyPaperPinMatch[1], await readJson(request),
      ));
      return;
    }
    const todoGroupReorderMatch = /^\/api\/todo-groups\/(\d+)\/reorder$/.exec(url.pathname);
    if (request.method === "POST" && todoGroupReorderMatch) {
      sendJson(response, 200, {
        todos: organizer.reorderTodos(todoGroupReorderMatch[1], await readJson(request)),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/todos") {
      sendJson(response, 201, { todo: organizer.createTodo(await readJson(request)) });
      return;
    }
    const todoMatch = /^\/api\/todos\/(\d+)$/.exec(url.pathname);
    if (request.method === "GET" && todoMatch) {
      const todo = organizer.getTodo(todoMatch[1]);
      if (!todo) throw Object.assign(new Error("To-do not found"), { statusCode: 404 });
      sendJson(response, 200, { todo });
      return;
    }
    if (request.method === "PATCH" && todoMatch) {
      sendJson(response, 200, { todo: organizer.updateTodo(todoMatch[1], await readJson(request)) });
      return;
    }
    const todoAssignSequenceMatch = /^\/api\/todos\/(\d+)\/assign-next-sequence$/.exec(url.pathname);
    if (request.method === "POST" && todoAssignSequenceMatch) {
      sendJson(response, 200, {
        todo: organizer.assignNextTodoSequence(todoAssignSequenceMatch[1], await readJson(request)),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/physical-item-groups") {
      sendJson(response, 200, { groups: physicalItems.listGroups({
        includeArchived: url.searchParams.get("includeArchived") === "true",
      }) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/physical-item-groups") {
      sendJson(response, 201, { group: physicalItems.createGroup(await readJson(request)) });
      return;
    }
    const physicalItemGroupMatch = /^\/api\/physical-item-groups\/(\d+)$/.exec(url.pathname);
    if (request.method === "PATCH" && physicalItemGroupMatch) {
      sendJson(response, 200, { group: physicalItems.updateGroup(physicalItemGroupMatch[1], await readJson(request)) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/physical-items") {
      sendJson(response, 200, { items: physicalItems.list({
        groupId: url.searchParams.get("groupId"),
        status: url.searchParams.get("status"),
        query: url.searchParams.get("q"),
        limit: url.searchParams.get("limit") || 1000,
      }) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/physical-items") {
      sendJson(response, 201, { item: physicalItems.create(await readJson(request)) });
      return;
    }
    const physicalItemMatch = /^\/api\/physical-items\/(\d+)$/.exec(url.pathname);
    if (request.method === "GET" && physicalItemMatch) {
      const item = physicalItems.get(physicalItemMatch[1]);
      if (!item) throw Object.assign(new Error("Physical item not found"), { statusCode: 404 });
      sendJson(response, 200, { item });
      return;
    }
    if (request.method === "PATCH" && physicalItemMatch) {
      sendJson(response, 200, { item: physicalItems.update(physicalItemMatch[1], await readJson(request)) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/content-items") {
      sendJson(response, 200, {
        content: organizer.listContent({
          groupId: url.searchParams.get("groupId"),
          status: url.searchParams.get("status"),
          query: url.searchParams.get("q"),
          limit: url.searchParams.get("limit") || 1000,
        }),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/video-scripts") {
      sendJson(response, 200, videoScripts.list({
        status: url.searchParams.get("status") || "draft",
        limit: Number(url.searchParams.get("limit") || 200),
        query: url.searchParams.get("q"),
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/video-scripts/generate") {
      const body = await readJson(request);
      const sources = videoScripts.validateSelection(body.sourceRequestIds);
      const sourceRequestIds = sources.map(({ requestId }) => requestId);
      const runLimits = normalizeRunLimits(body.runLimits);
      const created = ledger.createRequest({
        text: [
          "Create one concise, copy-ready script for a video of the selected user-and-AI conversations below.",
          "Use the selected interactions in chronological order. Supply only a concise title and a one- or two-sentence description of what the conversation is about; the application will insert the exact request-response dialogue and omit all intermediate activity. Do not render an MP4.",
          ...sourceRequestIds.map((id, index) => `${index + 1}. Source interaction ${id}`),
        ].join("\n"),
        channel: "web",
        runLimits,
        metadata: {
          requestKind: "video_script",
          sourceRequestIds,
          model: config.videoModel,
          effort: config.videoReasoningEffort,
        },
      });
      queue.notify();
      sendJson(response, 202, { ...created, sourceRequestIds });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/video-productions/generate") {
      const body = await readJson(request);
      const sources = videoScripts.validateSelection(body.sourceRequestIds);
      const sourceRequestIds = sources.map(({ requestId }) => requestId);
      const runLimits = normalizeRunLimits(body.runLimits);
      const created = ledger.createRequest({
        text: [
          "Create one source-grounded video production from every selected interaction below.",
          "Supply only a concise title and a one- or two-sentence description of what the conversation is about, then call video_production_create exactly once.",
          "The application will create both the portable script and 1080x1620 MP4 as one continuous chat containing only the exact request followed by the exact final Agent response for each selected interaction. It will omit all intermediate activity, reasoning, trace, processing, tutorial, summary, intro, and outro material.",
          ...sourceRequestIds.map((id, index) => `${index + 1}. Source interaction ${id}`),
        ].join("\n"),
        channel: "web",
        runLimits,
        metadata: {
          requestKind: "video_production",
          sourceRequestIds,
          model: config.videoModel,
          effort: config.videoReasoningEffort,
        },
      });
      queue.notify();
      sendJson(response, 202, { ...created, sourceRequestIds });
      return;
    }
    const videoScriptMatch = /^\/api\/video-scripts\/(\d+)$/.exec(url.pathname);
    if (request.method === "GET" && videoScriptMatch) {
      const script = videoScripts.get(videoScriptMatch[1]);
      if (!script) {
        sendJson(response, 404, { error: "Video script not found" });
        return;
      }
      sendJson(response, 200, { script });
      return;
    }
    const videoScriptArchiveMatch = /^\/api\/video-scripts\/(\d+)\/archive$/.exec(url.pathname);
    const videoScriptRenderMatch = /^\/api\/video-scripts\/(\d+)\/render$/.exec(url.pathname);
    const videoScriptContentMatch = /^\/api\/video-scripts\/(\d+)\/content$/.exec(url.pathname);
    if (request.method === "POST" && videoScriptRenderMatch) {
      const result = videoScripts.queueRender(videoScriptRenderMatch[1], {
        actorType: "user", actorName: "web", channel: "web",
      });
      if (result.queued) videoRenderWorker?.notify();
      sendJson(response, result.queued ? 202 : 200, result);
      return;
    }
    if (request.method === "POST" && videoScriptArchiveMatch) {
      const body = await readJson(request);
      sendJson(response, 200, videoScripts.archive(
        videoScriptArchiveMatch[1],
        body.version,
        { actorType: "user", actorName: "web", channel: "web" },
      ));
      return;
    }
    if (request.method === "POST" && videoScriptContentMatch) {
      const body = await readJson(request);
      const result = videoContent.add({
        videoScriptId: videoScriptContentMatch[1], groupId: body.groupId,
      }, {
        actorType: "user", actorName: "web", channel: "web",
      });
      sendJson(response, result.created ? 201 : 200, {
        ...result,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/content-groups") {
      sendJson(response, 200, { groups: organizer.listContentGroups() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/content-groups") {
      sendJson(response, 201, { group: organizer.createContentGroup(await readJson(request)) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/content-groups/reorder") {
      sendJson(response, 200, { groups: organizer.reorderContentGroups(await readJson(request)) });
      return;
    }
    const contentGroupSequenceMatch = /^\/api\/content-groups\/(\d+)\/sequence$/.exec(url.pathname);
    if (request.method === "POST" && contentGroupSequenceMatch) {
      sendJson(response, 200, organizer.setContentGroupSequenceMode(
        contentGroupSequenceMatch[1], await readJson(request),
        { actorType: "user", actorName: "web", source: "tailnet_web", channel: "web" },
      ));
      return;
    }
    const contentGroupMatch = /^\/api\/content-groups\/(\d+)$/.exec(url.pathname);
    if (request.method === "PATCH" && contentGroupMatch) {
      sendJson(response, 200, organizer.renameContentGroup(contentGroupMatch[1], await readJson(request)));
      return;
    }
    const contentGroupArchiveMatch = /^\/api\/content-groups\/(\d+)\/archive$/.exec(url.pathname);
    if (request.method === "POST" && contentGroupArchiveMatch) {
      sendJson(response, 200, organizer.archiveContentGroup(contentGroupArchiveMatch[1]));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/content-items") {
      sendJson(response, 201, { content: organizer.createContent(await readJson(request)) });
      return;
    }
    const contentMatch = /^\/api\/content-items\/(\d+)$/.exec(url.pathname);
    if (request.method === "GET" && url.pathname === "/api/music") {
      const result = ledger.listFiles({
        query: url.searchParams.get("query"),
        limit: url.searchParams.get("limit") || 500,
        mediaKind: "audio",
        musicMetadataOnly: true,
      });
      const durationFiles = await musicDurationResolver.enrich(result.files);
      const files = durationFiles.flatMap((file) => {
        const entry = musicLibraryEntry(file);
        return entry ? [{ ...entry, streamUrl: `/api/music/${file.fileId}/stream` }] : [];
      });
      sendJson(response, 200, {
        schemaVersion: 2,
        count: files.length,
        files,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/music/narrations") {
      const narration = await musicNarration.create(await readJson(request, 4 * 1024));
      sendJson(response, 201, { narration });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/music/prepared-concerts") {
      const input = await readJson(request, 256 * 1024);
      if (!Array.isArray(input?.items)) {
        throw Object.assign(new Error("Prepared concert items are required"), { statusCode: 400 });
      }
      for (const item of input.items) {
        if (item?.kind !== "music") continue;
        const fileId = Number(item.fileId);
        const file = Number.isSafeInteger(fileId) ? ledger.file(fileId) : null;
        if (!file || file.media_kind !== "audio" || !parseMusicMetadataDescription(file.description).metadata) {
          throw Object.assign(new Error(`Music file ${String(item.fileId)} is not available for concert playback`), { statusCode: 400 });
        }
      }
      sendJson(response, 201, { concert: await preparedConcerts.create(input) });
      return;
    }
    const preparedConcertMatch = /^\/api\/music\/prepared-concerts\/([0-9a-f-]{36})$/u.exec(url.pathname);
    if (request.method === "DELETE" && preparedConcertMatch) {
      sendJson(response, 200, { discarded: preparedConcerts.discard(preparedConcertMatch[1]) });
      return;
    }
    const musicNarrationStreamMatch = /^\/api\/music\/narrations\/([0-9a-f-]{36})\/stream$/u.exec(url.pathname);
    if (request.method === "GET" && musicNarrationStreamMatch) {
      const narration = musicNarration.get(musicNarrationStreamMatch[1]);
      if (!narration) {
        sendJson(response, 404, { error: "Concert narration was not found or has expired" });
        return;
      }
      sendAudioBuffer(request, response, {
        bytes: narration.bytes,
        mimeType: narration.mimeType,
        filename: `concert-narration-${narration.narrationId}.wav`,
        aiGenerated: true,
      });
      return;
    }
    const musicStreamMatch = /^\/api\/music\/(\d+)\/stream$/.exec(url.pathname);
    if (request.method === "GET" && musicStreamMatch) {
      const file = ledger.file(Number(musicStreamMatch[1]));
      if (!file || file.media_kind !== "audio") {
        sendJson(response, 404, { error: "Music file was not found" });
        return;
      }
      if (!parseMusicMetadataDescription(file.description).metadata) {
        sendJson(response, 404, { error: "Music file was not found" });
        return;
      }
      await sendStoredMusic(request, response, file);
      return;
    }
    const fileDownloadMatch = /^\/api\/files\/(\d+)\/download$/.exec(url.pathname);
    if (request.method === "GET" && fileDownloadMatch) {
      const file = ledger.file(Number(fileDownloadMatch[1]));
      if (!file) {
        sendJson(response, 404, { error: "File was not found" });
        return;
      }
      const filename = safeMediaPath(config.mediaRoot, file.storage_path);
      const stat = await fsp.stat(filename).catch(() => null);
      if (!stat?.isFile()) {
        sendJson(response, 404, { error: "The stored file is missing" });
        return;
      }
      const downloadName = String(file.original_filename || `file-${file.file_id}`)
        .replace(/[^A-Za-z0-9._-]+/g, "-");
      response.writeHead(200, {
        "Content-Type": file.mime_type || "application/octet-stream",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "private, no-store",
      });
      fs.createReadStream(filename).pipe(response);
      return;
    }
    if (request.method === "PATCH" && contentMatch) {
      sendJson(response, 200, { content: organizer.updateContent(contentMatch[1], await readJson(request)) });
      return;
    }
    if (request.method === "DELETE" && contentMatch) {
      sendJson(response, 200, organizer.deleteContent(contentMatch[1], await readJson(request)));
      return;
    }
    const trackerScheduleMatch = /^\/api\/journal-trackers\/(\d+)\/schedule$/.exec(url.pathname);
    if (request.method === "PATCH" && trackerScheduleMatch) {
      const input = await readJson(request);
      sendJson(response, 200, journalSchedule.setTrackerSchedule({
        tracker_id: Number(trackerScheduleMatch[1]),
        starts_at_utc: input.starts_at_utc ?? null,
        recurrence: input.recurrence ?? null,
      }, {
        actorType: "user",
        actorName: "tracker_schedule_web",
        channel: "web",
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/journal-trackers") {
      sendJson(response, 200, {
        trackers: organizer.listJournalTrackers({
          groupId: url.searchParams.get("groupId"),
          includeArchived: url.searchParams.get("includeArchived") === "true",
          limit: url.searchParams.get("limit") || 200,
          timeZone: url.searchParams.get("timeZone"),
          localDate: url.searchParams.get("localDate"),
          query: url.searchParams.get("q"),
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/journal-trackers") {
      sendJson(response, 201, { tracker: organizer.createJournalTracker(await readJson(request)) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/journal-groups") {
      sendJson(response, 200, {
        groups: organizer.listJournalGroups({
          includeArchived: url.searchParams.get("includeArchived") === "true",
        }),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/journal-entries") {
      sendJson(response, 200, {
        entries: organizer.listJournalEntries({
          trackerId: url.searchParams.get("trackerId"),
          groupId: url.searchParams.get("groupId"),
          limit: url.searchParams.get("limit") || 200,
          query: url.searchParams.get("q"),
        }),
      });
      return;
    }
    const journalEntryMatch = /^\/api\/journal-entries\/(\d+)$/.exec(url.pathname);
    if (request.method === "PATCH" && journalEntryMatch) {
      sendJson(response, 200, { entry: organizer.updateJournalEntry(journalEntryMatch[1], await readJson(request)) });
      return;
    }
    const journalGroupMatch = /^\/api\/journal-groups\/(\d+)$/.exec(url.pathname);
    if (request.method === "PATCH" && journalGroupMatch) {
      sendJson(response, 200, organizer.renameJournalGroup(journalGroupMatch[1], await readJson(request)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/journal-entries") {
      sendJson(response, 201, { entry: organizer.createJournalEntry(await readJson(request)) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/files") {
      sendJson(response, 200, ledger.listFiles({
        query: url.searchParams.get("query"),
        limit: url.searchParams.get("limit") || 200,
      }));
      return;
    }
    const fileMetadataMatch = /^\/api\/files\/(\d+)$/.exec(url.pathname);
    if (request.method === "GET" && fileMetadataMatch) {
      const file = ledger.fileDetails(Number(fileMetadataMatch[1]));
      if (!file) {
        sendJson(response, 404, { error: `File ${fileMetadataMatch[1]} was not found` });
        return;
      }
      sendJson(response, 200, { file });
      return;
    }
    if (request.method === "PATCH" && fileMetadataMatch) {
      const body = await readJson(request);
      const file = ledger.updateFile(Number(fileMetadataMatch[1]), {
        title: body.title,
        description: body.description,
        titleSource: "user",
      });
      ledger.append({
        type: "file.metadata.updated",
        status: "complete",
        actorType: "user",
        actorName: "web",
        name: `Updated file #${file.fileId} metadata`,
        subjectType: "file",
        subjectId: String(file.fileId),
        payload: { fileId: file.fileId, titleSource: file.titleSource },
      });
      sendJson(response, 200, { file });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/request-files") {
      const file = await receiveRequestAttachment(request, {
        filename: url.searchParams.get("filename"),
        mediaRoot: config.mediaRoot,
        maximumBytes: config.maxRequestAttachmentBytes,
        ledger,
      });
      sendJson(response, 201, file);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/requests") {
      assertAiAllowance(request);
      // A request may carry a bounded bulk object selection. The ordinary
      // endpoint default is intentionally smaller, but 500 complete identity
      // tuples need a larger explicit envelope.
      const body = await readJson(request, 2 * 1024 * 1024);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw Object.assign(new Error("Request text is required"), { statusCode: 400 });
      const attachmentFileIds = normalizeAttachmentFileIds(body.attachmentFileIds);
      const primaryFileId = body.primaryFileId == null
        ? (attachmentFileIds[0] ?? null)
        : Number(body.primaryFileId);
      const runLimits = normalizeRunLimits(body.runLimits);
      const referencedRequestIds = normalizeReferencedRequestIds(body.referencedRequestIds);
      let selectedObjectCandidates;
      try {
        selectedObjectCandidates = normalizeSelectedObjectCandidates(body.selectedObjectCandidates);
      } catch (error) {
        throw Object.assign(error, { statusCode: 400 });
      }
      if (primaryFileId !== null) {
        if (!Number.isSafeInteger(primaryFileId) || primaryFileId <= 0) {
          throw Object.assign(new Error("Request attachment ID is invalid"), { statusCode: 400 });
        }
        const file = ledger.file(primaryFileId);
        if (!file || !["document", "image", "audio"].includes(file.media_kind)) {
          throw Object.assign(new Error("Request attachment was not found"), { statusCode: 404 });
        }
      }
      const effectiveAttachmentFileIds = attachmentFileIds.length
        ? attachmentFileIds
        : (primaryFileId == null ? [] : [primaryFileId]);
      if (primaryFileId != null && !effectiveAttachmentFileIds.includes(primaryFileId)) {
        throw Object.assign(new Error("The primary file must be included in attachmentFileIds"), { statusCode: 400 });
      }
      const attachedFiles = effectiveAttachmentFileIds.map((fileId) => ledger.file(fileId));
      if (attachedFiles.some((attachedFile) => !attachedFile)) {
        throw Object.assign(new Error("One or more request attachments were not found"), { statusCode: 404 });
      }
      if (attachedFiles.length > 1 && attachedFiles.some((attachedFile) => attachedFile.media_kind !== "audio")) {
        throw Object.assign(new Error("Grouped request attachments must all be MP3 audio files"), { statusCode: 400 });
      }
      for (const referencedRequestId of referencedRequestIds) ledger.exchangeReference(referencedRequestId);
      const created = ledger.createRequest({
        text,
        channel: "web",
        primaryFileId,
        attachmentFileIds: effectiveAttachmentFileIds,
        runLimits,
        metadata: {
          ...(effectiveAttachmentFileIds.length ? { attachmentFileIds: effectiveAttachmentFileIds } : {}),
          ...(referencedRequestIds.length ? { referencedRequestIds } : {}),
          ...(selectedObjectCandidates.length ? { selectedObjectCandidates } : {}),
        },
      });
      sendJson(response, 202, created);
      queue.notify();
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/voice") {
      assertAiAllowance(request);
      let voiceRunLimits = null;
      const encodedRunLimits = url.searchParams.get("runLimits");
      if (encodedRunLimits !== null) {
        let parsedRunLimits;
        try {
          parsedRunLimits = JSON.parse(encodedRunLimits);
        } catch {
          throw Object.assign(new Error("runLimits must be valid JSON"), { statusCode: 400 });
        }
        voiceRunLimits = normalizeRunLimits(parsedRunLimits);
      }
      const file = await receiveAudio(request);
      const created = ledger.createRequest({
        channel: "voice", primaryFileId: file.fileId, runLimits: voiceRunLimits,
      });
      sendJson(response, 202, { ...created, fileId: file.fileId });
      queue.notify();
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error("[agent-slayer] request failed:", error);
    sendJson(response, error.statusCode || 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`[agent-slayer] ${identity.commit || "uncommitted"}${identity.dirty ? "-dirty" : ""} listening on http://${config.host}:${config.port}`);
  const startupPersonIds = [...new Set([
    config.legacyPersonId,
    ...(identityStore?.activePersonIds() ?? []),
  ])];
  if (store.status.ready) for (const personId of startupPersonIds) queue.notify(personId);
  videoRenderWorker?.start(startupPersonIds);
});

async function shutdown() {
  server.close();
  await videoRenderWorker?.stop();
  transcriber.close();
  await modelTransport.close();
  await mcp.close();
  organizer?.close();
  correspondenceSync?.close();
  messagesWebSync?.close();
  identityStore?.close();
  store.close();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

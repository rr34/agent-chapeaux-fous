import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { ContextBuilder } from "./context.mjs";
import { SlayerDatabase } from "./database.mjs";
import { Ledger } from "./ledger.mjs";
import { JmapClient } from "./jmap-client.mjs";
import { InteractionGuides } from "./interaction-guides.mjs";
import { createCalendarInviteDraft } from "./calendar-invite-draft.mjs";
import { OrganizerStore } from "./organizer-store.mjs";
import { createModelTransport } from "./model-transport.mjs";
import { RequestQueue } from "./queue.mjs";
import { RequestCompiler } from "./request-compiler.mjs";
import { receiveTextAttachment, safeMediaPath } from "./request-attachments.mjs";
import { normalizeRunLimits } from "./run-limits.mjs";
import { SlayerRuntime } from "./runtime.mjs";
import { runtimeIdentity } from "./runtime-identity.mjs";
import { SchemaSemantics } from "./schema-semantics.mjs";
import { WhisperTranscriber } from "./transcriber.mjs";
import { registerDatabaseTools } from "./tools/database-tools.mjs";
import { registerJmapEmailTools } from "./tools/jmap-email-tools.mjs";
import { registerCalendarTools } from "./tools/calendar-tools.mjs";
import { registerContactTools } from "./tools/contact-tools.mjs";
import { registerLogTools } from "./tools/log-tools.mjs";
import { registerInteractionGuideTools } from "./tools/interaction-guide-tools.mjs";
import { McpToolManager } from "./tools/mcp-tools.mjs";
import { ProfileFacts } from "./profile-facts.mjs";
import { loadProfileFactQuestions } from "./profile-fact-questions.mjs";
import { ToolRegistry } from "./tools/registry.mjs";
import { registerProfileFactTools } from "./tools/profile-fact-tools.mjs";
import { registerTodoTools } from "./tools/todo-tools.mjs";
import { registerWebPageTools } from "./tools/web-page-tools.mjs";
import { registerVideoTools } from "./tools/video-tools.mjs";
import { VideoService } from "./video-service.mjs";
import { WebPageClient } from "./web-page-client.mjs";

const config = loadConfig();
const identity = runtimeIdentity(config.repositoryRoot);
const store = new SlayerDatabase(config.databasePath);
const ledger = new Ledger(store);
const organizer = store.status.ready ? new OrganizerStore(config.databasePath) : null;
const profileFacts = new ProfileFacts({ store, ledger });
const interactionGuides = new InteractionGuides({ store, ledger });
const profileFactQuestions = await loadProfileFactQuestions(config.profileFactQuestionsPath);
const schemaSemantics = new SchemaSemantics({ filename: config.schemaSemanticsPath, ledger });
const registry = new ToolRegistry();
const videoService = new VideoService({
  ledger,
  mediaRoot: config.mediaRoot,
  outputRoot: config.videoOutputRoot,
  browserExecutable: config.remotionBrowserExecutable,
});
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
  oauthRoot: config.mcpOAuthRoot,
  publicUrl: config.publicUrl,
});
const jmap = new JmapClient({
  sessionUrl: config.jmapSessionUrl,
  accessToken: config.jmapAccessToken,
  accountId: config.jmapAccountId,
  required: config.jmapRequired,
  timeoutMs: config.jmapTimeoutMs,
});
if (store.status.ready) {
  registerCalendarTools(registry, store, organizer, ledger, schemaSemantics);
  registerContactTools(registry, store, organizer, ledger, schemaSemantics);
  registerTodoTools(registry, store, ledger, schemaSemantics);
  registerLogTools(registry, store, ledger, schemaSemantics);
  registerInteractionGuideTools(registry, interactionGuides, schemaSemantics);
  registerProfileFactTools(registry, profileFacts, schemaSemantics);
  registerDatabaseTools(registry, store, ledger, schemaSemantics);
  registerVideoTools(registry, videoService);
}
await mcp.initialize(registry);
await jmap.initialize();
if (jmap.health().ready) registerJmapEmailTools(registry, jmap);
const contextBuilder = new ContextBuilder({
  ledger,
  profileFacts,
  store,
  profileFactQuestions,
  maximumAttachmentCharacters: config.maxAttachmentContextCharacters,
});
const requestCompiler = new RequestCompiler({ instructionRoot: config.capabilityInstructionsPath });
const runtime = new SlayerRuntime({ modelTransport, registry, contextBuilder, requestCompiler, ledger, config });
const transcriber = new WhisperTranscriber({
  pythonExecutable: config.pythonExecutable,
  workerPath: config.whisperWorkerPath,
  timeoutMs: config.whisperTimeoutMs,
});
const queue = new RequestQueue({
  ledger,
  runtime,
  transcriber,
  mediaRoot: config.mediaRoot,
  maxTextAttachmentBytes: config.maxTextAttachmentBytes,
});

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/event-date-time.js", ["event-date-time.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
  ["/service-worker.js", ["service-worker.js", "text/javascript; charset=utf-8"]],
  ["/icon.svg", ["icon.svg", "image/svg+xml"]],
]);

function sendJson(response, statusCode, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": encoded.length,
    "Cache-Control": "no-store",
  });
  response.end(encoded);
}

function sendOAuthPage(response, statusCode, { title, message, redirect = false }) {
  const escapedTitle = String(title).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
  const escapedMessage = String(message).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
  const body = Buffer.from(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapedTitle}</title><body><main><h1>${escapedTitle}</h1><p>${escapedMessage}</p><p><a href="/">Return to Agent Slayer</a></p></main>${redirect ? '<script>setTimeout(() => location.replace("/?oauth=connected"), 800)</script>' : ""}</body></html>`);
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

function authorized(request) {
  if (config.allowUnauthenticated) return true;
  const header = String(request.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.accessToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function requireAuthorization(request, response) {
  if (authorized(request)) return true;
  sendJson(response, 401, { error: "A valid Slayer access token is required" });
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
  const integrationProblem = mcp.requiredProblem() || jmap.requiredProblem();
  return {
    ready: store.status.ready && model.ready && !integrationProblem,
    reason: store.status.ready ? (model.ready ? integrationProblem : model.reason) : store.status.reason,
    runtime: identity,
    model: { ...model, id: modelTransport.id, displayName: modelTransport.displayName, model: config.model },
    database: store.status,
    schemaSemantics: schemaSemantics.health(),
    integrations: { ...mcp.health(), email: jmap.health() },
    tools: registry.list().map((tool) => ({
      name: tool.name,
      source: tool.source,
      upstreamName: tool.upstreamName ?? null,
    })),
  };
}

async function serveStatic(pathname, response) {
  const selected = staticFiles.get(pathname);
  if (!selected) return false;
  const [name, contentType] = selected;
  const body = await fsp.readFile(path.join(config.publicRoot, name));
  response.writeHead(200, { "Content-Type": contentType, "Content-Length": body.length, "Cache-Control": pathname === "/service-worker.js" ? "no-cache" : "public, max-age=300" });
  response.end(body);
  return true;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
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
    if (request.method === "GET" && staticFiles.has(url.pathname)) {
      await serveStatic(url.pathname, response);
      return;
    }
    if (!requireAuthorization(request, response)) return;
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
    if (!store.status.ready) {
      sendJson(response, 503, { error: store.status.reason });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/requests") {
      sendJson(response, 200, { requests: ledger.recentRequests(url.searchParams.get("limit")) });
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
        contacts: organizer.listContacts({
          scope: url.searchParams.get("scope") || "active",
          limit: url.searchParams.get("limit") || 500,
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/contacts") {
      sendJson(response, 201, { contact: organizer.createContact(await readJson(request)) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/contacts/duplicates") {
      sendJson(response, 200, organizer.listContactDuplicates({
        limit: url.searchParams.get("limit") || 100,
        offset: url.searchParams.get("offset") || 0,
        contactLimit: 1000,
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/contacts/merge") {
      sendJson(response, 200, organizer.mergeContacts(await readJson(request)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/contacts/bulk") {
      sendJson(response, 200, organizer.bulkContacts(await readJson(request, 2 * 1024 * 1024)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/contacts/tags/rename") {
      sendJson(response, 200, organizer.renameContactTag(await readJson(request)));
      return;
    }
    const contactMatch = /^\/api\/contacts\/(\d+)$/.exec(url.pathname);
    if (request.method === "PATCH" && contactMatch) {
      sendJson(response, 200, { contact: organizer.updateContact(contactMatch[1], await readJson(request)) });
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
    const calendarMatch = /^\/api\/calendar-events\/(\d+)$/.exec(url.pathname);
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
        }),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/interaction-guides") {
      sendJson(response, 200, {
        guides: interactionGuides.list({
          status: url.searchParams.get("status") || "active",
          limit: Number(url.searchParams.get("limit") || 500),
        }).guides,
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
    if (request.method === "POST" && url.pathname === "/api/todos/move-overdue-to-today") {
      sendJson(response, 200, organizer.moveOverdueTodosToToday(await readJson(request)));
      return;
    }
    const todoMatch = /^\/api\/todos\/(\d+)$/.exec(url.pathname);
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
    if (request.method === "PATCH" && contentMatch) {
      sendJson(response, 200, { content: organizer.updateContent(contentMatch[1], await readJson(request)) });
      return;
    }
    if (request.method === "DELETE" && contentMatch) {
      sendJson(response, 200, organizer.deleteContent(contentMatch[1], await readJson(request)));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/log-trackers") {
      sendJson(response, 200, {
        trackers: organizer.listLogTrackers({
          groupId: url.searchParams.get("groupId"),
          includeArchived: url.searchParams.get("includeArchived") === "true",
          limit: url.searchParams.get("limit") || 200,
        }),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/log-entries") {
      sendJson(response, 200, {
        entries: organizer.listLogEntries({
          trackerId: url.searchParams.get("trackerId"),
          groupId: url.searchParams.get("groupId"),
          limit: url.searchParams.get("limit") || 200,
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/log-entries") {
      sendJson(response, 201, { entry: organizer.createLogEntry(await readJson(request)) });
      return;
    }
    const integrationProblem = mcp.requiredProblem() || jmap.requiredProblem();
    if (integrationProblem) {
      sendJson(response, 503, { error: integrationProblem });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/request-files") {
      const file = await receiveTextAttachment(request, {
        filename: url.searchParams.get("filename"),
        mediaRoot: config.mediaRoot,
        maximumBytes: config.maxTextAttachmentBytes,
        ledger,
      });
      sendJson(response, 201, file);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/requests") {
      const body = await readJson(request);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw Object.assign(new Error("Request text is required"), { statusCode: 400 });
      const primaryFileId = body.primaryFileId == null ? null : Number(body.primaryFileId);
      const runLimits = normalizeRunLimits(body.runLimits);
      if (primaryFileId !== null) {
        if (!Number.isSafeInteger(primaryFileId) || primaryFileId <= 0) {
          throw Object.assign(new Error("Request attachment ID is invalid"), { statusCode: 400 });
        }
        const file = ledger.file(primaryFileId);
        if (!file || file.media_kind !== "document") {
          throw Object.assign(new Error("Request attachment was not found"), { statusCode: 404 });
        }
      }
      const created = ledger.createRequest({ text, channel: "web", primaryFileId, runLimits });
      queue.notify();
      sendJson(response, 202, created);
      return;
    }
    const interactionVideoMatch = /^\/api\/requests\/([0-9a-f][0-9a-f-]{7,35})\/video$/.exec(url.pathname);
    if (request.method === "POST" && interactionVideoMatch) {
      const resolved = ledger.resolveRequestId(interactionVideoMatch[1]);
      if (resolved.status === "missing") {
        sendJson(response, 404, { error: `No request matches ${interactionVideoMatch[1]}` });
        return;
      }
      if (resolved.status === "ambiguous") {
        sendJson(response, 409, { error: `More than one request matches ${interactionVideoMatch[1]}` });
        return;
      }
      if (resolved.status === "invalid") {
        sendJson(response, 400, { error: "Request ID must be an 8-36 character hexadecimal UUID or prefix" });
        return;
      }
      ledger.interactionVideoSource(resolved.requestId);
      const existing = ledger.videoForSourceRequest(resolved.requestId);
      if (existing && existing.status !== "error") {
        sendJson(response, 200, { existing: true, ...existing });
        return;
      }
      const body = await readJson(request);
      const runLimits = normalizeRunLimits(body.runLimits) ?? { maxToolCalls: 256, timeoutMs: 60 * 60 * 1000 };
      const created = ledger.createRequest({
        text: `Create the finished vertical interaction video MP4 for source interaction ${resolved.requestId}. Normalize its Whisper transcript for captions, select one coherent audio section, accurately show the real agent activity and response, render it, and return the download link.`,
        channel: "web",
        runLimits,
        metadata: {
          requestKind: "interaction_video",
          sourceRequestId: resolved.requestId,
          model: config.videoModel,
          effort: config.videoReasoningEffort,
        },
      });
      queue.notify();
      sendJson(response, 202, { ...created, sourceRequestId: resolved.requestId });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/voice") {
      const file = await receiveAudio(request);
      const created = ledger.createRequest({ channel: "voice", primaryFileId: file.fileId });
      queue.notify();
      sendJson(response, 202, { ...created, fileId: file.fileId });
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
  if (store.status.ready && mcp.ready() && !jmap.requiredProblem()) queue.notify();
});

async function shutdown() {
  server.close();
  transcriber.close();
  await modelTransport.close();
  await mcp.close();
  organizer?.close();
  store.close();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

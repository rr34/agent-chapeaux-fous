import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { ContextBuilder } from "./context.mjs";
import { SlayerDatabase } from "./database.mjs";
import { Ledger } from "./ledger.mjs";
import { createModelTransport } from "./model-transport.mjs";
import { RequestQueue } from "./queue.mjs";
import { SlayerRuntime } from "./runtime.mjs";
import { runtimeIdentity } from "./runtime-identity.mjs";
import { WhisperTranscriber } from "./transcriber.mjs";
import { registerDatabaseTools } from "./tools/database-tools.mjs";
import { McpToolManager } from "./tools/mcp-tools.mjs";
import { ToolRegistry } from "./tools/registry.mjs";
import { registerTodoTools } from "./tools/todo-tools.mjs";

const config = loadConfig();
const identity = runtimeIdentity(config.repositoryRoot);
const store = new SlayerDatabase(config.databasePath);
const ledger = new Ledger(store);
const registry = new ToolRegistry();
const modelTransport = await createModelTransport(config);
await modelTransport.start().catch((error) => {
  console.error(`[agent-slayer] ${modelTransport.displayName} transport startup failed:`, error);
});
const mcp = new McpToolManager({ configPath: config.mcpConfigPath });
if (store.status.ready) {
  registerTodoTools(registry, store, ledger);
  registerDatabaseTools(registry, store, ledger);
}
await mcp.initialize(registry);
const contextBuilder = new ContextBuilder({ ledger, profilePath: config.profilePath });
const runtime = new SlayerRuntime({ modelTransport, registry, contextBuilder, ledger, config });
const transcriber = new WhisperTranscriber({
  pythonExecutable: config.pythonExecutable,
  workerPath: config.whisperWorkerPath,
  timeoutMs: config.whisperTimeoutMs,
});
const queue = new RequestQueue({ ledger, runtime, transcriber, mediaRoot: config.mediaRoot });

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
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
  return {
    ready: store.status.ready && model.ready,
    runtime: identity,
    model: { ...model, id: modelTransport.id, displayName: modelTransport.displayName, model: config.model },
    database: store.status,
    integrations: mcp.health(),
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
    if (!store.status.ready) {
      sendJson(response, 503, { error: store.status.reason });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/requests") {
      const body = await readJson(request);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw Object.assign(new Error("Request text is required"), { statusCode: 400 });
      const created = ledger.createRequest({ text, channel: "web" });
      queue.notify();
      sendJson(response, 202, created);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/voice") {
      const file = await receiveAudio(request);
      const created = ledger.createRequest({ channel: "voice", primaryFileId: file.fileId });
      queue.notify();
      sendJson(response, 202, { ...created, fileId: file.fileId });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/requests") {
      sendJson(response, 200, { requests: ledger.recentRequests(url.searchParams.get("limit")) });
      return;
    }
    const traceMatch = /^\/api\/requests\/([0-9a-f-]+)\/trace$/.exec(url.pathname);
    if (request.method === "GET" && traceMatch) {
      sendJson(response, 200, { requestId: traceMatch[1], events: ledger.trace(traceMatch[1]) });
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
  if (store.status.ready) queue.notify();
});

async function shutdown() {
  server.close();
  transcriber.close();
  await modelTransport.close();
  await mcp.close();
  store.close();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

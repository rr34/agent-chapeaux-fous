#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentFilename = path.join(repositoryRoot, ".env.live-inspect");
if (fs.existsSync(environmentFilename)) {
  const mode = fs.statSync(environmentFilename).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(".env.live-inspect must not be readable or writable by group or other users; run chmod 600 .env.live-inspect");
  }
  process.loadEnvFile(environmentFilename);
}

function usage(message = null) {
  if (message) console.error(message);
  console.error(`Usage:
  npm run live:inspect -- requests [limit]
  npm run live:inspect -- trace <request-id-or-prefix>
  npm run live:inspect -- schema [object-name]
  npm run live:inspect -- read <object-name> [where-json] [limit]`);
  process.exitCode = 2;
}

function liveConfiguration() {
  const baseUrlText = process.env.SLAYER_LIVE_URL?.trim() || "";
  const token = process.env.SLAYER_LIVE_INSPECT_TOKEN?.trim() || "";
  if (!baseUrlText || !token) {
    throw new Error("Set SLAYER_LIVE_URL and SLAYER_LIVE_INSPECT_TOKEN in .env.live-inspect");
  }
  const baseUrl = new URL(baseUrlText);
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && loopback.has(baseUrl.hostname))) {
    throw new Error("SLAYER_LIVE_URL must use HTTPS unless it is a loopback URL");
  }
  if (baseUrl.username || baseUrl.password || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
    throw new Error("SLAYER_LIVE_URL must be an origin without credentials, a path, query, or fragment");
  }
  return { baseUrl, token };
}

async function request(pathname, { method = "GET", body = null } = {}) {
  const { baseUrl, token } = liveConfiguration();
  const root = baseUrl.href.endsWith("/") ? baseUrl : new URL(`${baseUrl.href}/`);
  const url = new URL(pathname.replace(/^\//, ""), root);
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body == null ? {} : { "Content-Type": "application/json" }),
    },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch { result = { rawResponse: text }; }
  if (!response.ok) {
    throw new Error(`Live Slayer returned HTTP ${response.status}: ${result.error || text || response.statusText}`);
  }
  return result;
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2);
  let result;
  if (command === "requests") {
    const limit = argumentsList[0] || "100";
    if (!/^\d+$/.test(limit)) return usage("Request limit must be an integer");
    result = await request(`/api/requests?limit=${encodeURIComponent(limit)}`);
  } else if (command === "trace") {
    const requestId = argumentsList[0] || "";
    if (!/^[0-9a-f][0-9a-f-]{7,35}$/i.test(requestId)) return usage("Trace requires an 8-36 character request UUID or prefix");
    result = await request(`/api/requests/${encodeURIComponent(requestId)}/trace`);
  } else if (command === "schema") {
    const objectName = argumentsList[0];
    result = await request(`/api/database/schema${objectName ? `?objectName=${encodeURIComponent(objectName)}` : ""}`);
  } else if (command === "read") {
    const [objectName, whereText = "{}", limitText = "50"] = argumentsList;
    if (!objectName) return usage("Read requires an object name");
    if (!/^\d+$/.test(limitText)) return usage("Read limit must be an integer");
    let where;
    try { where = JSON.parse(whereText); }
    catch { return usage("Read where-json must be valid JSON"); }
    if (!where || typeof where !== "object" || Array.isArray(where)) return usage("Read where-json must be a JSON object");
    result = await request("/api/database/read", {
      method: "POST",
      body: { objectName, where, limit: Number(limitText) },
    });
  } else {
    return usage();
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

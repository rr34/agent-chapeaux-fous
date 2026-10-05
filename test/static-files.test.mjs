import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createStaticHandler } from "../src/static-files.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const serveStatic = createStaticHandler({ repositoryRoot, publicRoot: path.join(repositoryRoot, "public") });

async function request(url, method = "GET") {
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body.toString("utf8"); },
  };
  const handled = await serveStatic({ url, method }, response);
  return { handled, ...response };
}

test("first visits serve the landing page without loading the token-prompting app", async () => {
  for (const url of ["/", "/?ref=first-visit"]) {
    const response = await request(url);
    assert.equal(response.handled, true);
    assert.equal(response.status, 200);
    assert.match(response.headers["Content-Type"], /^text\/html/);
    assert.equal(response.headers["Cache-Control"], "no-cache");
    assert.equal(response.body, await fs.readFile(path.join(repositoryRoot, "landing/index.html"), "utf8"));
    assert.match(response.body, /href="\/app"/);
    assert.doesNotMatch(response.body, /<script\b|<dialog\b|app\.js/i);
  }
});

test("the landing-page logo is served from the public asset directory", async () => {
  const response = await request("/logo-chapeaux-fous-1200-square-transparent.png");
  assert.equal(response.handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers["Content-Type"], "image/png");
  assert.equal(response.headers["Cache-Control"], "public, max-age=300");
  assert.ok(response.body.length > 0);
});

test("the Hats card outline is served from the public asset directory", async () => {
  const response = await request("/logo-outline-hat.svg");
  assert.equal(response.handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers["Content-Type"], "image/svg+xml");
  assert.match(response.body, /Chapeaux Fous hat outline/);
});

test("app navigation and OAuth return URLs still load the application", async () => {
  const app = await fs.readFile(path.join(repositoryRoot, "public/ui/index.html"), "utf8");
  for (const url of ["/app", "/app/", "/app?oauth=connected"]) {
    const response = await request(url);
    assert.equal(response.status, 200);
    assert.equal(response.body, app);
    assert.equal(response.headers["Cache-Control"], "no-cache");
  }
});

test("content-hashed React assets are served only from the built UI root", async () => {
  const index = await fs.readFile(path.join(repositoryRoot, "public/ui/index.html"), "utf8");
  const assetPath = index.match(/(?:src|href)="(\/ui\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(assetPath);
  const response = await request(assetPath);
  assert.equal(response.status, 200);
  assert.match(response.headers["Content-Type"], /^text\/javascript/);
  assert.equal(response.headers["Cache-Control"], "public, max-age=300");
});

test("static serving leaves API requests, private files, unknown paths and mutations to the server", async () => {
  for (const url of ["/api/requests", "/.env", "/src/server.mjs", "/landing/README.md", "/../.env", "/missing"]) {
    const response = await request(url);
    assert.equal(response.handled, false, url);
    assert.equal(response.status, undefined, url);
  }
  assert.equal((await request("/", "POST")).handled, false);
  assert.equal((await request("/app", "POST")).handled, false);
});

test("installed apps launch the app route and retain their existing identity and scope", async () => {
  const response = await request("/manifest.webmanifest");
  const manifest = JSON.parse(response.body);
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/app");
  assert.equal(manifest.scope, "/");
  assert.equal(response.headers["Cache-Control"], "no-cache");
  assert.equal((await request("/service-worker.js")).headers["Cache-Control"], "no-cache");
});

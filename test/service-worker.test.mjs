import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../public/service-worker.js", import.meta.url), "utf8");
function worker({ fetch = async () => { throw new Error("Offline"); }, cached, cacheError = false } = {}) {
  const listeners = new Map();
  const cacheReads = [];
  vm.runInNewContext(source, {
    URL, Response,
    self: { location: { origin: "https://chapeauxfous.com" }, addEventListener: (name, callback) => listeners.set(name, callback) },
    fetch,
    caches: { open: async () => {
      if (cacheError) throw new Error("Cache unavailable");
      return { match: async key => { cacheReads.push(key); return typeof cached === "function" ? cached(key) : cached; } };
    } },
  });
  return {
    cacheReads,
    request(path, method = "GET") {
      let response;
      listeners.get("fetch")({ request: new Request(new URL(path, "https://chapeauxfous.com"), { method }),
        respondWith: value => { response = value; } });
      return response;
    },
  };
}

test("health, APIs, unknown paths, external origins and mutations bypass the shell cache", () => {
  const instance = worker();
  for (const path of ["/health", "/health?probe=1", "/api/requests?limit=25", "/missing", "https://example.com/app.js"]) {
    assert.equal(instance.request(path), undefined, path);
  }
  assert.equal(instance.request("/", "POST"), undefined);
  assert.deepEqual(instance.cacheReads, []);
});

test("shell requests return the real network response when online", async () => {
  const response = new Response("current app");
  const instance = worker({ fetch: async () => response });
  assert.equal(await instance.request("/app.js"), response);
  assert.deepEqual(instance.cacheReads, []);
});

test("offline shell requests fall back to their cached path including navigation query strings", async () => {
  const cached = new Response("offline app");
  const instance = worker({ cached });
  assert.equal(await instance.request("/app?oauth=connected"), cached);
  assert.deepEqual(instance.cacheReads, ["/app"]);
});

test("cache misses and unavailable cache storage return a Response instead of undefined or a rejected promise", async () => {
  for (const options of [{}, { cacheError: true }]) {
    const response = await worker(options).request("/app.js");
    assert.ok(response instanceof Response);
    assert.equal(response.type, "error");
  }
});

test("offline landing and app navigations use distinct cached pages", async () => {
  const pages = new Map([["/", new Response("landing")], ["/app", new Response("app")], ["/app/", new Response("app")]]);
  const instance = worker({ cached: key => pages.get(key) });
  for (const [path, response] of pages) {
    assert.equal(await instance.request(path), response);
  }
  assert.deepEqual(instance.cacheReads, ["/", "/app", "/app/"]);
});

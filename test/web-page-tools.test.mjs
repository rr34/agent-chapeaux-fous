import assert from "node:assert/strict";
import test from "node:test";
import { readResultFilterSchema } from "../src/search/result-filter.mjs";
import { WebPageClient, isPublicIpAddress, parseWebPageUrl } from "../src/web-page-client.mjs";
import { registerWebPageTools } from "../src/tools/web-page-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function response(statusCode, headers, body = "") {
  return { statusCode, headers, body: Buffer.from(body) };
}

test("web_page_read exposes one explicit URL reader and no search query", () => {
  const registry = new ToolRegistry();
  registerWebPageTools(registry, new WebPageClient());
  const definition = registry.toolDefinitions().find(({ name }) => name === "web_page_read");
  assert.deepEqual(definition.inputSchema, {
    type: "object",
    additionalProperties: false,
    properties: {
      url: { type: "string", minLength: 8, maxLength: 4096 },
      maximum_characters: { type: "integer", minimum: 1000, maximum: 100000 },
      result_filter: readResultFilterSchema,
    },
    required: ["url", "maximum_characters", "result_filter"],
  });
  assert.match(definition.description, /does not search the web/i);
  assert.equal(Object.hasOwn(definition.inputSchema.properties, "query"), false);
});

test("web_page_read extracts text, metadata, canonical URL, and traversable links", async () => {
  const calls = [];
  const client = new WebPageClient({
    lookup: publicLookup,
    requestPage: async (url, target) => {
      calls.push({ url: url.toString(), target });
      if (url.pathname === "/start") {
        return response(301, { location: "/episodes/" });
      }
      return response(200, { "content-type": "text/html; charset=utf-8" }, `
        <!doctype html>
        <html><head>
          <title>Car Studio &amp; Friends</title>
          <meta content="Episode summaries &amp; notes" name="description">
          <link href="/episodes/" rel="canonical">
          <style>hidden style</style><script>hidden script</script>
        </head><body>
          <main><h1>Episodes</h1><article><p>13. The Road &amp; Track</p></article></main>
          <a rel="next" href="/episodes/page/2/#posts">Older posts</a>
          <a href="mailto:nate@example.test">Email</a>
        </body></html>
      `);
    },
  });
  const registry = new ToolRegistry();
  registerWebPageTools(registry, client);

  const result = await registry.execute("web_page_read", {
    url: "https://blog.example.com/start#top",
    maximum_characters: 1000,
  });

  assert.equal(result.requested_url, "https://blog.example.com/start");
  assert.equal(result.url, "https://blog.example.com/episodes/");
  assert.equal(result.title, "Car Studio & Friends");
  assert.equal(result.description, "Episode summaries & notes");
  assert.equal(result.canonical_url, "https://blog.example.com/episodes/");
  assert.match(result.text, /13\. The Road & Track/);
  assert.doesNotMatch(result.text, /hidden script|hidden style/);
  assert.deepEqual(result.links, [{
    text: "Older posts",
    url: "https://blog.example.com/episodes/page/2/",
    rel: "next",
  }]);
  assert.equal(result.text_truncated, false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ target }) => target.address), ["93.184.216.34", "93.184.216.34"]);
});

test("web page text is bounded while link traversal remains available", async () => {
  const client = new WebPageClient({
    lookup: publicLookup,
    requestPage: async () => response(200, { "content-type": "text/html" }, `
      <html><body><p>${"word ".repeat(400)}</p><a href="/page/2/">Next page</a></body></html>
    `),
  });
  const result = await client.read("https://example.com/page/1/", 1000);
  assert.equal(result.text.length, 1000);
  assert.equal(result.text_truncated, true);
  assert.equal(result.links[0].url, "https://example.com/page/2/");
});

test("web page reader rejects local, private, credentialed, and non-HTTP targets", async () => {
  let requests = 0;
  const client = new WebPageClient({
    lookup: async () => [{ address: "10.1.2.3", family: 4 }],
    requestPage: async () => { requests += 1; return response(200, { "content-type": "text/plain" }, "no"); },
  });
  await assert.rejects(() => client.read("http://private.example.test/", 1000), /private or non-public/);
  await assert.rejects(() => client.read("http://localhost/admin", 1000), /private or local/);
  await assert.rejects(() => client.read("http://127.0.0.1/admin", 1000), /private or non-public/);
  assert.throws(() => parseWebPageUrl("file:///etc/passwd"), /HTTP or HTTPS/);
  assert.throws(() => parseWebPageUrl("https://user:secret@example.com/"), /credentials/);
  assert.equal(requests, 0);
});

test("every redirect target is checked before it is requested", async () => {
  let requests = 0;
  const client = new WebPageClient({
    lookup: publicLookup,
    requestPage: async () => {
      requests += 1;
      return response(302, { location: "http://169.254.169.254/latest/meta-data/" });
    },
  });
  await assert.rejects(() => client.read("https://example.com/", 1000), /private or non-public/);
  assert.equal(requests, 1);
});

test("IP policy allows global addresses and rejects special-use ranges", () => {
  assert.equal(isPublicIpAddress("93.184.216.34"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.168.1.1", "198.51.100.2", "224.0.0.1", "::1", "fc00::1",
    "fe80::1", "2001:db8::1", "::ffff:127.0.0.1",
  ]) assert.equal(isPublicIpAddress(address), false, address);
});

test("web page reader rejects binary responses", async () => {
  const client = new WebPageClient({
    lookup: publicLookup,
    requestPage: async () => response(200, { "content-type": "image/png" }, "not really a png"),
  });
  await assert.rejects(() => client.read("https://example.com/image.png", 1000), /unsupported Content-Type: image\/png/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { JmapClient, JMAP_CAPABILITIES } from "../src/jmap-client.mjs";

const { core, mail, submission } = JMAP_CAPABILITIES;

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function session(overrides = {}) {
  return {
    username: "owner@example.test",
    apiUrl: "https://mail.example.test/jmap/api",
    downloadUrl: "https://mail.example.test/download/{accountId}/{blobId}/{name}?type={type}",
    uploadUrl: "https://mail.example.test/upload/{accountId}",
    eventSourceUrl: "https://mail.example.test/events",
    capabilities: { [core]: {}, [mail]: {}, [submission]: {} },
    accounts: {
      account1: {
        name: "Personal",
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: { [mail]: {}, [submission]: { maxDelayedSend: 3600 } },
      },
    },
    primaryAccounts: { [mail]: "account1" },
    ...overrides,
  };
}

test("JMAP discovers the primary account and sends authenticated method calls", async () => {
  const requests = [];
  const client = new JmapClient({
    sessionUrl: "https://mail.example.test/jmap/session",
    accessToken: "secret-token",
    fetchFn: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith("/session")) return json(session());
      const request = JSON.parse(init.body);
      assert.deepEqual(request.using, [core, mail]);
      assert.deepEqual(request.methodCalls, [["Mailbox/get", { accountId: "account1", ids: null }, "0"]]);
      return json({ methodResponses: [["Mailbox/get", {
        accountId: "account1", state: "mailboxes-1", list: [], notFound: [],
      }, "0"]] });
    },
  });

  assert.equal((await client.initialize()).ready, true);
  assert.equal(client.health().accountId, "account1");
  const result = await client.call("Mailbox/get", { accountId: "account1", ids: null });
  assert.equal(result.state, "mailboxes-1");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.headers.Authorization, "Bearer secret-token");
  assert.equal(requests[1].init.headers.Authorization, "Bearer secret-token");
  assert.doesNotMatch(JSON.stringify(client.health()), /secret-token/);
  assert.doesNotMatch(JSON.stringify(client.publicSession()), /jmap\/api|secret-token/);
});

test("JMAP does not become callable when session discovery lacks mail capability", async () => {
  const client = new JmapClient({
    sessionUrl: "https://mail.example.test/jmap/session",
    accessToken: "secret-token",
    required: true,
    fetchFn: async () => json(session({ capabilities: { [core]: {} } })),
  });
  const health = await client.initialize();
  assert.equal(health.ready, false);
  assert.match(health.error, /mail capability/);
  assert.match(client.requiredProblem(), /email JMAP integration is unavailable/);
  assert.throws(() => client.requireReady(), /mail capability/);
});

test("JMAP blob retrieval enforces the byte boundary", async () => {
  const client = new JmapClient({
    sessionUrl: "https://mail.example.test/jmap/session",
    accessToken: "secret-token",
    fetchFn: async (input) => String(input).endsWith("/session")
      ? json(session())
      : new Response("123456", { headers: { "content-type": "text/plain", "content-length": "6" } }),
  });
  await client.initialize();
  await assert.rejects(
    client.downloadBlob({ accountId: null, blobId: "blob", name: "x.txt", type: "text/plain", maximumBytes: 5 }),
    /6 bytes; the tool limit is 5/,
  );
});

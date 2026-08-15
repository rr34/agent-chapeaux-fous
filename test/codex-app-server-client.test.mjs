import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  CodexAppServerClient,
  disabledCodexFeatures,
  summarizeRateLimits,
  usageDelta,
} from "../src/codex-app-server-client.mjs";

function quota(usedPercent) {
  return {
    rateLimits: {
      limitId: "codex",
      planType: "plus",
      primary: { usedPercent, windowDurationMins: 300, resetsAt: 2_000_000_000 },
      secondary: null,
    },
    rateLimitsByLimitId: null,
    rateLimitResetCredits: null,
  };
}

class FakeCodexProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.messages = [];
    this.rateReads = 0;
    let buffered = "";
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        buffered += chunk.toString();
        let newline;
        while ((newline = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (line) this.receive(JSON.parse(line));
        }
        callback();
      },
    });
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  receive(message) {
    this.messages.push(message);
    if (message.method === "initialize") {
      this.send({ id: message.id, result: { codexHome: "/fake", platformFamily: "unix", platformOs: "linux", userAgent: "codex-test/1" } });
    } else if (message.method === "config/read") {
      this.send({ id: message.id, result: { config: { mcp_servers: {}, plugins: {}, agents: { enabled: false } }, layers: [] } });
    } else if (message.method === "account/read") {
      this.send({ id: message.id, result: { account: { type: "chatgpt", planType: "plus", email: "hidden@example.test" }, requiresOpenaiAuth: true } });
    } else if (message.method === "account/rateLimits/read") {
      this.rateReads += 1;
      this.send({ id: message.id, result: quota(this.rateReads >= 4 ? 12 : 10) });
    } else if (message.method === "thread/start") {
      this.send({ id: message.id, result: { thread: { id: "thread-1" } } });
    } else if (message.method === "turn/start") {
      this.send({ id: message.id, result: { turn: { id: "turn-1", status: "inProgress", items: [] } } });
      queueMicrotask(() => this.send({
        method: "item/tool/call",
        id: "server-call-1",
        params: { threadId: "thread-1", turnId: "turn-1", callId: "call-1", tool: "echo", namespace: null, arguments: { value: "hello" } },
      }));
    } else if (message.id === "server-call-1" && message.result) {
      this.send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: { id: "item-tool", type: "dynamicToolCall", tool: "echo", arguments: { value: "hello" }, status: "completed", success: true } } });
      this.send({ method: "thread/tokenUsage/updated", params: { threadId: "thread-1", turnId: "turn-1", tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 }, total: { inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 }, modelContextWindow: 1000 } } });
      this.send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: { id: "item-message", type: "agentMessage", phase: "final_answer", text: "hello returned" } } });
      this.send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } } });
    } else if (message.method === "thread/unsubscribe") {
      this.send({ id: message.id, result: {} });
    }
  }

  kill() {
    queueMicrotask(() => this.emit("exit", 0, null));
  }
}

test("rate-limit summaries expose remaining quota and per-request deltas", () => {
  const before = summarizeRateLimits(quota(25), new Date("2026-08-15T00:00:00Z"));
  const after = summarizeRateLimits(quota(28), new Date("2026-08-15T00:01:00Z"));
  const delta = usageDelta(before, after, { totalTokens: 321 });
  assert.equal(after.buckets[0].primary.remainingPercent, 72);
  assert.equal(delta.windows[0].usedPercentDelta, 3);
  assert.equal(delta.tokenUsage.totalTokens, 321);
});

test("the client performs a complete dynamic-tool turn and records subscription usage", async () => {
  let fake;
  let spawnArguments;
  const client = new CodexAppServerClient({
    command: "/fake/codex",
    codexHome: "/fake",
    cwd: "/fake/workspace",
    disabledFeatures: disabledCodexFeatures,
    spawnImplementation(_command, args) {
      spawnArguments = args;
      fake = new FakeCodexProcess();
      return fake;
    },
  });
  const calls = [];
  const result = await client.runTurn({
    model: "test-model",
    effort: "high",
    baseInstructions: "SYSTEM",
    developerInstructions: "CONTEXT",
    input: "Call echo.",
    tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" }, strict: true }],
    async onToolCall(call) {
      calls.push(call);
      return { ok: true, result: call.arguments };
    },
  });

  assert.equal(result.text, "hello returned");
  assert.equal(calls.length, 1);
  assert.equal(result.usage.windows[0].usedPercentDelta, 2);
  assert.equal(result.usage.tokenUsage.totalTokens, 120);
  const threadStart = fake.messages.find((message) => message.method === "thread/start");
  assert.equal(threadStart.params.ephemeral, true);
  assert.equal(threadStart.params.sandbox, "read-only");
  assert.deepEqual(threadStart.params.dynamicTools, [{ type: "function", name: "echo", description: "Echo", inputSchema: { type: "object" } }]);
  assert.ok(spawnArguments.includes("shell_tool"));
  assert.ok(spawnArguments.includes("unified_exec"));
  assert.ok(spawnArguments.includes("tools.update_plan.enabled=false"));
  assert.deepEqual(client.health().configAudit.mcpServers, []);
  assert.equal(client.health().workDirectory, "/fake/workspace");
  await client.close();
});

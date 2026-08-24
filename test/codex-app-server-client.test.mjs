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
  constructor({ stallTurn = false } = {}) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.messages = [];
    this.rateReads = 0;
    this.turnCount = 0;
    this.stallTurn = stallTurn;
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
    } else if (message.method === "thread/resume") {
      this.send({ id: message.id, result: { thread: { id: message.params.threadId } } });
    } else if (message.method === "turn/start") {
      this.turnCount += 1;
      const turnId = `turn-${this.turnCount}`;
      const serverCallId = `server-call-${this.turnCount}`;
      this.send({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      if (this.stallTurn) return;
      queueMicrotask(() => this.send({
        method: "item/tool/call",
        id: serverCallId,
        params: { threadId: message.params.threadId, turnId, callId: `call-${this.turnCount}`, tool: "echo", namespace: null, arguments: { value: "hello" } },
      }));
    } else if (message.method === "turn/interrupt") {
      this.send({ id: message.id, result: {} });
    } else if (String(message.id).startsWith("server-call-") && message.result) {
      const turnNumber = Number(String(message.id).slice("server-call-".length));
      const turnId = `turn-${turnNumber}`;
      this.send({ method: "item/completed", params: { threadId: "thread-1", turnId, item: { id: `item-tool-${turnNumber}`, type: "dynamicToolCall", tool: "echo", arguments: { value: "hello" }, status: "completed", success: true } } });
      this.send({ method: "thread/tokenUsage/updated", params: { threadId: "thread-1", turnId, tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 }, total: { inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 }, modelContextWindow: 1000 } } });
      this.send({ method: "item/completed", params: { threadId: "thread-1", turnId, item: { id: `item-message-${turnNumber}`, type: "agentMessage", phase: "final_answer", text: "hello returned" } } });
      this.send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, status: "completed", items: [] } } });
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

test("request descriptions expose one-shot execution limits", () => {
  const client = new CodexAppServerClient({ command: "/fake/codex", codexHome: "/fake", cwd: "/fake/workspace" });
  const description = client.describeRequest({
    model: "test-model", effort: "high", conversationId: null,
    baseInstructions: "SYSTEM", developerInstructions: "CONTEXT", input: "Import jobs.",
    tools: [], maxToolCalls: null, runTimeoutMs: 3_600_000,
  });
  assert.equal(description.executionBoundary.maxToolCalls, null);
  assert.equal(description.executionBoundary.runTimeoutMs, 3_600_000);
  assert.deepEqual(description.callableTools, []);
  assert.equal(description.toolDelivery, "sent in thread/start");
});

test("Codex turns carry phase-specific effort and structured output schemas", async (context) => {
  const process = new FakeCodexProcess();
  const client = new CodexAppServerClient({
    command: "/fake/codex", requiredVersion: "codex-test/1", codexHome: "/fake", cwd: "/fake/workspace",
    spawnImplementation: () => process,
  });
  context.after(() => client.close());
  const outputSchema = {
    type: "object", additionalProperties: false,
    properties: { objective: { type: "string" } }, required: ["objective"],
  };

  await client.runTurn({
    model: "test-model", effort: "medium", conversationId: null,
    baseInstructions: "ORIENT", developerInstructions: "SOURCES", input: "Continue.",
    tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
    outputSchema, maxToolCalls: 1, onToolCall: async () => ({ ok: true }),
  });

  const turnStart = process.messages.find(({ method }) => method === "turn/start");
  assert.equal(turnStart.params.effort, "medium");
  assert.deepEqual(turnStart.params.outputSchema, outputSchema);
});

test("request descriptions distinguish retained callable schemas from protocol delivery", () => {
  const client = new CodexAppServerClient({ command: "/fake/codex", codexHome: "/fake", cwd: "/fake/workspace" });
  const description = client.describeRequest({
    model: "test-model", effort: "high", conversationId: "thread-1",
    baseInstructions: "SYSTEM", developerInstructions: "CONTEXT", input: "Continue.",
    tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
    maxToolCalls: 4, runTimeoutMs: null,
  });
  assert.equal(description.toolDelivery, "retained on the resumed conversation");
  assert.deepEqual(description.callableTools.map(({ name }) => name), ["echo"]);
  assert.equal(Object.hasOwn(description, "dynamicTools"), false);
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
    requestAttachmentInput: "# Attached request file\nname,email\nAlice,a@example.test\n",
    tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" }, strict: true }],
    maxToolCalls: null,
    runTimeoutMs: 60_000,
    async onToolCall(call) {
      calls.push(call);
      return { ok: true, result: call.arguments };
    },
  });

  assert.equal(result.text, "hello returned");
  assert.equal(calls.length, 1);
  assert.equal(result.usage.windows[0].usedPercentDelta, 2);
  assert.equal(result.usage.tokenUsage.totalTokens, 120);
  assert.equal(result.usage.contextWindowTokens, 1000);
  const threadStart = fake.messages.find((message) => message.method === "thread/start");
  assert.equal(threadStart.params.ephemeral, false);
  assert.equal(threadStart.params.personality, "friendly");
  assert.equal(threadStart.params.sandbox, "read-only");
  const turnStart = fake.messages.find((message) => message.method === "turn/start");
  assert.equal(turnStart.params.input[0].text, "Call echo.");
  assert.match(turnStart.params.input[1].text, /Alice,a@example\.test/);
  assert.deepEqual(threadStart.params.dynamicTools, [{ type: "function", name: "echo", description: "Echo", inputSchema: { type: "object" } }]);
  assert.ok(spawnArguments.includes("shell_tool"));
  assert.ok(spawnArguments.includes("unified_exec"));
  assert.ok(spawnArguments.includes("tools.update_plan.enabled=false"));
  assert.deepEqual(client.health().configAudit.mcpServers, []);
  assert.equal(client.health().workDirectory, "/fake/workspace");
  await client.close();
});

test("a per-request run deadline interrupts a stalled model turn", async () => {
  let fake;
  const client = new CodexAppServerClient({
    command: "/fake/codex",
    codexHome: "/fake",
    cwd: "/fake/workspace",
    disabledFeatures: disabledCodexFeatures,
    spawnImplementation() {
      fake = new FakeCodexProcess({ stallTurn: true });
      return fake;
    },
  });
  await assert.rejects(client.runTurn({
    model: "test-model",
    effort: "medium",
    baseInstructions: "SYSTEM",
    developerInstructions: "CONTEXT",
    input: "Work until interrupted.",
    tools: [],
    maxToolCalls: null,
    runTimeoutMs: 10,
    async onToolCall() { throw new Error("must not call tools"); },
  }), /exceeded its 10ms run deadline/);
  assert.equal(fake.messages.some(({ method }) => method === "turn/interrupt"), true);
  await client.close();
});

test("the client resumes a persistent thread with refreshed instructions", async () => {
  let fake;
  const client = new CodexAppServerClient({
    command: "/fake/codex",
    codexHome: "/fake",
    cwd: "/fake/workspace",
    disabledFeatures: disabledCodexFeatures,
    spawnImplementation() {
      fake = new FakeCodexProcess();
      return fake;
    },
  });
  const result = await client.runTurn({
    model: "test-model",
    effort: "medium",
    conversationId: "thread-1",
    baseInstructions: "SYSTEM 2",
    developerInstructions: "CURRENT CONTEXT 2",
    input: "Continue with echo.",
    requestAttachmentInput: "# Attached request file\nTitle,URL\nExample,https://example.test\n",
    tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" }, strict: true }],
    async onToolCall(call) { return { ok: true, result: call.arguments }; },
  });

  const resume = fake.messages.find((message) => message.method === "thread/resume");
  assert.equal(resume.params.threadId, "thread-1");
  assert.equal(resume.params.personality, "friendly");
  assert.equal(resume.params.baseInstructions, "SYSTEM 2");
  assert.equal(resume.params.developerInstructions, "CURRENT CONTEXT 2");
  assert.equal(Object.hasOwn(resume.params, "dynamicTools"), false);
  const turnStart = fake.messages.find((message) => message.method === "turn/start");
  assert.equal(turnStart.params.input[0].text, "Continue with echo.");
  assert.match(turnStart.params.input[1].text, /Title,URL/);
  assert.equal(result.threadId, "thread-1");
  await client.close();
});

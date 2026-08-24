import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

export const disabledCodexFeatures = Object.freeze([
  "apps",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "code_mode",
  "computer_use",
  "hooks",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "multi_agent_v2",
  "plugins",
  "remote_plugin",
  "shell_tool",
  "skill_search",
  "tool_suggest",
  "unified_exec",
  "view_image",
  "workspace_dependencies",
]);

const allowedTurnItemTypes = new Set([
  "agentMessage",
  "contextCompaction",
  "dynamicToolCall",
  "reasoning",
  "userMessage",
]);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function boundedLines(lines, maximum = 20) {
  return lines.slice(Math.max(0, lines.length - maximum));
}

function safePercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function summarizeWindow(window) {
  if (!window) return null;
  const usedPercent = safePercent(window.usedPercent);
  return {
    usedPercent,
    remainingPercent: usedPercent == null ? null : 100 - usedPercent,
    windowDurationMins: window.windowDurationMins ?? null,
    resetsAt: window.resetsAt ?? null,
  };
}

export function summarizeRateLimits(result, fetchedAt = new Date()) {
  if (!result?.rateLimits) return null;
  const source = result.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
    ? result.rateLimitsByLimitId
    : { [result.rateLimits.limitId || "codex"]: result.rateLimits };
  return {
    fetchedAtUtc: fetchedAt.toISOString(),
    buckets: Object.entries(source).map(([key, bucket]) => ({
      id: bucket.limitId || key,
      name: bucket.limitName || null,
      planType: bucket.planType || null,
      reached: bucket.rateLimitReachedType || null,
      primary: summarizeWindow(bucket.primary),
      secondary: summarizeWindow(bucket.secondary),
      credits: bucket.credits || null,
      individualLimit: bucket.individualLimit || null,
    })),
    resetCreditsAvailable: result.rateLimitResetCredits?.availableCount ?? null,
  };
}

export function usageDelta(before, after, tokenUsage = null) {
  const prior = new Map((before?.buckets ?? []).map((bucket) => [bucket.id, bucket]));
  const windows = [];
  for (const bucket of after?.buckets ?? []) {
    const previous = prior.get(bucket.id);
    for (const kind of ["primary", "secondary"]) {
      const currentWindow = bucket[kind];
      if (!currentWindow) continue;
      const priorUsed = previous?.[kind]?.usedPercent;
      const resetOccurred = priorUsed != null
        && currentWindow.usedPercent != null
        && currentWindow.usedPercent < priorUsed;
      const usedPercentDelta = priorUsed == null || currentWindow.usedPercent == null || resetOccurred
        ? null
        : currentWindow.usedPercent - priorUsed;
      windows.push({
        bucketId: bucket.id,
        bucketName: bucket.name,
        kind,
        usedPercentDelta,
        resetOccurred,
        usedPercent: currentWindow.usedPercent,
        remainingPercent: currentWindow.remainingPercent,
        resetsAt: currentWindow.resetsAt,
        windowDurationMins: currentWindow.windowDurationMins,
      });
    }
  }
  return { before, after, windows, tokenUsage };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export class CodexAppServerClient extends EventEmitter {
  constructor({
    command = "codex",
    requiredVersion = "",
    codexHome,
    cwd,
    requestTimeoutMs = 10 * 60 * 1000,
    startupTimeoutMs = 30_000,
    spawnImplementation = spawn,
    disabledFeatures = disabledCodexFeatures,
  }) {
    super();
    this.id = "codex-app-server";
    this.displayName = "Codex";
    this.command = command;
    this.requiredVersion = requiredVersion;
    this.codexHome = codexHome;
    this.cwd = cwd;
    this.requestTimeoutMs = requestTimeoutMs;
    this.startupTimeoutMs = startupTimeoutMs;
    this.spawnImplementation = spawnImplementation;
    this.disabledFeatures = [...disabledFeatures];
    this.child = null;
    this.reader = null;
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.activeTurn = null;
    this.initializeResult = null;
    this.account = null;
    this.rateLimits = null;
    this.configAudit = null;
    this.lastError = null;
    this.stderrLines = [];
    this.closing = false;
  }

  spawnArguments() {
    return [
      "app-server",
      "--stdio",
      "--strict-config",
      ...this.disabledFeatures.flatMap((feature) => ["--disable", feature]),
      "-c", "web_search=\"disabled\"",
      "-c", "apps._default.enabled=false",
      "-c", "include_apps_instructions=false",
      "-c", "include_collaboration_mode_instructions=false",
      "-c", "include_environment_context=false",
      "-c", "include_permissions_instructions=false",
      "-c", "tools.update_plan.enabled=false",
      "-c", "tools.experimental_request_user_input.enabled=false",
      "-c", "agents.enabled=false",
      "-c", "orchestrator.skills.enabled=false",
      "-c", "orchestrator.mcp.enabled=false",
      "-c", "mcp_servers={}",
      "-c", "plugins={}",
    ];
  }

  async start() {
    if (this.startPromise && this.child) return this.startPromise;
    this.closing = false;
    this.startPromise = this.#start();
    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  async #start() {
    this.lastError = null;
    this.configAudit = null;
    const child = this.spawnImplementation(this.command, this.spawnArguments(), {
      cwd: this.cwd,
      env: { ...process.env, ...(this.codexHome ? { CODEX_HOME: this.codexHome } : {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.reader = readline.createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this.#receiveLine(line));
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      this.stderrLines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
      this.stderrLines = boundedLines(this.stderrLines);
    });
    child.once("error", (error) => this.#processFailed(error));
    child.once("exit", (code, signal) => {
      const suffix = signal ? `signal ${signal}` : `code ${code}`;
      this.#processFailed(new Error(`Codex App Server exited with ${suffix}`));
    });

    this.initializeResult = await this.request("initialize", {
      clientInfo: { name: "agent_slayer", title: "Chapeaux Fous", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    }, { timeoutMs: this.startupTimeoutMs });
    this.notify("initialized", {});
    await this.auditEffectiveConfig();
    await this.refreshAccount();
  }

  async auditEffectiveConfig() {
    const result = await this.request("config/read", { cwd: this.cwd, includeLayers: false }, { timeoutMs: this.startupTimeoutMs });
    const config = result?.config ?? {};
    const mcpServers = Object.keys(config.mcp_servers ?? config.mcpServers ?? {});
    const plugins = Object.keys(config.plugins ?? {});
    const agentsEnabled = config.agents?.enabled === true;
    this.configAudit = {
      isolatedCodexHome: this.initializeResult?.codexHome ?? null,
      mcpServers,
      plugins,
      agentsEnabled,
    };
    if (mcpServers.length || plugins.length || agentsEnabled) {
      throw new Error(`Codex tool isolation failed: inherited MCPs=${mcpServers.join(",") || "none"}, plugins=${plugins.join(",") || "none"}, agents=${agentsEnabled}`);
    }
  }

  #processFailed(error) {
    if (this.closing) return;
    this.lastError = errorMessage(error);
    this.child = null;
    this.reader?.close();
    this.reader = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(this.lastError));
    }
    this.pending.clear();
    this.activeTurn?.completion.reject(new Error(this.lastError));
    this.activeTurn = null;
    this.startPromise = null;
    this.emit("health", this.health());
  }

  #receiveLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.stderrLines.push(`Invalid JSON from app-server: ${line.slice(0, 500)}`);
      this.stderrLines = boundedLines(this.stderrLines);
      return;
    }
    if (message.id != null && message.method) {
      void this.#handleServerRequest(message);
      return;
    }
    if (message.id != null) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(`Codex App Server ${pending.method}: ${message.error.message || "unknown error"}`);
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method) this.#handleNotification(message.method, message.params ?? {});
  }

  async #handleServerRequest(message) {
    const turn = this.activeTurn;
    if (message.method !== "item/tool/call" || !turn || message.params?.threadId !== turn.threadId || message.params?.namespace) {
      this.#write({
        id: message.id,
        error: { code: -32601, message: `Agent Slayer rejects unsupported server request: ${message.method}` },
      });
      return;
    }
    turn.toolCallCount += 1;
    if (turn.maxToolCalls !== null && turn.toolCallCount > turn.maxToolCalls + 1) {
      this.#write({
        id: message.id,
        result: {
          contentItems: [{ type: "inputText", text: JSON.stringify({
            ok: false,
            error: `Tool-call limit exceeded (${turn.maxToolCalls}); return a final answer without more tool calls`,
          }) }],
          success: false,
        },
      });
      if (!turn.interruptRequested) {
        turn.interruptRequested = true;
        void this.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.turnId }).catch(() => {});
      }
      return;
    }
    try {
      const result = await turn.onToolCall({
        callId: message.params.callId,
        tool: message.params.tool,
        arguments: message.params.arguments,
      });
      this.#write({
        id: message.id,
        result: {
          contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
          success: result?.ok === true,
        },
      });
    } catch (error) {
      this.#write({
        id: message.id,
        result: {
          contentItems: [{ type: "inputText", text: JSON.stringify({ ok: false, error: errorMessage(error) }) }],
          success: false,
        },
      });
    }
  }

  #handleNotification(method, params) {
    if (method === "account/updated") {
      if (this.account) this.account = { ...this.account, planType: params.planType ?? this.account.planType };
      this.emit("health", this.health());
    }
    if (method === "account/rateLimits/updated") {
      this.rateLimits = summarizeRateLimits(params);
      this.emit("health", this.health());
    }
    const turn = this.activeTurn;
    if (!turn) return;
    turn.events.push({ method, params });
    turn.onEvent?.({ method, params });
    if (method === "thread/tokenUsage/updated" && params.threadId === turn.threadId) {
      turn.tokenUsage = params.tokenUsage;
    }
    if ((method === "item/started" || method === "item/completed") && params.threadId === turn.threadId) {
      const item = params.item;
      if (item?.type === "agentMessage" && method === "item/completed" && item.text) {
        turn.messages.push(item);
      }
      if (item?.type && !allowedTurnItemTypes.has(item.type)) {
        turn.unexpectedItems.push(item);
        if (!turn.interruptRequested) {
          turn.interruptRequested = true;
          void this.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.turnId })
            .catch(() => {});
        }
      }
    }
    if (method === "turn/completed" && params.turn?.id === turn.turnId) {
      turn.completion.resolve(params.turn);
    }
  }

  #write(message) {
    if (!this.child?.stdin?.writable) throw new Error("Codex App Server is not running");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.child) return Promise.reject(new Error(this.lastError || "Codex App Server is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.#write({ method, params });
  }

  async refreshAccount() {
    try {
      const result = await this.request("account/read", { refreshToken: false }, { timeoutMs: this.startupTimeoutMs });
      this.account = result?.account ?? null;
      if (this.account?.type === "chatgpt") await this.refreshRateLimits();
      this.lastError = null;
    } catch (error) {
      this.lastError = errorMessage(error);
    }
    this.emit("health", this.health());
    return this.account;
  }

  async refreshRateLimits() {
    try {
      const result = await this.request("account/rateLimits/read", {}, { timeoutMs: this.startupTimeoutMs });
      this.rateLimits = summarizeRateLimits(result);
      return this.rateLimits;
    } catch (error) {
      this.stderrLines.push(`Rate limits unavailable: ${errorMessage(error)}`);
      this.stderrLines = boundedLines(this.stderrLines);
      return this.rateLimits;
    }
  }

  health() {
    const chatGptAuthenticated = this.account?.type === "chatgpt";
    const versionMatches = !this.requiredVersion || this.initializeResult?.userAgent?.includes(this.requiredVersion);
    const homeMatches = !this.codexHome || this.initializeResult?.codexHome === this.codexHome;
    let reason = this.lastError;
    if (!reason && !chatGptAuthenticated) reason = "Agent Slayer's isolated Codex home is not signed in with ChatGPT; run `npm run codex:login` as the service user";
    if (!reason && !versionMatches) {
      reason = `Codex version mismatch: expected ${this.requiredVersion}, got ${this.initializeResult?.userAgent || "unknown"}`;
    }
    if (!reason && !homeMatches) reason = `Codex home mismatch: expected ${this.codexHome}, got ${this.initializeResult?.codexHome || "unknown"}`;
    return {
      ready: Boolean(this.child && this.initializeResult && chatGptAuthenticated && versionMatches && homeMatches && this.configAudit && !this.lastError),
      transport: "codex-app-server",
      command: this.command,
      userAgent: this.initializeResult?.userAgent ?? null,
      requiredVersion: this.requiredVersion || null,
      versionMatches,
      codexHome: this.codexHome || null,
      workDirectory: this.cwd || null,
      homeMatches,
      configAudit: this.configAudit,
      authMode: this.account?.type ?? null,
      planType: this.account?.planType ?? null,
      usage: this.rateLimits,
      disabledBuiltInFeatures: this.disabledFeatures,
      reason,
      diagnostics: boundedLines(this.stderrLines),
    };
  }

  dynamicTools(tools) {
    return tools.map(({ name, description, inputSchema }) => ({
      type: "function",
      name,
      description,
      inputSchema,
    }));
  }

  describeRequest({
    model,
    effort,
    conversationId,
    baseInstructions,
    developerInstructions,
    input,
    requestAttachmentInput,
    tools,
    outputSchema = null,
    maxToolCalls,
    runTimeoutMs,
  }) {
    return {
      transport: this.id,
      model,
      reasoningEffort: effort,
      conversation: {
        mode: conversationId ? "resume" : "start",
        conversationId: conversationId ?? null,
      },
      baseInstructions,
      developerInstructions,
      input: [
        { type: "text", text: input },
        ...(typeof requestAttachmentInput === "string"
          ? [{ type: "text", text: requestAttachmentInput }]
          : requestAttachmentInput?.mediaKind === "image"
            ? [{
                type: "unsupported_image",
                filename: requestAttachmentInput.filename,
                mimeType: requestAttachmentInput.mimeType,
                byteSize: requestAttachmentInput.byteSize,
                sha256: requestAttachmentInput.sha256,
              }]
            : []),
      ],
      callableTools: this.dynamicTools(tools),
      outputSchema,
      toolDelivery: conversationId
        ? "retained on the resumed conversation"
        : "sent in thread/start",
      executionBoundary: {
        persistentThread: true,
        sandbox: "read-only",
        networkAccess: false,
        builtInAgentFeatures: "disabled; an unexpected built-in item fails the turn",
        maxToolCalls,
        runTimeoutMs,
      },
    };
  }

  async runTurn({
    model,
    effort,
    conversationId = null,
    baseInstructions,
    developerInstructions,
    input,
    requestAttachmentInput = null,
    tools,
    outputSchema = null,
    maxToolCalls = 128,
    runTimeoutMs = null,
    onToolCall,
    onEvent,
  }) {
    await this.start();
    if (requestAttachmentInput?.mediaKind === "image") {
      throw new Error("Image requests require SLAYER_MODEL_TRANSPORT=openai-responses");
    }
    if (!this.health().versionMatches) throw new Error(this.health().reason);
    await this.refreshAccount();
    if (this.account?.type !== "chatgpt") {
      throw new Error("Codex must be signed in with ChatGPT; API-key authentication is intentionally rejected");
    }
    if (this.activeTurn) throw new Error("Codex App Server already has an active Agent Slayer turn");
    const before = await this.refreshRateLimits();
    const threadConfiguration = {
      model,
      cwd: this.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      personality: "friendly",
      baseInstructions,
      developerInstructions,
      config: {
        web_search: "disabled",
        include_apps_instructions: false,
        include_collaboration_mode_instructions: false,
        include_environment_context: false,
        apps: { _default: { enabled: false } },
      },
    };
    const threadMethod = conversationId ? "thread/resume" : "thread/start";
    const threadRequest = conversationId
      ? { threadId: conversationId, ...threadConfiguration }
      : {
          ...threadConfiguration,
          ephemeral: false,
          serviceName: "agent_slayer",
          dynamicTools: this.dynamicTools(tools),
        };
    const threadResult = await this.request(threadMethod, threadRequest);
    const threadId = threadResult?.thread?.id;
    if (!threadId) throw new Error("Codex App Server did not return a thread id");
    if (conversationId && threadId !== conversationId) {
      throw new Error(`Codex resumed unexpected thread ${threadId} instead of ${conversationId}`);
    }
    if ((threadResult.instructionSources ?? []).length) {
      throw new Error(`Codex loaded unexpected instruction files: ${threadResult.instructionSources.join(", ")}`);
    }

    const completion = deferred();
    void completion.promise.catch(() => {});
    const state = {
      threadId,
      turnId: null,
      completion,
      events: [],
      messages: [],
      tokenUsage: null,
      unexpectedItems: [],
      interruptRequested: false,
      toolCallCount: 0,
      maxToolCalls,
      onToolCall,
      onEvent,
    };
    this.activeTurn = state;
    const turnStart = {
      threadId,
      input: [
        { type: "text", text: input },
        ...(typeof requestAttachmentInput === "string" ? [{ type: "text", text: requestAttachmentInput }] : []),
      ],
      ...(effort && !["none", "off"].includes(effort) ? { effort } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      approvalPolicy: "never",
    };
    let turn;
    let deadlineTimer = null;
    try {
      const turnResult = await this.request("turn/start", turnStart);
      state.turnId = turnResult?.turn?.id;
      if (!state.turnId) throw new Error("Codex App Server did not return a turn id");
      if (runTimeoutMs === null) {
        turn = await completion.promise;
      } else {
        const deadline = deferred();
        void deadline.promise.catch(() => {});
        deadlineTimer = setTimeout(() => {
          const error = new Error(`Codex model turn exceeded its ${runTimeoutMs}ms run deadline`);
          error.code = "RUN_DEADLINE_EXCEEDED";
          state.interruptRequested = true;
          void this.request("turn/interrupt", { threadId: state.threadId, turnId: state.turnId }).catch(() => {});
          deadline.reject(error);
        }, runTimeoutMs);
        deadlineTimer.unref?.();
        turn = await Promise.race([completion.promise, deadline.promise]);
      }
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (this.activeTurn === state) this.activeTurn = null;
      await this.request("thread/unsubscribe", { threadId }).catch(() => {});
    }
    if (state.unexpectedItems.length) {
      const types = [...new Set(state.unexpectedItems.map((item) => item.type))].join(", ");
      throw new Error(`Codex attempted disabled built-in tools (${types}); Agent Slayer rejected the turn`);
    }
    if (turn.status !== "completed") {
      throw new Error(turn.error?.message || `Codex turn ended with status ${turn.status}`);
    }
    const final = [...state.messages].reverse().find((message) => message.phase === "final_answer")
      || state.messages.at(-1);
    if (!final?.text?.trim()) throw new Error("Codex completed without a final response");
    const after = await this.refreshRateLimits();
    return {
      text: final.text.trim(),
      conversationId: threadId,
      providerTurnId: state.turnId,
      threadId,
      turnId: state.turnId,
      status: turn.status,
      messages: state.messages,
      tokenUsage: state.tokenUsage,
      usage: {
        ...usageDelta(before, after, state.tokenUsage?.last ?? state.tokenUsage?.total ?? null),
        contextWindowTokens: state.tokenUsage?.modelContextWindow ?? null,
      },
      events: state.events,
      protocol: { threadMethod, threadRequest, turnStart },
    };
  }

  async close() {
    this.closing = true;
    const child = this.child;
    this.child = null;
    this.reader?.close();
    this.reader = null;
    if (!child) return;
    child.stdin?.end();
    child.kill("SIGTERM");
    this.startPromise = null;
  }
}

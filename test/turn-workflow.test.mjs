import assert from "node:assert/strict";
import test from "node:test";
import { RequestCompiler } from "../src/request-compiler.mjs";
import { SlayerRuntime } from "../src/runtime.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { registerNativeObjectContextView } from "../src/native-object-search.mjs";
import { objectInputBindingsMetadataKey } from "../src/object-input-bindings.mjs";

function usage(totalTokens) {
  return {
    tokenUsage: {
      inputTokens: totalTokens - 5,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
      reasoningOutputTokens: 0,
      totalTokens,
    },
  };
}

function completed(text, totalTokens = 20) {
  return {
    text,
    threadId: null,
    turnId: `turn-${totalTokens}`,
    status: "completed",
    messages: [],
    events: [],
    usage: usage(totalTokens),
  };
}

function core(overrides = {}) {
  const value = {
    version: 1,
    mode: "act",
    objective: "Update the selected object.",
    conversationSummary: "The user wants the selected object updated.",
    actions: [{ instruction: "Update the selected object.", targetRefs: [] }],
    constraints: [],
    questions: [],
    capabilities: ["calendar"],
    contextRequests: [],
    confirmedActionReferenceIds: [],
    temporalResolutions: [],
    ...overrides,
  };
  return {
    ...value,
    actions: value.actions.map((action) => ({
      targetSetRefs: [],
      relationshipSetRefs: [],
      unresolvedTargets: [],
      ...action,
    })),
    objectSets: value.objectSets ?? [],
    relationshipSets: value.relationshipSets ?? [],
  };
}

function fakeLedger({
  conversation = null, conversationState = null, actionReferences = [], referencedExchanges = [], toolReceipts = [],
} = {}) {
  const events = [];
  const sequences = new Map([["event-current", 9]]);
  let nextSequence = 10;
  return {
    events,
    append(event) {
      const eventId = `event-${nextSequence}`;
      events.push({ ...event, eventId, eventSeq: nextSequence, occurredAtMs: nextSequence * 10 });
      sequences.set(eventId, nextSequence);
      nextSequence += 1;
      return eventId;
    },
    eventSequence(eventId) { return sequences.get(eventId) ?? null; },
    conversationBoundaryEventSeq() { return 0; },
    latestConversationState() { return structuredClone(conversationState); },
    activeDeferredActionReferences() { return structuredClone(actionReferences); },
    referencedExchangesForRequest() { return structuredClone(referencedExchanges); },
    toolReceiptList({ requestId, limit = 20 }) {
      const receipts = toolReceipts
        .filter((receipt) => requestId == null || receipt.requestId === requestId)
        .slice(0, limit);
      return { receipts: structuredClone(receipts), count: receipts.length, hasMore: false };
    },
    recentConversation() {
      return conversation ?? [{
        eventSeq: 4,
        requestId: "request-prior",
        role: "assistant",
        content: "The selected event is ready to update.",
      }];
    },
  };
}

function contextBuilder() {
  return {
    async build(_requestId, _requestText, options) {
      const prepared = options.preparedCapabilityContext ?? [];
      const developerInstructions = [
        "BOUNDED APPLICATION CONTEXT",
        ...prepared.map(({ heading, text }) => `# ${heading}\n${text}`),
      ].join("\n\n");
      return {
        text: developerInstructions,
        developerInstructions,
        requestAttachmentInput: null,
        profileFacts: [],
        activeProfileFactCount: 0,
        relevantProfileTypes: [],
        relevantProfileQuestions: [],
        localCalendar: "Wednesday 2026-10-14; Thursday 2026-10-15; Friday 2026-10-16",
        history: [],
        contextBudget: { truncated: false },
        attachment: options.attachment ?? null,
      };
    },
  };
}

function workflowConfig() {
  return {
    model: "test-model",
    reasoningEffort: "high",
    orientationReasoningEffort: "medium",
    auditReasoningEffort: "low",
    repairReasoningEffort: "high",
    turnWorkflowEnabled: true,
    maxToolCalls: 8,
    systemPromptPath: "unused",
  };
}

function transport(runTurn, requests) {
  return {
    id: "test-transport",
    displayName: "Test model",
    describeRequest(payload) {
      return {
        transport: this.id,
        model: payload.model,
        reasoningEffort: payload.effort,
        conversationId: payload.conversationId,
        developerInstructions: payload.developerInstructions,
        input: payload.input,
        callableTools: structuredClone(payload.tools),
        structuredOutput: payload.outputSchema ?? null,
      };
    },
    async runTurn(payload) {
      requests.push(payload);
      return runTurn(payload, requests.length - 1);
    },
  };
}

function runtimeWith({ registry, ledger, runTurn, requests, contextBuilderOverride = null }) {
  const runtime = new SlayerRuntime({
    modelTransport: transport(runTurn, requests),
    registry,
    contextBuilder: contextBuilderOverride ?? contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";
  return runtime;
}

function calendarUpdateTool(registry, execute) {
  registry.withCapability("calendar").register({
    name: "calendar_event_update",
    description: "Update or cancel one exact stored calendar event. Null fields preserve their current values.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        calendar_event_id: { type: "integer", minimum: 1 },
        title: { type: ["string", "null"] },
        status: { type: ["string", "null"], enum: ["confirmed", "cancelled", null] },
      },
      required: ["calendar_event_id", "title", "status"],
    },
    execute,
  });
}

test("the normal mutation path is one common-sense call plus execution and skips semantic audit", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  let updates = 0;
  calendarUpdateTool(registry, async (argumentsObject) => {
    updates += 1;
    return { updated: true, event: { calendar_event_id: argumentsObject.calendar_event_id, title: "Admin" } };
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        assert.equal(payload.tools.length, 0);
        assert.match(payload.developerInstructions, /Common-sense orientation/);
        assert.doesNotMatch(payload.developerInstructions, /calendar_event_update/);
        assert.match(payload.developerInstructions, /selected event is ready to update/);
        assert.doesNotMatch(payload.developerInstructions, /Local calendar for relative dates/);
        assert.equal(Object.hasOwn(payload.outputSchema.properties, "requiredTools"), false);
        return completed(JSON.stringify(core({
          objective: "Rename calendar event 3165 to Admin.",
          conversationSummary: "The user wants one calendar event renamed.",
          actions: [{ instruction: "Rename calendar event 3165 to Admin.", targetRefs: [] }],
        })));
      }
      assert.equal(index, 1);
      assert.deepEqual(payload.tools.map(({ name }) => name), ["calendar_event_update"]);
      const result = await payload.onToolCall({
        callId: "update-event",
        tool: "calendar_event_update",
        arguments: { calendar_event_id: 3165, title: "Admin", status: null },
      });
      assert.equal(result.ok, true);
      return completed("Renamed the event to Admin.", 30);
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-rename", requestEventId: "event-current", text: "Rename event 3165 to Admin.",
  }), "Renamed the event to Admin.");
  assert.equal(updates, 1);
  assert.equal(requests.length, 2);
  assert.equal(ledger.events.filter(({ type }) => type === "orientation.core").length, 1);
  assert.equal(ledger.events.some(({ payload }) => payload?.workflowStep === "orientation_context"), false);
  assert.equal(ledger.events.find(({ name }) => name === "Audit skipped").payload.skipped, true);
});

test("sequenced to-do creation responses include the group-local sequence from the receipt", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registry.withCapability("todos").register({
    name: "todo_add",
    description: "Add one to-do and return its database ID and optional group-local sequence.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string" },
        todo_group_id: { type: "integer" },
      },
      required: ["text", "todo_group_id"],
    },
    async execute({ text, todo_group_id }) {
      return {
        created: true,
        task: {
          personal_task_id: 433,
          todo_group_id,
          sequence: "167",
          group_name: "Watch Jobs",
          text,
          ref: "agent-slayer://todos/433",
        },
      };
    },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        return completed(JSON.stringify(core({
          objective: "Add a sequenced Watch Jobs to-do.",
          conversationSummary: "The user wants one Watch Jobs to-do created.",
          actions: [{ instruction: "Add the Watch Jobs to-do.", targetRefs: [] }],
          capabilities: ["todos"],
        })));
      }
      assert.equal(index, 1);
      const result = await payload.onToolCall({
        callId: "add-watch-job",
        tool: "todo_add",
        arguments: { text: "Remove watch links", todo_group_id: 10 },
      });
      assert.equal(result.ok, true);
      return completed("Added **#433** to **Watch Jobs**.", 30);
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-add-watch-job",
    requestEventId: "event-current",
    text: "Add a Watch Jobs to-do.",
  }), "Added **#433** to **Watch Jobs**.\n\nSequence number: **Watch Jobs #167**.");
  assert.equal(requests.length, 2);
  assert.match(ledger.events.find(({ name, phase }) => name === "Execute request" && phase === "end").content,
    /Sequence number: \*\*Watch Jobs #167\*\*/u);
});

test("a requested context view supplies observed bindings directly to execution", async () => {
  const requests = [];
  const ledger = fakeLedger({
    conversation: [{
      eventSeq: 4,
      requestId: "request-unrelated",
      role: "assistant",
      content: "Moved Leg day and attached the cookie to-do.",
      objectReferences: [{
        mention: "Unrelated calendar event",
        role: "subject",
        type: "calendar.event",
        source: "native:calendar",
        objects: [{ id: 3169, ref: "agent-slayer://calendar-events/3169", display: "Leg day" }],
        sourceEventSeqs: [4],
      }],
    }],
    conversationState: {
      activeObjective: "Attach the cookie to-do to the calendar event.",
      unresolvedQuestions: [],
    },
    actionReferences: [{
      referenceId: "unrelated-invoice-action",
      targetTool: "invoice_send",
      summary: "Send an unrelated invoice after confirmation.",
    }],
    toolReceipts: [{
      receiptEventSeq: 5,
      requestId: "request-unrelated",
      tool: "calendar_event_update",
      status: "complete",
      ok: true,
    }],
  });
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registry.registerContextView("journal", {
    id: "journal.active_trackers",
    title: "Active personal-journal trackers",
    description: "Active tracker identities and units.",
    async execute() {
      return {
        heading: "Active personal-journal trackers",
        text: "- [tracker 1] name: Weight | group: Biometrics [journal_group_id=5] | unit: kg",
        data: {
          trackers: [{
            tracker_id: 1,
            journal_group_id: 5,
            name: "Weight",
            unit: "kg",
            ref: "agent-slayer://journal-trackers/1",
            group_ref: "agent-slayer://journal-groups/5",
            group_name: "Biometrics",
          }],
        },
      };
    },
  });
  let additions = 0;
  registry.register({
    name: "journal_add",
    description: "Record one observation under an existing tracker.",
    capabilityId: "journal",
    annotations: { readOnlyHint: false, destructiveHint: false },
    metadata: {
      "agent-slayer/object-input-bindings": {
        protocol: "agent-slayer.object-input-bindings",
        version: 1,
        bindings: [{ path: "/tracker_id", objectType: "journal.tracker", value: "id", role: "subject" }],
      },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tracker_id: { type: "integer" },
        number_value: { type: "number" },
      },
      required: ["tracker_id", "number_value"],
    },
    async execute({ tracker_id, number_value }) {
      additions += 1;
      assert.equal(tracker_id, 1);
      assert.equal(number_value, 75.8);
      return {
        created: true,
        tracker: {
          tracker_id: 1, journal_group_id: 5, name: "Weight",
          ref: "agent-slayer://journal-trackers/1",
        },
        entry: {
          journal_entry_id: 190, tracker_id: 1,
          content_text: "Weight measurement: 75.8 kg.",
          ref: "agent-slayer://journal-entries/190",
          tracker_name: "Weight",
        },
      };
    },
  });
  registry.register({
    name: "journal_update",
    description: "Update one exact journal entry.",
    capabilityId: "journal",
    annotations: { readOnlyHint: false, destructiveHint: false },
    metadata: {
      "agent-slayer/object-input-bindings": {
        protocol: "agent-slayer.object-input-bindings",
        version: 1,
        bindings: [{ path: "/journal_entry_id", objectType: "journal.entry", value: "id", role: "subject" }],
      },
    },
    parameters: {
      type: "object", additionalProperties: false,
      properties: { journal_entry_id: { type: "integer" } },
      required: ["journal_entry_id"],
    },
    async execute() { throw new Error("journal_update should not run"); },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        assert.match(payload.developerInstructions, /Leg day|cookie to-do/);
        assert.doesNotMatch(payload.developerInstructions, /calendar-events\/3169/);
        assert.doesNotMatch(payload.developerInstructions, /unrelated-invoice-action|unrelated invoice/);
        assert.doesNotMatch(payload.developerInstructions, /Recent durable receipt index/);
        assert.doesNotMatch(payload.developerInstructions, /Local calendar for relative dates/);
        return completed(JSON.stringify(core({
          objective: "Record a weight measurement of 75.8.",
          conversationSummary: "The user wants to log a weight measurement.",
          actions: [{ instruction: "Log a weight measurement of 75.8.", targetRefs: [] }],
          capabilities: ["journal"],
          contextRequests: ["journal.active_trackers"],
        })));
      }
      assert.equal(index, 1, "prepared bindings must not require a search or another model stage");
      assert.match(payload.developerInstructions, /agent-slayer:\/\/journal-trackers\/1/);
      assert.doesNotMatch(payload.developerInstructions, /unrelated-invoice-action|unrelated invoice/);
      assert.doesNotMatch(payload.developerInstructions, /Recent durable receipt index/);
      assert.deepEqual(payload.tools.map(({ name }) => name), ["journal_add", "journal_update"]);
      const result = await payload.onToolCall({
        callId: "log-weight",
        tool: "journal_add",
        arguments: { tracker_id: 1, number_value: 75.8 },
      });
      assert.equal(result.ok, true);
      return {
        ...completed("Logged your weight: 75.8 kg.", 30),
        protocol: { objectBindingRefreshCount: 1 },
      };
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-weight", requestEventId: "event-current", text: "log weight 75.8",
  }), "Logged your weight: 75.8 kg.");
  assert.equal(additions, 1);
  assert.equal(requests.length, 2);
  assert.equal(ledger.events.some(({ type }) => type === "object.binding.rejected"), false);
  assert.equal(ledger.events.filter(({ type }) => type === "tools.schema_refresh.requested").length, 0);
  assert.equal(ledger.events.find(({ name }) => name === "Audit skipped").payload.skipped, true);
});

test("explicit batch selections are verified once and stay one bulk action", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  const selections = [7, 8, 9].map((id) => ({
    mention: `@Task ${id} — To-do #${id}`,
    type: "todos.personal_task",
    source: "native:todos",
    id,
    ref: `agent-slayer://todos/${id}`,
    display: `Task ${id}`,
  }));
  registerNativeObjectContextView(registry, {
    searchNativeObjects() {
      return { source: "native_mariadb_object_tables", capturedAtUtc: "2026-10-14T12:00:00Z", objects: [] };
    },
    resolveNativeObjectCandidates(candidates) {
      assert.deepEqual(candidates, selections);
      return candidates.map(({ id, ref, display }) => ({
        type: "todo",
        domainType: "todos.personal_task",
        source: "native:todos",
        table: "todo_personal",
        id,
        ref,
        label: "To-do",
        title: display,
        detail: "",
        matchedOn: ["selected stable reference"],
        related: [],
      }));
    },
  });
  let bulkCalls = 0;
  registry.withCapability("todos").register({
    name: "todo_complete_batch",
    description: "Complete one through 500 exact to-dos atomically.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    metadata: {
      [objectInputBindingsMetadataKey]: {
        protocol: "agent-slayer.object-input-bindings",
        version: 1,
        bindings: [{
          path: "/updates/*/personal_task_id",
          objectType: "todos.personal_task",
          value: "id",
          role: "subject",
        }],
      },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        updates: {
          type: "array", minItems: 1, maxItems: 500,
          items: {
            type: "object", additionalProperties: false,
            properties: { personal_task_id: { type: "integer" } },
            required: ["personal_task_id"],
          },
        },
      },
      required: ["updates"],
    },
    async execute({ updates }) {
      bulkCalls += 1;
      const todo_ids = updates.map(({ personal_task_id }) => personal_task_id);
      assert.deepEqual(todo_ids, [7, 8, 9]);
      return { updated_count: 3, todo_ids };
    },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        assert.match(payload.developerInstructions, /Explicit composer selections/);
        return completed(JSON.stringify(core({
          objective: "Complete all three selected to-dos.",
          conversationSummary: "The user selected three to-dos and wants all of them completed.",
          actions: [{
            instruction: "Complete all three selected to-dos.",
            targetRefs: selections.map(({ ref }) => ref),
          }],
          capabilities: ["todos"],
        })));
      }
      if (index === 2) {
        assert.match(payload.developerInstructions, /TOOL_FAILURE_REQUIRES_SEMANTIC_REVIEW/);
        return completed(JSON.stringify({
          version: 1,
          outcome: "complete",
          summary: "The complete explicit selection was updated successfully after the incomplete call was rejected.",
          satisfied: ["All three explicitly selected to-dos were completed."],
          remaining: [],
          repairInstructions: [],
        }));
      }
      assert.equal(index, 1, "selected-object hydration must not add a model call");
      assert.deepEqual(payload.tools.map(({ name }) => name), ["todo_complete_batch"]);
      assert.match(payload.developerInstructions, /agent-slayer:\/\/todos\/9/);
      const incomplete = await payload.onToolCall({
        callId: "complete-incomplete-batch",
        tool: "todo_complete_batch",
        arguments: { updates: [7, 8].map((personal_task_id) => ({ personal_task_id })) },
      });
      assert.equal(incomplete.ok, false);
      assert.match(incomplete.error, /must include the complete explicit.*Task 9/u);
      const result = await payload.onToolCall({
        callId: "complete-batch",
        tool: "todo_complete_batch",
        arguments: { updates: [7, 8, 9].map((personal_task_id) => ({ personal_task_id })) },
      });
      assert.equal(result.ok, true);
      return completed("Completed all three selected to-dos.", 30);
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-batch", requestEventId: "event-current",
    text: "Complete these three.", selectedObjectCandidates: selections,
  }), "Completed all three selected to-dos.");
  assert.equal(bulkCalls, 1);
  assert.equal(requests.length, 3);
  const accepted = ledger.events.find(({ type }) => type === "orientation.core");
  assert.deepEqual(accepted.payload.core.actions[0].targetRefs, selections.map(({ ref }) => ref));
  assert.deepEqual(accepted.payload.objectReferences[0].objects.map(({ id }) => id), [7, 8, 9]);
  assert.equal(ledger.events.filter(({ type }) => type === "object.binding.rejected").length, 1);
});

test("missing explicit selections stop execution deterministically", async () => {
  const requests = [];
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  const selections = [7, 8].map((id) => ({
    mention: `@Task ${id} — To-do #${id}`,
    type: "todos.personal_task",
    source: "native:todos",
    id,
    ref: `agent-slayer://todos/${id}`,
    display: `Task ${id}`,
  }));
  registerNativeObjectContextView(registry, {
    searchNativeObjects() { return { objects: [] }; },
    resolveNativeObjectCandidates() {
      return [{
        type: "todo", domainType: "todos.personal_task", source: "native:todos",
        table: "todo_personal", id: 7, ref: "agent-slayer://todos/7", label: "To-do",
        title: "Task 7", detail: "", matchedOn: ["selected stable reference"], related: [],
      }];
    },
  });
  registry.withCapability("todos").register({
    name: "todo_complete_batch",
    description: "Complete exact to-dos.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() { throw new Error("must not execute"); },
  });
  const runtime = runtimeWith({
    registry,
    ledger: fakeLedger(),
    requests,
    runTurn: async (_payload, index) => {
      assert.equal(index, 0);
      return completed(JSON.stringify(core({
        objective: "Complete both selected to-dos.",
        actions: [{ instruction: "Complete both selected to-dos.", targetRefs: selections.map(({ ref }) => ref) }],
        capabilities: ["todos"],
      })));
    },
  });

  await assert.rejects(runtime.run({
    requestId: "request-missing", requestEventId: "event-current",
    text: "Complete both.", selectedObjectCandidates: selections,
  }), /Every selected object must be verified.*agent-slayer:\/\/todos\/8/u);
  assert.equal(requests.length, 1);
});

test("an explicit selection does not hide prior exact relationship evidence for a mixed-endpoint request", async () => {
  const requests = [];
  const content = {
    mention: "@Job 6 - Sidelined — Content item #165",
    type: "video.content_item",
    source: "native:video",
    id: 165,
    ref: "agent-slayer://content-items/165",
    display: "Job 6 - Sidelined",
  };
  const priorObjects = [{
    mention: "Watch Job 6",
    role: "relationship_source",
    type: "todos.personal_task",
    source: "native:todos",
    objects: [{ id: 126, ref: "agent-slayer://todos/126", display: "Job 6 - Sidelined" }],
    sourceEventSeqs: [4],
  }, {
    mention: "Previously linked Job 6 content",
    role: "relationship_target",
    type: "video.content_item",
    source: "native:video",
    objects: [{ id: 149, ref: "agent-slayer://content-items/149", display: "Earlier Job 6" }],
    sourceEventSeqs: [4],
  }];
  const relationshipSet = {
    protocol: "agent-slayer.reference-set",
    version: 1,
    kind: "relationship_set",
    ref: "agent-slayer://reference-sets/relationships/watch-job-content",
    display: "Watch Jobs linked to matching content items",
    relationshipType: "todo_content_link",
    fromType: "todos.personal_task",
    toType: "video.content_item",
    edges: [{
      fromRef: "agent-slayer://todos/126",
      toRef: "agent-slayer://content-items/149",
    }],
    sourceEventSeqs: [4],
  };
  const ledger = fakeLedger({
    conversation: [{
      eventSeq: 4,
      requestId: "request-prior-links",
      role: "assistant",
      content: "I linked each numbered content item to its matching Watch Job.",
      objectReferences: priorObjects,
      referenceSets: [relationshipSet],
    }],
  });
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registerNativeObjectContextView(registry, {
    searchNativeObjects() { return { objects: [] }; },
    resolveNativeObjectCandidates() {
      return [{
        type: "content_item", domainType: content.type, source: content.source,
        table: "content_items", id: content.id, ref: content.ref,
        label: "Content item", title: content.display, detail: "",
        matchedOn: ["selected stable reference"], related: [],
      }];
    },
  });
  registry.withCapability("relationships").register({
    name: "object_connection_set",
    description: "Connect exact object pairs.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() {
      return {
        selected_count: 1, changed_count: 1, unchanged_count: 0,
        results: [{
          from: {
            type: "video.content_item", source: "native:video", id: 165,
            ref: "agent-slayer://content-items/165", display: "Job 6 - Sidelined",
          },
          to: {
            type: "todos.personal_task", source: "native:todos", id: 126,
            ref: "agent-slayer://todos/126", display: "Job 6 - Sidelined",
          },
          linked: true, changed: true,
        }],
      };
    },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        assert.match(payload.developerInstructions, /Exact previously verified object references/u);
        assert.match(payload.developerInstructions, /Watch Job 6/u);
        assert.match(payload.developerInstructions, /Exact selectable sets/u);
        assert.match(payload.developerInstructions, /todo_content_link/u);
        return completed(JSON.stringify(core({
          objective: "Connect the selected content item to Watch Job 6.",
          conversationSummary: "The selected content item should be connected to numbered Watch Job 6.",
          actions: [{
            instruction: "Connect the selected content item to Watch Job 6 using the canonical to-do/content relationship.",
            targetRefs: [content.ref],
            unresolvedTargets: [{
              slot: "watch_job",
              description: "Watch Job 6 in the exact named to-do group",
              objectType: "todos.personal_task",
              role: "relationship source",
              cardinality: "one",
            }],
          }],
          capabilities: ["relationships"],
        })));
      }
      assert.equal(index, 1);
      assert.equal(payload.tools.some(({ name }) => name === "object_connection_set"), true);
      const result = await payload.onToolCall({
        callId: "connect-selected-content",
        tool: "object_connection_set",
        arguments: {},
      });
      assert.equal(result.ok, true);
      return completed("Connected the selected content item to Watch Job 6.", 30);
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-mixed-endpoints",
    requestEventId: "event-current",
    text: "This should be connected to Watch Job 6.",
    selectedObjectCandidates: [content],
  }), "Connected the selected content item to Watch Job 6.");
  assert.equal(requests.length, 2);
  const observed = ledger.events.find(({ type }) => type === "reference.sets.observed");
  assert.equal(observed.payload.referenceSets[0].relationshipType, "todo_content_link");
  assert.deepEqual(observed.payload.referenceSets[0].edges, [{
    fromRef: "agent-slayer://todos/126",
    toRef: "agent-slayer://content-items/165",
  }]);
});

test("structured execution can request one bounded missing owning capability", async () => {
  const requests = [];
  const selected = {
    mention: "@Selected content",
    type: "video.content_item",
    source: "native:video",
    id: 165,
    ref: "agent-slayer://content-items/165",
    display: "Selected content",
  };
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registerNativeObjectContextView(registry, {
    searchNativeObjects() { return { objects: [] }; },
    resolveNativeObjectCandidates() {
      return [{
        type: "content_item", domainType: selected.type, source: selected.source,
        table: "content_items", id: selected.id, ref: selected.ref,
        label: "Content item", title: selected.display, detail: "",
        matchedOn: ["selected stable reference"], related: [],
      }];
    },
  });
  registry.withCapability("video").register({
    name: "video_content_list",
    description: "Read content.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return { items: [] }; },
  });
  registry.withCapability("todos").register({
    name: "todo_selected_content_link",
    description: "Link the selected content through the owning to-do domain.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    metadata: {
      [objectInputBindingsMetadataKey]: {
        protocol: "agent-slayer.object-input-bindings",
        version: 1,
        bindings: [{
          path: "/content_id", objectType: "video.content_item", value: "id", role: "subject",
        }],
      },
    },
    parameters: {
      type: "object", additionalProperties: false,
      properties: { content_id: { type: "integer" } }, required: ["content_id"],
    },
    async execute({ content_id }) {
      assert.equal(content_id, 165);
      return { linked: true, content_id };
    },
  });
  const runtime = runtimeWith({
    registry,
    ledger: fakeLedger({ conversation: [] }),
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        return completed(JSON.stringify(core({
          objective: "Apply the requested connection to the selected content.",
          conversationSummary: "The selected content needs an owning-domain connection.",
          actions: [{ instruction: "Apply the connection.", targetRefs: [selected.ref] }],
          capabilities: ["video"],
        })));
      }
      if (index === 1) {
        assert.equal(payload.tools.some(({ name }) => name === "request_capabilities"), true);
        assert.equal(payload.tools.some(({ name }) => name === "todo_selected_content_link"), false);
        const expansion = await payload.onToolCall({
          callId: "request-todos",
          tool: "request_capabilities",
          arguments: { capabilities: ["todos"] },
        });
        assert.equal(expansion.ok, true);
        return completed("Loading the owning relationship capability.", 25);
      }
      assert.equal(index, 2);
      assert.equal(payload.tools.some(({ name }) => name === "todo_selected_content_link"), true);
      const linked = await payload.onToolCall({
        callId: "link-selected-content",
        tool: "todo_selected_content_link",
        arguments: { content_id: 165 },
      });
      assert.equal(linked.ok, true);
      return completed("Connected the selected content.", 30);
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-expand-capability",
    requestEventId: "event-current",
    text: "Apply it.",
    selectedObjectCandidates: [selected],
  }), "Connected the selected content.");
  assert.equal(requests.length, 3);
});

test("an explicitly referenced reusable exchange supplies tool-boundary identity evidence", async () => {
  const requests = [];
  const referencedTask = {
    mention: "Task 178 from the referenced exchange",
    role: "subject",
    type: "todos.personal_task",
    source: "native:todos",
    objects: [{
      id: 178,
      ref: "agent-slayer://todos/178",
      display: "Call Alice",
    }],
    sourceEventSeqs: [5],
  };
  const ledger = fakeLedger({
    referencedExchanges: [{
      requestId: "request-prior-task",
      status: "complete",
      taskOutcome: "complete",
      objectReferencePolicy: "reusable",
      objectReferences: [referencedTask],
    }],
  });
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  let updates = 0;
  registry.withCapability("todos").register({
    name: "todo_complete_one",
    description: "Complete one exact to-do.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    metadata: {
      [objectInputBindingsMetadataKey]: {
        protocol: "agent-slayer.object-input-bindings",
        version: 1,
        bindings: [{
          path: "/personal_task_id",
          objectType: "todos.personal_task",
          value: "id",
          role: "subject",
        }],
      },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { personal_task_id: { type: "integer", minimum: 1 } },
      required: ["personal_task_id"],
    },
    async execute({ personal_task_id }) {
      updates += 1;
      return { updated: true, personal_task_id };
    },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        assert.match(payload.developerInstructions, /agent-slayer:\/\/todos\/178/u);
        return completed(JSON.stringify(core({
          objective: "Complete task 178 from the referenced exchange.",
          conversationSummary: "The referenced exchange identifies task 178.",
          actions: [{ instruction: "Complete task 178.", targetRefs: [] }],
          capabilities: ["todos"],
        })));
      }
      assert.equal(index, 1);
      const result = await payload.onToolCall({
        callId: "complete-referenced-task",
        tool: "todo_complete_one",
        arguments: { personal_task_id: 178 },
      });
      assert.equal(result.ok, true);
      return completed("Completed task 178.", 30);
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-reference-use",
    requestEventId: "event-current",
    text: "Complete that task.",
  }), "Completed task 178.");
  assert.equal(updates, 1);
  assert.equal(ledger.events.some(({ type }) => type === "object.binding.rejected"), false);
});

test("date inconsistency gets one exceptional correction before tools are exposed", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  calendarUpdateTool(registry, async () => ({ updated: true }));
  const resolution = {
    sourceText: "Friday",
    sourceEventSeqs: [9],
    weekday: "Friday",
    localDate: "2026-10-16",
    timeZone: "America/New_York",
    role: "target",
    appliesTo: "calendar_start",
  };
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        return completed(JSON.stringify(core({
          objective: "Move event 12 to Friday.",
          actions: [{ instruction: "Move event 12 to Friday.", targetRefs: [] }],
          temporalResolutions: [{ ...resolution, localDate: "2026-10-15" }],
        })));
      }
      if (index === 1) {
        assert.match(payload.developerInstructions, /Deterministic temporal validation rejected/);
        assert.equal(payload.tools.length, 0);
        return completed(JSON.stringify(core({
          objective: "Move event 12 to Friday.",
          actions: [{ instruction: "Move event 12 to Friday.", targetRefs: [] }],
          temporalResolutions: [resolution],
        })));
      }
      assert.equal(index, 2);
      const result = await payload.onToolCall({
        callId: "move-event",
        tool: "calendar_event_update",
        arguments: { calendar_event_id: 12, title: null, status: null },
      });
      assert.equal(result.ok, true);
      return completed("Moved the event to Friday.");
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-date", requestEventId: "event-current", text: "Move event 12 to Friday.",
  }), "Moved the event to Friday.");
  assert.equal(requests.length, 3);
});

test("destructive language triggers the exceptional semantic audit", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  calendarUpdateTool(registry, async () => ({
    updated: true,
    event: { calendar_event_id: 3165, status: "cancelled" },
  }));
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        return completed(JSON.stringify(core({
          objective: "Delete calendar event 3165.",
          conversationSummary: "The user explicitly asked to delete one calendar event.",
          actions: [{ instruction: "Delete calendar event 3165.", targetRefs: [] }],
        })));
      }
      if (index === 1) {
        const result = await payload.onToolCall({
          callId: "cancel-event",
          tool: "calendar_event_update",
          arguments: { calendar_event_id: 3165, title: null, status: "cancelled" },
        });
        assert.equal(result.ok, true);
        return completed("Archived the event.");
      }
      assert.equal(index, 2);
      assert.match(payload.developerInstructions, /DESTRUCTIVE_INTENT_SEMANTICS/);
      assert.match(payload.developerInstructions, /not.*interchangeable/si);
      return completed(JSON.stringify({
        version: 1,
        outcome: "blocked",
        summary: "The repaired receipts do not prove permanent deletion.",
        satisfied: ["The event was cancelled."],
        remaining: ["Permanent deletion remains unverified."],
        repairInstructions: [],
      }));
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-delete", requestEventId: "event-current", text: "Delete calendar event 3165.",
  }), [
    "I completed part of the request, but I couldn't complete everything requested.",
    "",
    "Still incomplete:",
    "- Permanent deletion remains unverified.",
  ].join("\n"));
  assert.equal(requests.length, 3);
});

test("an exceptional repair is audited again before its response is accepted", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  calendarUpdateTool(registry, async () => ({
    updated: true,
    event: { calendar_event_id: 3165, status: "cancelled" },
  }));
  registry.withCapability("calendar").register({
    name: "calendar_event_delete",
    description: "Permanently delete one exact calendar event.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    parameters: {
      type: "object", additionalProperties: false,
      properties: { calendar_event_id: { type: "integer", minimum: 1 } },
      required: ["calendar_event_id"],
    },
    async execute({ calendar_event_id: calendarEventId }) {
      return { deleted: true, calendar_event_id: calendarEventId };
    },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) return completed(JSON.stringify(core({
        objective: "Delete calendar event 3165.",
        actions: [{ instruction: "Delete calendar event 3165.", targetRefs: [] }],
      })));
      if (index === 1) {
        await payload.onToolCall({
          callId: "cancel-first", tool: "calendar_event_update",
          arguments: { calendar_event_id: 3165, title: null, status: "cancelled" },
        });
        return completed("Cancelled the event.");
      }
      if (index === 2) return completed(JSON.stringify({
        version: 1,
        outcome: "repair_needed",
        summary: "Cancellation did not satisfy deletion.",
        satisfied: ["The event was cancelled."],
        remaining: ["The event must be permanently deleted."],
        repairInstructions: ["Call the exact permanent-delete tool for event 3165."],
      }));
      if (index === 3) {
        assert.match(payload.developerInstructions, /Cancellation did not satisfy deletion/);
        const result = await payload.onToolCall({
          callId: "delete-repair", tool: "calendar_event_delete",
          arguments: { calendar_event_id: 3165 },
        });
        assert.equal(result.ok, true);
        return completed("Deleted the event permanently.");
      }
      assert.equal(index, 4);
      assert.match(payload.developerInstructions, /post_repair_verification/);
      assert.match(payload.developerInstructions, /calendar_event_delete/);
      return completed(JSON.stringify({
        version: 1,
        outcome: "complete",
        summary: "The repaired receipt proves permanent deletion.",
        satisfied: ["Calendar event 3165 was permanently deleted."],
        remaining: [],
        repairInstructions: [],
      }));
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-delete-repair", requestEventId: "event-current",
    text: "Delete calendar event 3165.",
  }), "Deleted the event permanently.");
  assert.equal(requests.length, 5);
});

test("ordinary informational work needs no mutation receipt and no audit", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registry.withCapability("todos").register({
    name: "todo_list",
    description: "List current to-dos.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return { todos: [] }; },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        return completed(JSON.stringify(core({
          mode: "answer",
          objective: "Tell the user which to-dos are current.",
          conversationSummary: "The user asked for the current to-do list.",
          actions: [],
          capabilities: ["todos"],
        })));
      }
      assert.equal(index, 1);
      const result = await payload.onToolCall({
        callId: "list",
        tool: "todo_list",
        arguments: {
          result_filter: {
            collection_path: null,
            query: null,
            match_mode: "all_terms",
            include_fields: [],
            exclude_fields: [],
            max_items: 200,
            max_characters: 32768,
          },
        },
      });
      assert.equal(result.ok, true);
      return completed("There are no current to-dos.");
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-list", requestEventId: "event-current", text: "What are my current to-dos?",
  }), "There are no current to-dos.");
  assert.equal(requests.length, 2);
});

test("tool-specific protected fields preserve nested batch evidence through projection", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registry.withCapability("contacts").register({
    name: "nested_contact_lookup",
    description: "Return exact contact matches grouped by query.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    readResultCollectionPaths: ["/results"],
    readResultProtectedFields: ["query", "match_count", "matches"],
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() {
      return {
        query_count: 1,
        results: [{
          query: "Eddie Moore",
          match_count: 1,
          matches: [{ contact_id: 383, display_name: "Eddie Moore", status: "active" }],
        }],
      };
    },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        return completed(JSON.stringify(core({
          mode: "answer",
          objective: "Find the current contact for Eddie Moore.",
          conversationSummary: "The user requested one read-only contact lookup.",
          actions: [],
          capabilities: ["contacts"],
        })));
      }
      assert.equal(index, 1);
      const result = await payload.onToolCall({
        callId: "nested-lookup",
        tool: "nested_contact_lookup",
        arguments: {
          result_filter: {
            collection_path: "/results",
            query: null,
            match_mode: "all_terms",
            include_fields: ["contact_id", "display_name", "status"],
            exclude_fields: [],
            max_items: 100,
            max_characters: 30_000,
          },
        },
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.result.results, [{
        query: "Eddie Moore",
        match_count: 1,
        matches: [{ contact_id: 383, display_name: "Eddie Moore", status: "active" }],
      }]);
      return completed("Eddie Moore matches active contact 383.");
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-nested-lookup", requestEventId: "event-current",
    text: "Find the current contact for Eddie Moore without changing anything.",
  }), "Eddie Moore matches active contact 383.");
  assert.equal(requests.length, 2);
});

test("structured execution retains the database read core when orientation selects only search", async () => {
  const requests = [];
  const ledger = fakeLedger({ conversation: [] });
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registry.withCapability("search").register({
    name: "global_search",
    description: "Search discovery sources.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { throw new Error("history search must not be needed"); },
  });
  for (const name of ["database_schema", "database_read"]) {
    registry.withCapability("database").register({
      name,
      description: `Bounded ${name}.`,
      annotations: { readOnlyHint: true, destructiveHint: false },
      parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
      async execute() { return {}; },
    });
  }
  registry.withCapability("database").register({
    name: "database_aggregate",
    description: "Count rows by declared dimensions.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        objectName: { type: "string" },
        where: { type: "object", additionalProperties: true },
        dimensions: { type: "array", items: { type: "object", additionalProperties: true } },
      },
      required: ["objectName", "where", "dimensions"],
    },
    async execute() {
      return {
        objectName: "todo_personal", totalCount: 3, totalBucketCount: 2,
        exhaustive: true, buckets: [
          { values: { related_contact_id: "present" }, count: 2 },
          { values: { related_contact_id: "missing" }, count: 1 },
        ],
      };
    },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        return completed(JSON.stringify(core({
          mode: "answer",
          objective: "Count Watch Jobs with and without contact connections.",
          conversationSummary: "The user wants current connected and unconnected Watch Jobs totals.",
          actions: [],
          capabilities: ["search"],
        })));
      }
      assert.equal(index, 1);
      assert.deepEqual(new Set(payload.tools.map(({ name }) => name)), new Set([
        "global_search", "database_schema", "database_read", "database_aggregate",
      ]));
      const result = await payload.onToolCall({
        callId: "aggregate-watch-jobs",
        tool: "database_aggregate",
        arguments: {
          objectName: "todo_personal",
          where: { todo_group_id: 10 },
          dimensions: [{ column: "related_contact_id", mode: "presence" }],
          result_filter: {
            collection_path: "/buckets",
            query: null,
            match_mode: "all_terms",
            include_fields: [],
            exclude_fields: [],
            max_items: 10,
            max_characters: 10000,
          },
        },
      });
      assert.equal(result.ok, true);
      return completed("Of 3 Watch Jobs, 1 is unconnected and 2 are connected.");
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-watch-job-count", requestEventId: "event-current",
    text: "how many of the watch jobs are not connected to a contact?",
  }), "Of 3 Watch Jobs, 1 is unconnected and 2 are connected.");
  assert.deepEqual(
    ledger.events.find(({ type }) => type === "orientation.core").payload.core.capabilities,
    ["search", "database"],
  );
  assert.deepEqual(
    ledger.events.find(({ type }) => type === "capability.selection").payload,
    {
      selectedByOrientation: ["search"],
      addedReadOnlyCoreCapabilities: ["database"],
      acceptedCapabilities: ["search", "database"],
    },
  );
  assert.equal(ledger.events.find(({ name }) => name === "Audit skipped").payload.skipped, true);
});

test("a complex continuation can recover opaque prior evidence during execution without bloating orientation", async () => {
  const requests = [];
  const ledger = fakeLedger({
    conversation: [{
      eventSeq: 4,
      requestId: "request-import-prior",
      role: "assistant",
      content: "The import job is ready to continue.",
    }],
    toolReceipts: [{
      receiptEventSeq: 42,
      requestId: "request-import-prior",
      occurredAtUtc: "2026-10-14T12:00:00Z",
      tool: "remote_accounting_start_import",
      status: "complete",
      ok: true,
    }],
  });
  const registry = new ToolRegistry();
  registry.register({
    name: "tool_receipt_read",
    description: "Read one exact durable tool receipt.",
    capabilityId: "database",
    annotations: { readOnlyHint: true, destructiveHint: false },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { receipt_event_seq: { type: "integer" } },
      required: ["receipt_event_seq"],
    },
    async execute({ receipt_event_seq }) {
      assert.equal(receipt_event_seq, 42);
      return { result: { import_job_id: "job-42" } };
    },
  });
  registry.register({
    name: "remote_accounting_resume_import",
    description: "Resume an exact accounting import job.",
    source: "mcp:accounting",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { import_job_id: { type: "string" } },
      required: ["import_job_id"],
    },
    async execute({ import_job_id }) {
      assert.equal(import_job_id, "job-42");
      return { resumed: true, import_job_id };
    },
  });
  const runtime = runtimeWith({
    registry,
    ledger,
    requests,
    runTurn: async (payload, index) => {
      if (index === 0) {
        assert.doesNotMatch(payload.developerInstructions, /Recent durable receipt index/);
        return completed(JSON.stringify(core({
          objective: "Resume the existing accounting import.",
          conversationSummary: "The user wants the previously prepared accounting import resumed.",
          actions: [{ instruction: "Resume the existing accounting import.", targetRefs: [] }],
          capabilities: ["integration:accounting"],
        })));
      }
      assert.equal(index, 1);
      assert.match(payload.developerInstructions, /Recent durable receipt index/);
      assert.deepEqual(payload.tools.map(({ name }) => name), [
        "tool_receipt_read", "remote_accounting_resume_import",
      ]);
      const receipt = await payload.onToolCall({
        callId: "read-receipt",
        tool: "tool_receipt_read",
        arguments: {
          receipt_event_seq: 42,
          result_filter: {
            collection_path: null,
            query: null,
            match_mode: "all_terms",
            include_fields: [],
            exclude_fields: [],
            max_items: 200,
            max_characters: 32768,
          },
        },
      });
      assert.equal(receipt.ok, true);
      const resumed = await payload.onToolCall({
        callId: "resume-import",
        tool: "remote_accounting_resume_import",
        arguments: { import_job_id: "job-42" },
      });
      assert.equal(resumed.ok, true);
      return completed("Resumed the accounting import.");
    },
  });

  assert.equal(await runtime.run({
    requestId: "request-resume", requestEventId: "event-current",
    text: "Resume the existing accounting import.",
  }), "Resumed the accounting import.");
  assert.equal(requests.length, 2);
});

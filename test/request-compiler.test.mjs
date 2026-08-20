import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  capabilityForTool,
  RequestCompiler,
  selectRequestCapabilities,
} from "../src/request-compiler.mjs";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { registerContactTools } from "../src/tools/contact-tools.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
import { registerJmapEmailTools } from "../src/tools/jmap-email-tools.mjs";
import { registerLogTools } from "../src/tools/log-tools.mjs";
import { registerProfileFactTools } from "../src/tools/profile-fact-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { registerWebPageTools } from "../src/tools/web-page-tools.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tool(name, source = "local") {
  return {
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
    strict: true,
    source,
  };
}

const tools = [
  tool("calendar_event_list"),
  tool("contact_file_import"),
  tool("contact_search"),
  tool("contact_lookup_batch"),
  tool("todo_list"),
  tool("log_add"),
  tool("profile_fact_list"),
  tool("profile_fact_set"),
  tool("database_read"),
  tool("database_write"),
  tool("history_range"),
  tool("email_search"),
  tool("email_send"),
  tool("web_page_read"),
  tool("remote_tlom_query_data", "mcp:tlom"),
  tool("remote_weather_forecast", "mcp:weather"),
  tool("remote_nutrition_lookup", "mcp:nutrition"),
];

function names(selection) {
  return selection.tools.map(({ name }) => name);
}

test("known tool families have stable hard-coded capability ownership", () => {
  assert.equal(capabilityForTool(tool("calendar_event_list")), "calendar");
  assert.equal(capabilityForTool(tool("contact_merge_batch")), "contacts");
  assert.equal(capabilityForTool(tool("todo_add")), "todos");
  assert.equal(capabilityForTool(tool("tracker_update")), "logs");
  assert.equal(capabilityForTool(tool("database_read")), "database");
  assert.equal(capabilityForTool(tool("database_write")), "database-write");
  assert.equal(capabilityForTool(tool("email_send")), "email");
  assert.equal(capabilityForTool(tool("remote_tlom_query_data", "mcp:tlom")), "integration:tlom");
  assert.equal(capabilityForTool(tool("video_render_interaction")), "video");
});

test("an explicit interaction-video request selects the contained renderer", () => {
  const selection = selectRequestCapabilities({
    tools: [...tools, tool("video_render_interaction")],
    text: "Create the finished vertical video for this interaction.",
  });
  assert.equal(names(selection).includes("video_render_interaction"), true);
  assert.equal(selection.capabilities.includes("video"), true);
  assert.equal(selection.fallbackAll, false);
});

test("an application capability override ignores unrelated prior-conversation routing", async () => {
  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
  });
  const compiled = await compiler.compile({
    tools: [...tools, tool("video_render_interaction")],
    text: "Create the MP4 for this interaction and return the download link.",
    recentConversation: [{ role: "user", content: "Add this to my calendar." }],
    previousCapabilities: ["calendar", "profile"],
    capabilityOverride: ["video"],
  });
  assert.deepEqual(names(compiled), ["video_render_interaction"]);
  assert.deepEqual(compiled.capabilities, ["video"]);
  assert.deepEqual(compiled.reasons, ["video:application-override"]);
  assert.match(compiled.instructions, /## video/);
  assert.doesNotMatch(compiled.instructions, /## calendar/);
});

test("every currently registered local tool belongs to an explicit capability", () => {
  const registry = new ToolRegistry();
  registerWebPageTools(registry, {});
  registerCalendarTools(registry, {}, {}, {}, null);
  registerContactTools(registry, {}, {}, {}, null);
  registerTodoTools(registry, {}, {}, null);
  registerLogTools(registry, {}, {}, null);
  registerProfileFactTools(registry, {}, null);
  registerDatabaseTools(registry, {}, {}, null);
  registerJmapEmailTools(registry, { health() { return { ready: true }; } });
  assert.deepEqual(
    registry.toolDefinitions().filter((definition) => capabilityForTool(definition) === "unclassified"),
    [],
  );
});

test("an email request receives email and durable-profile tools, not unrelated domains", () => {
  const selection = selectRequestCapabilities({ tools, text: "Show me unread email in my inbox." });
  assert.deepEqual(names(selection), ["contact_lookup_batch", "profile_fact_list", "profile_fact_set", "database_read", "email_search", "email_send"]);
  assert.deepEqual(selection.dependentTools, ["contact_lookup_batch"]);
  assert.deepEqual(selection.capabilities, ["database", "email", "profile"]);
  assert.equal(selection.fallbackAll, false);
});

test("a plural contacts request selects focused contact tools without falling back", () => {
  const selection = selectRequestCapabilities({
    tools,
    text: "Can you find cabinet or design people in my contacts?",
  });
  assert.deepEqual(names(selection), [
    "contact_file_import", "contact_search", "contact_lookup_batch",
    "profile_fact_list", "profile_fact_set", "database_read",
  ]);
  assert.deepEqual(selection.capabilities, ["contacts", "database", "profile"]);
  assert.equal(selection.fallbackAll, false);
});

test("common plural request words select their focused tool families", () => {
  const examples = [
    ["Read these webpages.", "web", "web_page_read"],
    ["Show my appointments.", "calendar", "calendar_event_list"],
    ["List my tasks.", "todos", "todo_list"],
    ["Show my trackers.", "logs", "log_add"],
    ["Inspect the database tables.", "database", "database_read"],
    ["Search previous conversations.", "history", "history_range"],
    ["Find my AbeBooks emails.", "email", "email_search"],
  ];

  for (const [text, capability, toolName] of examples) {
    const selection = selectRequestCapabilities({ tools, text });
    assert.equal(selection.capabilities.includes(capability), true, text);
    assert.equal(names(selection).includes(toolName), true, text);
    assert.equal(selection.fallbackAll, false, text);
  }
});

test("native database reads are always callable while database writes require explicit mutation intent", () => {
  const ordinary = selectRequestCapabilities({ tools, text: "What's going on?" });
  assert.equal(names(ordinary).includes("database_read"), true);
  assert.equal(names(ordinary).includes("database_write"), false);

  const audit = selectRequestCapabilities({ tools, text: "Read your DB audit trail and tool receipts." });
  assert.equal(audit.capabilities.includes("database"), true);
  assert.equal(names(audit).includes("database_read"), true);
  assert.equal(names(audit).includes("database_write"), false);

  const mutation = selectRequestCapabilities({ tools, text: "Update the database rows for those content items." });
  assert.equal(mutation.capabilities.includes("database-write"), true);
  assert.equal(names(mutation).includes("database_write"), true);
});

test("an explicit plural email request does not inherit an unrelated prior topic from incidental pronouns", () => {
  const selection = selectRequestCapabilities({
    tools,
    text: "can you check for abebooks emails and tell me what days my books are supposed to arrive? there is one order with two books on it coming from two different places",
    recentConversation: [
      { role: "user", content: "Log my weight for today." },
      { role: "assistant", content: "I recorded today's weight." },
    ],
    previousCapabilities: ["logs", "profile"],
  });

  assert.deepEqual(selection.capabilities, ["database", "email", "profile"]);
  assert.equal(names(selection).includes("email_search"), true);
  assert.equal(names(selection).includes("log_add"), false);
  assert.equal(selection.followsPriorTurn, false);
  assert.equal(selection.fallbackAll, false);
});

test("an explicit URL receives the page reader without unrelated application tools", () => {
  const selection = selectRequestCapabilities({ tools, text: "Read https://example.com/report for me." });
  assert.deepEqual(names(selection), ["profile_fact_list", "profile_fact_set", "database_read", "web_page_read"]);
  assert.deepEqual(selection.capabilities, ["database", "profile", "web"]);
});

test("attachment structure routes known imports and conservatively falls back when unknown", () => {
  const contacts = selectRequestCapabilities({
    tools,
    text: "Import this file.",
    attachment: { filename: "people.csv", mimeType: "text/csv", text: "display_name,email\nAlice,a@example.test" },
  });
  assert.deepEqual(names(contacts), [
    "contact_file_import", "contact_search", "contact_lookup_batch",
    "profile_fact_list", "profile_fact_set", "database_read",
  ]);

  const unknown = selectRequestCapabilities({
    tools,
    text: "Import this file.",
    attachment: { filename: "data.csv", mimeType: "text/csv", text: "alpha,beta\n1,2" },
  });
  assert.equal(unknown.fallbackAll, false);
  assert.deepEqual(names(unknown), ["profile_fact_list", "profile_fact_set", "database_read"]);
  assert.ok(unknown.reasons.includes("catalog:uncertain-attachment"));
});

test("short approvals retain prior capabilities and can add an explicit new domain", () => {
  const prior = [
    { role: "user", content: "Import these content items into the database." },
    { role: "assistant", content: "I can create the content group and import all rows. Shall I proceed?" },
  ];
  const approved = selectRequestCapabilities({
    tools,
    text: "Okay, go ahead.",
    recentConversation: prior,
    previousCapabilities: ["database", "database-write", "profile"],
  });
  assert.deepEqual(names(approved), ["profile_fact_list", "profile_fact_set", "database_read", "database_write"]);
  assert.equal(approved.followsPriorTurn, true);

  const emailed = selectRequestCapabilities({
    tools,
    text: "Okay, go ahead and email it.",
    recentConversation: prior,
    previousCapabilities: ["database", "database-write", "profile"],
  });
  assert.deepEqual(emailed.capabilities, ["database", "database-write", "email", "profile"]);

  const explanation = selectRequestCapabilities({
    tools,
    text: "Explain why that happened.",
    recentConversation: prior,
    previousCapabilities: ["database", "database-write", "profile"],
  });
  assert.deepEqual(explanation.capabilities, ["database", "database-write", "profile"]);
  assert.equal(explanation.followsPriorTurn, true);
});

test("ambiguous actionable requests keep a small core and expose the deferred catalog", async () => {
  const selection = selectRequestCapabilities({ tools, text: "Take care of it." });
  assert.equal(selection.fallbackAll, false);
  assert.deepEqual(names(selection), ["profile_fact_list", "profile_fact_set", "database_read"]);
  assert.ok(selection.reasons.includes("catalog:ambiguous-request"));

  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
  });
  const compiled = await compiler.compile({ tools, text: "Take care of it." });
  assert.equal(names(compiled).includes("request_capabilities"), true);
  assert.ok(compiled.deferredCapabilities.includes("integration:tlom"));
});

test("a new unclassified local tool fails open until it is assigned a capability", () => {
  const extended = [...tools, tool("brand_new_local_operation")];
  const selection = selectRequestCapabilities({ tools: extended, text: "Show my calendar." });
  assert.equal(selection.fallbackAll, true);
  assert.equal(selection.tools.length, extended.length);
  assert.ok(selection.reasons.includes("fallback:unclassified-tools"));
});

test("provider names select only that integration", () => {
  const tlom = selectRequestCapabilities({ tools, text: "Query TLOM for my properties." });
  assert.equal(names(tlom).includes("remote_tlom_query_data"), true);
  assert.equal(names(tlom).includes("remote_weather_forecast"), false);

  const weather = selectRequestCapabilities({ tools, text: "What is tomorrow's weather forecast?" });
  assert.equal(names(weather).includes("remote_weather_forecast"), true);
  assert.equal(names(weather).includes("remote_tlom_query_data"), false);
});

test("an active integration scope remains additive for an ordinary project-task request", () => {
  const selection = selectRequestCapabilities({
    tools,
    text: "There are a bunch of Door Install or Repair tasks on the doors. Consolidate the identical ones.",
    recentConversation: [
      { role: "user", content: "Make the full remodel the active project." },
      { role: "assistant", content: "The full remodel is now active." },
    ],
    previousCapabilities: ["integration:tlom", "profile"],
  });

  assert.deepEqual(selection.capabilities, ["database", "integration:tlom", "profile", "todos"]);
  assert.equal(names(selection).includes("remote_tlom_query_data"), true);
  assert.equal(names(selection).includes("todo_list"), true);
  assert.ok(selection.reasons.includes("integration:tlom:active-scope"));
  assert.equal(selection.followsPriorTurn, false);
});

test("compiled requests expose an organized deferred catalog and one capability-request tool", async () => {
  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
  });
  const compiled = await compiler.compile({ tools, text: "Show my tasks." });

  assert.equal(names(compiled).includes("todo_list"), true);
  assert.equal(names(compiled).includes("request_capabilities"), true);
  assert.ok(compiled.deferredCapabilities.includes("integration:tlom"));
  assert.match(compiled.instructions, /# Additional available capabilities/);
  assert.match(compiled.instructions, /integration:tlom/);
  const requestTool = compiled.tools.find(({ name }) => name === "request_capabilities");
  assert.deepEqual(
    requestTool.inputSchema.properties.capabilities.items.enum,
    compiled.deferredCapabilities,
  );

  const greeting = await compiler.compile({ tools, text: "Hello!" });
  assert.equal(names(greeting).includes("request_capabilities"), false);
  assert.deepEqual(greeting.deferredCapabilities, []);
});

test("the compiler loads instructions only for selected callable capabilities", async () => {
  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
  });
  const compiled = await compiler.compile({ tools, text: "Search my inbox for the receipt email." });
  assert.match(compiled.instructions, /## email/);
  assert.match(compiled.instructions, /## profile/);
  assert.doesNotMatch(compiled.instructions, /## calendar/);
  assert.doesNotMatch(compiled.instructions, /todo_group_list/);
});

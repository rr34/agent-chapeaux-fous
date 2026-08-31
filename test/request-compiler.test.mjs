import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  capabilityForTool,
  requestCapabilityCatalog,
  RequestCompiler,
  selectRequestCapabilities,
} from "../src/request-compiler.mjs";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { registerContactTools } from "../src/tools/contact-tools.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
import { registerJmapEmailTools } from "../src/tools/jmap-email-tools.mjs";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { registerLogTools } from "../src/tools/log-tools.mjs";
import { registerInteractionGuideTools } from "../src/tools/interaction-guide-tools.mjs";
import { registerProfileFactTools } from "../src/tools/profile-fact-tools.mjs";
import { registerSearchTools } from "../src/tools/search-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { registerWebPageTools } from "../src/tools/web-page-tools.mjs";
import { loadHatCatalog } from "../src/hat-catalog.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hatCatalog = await loadHatCatalog(path.join(repositoryRoot, "config", "hats.json"));

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
  tool("interaction_guide_get"),
  tool("profile_fact_list"),
  tool("profile_fact_set"),
  tool("database_read"),
  tool("database_write"),
  tool("history_range"),
  tool("email_search"),
  tool("email_send"),
  tool("web_page_read"),
  tool("global_search"),
  tool("remote_tlom_query_data", "mcp:tlom"),
  tool("remote_weather_forecast", "mcp:weather"),
];

function names(selection) {
  return selection.tools.map(({ name }) => name);
}

test("known tool families have stable hard-coded capability ownership", () => {
  assert.equal(capabilityForTool(tool("calendar_event_list")), "calendar");
  assert.equal(capabilityForTool(tool("contact_merge")), "contacts");
  assert.equal(capabilityForTool(tool("todo_add")), "todos");
  assert.equal(capabilityForTool(tool("tracker_update")), "logs");
  assert.equal(capabilityForTool(tool("log_update")), "logs");
  assert.equal(capabilityForTool(tool("interaction_guide_update")), "interaction-guides");
  assert.equal(capabilityForTool(tool("database_read")), "database");
  assert.equal(capabilityForTool(tool("database_write")), "database-write");
  assert.equal(capabilityForTool(tool("email_send")), "email");
  assert.equal(capabilityForTool(tool("remote_tlom_query_data", "mcp:tlom")), "integration:tlom");
  assert.equal(capabilityForTool(tool("video_script_create")), "video");
  assert.equal(capabilityForTool(tool("video_production_create")), "video");
  assert.equal(capabilityForTool(tool("video_content_add")), "video");
  assert.equal(capabilityForTool(tool("global_search")), "search");
  assert.equal(capabilityForTool(tool("file_read")), "files");
});

test("a referenced generated video can select the focused content-sequence operation", () => {
  const selection = selectRequestCapabilities({
    tools: [...tools, tool("video_content_add")],
    text: [
      "In reference to:",
      "Generated video ‘A useful generated video’: video_script_id 42, output_file_id 77.",
      "Add this video to my content sequence.",
    ].join("\n"),
  });
  assert.equal(selection.capabilities.includes("video"), true);
  assert.equal(names(selection).includes("video_content_add"), true);
  assert.equal(selection.fallbackAll, false);
});

test("the orienter receives one organized catalog of every connected capability family", () => {
  const catalog = requestCapabilityCatalog([...tools, tool("brand_new_local_operation")]);
  assert.equal(catalog.some(({ capability }) => capability === "orchestration"), false);
  assert.equal(catalog.some(({ capability }) => capability === "unclassified"), true);
  assert.equal(catalog.some(({ capability }) => capability === "integration:tlom"), true);
  assert.deepEqual(
    catalog.find(({ capability }) => capability === "email").representativeTools,
    ["email_search", "email_send"],
  );
  assert.deepEqual(
    catalog.find(({ capability }) => capability === "email").tools.map(({ name }) => name),
    ["email_search", "email_send"],
  );
  assert.equal(
    catalog.find(({ capability }) => capability === "email").tools[0].inputSchema,
    undefined,
  );
});

test("a TurnBrief tool override starts narrow and advertises exact in-capability expansion", async () => {
  const compiler = new RequestCompiler();
  const accountingTools = [
    tool("remote_accounting_preview_delete_transactions", "mcp:accounting"),
    tool("remote_accounting_get_transaction_delete_plan", "mcp:accounting"),
    tool("remote_accounting_commit_delete_transactions", "mcp:accounting"),
  ];
  const compiled = await compiler.compile({
    tools: accountingTools,
    text: "Delete the reviewed transactions.",
    recentConversation: [],
    previousCapabilities: [],
    capabilityOverride: ["integration:accounting"],
    toolOverride: ["remote_accounting_preview_delete_transactions"],
    allowCapabilityExpansion: false,
    allowToolExpansion: true,
  });

  assert.deepEqual(names(compiled), [
    "remote_accounting_preview_delete_transactions",
    "request_tools",
  ]);
  assert.deepEqual(
    compiled.deferredTools.map(({ name }) => name),
    [
      "remote_accounting_get_transaction_delete_plan",
      "remote_accounting_commit_delete_transactions",
    ],
  );
  assert.deepEqual(
    compiled.tools.find(({ name }) => name === "request_tools")
      .inputSchema.properties.tools.items.enum,
    [
      "remote_accounting_commit_delete_transactions",
      "remote_accounting_get_transaction_delete_plan",
    ],
  );
  assert.match(compiled.instructions, /exact schemas were intentionally deferred/);
});

test("durable file retrieval remains callable on a terse later request", async () => {
  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
  });
  const compiled = await compiler.compile({
    tools: [
      tool("profile_fact_list"), tool("profile_fact_set"), tool("database_read"),
      tool("file_get"), tool("file_read"), tool("file_search"), tool("file_update"),
    ],
    text: "Use file 200 and continue.",
    recentConversation: [], previousCapabilities: [],
  });
  assert.deepEqual(names(compiled), [
    "profile_fact_list", "profile_fact_set", "database_read",
    "file_get", "file_read", "file_search", "file_update",
  ]);
  assert.match(compiled.instructions, /stable numeric file ID/);
  assert.match(compiled.instructions, /call `file_get`\s+or `file_read` with 200/);
});

test("an explicit interaction-video request selects the script creator", () => {
  const selection = selectRequestCapabilities({
    tools: [...tools, tool("video_script_create")],
    text: "Create a portable video script from these interactions.",
  });
  assert.equal(names(selection).includes("video_script_create"), true);
  assert.equal(selection.capabilities.includes("video"), true);
  assert.equal(selection.fallbackAll, false);
});

test("an explicit one-button production request selects the combined production tool", () => {
  const selection = selectRequestCapabilities({
    tools: [...tools, tool("video_script_create"), tool("video_production_create")],
    text: "Create the script and produce its video from these interactions.",
  });
  assert.equal(names(selection).includes("video_production_create"), true);
  assert.equal(selection.capabilities.includes("video"), true);
});

test("an application capability override ignores unrelated prior-conversation routing", async () => {
  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
  });
  const compiled = await compiler.compile({
    tools: [...tools, tool("video_script_create")],
    text: "Create the AI-video script from these selected interactions.",
    recentConversation: [{ role: "user", content: "Add this to my calendar." }],
    previousCapabilities: ["calendar", "profile"],
    capabilityOverride: ["video"],
  });
  assert.deepEqual(names(compiled), ["video_script_create"]);
  assert.deepEqual(compiled.capabilities, ["video"]);
  assert.deepEqual(compiled.reasons, ["video:application-override"]);
  assert.match(compiled.instructions, /## video/);
  assert.doesNotMatch(compiled.instructions, /## calendar/);
});

test("a structured capability override keeps unselected families available only through expansion", async () => {
  const compiler = new RequestCompiler();
  const compiled = await compiler.compile({
    tools: [tool("todo_add"), tool("file_read"), tool("remote_tlom_query_data", "mcp:tlom")],
    text: "Clock out.",
    recentConversation: [],
    previousCapabilities: [],
    capabilityOverride: ["integration:tlom"],
    allowCapabilityExpansion: true,
  });

  assert.deepEqual(names(compiled), ["remote_tlom_query_data", "request_capabilities"]);
  assert.deepEqual(compiled.capabilities, ["integration:tlom"]);
  assert.deepEqual(compiled.deferredCapabilities, ["files", "todos"]);
  assert.deepEqual(
    compiled.tools.find(({ name }) => name === "request_capabilities")
      .inputSchema.properties.capabilities.items.enum,
    ["files", "todos"],
  );
});

test("every currently registered local tool belongs to an explicit capability", () => {
  const registry = new ToolRegistry();
  registerWebPageTools(registry, {});
  registerCalendarTools(registry, {}, {}, {}, null);
  registerContactTools(registry, {}, {}, {}, null);
  registerTodoTools(registry, {}, {}, null);
  registerLogTools(registry, {}, {}, null);
  registerInteractionGuideTools(registry, {}, null);
  registerProfileFactTools(registry, {}, null);
  registerDatabaseTools(registry, {}, {}, null);
  registerFileTools(registry, {
    ledger: {}, searchCoordinator: {}, mediaRoot: "/tmp", maximumTextBytes: 1,
  });
  registerJmapEmailTools(registry, { health() { return { ready: true }; } });
  registerSearchTools(registry, {
    listProviders() { return [{ id: "history" }]; },
    search() { return {}; },
  });
  assert.deepEqual(
    registry.toolDefinitions().filter((definition) => capabilityForTool(definition) === "unclassified"),
    [],
  );
});

test("a broad cross-domain discovery request selects global search", () => {
  const selection = selectRequestCapabilities({
    tools,
    text: "Find everything across all my data related to Alice.",
  });
  assert.equal(selection.capabilities.includes("search"), true);
  assert.equal(names(selection).includes("global_search"), true);
  assert.equal(selection.fallbackAll, false);
});

test("starting a linked guide selects guide and to-do capabilities", async () => {
  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
  });
  const compiled = await compiler.compile({
    tools,
    text: 'Start interaction guide 7 ("Morning Check-in") associated with to-do 418.',
  });
  assert.equal(compiled.capabilities.includes("interaction-guides"), true);
  assert.equal(compiled.capabilities.includes("todos"), true);
  assert.equal(names(compiled).includes("interaction_guide_get"), true);
  assert.match(compiled.instructions, /## interaction-guides/);
  assert.match(compiled.instructions, /take one starting snapshot/);
  assert.match(compiled.instructions, /one\s+complete opening checklist/);
  assert.doesNotMatch(compiled.instructions, /defaulting to\s+three/);
  assert.match(compiled.instructions, /completed_on_date/);

  const scheduled = await compiler.compile({
    tools,
    text: "Schedule my Morning Check-in interaction guide every weekday at 8.",
  });
  assert.equal(scheduled.capabilities.includes("interaction-guides"), true);
  assert.equal(scheduled.capabilities.includes("todos"), true);
  assert.ok(scheduled.reasons.includes("todos:interaction-guide-schedule"));
});

test("user-facing briefing language selects the internal interaction-guide capability", () => {
  const selection = selectRequestCapabilities({
    tools,
    text: 'Start my "Morning Check-in" briefing.',
  });
  assert.equal(selection.capabilities.includes("interaction-guides"), true);
  assert.equal(names(selection).includes("interaction_guide_get"), true);
});

test("a terse answer to a guide question retains the guided interaction capabilities", () => {
  const extendedTools = [...tools, tool("todo_interaction_guide_set")];
  const selection = selectRequestCapabilities({
    tools: extendedTools,
    text: "7 hours",
    recentConversation: [
      { role: "user", content: 'Start the "Morning Check-in" interaction guide.' },
      { role: "assistant", content: "How long did you sleep?" },
    ],
    previousCapabilities: ["database", "interaction-guides", "profile", "todos"],
  });
  assert.equal(selection.followsPriorTurn, true);
  assert.deepEqual(selection.capabilities, ["database", "interaction-guides", "profile", "todos"]);
  assert.ok(selection.reasons.includes("interaction-guides:question-answer-continuation"));
});

test("guided to-do reviews compile stable handles and forward-only progress rules", async () => {
  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
  });
  const compiled = await compiler.compile({
    tools,
    text: 'Start the "Evening Briefing" interaction guide and review my to-dos.',
  });

  assert.match(compiled.instructions, /#<personal_task_id>/);
  assert.match(compiled.instructions, /forward-only checklist/);
  assert.match(compiled.instructions, /Never ask\s+again about an addressed record/);
  assert.match(compiled.instructions, /moving it outside the original date does not make it/);
  assert.match(compiled.instructions, /every item in one complete opening response/);
  assert.match(compiled.instructions, /code-generated checklist/);
  assert.match(compiled.instructions, /do not ask the\s+next unaddressed record/);
});

test("one natural answer to an all-tracker guide checklist retains log tools", () => {
  const selection = selectRequestCapabilities({
    tools,
    text: "Weight is 185 pounds, left-arm pain is 3 out of 10, and I slept 7 hours.",
    recentConversation: [
      { role: "user", content: 'Start the "Evening Briefing" interaction guide.' },
      {
        role: "assistant",
        content: "For weight, left-arm pain, and sleep: what should I record for each tonight?",
      },
    ],
    previousCapabilities: ["database", "interaction-guides", "logs", "profile", "todos"],
  });
  assert.equal(selection.followsPriorTurn, true);
  assert.equal(selection.capabilities.includes("logs"), true);
  assert.equal(names(selection).includes("log_add"), true);
  assert.ok(selection.reasons.includes("interaction-guides:question-answer-continuation"));
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

test("routine and habit requests select the dedicated reusable-routine tool", () => {
  const registry = new ToolRegistry();
  registerTodoTools(registry, {}, {}, null);
  for (const text of ["Add a Friday planning routine.", "Create a weekly exercise habit."]) {
    const selection = selectRequestCapabilities({ tools: registry.toolDefinitions(), text });
    assert.equal(selection.capabilities.includes("todos"), true, text);
    assert.equal(names(selection).includes("routine_add"), true, text);
    assert.equal(selection.fallbackAll, false, text);
  }
  const routineCatalog = requestCapabilityCatalog(registry.toolDefinitions())
    .find(({ capability }) => capability === "todos")
    .tools.find(({ name }) => name === "routine_add");
  assert.match(routineCatalog.summary, /Unlike todo_add/);
  assert.match(routineCatalog.summary, /Actions: CREATE\. Effects: MUTATING\.$/);
  assert.equal(routineCatalog.summary.length <= 400, true);
});

test("a request to correct records in the logs selects the personal-log capability directly", () => {
  const registry = new ToolRegistry();
  registerLogTools(registry, {}, {}, null);
  const selection = selectRequestCapabilities({
    tools: registry.toolDefinitions(),
    text: "Some records in the logs have no unit; update those so they all say out of 10.",
  });
  assert.equal(selection.capabilities.includes("logs"), true);
  assert.equal(names(selection).includes("log_list"), true);
  assert.equal(names(selection).includes("log_update"), true);
  assert.equal(selection.fallbackAll, false);
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

test("explicit hats add their tool families without labeling ordinary tool selection as inferred hats", async () => {
  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
    hatCatalog,
  });
  const compiled = await compiler.compile({
    tools,
    text: "Chapeaux Fous, as my contacts, find Tim and then send him an email.",
  });

  assert.deepEqual(compiled.explicitHats.map(({ id }) => id), ["contacts"]);
  assert.equal(compiled.capabilities.includes("contacts"), true);
  assert.equal(compiled.capabilities.includes("email"), true);
  assert.equal(names(compiled).includes("contact_search"), true);
  assert.equal(names(compiled).includes("email_send"), true);
  assert.match(compiled.instructions, /Only the hats listed below were explicitly invoked/);
  assert.doesNotMatch(compiled.instructions, /inferred hat/iu);
});

test("multiple explicit hats remain ordered and receive exact schemas in the first compilation", async () => {
  const compiler = new RequestCompiler({
    instructionRoot: path.join(repositoryRoot, "config", "instructions"),
    hatCatalog,
  });
  const compiled = await compiler.compile({
    tools,
    text: "As my contacts, find Tim, then as my email, send him the inspection notice.",
  });

  assert.deepEqual(compiled.explicitHats.map(({ id }) => id), ["contacts", "email"]);
  assert.equal(names(compiled).includes("contact_search"), true);
  assert.equal(names(compiled).includes("email_send"), true);
  assert.ok(compiled.reasons.includes("contacts:explicit-hat:contacts"));
  assert.ok(compiled.reasons.includes("email:explicit-hat:email"));
  assert.ok(compiled.instructions.indexOf("1. contacts") < compiled.instructions.indexOf("2. email"));
});

test("property-manager and weatherman hats map to their connected integration capabilities", async () => {
  const compiler = new RequestCompiler({ hatCatalog });
  const propertyManager = await compiler.compile({ tools, text: "As my property manager, add a roof inspection task." });
  const weather = await compiler.compile({ tools, text: "As my weatherman, will it freeze tonight?" });

  assert.equal(names(propertyManager).includes("remote_tlom_query_data"), true);
  assert.deepEqual(propertyManager.explicitHats.map(({ id }) => id), ["property-manager"]);
  assert.equal(names(weather).includes("remote_weather_forecast"), true);
  assert.deepEqual(weather.explicitHats.map(({ id }) => id), ["weatherman"]);
});

test("ordinary requests select tools without creating hats", async () => {
  const compiler = new RequestCompiler({ hatCatalog });
  const compiled = await compiler.compile({ tools, text: "Send Tim an email." });

  assert.deepEqual(compiled.explicitHats, []);
  assert.equal(compiled.capabilities.includes("email"), true);
  assert.doesNotMatch(compiled.instructions, /Hats explicitly spoken/);
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
  assert.equal(compiled.deferredCapabilities.includes("database-write"), false);
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

test("accepted capability overrides include declared dependent tools without late expansion", async () => {
  const compiler = new RequestCompiler();
  const compiled = await compiler.compile({
    tools: [
      {
        ...tool("email_send"),
        capabilityId: "email",
        capability: { dependentTools: ["contact_lookup_batch"] },
      },
      { ...tool("contact_lookup_batch"), capabilityId: "contacts" },
      { ...tool("database_write"), capabilityId: "database-write" },
    ],
    text: "Send the approved email.",
    capabilityOverride: ["email"],
    allowCapabilityExpansion: false,
  });

  assert.deepEqual(names(compiled), ["email_send", "contact_lookup_batch"]);
  assert.deepEqual(compiled.dependentTools, ["contact_lookup_batch"]);
  assert.deepEqual(compiled.deferredCapabilities, []);
  assert.equal(names(compiled).includes("request_capabilities"), false);
  assert.equal(names(compiled).includes("database_write"), false);
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

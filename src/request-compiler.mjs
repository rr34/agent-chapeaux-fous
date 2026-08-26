import fs from "node:fs/promises";
import path from "node:path";

const localCapabilityMatchers = [
  ["web", (tool) => tool.name === "web_page_read"],
  ["calendar", (tool) => tool.name.startsWith("calendar_")],
  ["contacts", (tool) => tool.name.startsWith("contact_")],
  ["todos", (tool) => tool.name.startsWith("todo_")],
  ["logs", (tool) => tool.name.startsWith("log_") || tool.name.startsWith("tracker_")],
  ["interaction-guides", (tool) => tool.name.startsWith("interaction_guide_")],
  ["profile", (tool) => tool.name.startsWith("profile_fact_")],
  ["files", (tool) => tool.name.startsWith("file_")],
  ["database-write", (tool) => tool.name === "database_write"],
  ["database", (tool) => [
    "database_schema", "database_read", "tool_receipt_list", "tool_receipt_read",
  ].includes(tool.name)],
  ["history", (tool) => tool.name.startsWith("history_")],
  ["email", (tool) => tool.name.startsWith("email_")],
  ["video", (tool) => tool.name.startsWith("video_")],
  ["search", (tool) => tool.name === "global_search"],
  ["orchestration", (tool) => tool.name === "request_capabilities"],
];

const instructionFiles = new Map([
  ["web", "web.md"],
  ["calendar", "calendar.md"],
  ["contacts", "contacts.md"],
  ["todos", "todos.md"],
  ["logs", "logs.md"],
  ["interaction-guides", "interaction-guides.md"],
  ["profile", "profile.md"],
  ["files", "files.md"],
  ["database", "database.md"],
  ["database-write", "database-write.md"],
  ["history", "history.md"],
  ["email", "email.md"],
  ["video", "video.md"],
  ["search", "search.md"],
]);

const capabilityPatterns = new Map([
  ["web", /https?:\/\/|\b(?:web ?page|website|url|link)\b/iu],
  ["calendar", /\b(?:calendar|schedule|agenda|appointment|meeting|event|birthday|invite)\b/iu],
  ["contacts", /\b(?:contacts?|address book|phone number|email address|vcard|vcf|dedupe|deduplicate|deduplication|duplicate people|contact tag)\b/iu],
  ["todos", /\b(?:to[ -]?do|todo|task|remind(?:er)?|chore|overdue)\b/iu],
  ["logs", /\b(?:personal logs?|log entr(?:y|ies)|(?:my|the) logs?|food log|tracker|track my|weight|weigh-in|mood|symptom|workout|exercise|slept|sleep|blood pressure|i ate|my meal)\b/iu],
  ["interaction-guides", /\b(?:interaction guides?|guided interactions?)\b|\b(?:start|use|update|change|edit|create|make|show|list|archive|schedule).{0,60}\bguide\b/iu],
  ["profile", /\b(?:remember that|remember my|keep on file|profile fact|forget (?:that|my)|my preference|i prefer|i am allergic|my address|my phone|my vehicle|my car|my time ?zone|my\b.{0,80}\b(?:is|are|changed))\b/iu],
  ["files", /\b(?:file\s*#?\s*\d+|file id|uploaded file|previous upload|past upload|attachment|document|csv|vcard|original filename)\b/iu],
  ["database", /\b(?:database|db|sqlite|schema|table|ledger|audit trail|tool receipts?|activity events?|stored row|content item|content group|video job|correspondence)\b/iu],
  ["database-write", /(?:\b(?:write|insert|update|delete|remove|import|save|create|change)\b.{0,60}\b(?:database|db|sqlite|table|rows?|content items?|content groups?|video jobs?)\b)|(?:\b(?:database|db|sqlite|table|rows?|content items?|content groups?|video jobs?)\b.{0,60}\b(?:write|insert|update|delete|remove|import|save|create|change)\b)/iu],
  ["history", /\b(?:what did we|what have we|talked about|discussed|previous conversation|prior conversation|conversation history|earlier today|last time|yesterday we|recent exchange)\b/iu],
  ["email", /\b(?:e-?mail|inbox|mailbox|sender|subject line|email thread|draft|compose|send (?:it|this|that|an?|the|a message)|message .{0,40}(?:to|on)|reply to|forward (?:it|this|that|the)|spam|trash folder|invite .{0,40}(?:to|for))\b/iu],
  ["video", /\b(?:make|create|render|generate|produce).{0,40}\bvideo\b|\bvideo.{0,40}(?:interaction|request|response|render)\b/iu],
  ["search", /\b(?:global|unified|cross[ -]?domain|everywhere)\s+search\b|\b(?:find|search|look for)\b.{0,80}\b(?:everything|anything|across (?:all|my)|everywhere|all (?:my|available) (?:data|records?|information))\b/iu],
]);

const followupPattern = /^(?:\s)*(?:yes|yeah|yep|okay|ok|sure|correct|right|sounds good|go ahead|do it|proceed|continue|make it so|that one|those|please do)(?:\b|[.!,:])/iu;
const leadingContinuationReferencePattern = /^\s*(?:(?:can|could|would|will)\s+you\s+|please\s+)?(?:that|this|it|those|them|the same|again|what happened|tell me more|why did|why was|why is|how about|what about)\b/iu;
const actionContinuationReferencePattern = /\b(?:do|use|send|email|reply to|forward|delete|remove|update|change|apply|open|read|show|list|find|move|archive|trash|restore)\s+(?:that|this|it|those|them)\b/iu;
const questionContinuationReferencePattern = /\b(?:what|why|how)\b.{0,40}\b(?:that|this|it|those|them)\b/iu;
const compactFollowupPattern = /^\s*(?:why|how so|and then|anything else|more)\s*[?.!]*\s*$/iu;
const toolFreePattern = /\b(?:explain|define|brainstorm|rewrite|proofread|translate|tell me a joke|write a story|what do you think|help me think|your opinion|how does .+ work|compare the ideas)\b/iu;
const greetingPattern = /^\s*(?:hello|hi|hey|good (?:morning|afternoon|evening)|thanks|thank you)[.!\s]*$/iu;
const personalActionPattern = /\b(?:my|mine|current|latest|today|now|look up|find|show|list|add|create|update|change|delete|remove|send|save|record|import|apply|go ahead|do it|proceed)\b/iu;

const capabilitySummaries = new Map([
  ["web", "Read specific web pages supplied by URL."],
  ["calendar", "Read and manage calendar events and schedules."],
  ["contacts", "Search, import, tag, and merge contacts."],
  ["todos", "Read and manage native personal to-do items and groups."],
  ["logs", "Read, record, and correct personal logs and trackers."],
  ["interaction-guides", "Create, inspect, update, and follow user-owned guides for structured interactions."],
  ["profile", "Read and maintain durable profile facts."],
  ["files", "Find and retrieve durable uploads by stable file ID, and maintain their title and description."],
  ["database", "Inspect schema and read supported native SQLite-backed application data, including the durable activity ledger."],
  ["database-write", "Write supported native SQLite-backed application data; read-only database access is already callable."],
  ["history", "Search prior Agent Slayer conversations."],
  ["email", "Read, draft, send, organize, and clean up email."],
  ["video", "Render an interaction video from the current request trace."],
  ["search", "Search across calendar, contacts, durable uploads, and conversation history with compact normalized results."],
]);

export function capabilityForTool(tool) {
  if (typeof tool.capabilityId === "string" && tool.capabilityId) return tool.capabilityId;
  if (typeof tool.source === "string" && tool.source.startsWith("mcp:")) {
    return `integration:${tool.source.slice(4)}`;
  }
  return localCapabilityMatchers.find(([, matches]) => matches(tool))?.[0] ?? "unclassified";
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC");
}

function singularRoutingWord(word) {
  if (word.length < 4 || /(?:ss|us|is)$/iu.test(word)) return word;
  if (/ies$/iu.test(word)) return `${word.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|sses)$/iu.test(word)) return word.slice(0, -2);
  if (/s$/iu.test(word)) return word.slice(0, -1);
  return word;
}

function enrichedRoutingText(value) {
  const text = normalizedText(value);
  const singularized = text.replace(/[\p{L}\p{N}]+/gu, singularRoutingWord);
  return singularized === text ? text : `${text}\n${singularized}`;
}

function referencesPriorTurn(text) {
  return leadingContinuationReferencePattern.test(text)
    || actionContinuationReferencePattern.test(text)
    || questionContinuationReferencePattern.test(text);
}

function recentRoutingText(entries) {
  return entries.slice(-12).map(({ role, content }) => `${role}: ${content}`).join("\n");
}

function attachmentHintMatches(hint, { filename, mimeType, preview }) {
  const extensionMatches = (hint.extensions ?? []).some((extension) => filename.endsWith(extension));
  const mimeMatches = (hint.mimeIncludes ?? []).some((part) => mimeType.includes(part));
  if ((hint.extensions?.length || hint.mimeIncludes?.length) && !extensionMatches && !mimeMatches) return false;
  if (hint.headerTerms?.length && !hint.headerTerms.some((term) => preview.includes(String(term).toLowerCase()))) return false;
  return true;
}

function attachmentCapabilities(attachment, grouped = new Map()) {
  if (!attachment) return { capabilities: [], uncertain: false };
  const filename = normalizedText(attachment.filename).toLowerCase();
  const mimeType = normalizedText(attachment.mimeType).toLowerCase();
  const preview = normalizedText(attachment.text).slice(0, 8000).toLowerCase();
  const declared = [...grouped.entries()].flatMap(([capability, tools]) => {
    const hints = tools.find(({ capability: manifest }) => manifest)?.capability?.attachmentHints ?? [];
    return hints.some((hint) => attachmentHintMatches(hint, { filename, mimeType, preview }))
      ? [capability]
      : [];
  });
  if (declared.length) return { capabilities: ["files", ...new Set(declared)], uncertain: false };
  if (filename.endsWith(".vcf") || filename.endsWith(".vcard") || mimeType.includes("vcard")) {
    return { capabilities: ["files", "contacts"], uncertain: false };
  }
  if (filename.endsWith(".csv") || mimeType.includes("csv")) {
    if (/\b(?:email|phone|given_name|family_name|display_name|categories)\b/u.test(preview)) {
      return { capabilities: ["files", "contacts"], uncertain: false };
    }
    if (/\b(?:tracker|occurred_at|number_value|content_text|unit)\b/u.test(preview)) {
      return { capabilities: ["files", "logs"], uncertain: false };
    }
    if (/\b(?:content_type|content_status|content_url|published_at|relationship_to_user)\b/u.test(preview)) {
      return { capabilities: ["files", "database", "database-write"], uncertain: false };
    }
    return { capabilities: ["files"], uncertain: true };
  }
  return { capabilities: ["files"], uncertain: true };
}

function integrationAliases(provider) {
  const normalized = provider.replaceAll(/[_-]+/g, " ");
  return new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu");
}

function capabilityAliasMatches(tools, routingText) {
  const aliases = tools.find(({ capability }) => capability)?.capability?.aliases ?? [];
  return aliases.some((alias) => integrationAliases(String(alias)).test(routingText));
}

export function selectRequestCapabilities({
  tools, text, attachment = null, recentConversation = [], previousCapabilities = [], explicitHats = [],
}) {
  const grouped = new Map();
  for (const tool of tools) {
    const capability = capabilityForTool(tool);
    const list = grouped.get(capability) ?? [];
    list.push(tool);
    grouped.set(capability, list);
  }

  const currentText = normalizedText(text);
  const previousAssistantText = [...recentConversation].reverse()
    .find(({ role }) => role === "assistant")?.content ?? "";
  const guidedContinuation = previousCapabilities.includes("interaction-guides")
    && currentText.trim().length > 0
    && currentText.length <= 2000
    && /\?\s*$/u.test(previousAssistantText);
  const followsPriorTurn = recentConversation.length > 0 && (
    followupPattern.test(currentText)
    || compactFollowupPattern.test(currentText)
    || guidedContinuation
    || (
      !attachment
      && !/https?:\/\//iu.test(currentText)
      && referencesPriorTurn(currentText)
    )
  );
  const routingText = guidedContinuation
    ? enrichedRoutingText(currentText)
    : followsPriorTurn
    ? enrichedRoutingText(`${recentRoutingText(recentConversation)}\nuser: ${currentText}`)
    : enrichedRoutingText(currentText);
  const selected = new Set([
    ...(grouped.has("profile") ? ["profile"] : []),
    ...(grouped.has("files") ? ["files"] : []),
    ...(grouped.has("database") ? ["database"] : []),
  ]);
  const reasons = [];

  for (const hat of explicitHats) {
    if (grouped.has(hat.capability)) {
      selected.add(hat.capability);
      reasons.push(`${hat.capability}:explicit-hat:${hat.id}`);
    } else {
      reasons.push(`${hat.capability}:explicit-hat-unavailable:${hat.id}`);
    }
  }

  for (const [capability, pattern] of capabilityPatterns) {
    if (grouped.has(capability) && pattern.test(routingText)) {
      selected.add(capability);
      reasons.push(`${capability}:request`);
    }
  }

  for (const [capability, entries] of grouped) {
    if (selected.has(capability) || !capabilityAliasMatches(entries, routingText)) continue;
    selected.add(capability);
    reasons.push(`${capability}:declared-alias`);
  }

  if (
    selected.has("interaction-guides")
    && grouped.has("todos")
    && /(?:\b(?:schedule|repeat|repeating|recurring|every)\b.{0,80}\bguide\b)|(?:\bguide\b.{0,80}\b(?:daily|weekly|monthly|yearly|weekday|weekend|every)\b)/iu.test(routingText)
  ) {
    selected.add("todos");
    reasons.push("todos:interaction-guide-schedule");
  }

  for (const capability of grouped.keys()) {
    if (!capability.startsWith("integration:")) continue;
    const provider = capability.slice("integration:".length);
    if (integrationAliases(provider).test(routingText) || capabilityAliasMatches(grouped.get(capability) ?? [], routingText)) {
      selected.add(capability);
      reasons.push(`${capability}:request`);
    }
  }

  const explicitlySelectedIntegration = [...selected].some((capability) => capability.startsWith("integration:"));
  const clearlyToolFreeCurrentRequest = greetingPattern.test(currentText)
    || (toolFreePattern.test(currentText) && !personalActionPattern.test(currentText));
  if (recentConversation.length > 0 && !explicitlySelectedIntegration && !clearlyToolFreeCurrentRequest) {
    for (const capability of previousCapabilities) {
      if (!capability.startsWith("integration:") || !grouped.has(capability)) continue;
      selected.add(capability);
      reasons.push(`${capability}:active-scope`);
    }
  }

  const attachmentRoute = attachmentCapabilities(attachment, grouped);
  for (const capability of attachmentRoute.capabilities) {
    if (grouped.has(capability)) selected.add(capability);
    reasons.push(`${capability}:attachment`);
  }

  if (followsPriorTurn) {
    for (const capability of previousCapabilities) {
      if (grouped.has(capability)) selected.add(capability);
    }
    if (previousCapabilities.length) reasons.push("prior-capabilities:continuation");
    if (guidedContinuation) reasons.push("interaction-guides:question-answer-continuation");
  }

  const meaningfulSelections = [...selected]
    .filter((capability) => !["profile", "files", "database"].includes(capability));
  const clearlyToolFree = clearlyToolFreeCurrentRequest;
  const fallbackAll = grouped.has("unclassified");

  if (fallbackAll) {
    for (const capability of grouped.keys()) selected.add(capability);
    reasons.push("fallback:unclassified-tools");
  } else if (attachmentRoute.uncertain) {
    reasons.push("catalog:uncertain-attachment");
  } else if (meaningfulSelections.length === 0 && explicitHats.length > 0) {
    reasons.push("catalog:explicit-hat-unavailable");
  } else if (meaningfulSelections.length === 0 && !clearlyToolFree) {
    reasons.push("catalog:ambiguous-request");
  } else if (meaningfulSelections.length === 0) {
    reasons.push("core:tool-free-request");
  }

  const dependentToolNames = new Set();
  for (const capability of selected) {
    const manifest = grouped.get(capability)?.find(({ capability: item }) => item)?.capability;
    for (const toolName of manifest?.dependentTools ?? []) dependentToolNames.add(toolName);
  }
  if (selected.has("email") && !grouped.get("email")?.some(({ capability }) => capability)) {
    dependentToolNames.add("contact_lookup_batch");
  }
  const selectedTools = tools.filter((tool) => (
    selected.has(capabilityForTool(tool)) || dependentToolNames.has(tool.name)
  ));
  return {
    tools: selectedTools,
    capabilities: [...selected].sort(),
    reasons,
    dependentTools: [...dependentToolNames].filter((name) => selectedTools.some((tool) => tool.name === name)),
    fallbackAll,
    followsPriorTurn,
    availableToolCount: tools.length,
  };
}

function capabilitySummary(capability, tools) {
  const declared = tools.find(({ capability: manifest }) => manifest)?.capability?.summary;
  if (declared) return declared;
  if (capability.startsWith("integration:")) {
    const provider = capability.slice("integration:".length);
    const examples = tools.slice(0, 3).map(({ name }) => name).join(", ");
    return `${provider} connected integration${examples ? `; representative operations: ${examples}` : ""}.`;
  }
  return capabilitySummaries.get(capability) ?? `${capability} application capability.`;
}

export function requestCapabilityCatalog(tools) {
  const grouped = new Map();
  for (const tool of tools) {
    const capability = capabilityForTool(tool);
    if (capability === "orchestration") continue;
    const entries = grouped.get(capability) ?? [];
    entries.push(tool);
    grouped.set(capability, entries);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capability, entries]) => ({
      capability,
      summary: capabilitySummary(capability, entries),
      toolCount: entries.length,
      representativeTools: entries.slice(0, 5).map(({ name }) => name),
      contextViews: entries.find(({ capability: manifest }) => manifest)?.capability?.contextViews ?? [],
    }));
}

export function capabilityRequestDefinition(capabilities) {
  const allowed = [...new Set(capabilities)].sort();
  if (allowed.length === 0) return null;
  return {
    name: "request_capabilities",
    description: "Request exact schemas for one or more additional capability families when the current callable tools are insufficient. Prefer calling this before dependent actions, but it may be called after a read or other domain tool when that result reveals another capability is needed. After a successful request, Agent Slayer continues the same user request with those tools and prior same-request receipts loaded; do not ask the user to retry or treat this call itself as completing the task.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        capabilities: {
          type: "array",
          minItems: 1,
          maxItems: Math.min(8, allowed.length),
          uniqueItems: true,
          items: { type: "string", enum: allowed },
        },
      },
      required: ["capabilities"],
    },
    strict: true,
    source: "local",
    upstreamName: null,
  };
}

function overrideSelection(tools, capabilities) {
  const selected = [...new Set(capabilities)].filter((capability) => typeof capability === "string" && capability);
  const selectedSet = new Set(selected);
  const dependentToolNames = new Set();
  for (const capability of selectedSet) {
    const manifest = tools.find((tool) => capabilityForTool(tool) === capability && tool.capability)?.capability;
    for (const toolName of manifest?.dependentTools ?? []) dependentToolNames.add(toolName);
  }
  if (selectedSet.has("email") && !tools.some((tool) => capabilityForTool(tool) === "email" && tool.capability)) {
    dependentToolNames.add("contact_lookup_batch");
  }
  const selectedTools = tools.filter((tool) => (
    selectedSet.has(capabilityForTool(tool)) || dependentToolNames.has(tool.name)
  ));
  if (selectedTools.length === 0) {
    throw new Error(`Capability override has no callable tools: ${selected.join(", ")}`);
  }
  return {
    tools: selectedTools,
    capabilities: selected.sort(),
    reasons: selected.map((capability) => `${capability}:application-override`),
    dependentTools: [...dependentToolNames].filter((name) => selectedTools.some((tool) => tool.name === name)),
    fallbackAll: false,
    followsPriorTurn: false,
    availableToolCount: tools.length,
  };
}

function explicitHatInstructions(explicitHats, groupedTools) {
  if (explicitHats.length === 0) return "";
  const lines = [
    "# Hats explicitly spoken by the user",
    "Only the hats listed below were explicitly invoked. Do not infer, invent, or label any other active hat. Ordinary capability selection still applies to the rest of the exact user request.",
    "A spoken hat identifies the role or destination for the relevant part of the request; it does not restrict use of supporting tools. When several hats were spoken, honor them in the order shown and complete the corresponding work in that order when dependencies require it.",
  ];
  for (const [index, hat] of explicitHats.entries()) {
    const available = (groupedTools.get(hat.capability) ?? []).length > 0;
    lines.push(`${index + 1}. ${hat.label} (${hat.capability}) — ${available ? "callable" : "not currently backed by a callable tool family"}. ${hat.description}`);
  }
  if (explicitHats.some((hat) => (groupedTools.get(hat.capability) ?? []).length === 0)) {
    lines.push("Do not silently substitute a different destination for an explicitly spoken hat whose tool family is unavailable.");
  }
  return lines.join("\n");
}

function ambiguousHatInstructions(selection, hatCatalog) {
  if (!hatCatalog || !selection.reasons.includes("catalog:ambiguous-request")) return "";
  return [
    "# Ambiguous destination",
    "If the available request and context do not resolve the intended destination, ask with this consistent teaching pattern:",
    "I wasn't sure which one you meant—say ‘as my [hat]’ to point me at it. For example: ‘Chapeaux Fous, as my email, send John the invoice.’",
  ].join("\n");
}

export class RequestCompiler {
  constructor({
    instructionRoot, hatCatalog = null, readFile = fs.readFile, capabilityManifest = null,
  } = {}) {
    this.instructionRoot = instructionRoot;
    this.hatCatalog = hatCatalog;
    this.readFile = readFile;
    this.capabilityManifest = capabilityManifest;
    this.instructions = new Map();
  }

  async #instruction(capability, tools = []) {
    const declaredGuidance = this.capabilityManifest?.(capability)?.guidance;
    if (declaredGuidance) return declaredGuidance;
    const filename = tools.find(({ capability: manifest }) => manifest)?.capability?.instructionFile
      ?? instructionFiles.get(capability);
    if (!filename || !this.instructionRoot) return null;
    if (!this.instructions.has(capability)) {
      const contents = await this.readFile(path.join(this.instructionRoot, filename), "utf8");
      this.instructions.set(capability, contents.trim());
    }
    return this.instructions.get(capability);
  }

  async compile(input) {
    const explicitHats = this.hatCatalog?.explicitHats(input.text) ?? [];
    const expanding = Array.isArray(input.capabilityOverride);
    const selection = expanding
      ? overrideSelection(input.tools, input.capabilityOverride)
      : selectRequestCapabilities({ ...input, explicitHats });
    const grouped = new Map();
    for (const tool of input.tools) {
      const capability = capabilityForTool(tool);
      const entries = grouped.get(capability) ?? [];
      entries.push(tool);
      grouped.set(capability, entries);
    }
    const deferredCapabilities = expanding
      || selection.fallbackAll
      || selection.reasons.includes("core:tool-free-request")
      ? []
      : [...grouped.keys()]
        .filter((capability) => capability !== "unclassified" && !selection.capabilities.includes(capability))
        .sort();
    const requestCapabilities = capabilityRequestDefinition(deferredCapabilities);
    const fragments = (await Promise.all(selection.capabilities.map(async (capability) => ({
      capability,
      text: await this.#instruction(capability, grouped.get(capability) ?? []),
    })))).filter(({ text }) => text);
    const guidance = fragments.length
      ? ["# Active capability guidance", ...fragments.map(({ capability, text }) => `\n## ${capability}\n${text}`)].join("\n")
      : "";
    const catalog = deferredCapabilities.length
      ? [
          "# Additional available capabilities",
          "These capability families are connected but their exact tool schemas are deferred. If one may be needed, call `request_capabilities` before claiming it is unavailable.",
          ...deferredCapabilities.map((capability) => `- ${capability}: ${capabilitySummary(capability, grouped.get(capability) ?? [])}`),
        ].join("\n")
      : "";
    return {
      ...selection,
      tools: requestCapabilities ? [...selection.tools, requestCapabilities] : selection.tools,
      instructions: [
        explicitHatInstructions(explicitHats, grouped),
        ambiguousHatInstructions(selection, this.hatCatalog),
        guidance,
        catalog,
      ].filter(Boolean).join("\n\n"),
      explicitHats: explicitHats.map(({ id, label, icon, capability, spokenAs, index }) => ({
        id, label, icon, capability, spokenAs, index,
        available: (grouped.get(capability) ?? []).length > 0,
      })),
      instructionCapabilities: fragments.map(({ capability }) => capability),
      deferredCapabilities,
      capabilityCatalog: deferredCapabilities.map((capability) => ({
        capability,
        toolCount: grouped.get(capability)?.length ?? 0,
        summary: capabilitySummary(capability, grouped.get(capability) ?? []),
      })),
    };
  }
}

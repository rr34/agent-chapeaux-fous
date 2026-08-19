import fs from "node:fs/promises";
import path from "node:path";

const localCapabilityMatchers = [
  ["web", (tool) => tool.name === "web_page_read"],
  ["calendar", (tool) => tool.name.startsWith("calendar_")],
  ["contacts", (tool) => tool.name.startsWith("contact_")],
  ["todos", (tool) => tool.name.startsWith("todo_")],
  ["logs", (tool) => tool.name.startsWith("log_") || tool.name.startsWith("tracker_")],
  ["profile", (tool) => tool.name.startsWith("profile_fact_")],
  ["database", (tool) => ["database_schema", "database_read", "database_write"].includes(tool.name)],
  ["history", (tool) => tool.name.startsWith("history_")],
  ["email", (tool) => tool.name.startsWith("email_")],
  ["video", (tool) => tool.name.startsWith("video_")],
];

const instructionFiles = new Map([
  ["web", "web.md"],
  ["calendar", "calendar.md"],
  ["contacts", "contacts.md"],
  ["todos", "todos.md"],
  ["logs", "logs.md"],
  ["profile", "profile.md"],
  ["database", "database.md"],
  ["history", "history.md"],
  ["email", "email.md"],
  ["video", "video.md"],
]);

const capabilityPatterns = new Map([
  ["web", /https?:\/\/|\b(?:web ?page|website|url|link)\b/iu],
  ["calendar", /\b(?:calendar|schedule|agenda|appointment|meeting|event|birthday|invite)\b/iu],
  ["contacts", /\b(?:contact|address book|phone number|email address|vcard|vcf|dedupe|deduplicate|deduplication|duplicate people|contact tag)\b/iu],
  ["todos", /\b(?:to[ -]?do|todo|task|remind(?:er)?|chore|overdue)\b/iu],
  ["logs", /\b(?:personal log|log entry|food log|tracker|track my|weight|weigh-in|mood|symptom|workout|exercise|slept|sleep|blood pressure|i ate|my meal)\b/iu],
  ["profile", /\b(?:remember that|remember my|keep on file|profile fact|forget (?:that|my)|my preference|i prefer|i am allergic|my address|my phone|my vehicle|my car|my time ?zone|my\b.{0,80}\b(?:is|are|changed))\b/iu],
  ["database", /\b(?:database|sqlite|schema|table|stored row|content item|content group|video job|correspondence)\b/iu],
  ["history", /\b(?:what did we|what have we|talked about|discussed|previous conversation|prior conversation|conversation history|earlier today|last time|yesterday we|recent exchange)\b/iu],
  ["email", /\b(?:e-?mail|inbox|mailbox|sender|subject line|email thread|draft|compose|send (?:it|this|that|an?|the|a message)|message .{0,40}(?:to|on)|reply to|forward (?:it|this|that|the)|spam|trash folder|invite .{0,40}(?:to|for))\b/iu],
  ["video", /\b(?:make|create|render|generate|produce).{0,40}\bvideo\b|\bvideo.{0,40}(?:interaction|request|response|render)\b/iu],
]);

const followupPattern = /^(?:\s)*(?:yes|yeah|yep|okay|ok|sure|correct|right|sounds good|go ahead|do it|proceed|continue|make it so|that one|those|please do)(?:\b|[.!,:])/iu;
const continuationReferencePattern = /\b(?:that|this|it|those|them|the same|again|what happened|tell me more|why did|why was|why is|how about|what about)\b/iu;
const compactFollowupPattern = /^\s*(?:why|how so|and then|anything else|more)\s*[?.!]*\s*$/iu;
const toolFreePattern = /\b(?:explain|define|brainstorm|rewrite|proofread|translate|tell me a joke|write a story|what do you think|help me think|your opinion|how does .+ work|compare the ideas)\b/iu;
const greetingPattern = /^\s*(?:hello|hi|hey|good (?:morning|afternoon|evening)|thanks|thank you)[.!\s]*$/iu;
const personalActionPattern = /\b(?:my|mine|current|latest|today|now|look up|find|show|list|add|create|update|change|delete|remove|send|save|record|import|apply|go ahead|do it|proceed)\b/iu;

export function capabilityForTool(tool) {
  if (typeof tool.source === "string" && tool.source.startsWith("mcp:")) {
    return `integration:${tool.source.slice(4)}`;
  }
  return localCapabilityMatchers.find(([, matches]) => matches(tool))?.[0] ?? "unclassified";
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC");
}

function recentRoutingText(entries) {
  return entries.slice(-4).map(({ role, content }) => `${role}: ${content}`).join("\n");
}

function attachmentCapabilities(attachment) {
  if (!attachment) return { capabilities: [], uncertain: false };
  const filename = normalizedText(attachment.filename).toLowerCase();
  const mimeType = normalizedText(attachment.mimeType).toLowerCase();
  const preview = normalizedText(attachment.text).slice(0, 8000).toLowerCase();
  if (filename.endsWith(".vcf") || filename.endsWith(".vcard") || mimeType.includes("vcard")) {
    return { capabilities: ["contacts"], uncertain: false };
  }
  if (filename.endsWith(".csv") || mimeType.includes("csv")) {
    if (/\b(?:email|phone|given_name|family_name|display_name|categories)\b/u.test(preview)) {
      return { capabilities: ["contacts"], uncertain: false };
    }
    if (/\b(?:tracker|occurred_at|number_value|content_text|unit)\b/u.test(preview)) {
      return { capabilities: ["logs"], uncertain: false };
    }
    if (/\b(?:content_type|content_status|content_url|published_at|relationship_to_user)\b/u.test(preview)) {
      return { capabilities: ["database"], uncertain: false };
    }
    return { capabilities: [], uncertain: true };
  }
  return { capabilities: [], uncertain: true };
}

function integrationAliases(provider) {
  const normalized = provider.replaceAll(/[_-]+/g, " ");
  if (provider === "weather") return /\b(?:weather|forecast|temperature|rain|snow|wind|(?:high|low).{0,20}(?:today|tomorrow)|(?:today|tomorrow).{0,20}(?:high|low))\b/iu;
  if (provider === "nutrition") return /\b(?:nutrition|calorie|macro|protein|carbs?|fat intake|food data)\b/iu;
  if (provider === "tlom") return /\b(?:tlom|landlord'?s operating manual|property|properties|building)\b/iu;
  return new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu");
}

export function selectRequestCapabilities({ tools, text, attachment = null, recentConversation = [], previousCapabilities = [] }) {
  const grouped = new Map();
  for (const tool of tools) {
    const capability = capabilityForTool(tool);
    const list = grouped.get(capability) ?? [];
    list.push(tool);
    grouped.set(capability, list);
  }

  const currentText = normalizedText(text);
  const followsPriorTurn = recentConversation.length > 0 && (
    followupPattern.test(currentText)
    || compactFollowupPattern.test(currentText)
    || (
      !attachment
      && !/https?:\/\//iu.test(currentText)
      && continuationReferencePattern.test(currentText)
    )
  );
  const routingText = followsPriorTurn
    ? `${recentRoutingText(recentConversation)}\nuser: ${currentText}`
    : currentText;
  const selected = new Set(grouped.has("profile") ? ["profile"] : []);
  const reasons = [];

  for (const [capability, pattern] of capabilityPatterns) {
    if (grouped.has(capability) && pattern.test(routingText)) {
      selected.add(capability);
      reasons.push(`${capability}:request`);
    }
  }

  for (const capability of grouped.keys()) {
    if (!capability.startsWith("integration:")) continue;
    const provider = capability.slice("integration:".length);
    if (integrationAliases(provider).test(routingText)) {
      selected.add(capability);
      reasons.push(`${capability}:request`);
    }
  }

  const attachmentRoute = attachmentCapabilities(attachment);
  for (const capability of attachmentRoute.capabilities) {
    if (grouped.has(capability)) selected.add(capability);
    reasons.push(`${capability}:attachment`);
  }

  if (followsPriorTurn) {
    for (const capability of previousCapabilities) {
      if (grouped.has(capability)) selected.add(capability);
    }
    if (previousCapabilities.length) reasons.push("prior-capabilities:continuation");
  }

  const meaningfulSelections = [...selected].filter((capability) => capability !== "profile");
  const clearlyToolFree = greetingPattern.test(currentText)
    || (toolFreePattern.test(currentText) && !personalActionPattern.test(currentText));
  const fallbackAll = grouped.has("unclassified")
    || attachmentRoute.uncertain
    || (meaningfulSelections.length === 0 && !clearlyToolFree);

  if (fallbackAll) {
    for (const capability of grouped.keys()) selected.add(capability);
    reasons.push(
      grouped.has("unclassified")
        ? "fallback:unclassified-tools"
        : attachmentRoute.uncertain
          ? "fallback:uncertain-attachment"
          : "fallback:ambiguous-request",
    );
  } else if (meaningfulSelections.length === 0) {
    reasons.push("core:tool-free-request");
  }

  const dependentToolNames = new Set();
  if (selected.has("email")) dependentToolNames.add("contact_lookup_batch");
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

function overrideSelection(tools, capabilities) {
  const selected = [...new Set(capabilities)].filter((capability) => typeof capability === "string" && capability);
  const selectedSet = new Set(selected);
  const selectedTools = tools.filter((tool) => selectedSet.has(capabilityForTool(tool)));
  if (selectedTools.length === 0) {
    throw new Error(`Capability override has no callable tools: ${selected.join(", ")}`);
  }
  return {
    tools: selectedTools,
    capabilities: selected.sort(),
    reasons: selected.map((capability) => `${capability}:application-override`),
    dependentTools: [],
    fallbackAll: false,
    followsPriorTurn: false,
    availableToolCount: tools.length,
  };
}

export class RequestCompiler {
  constructor({ instructionRoot, readFile = fs.readFile } = {}) {
    this.instructionRoot = instructionRoot;
    this.readFile = readFile;
    this.instructions = new Map();
  }

  async #instruction(capability) {
    const filename = instructionFiles.get(capability);
    if (!filename || !this.instructionRoot) return null;
    if (!this.instructions.has(capability)) {
      const contents = await this.readFile(path.join(this.instructionRoot, filename), "utf8");
      this.instructions.set(capability, contents.trim());
    }
    return this.instructions.get(capability);
  }

  async compile(input) {
    const selection = Array.isArray(input.capabilityOverride)
      ? overrideSelection(input.tools, input.capabilityOverride)
      : selectRequestCapabilities(input);
    const fragments = (await Promise.all(selection.capabilities.map(async (capability) => ({
      capability,
      text: await this.#instruction(capability),
    })))).filter(({ text }) => text);
    return {
      ...selection,
      instructions: fragments.length
        ? ["# Active capability guidance", ...fragments.map(({ capability, text }) => `\n## ${capability}\n${text}`)].join("\n")
        : "",
      instructionCapabilities: fragments.map(({ capability }) => capability),
    };
  }
}

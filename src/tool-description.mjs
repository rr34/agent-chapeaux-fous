export const toolDescriptionMetadataKey = "agent-slayer/selection";
export const toolDescriptionProtocol = "agent-slayer.tool-description";
export const toolDescriptionVersion = 1;

const allowedActions = new Set(["CREATE", "READ", "UPDATE", "DELETE", "EXECUTE"]);
const allowedEffects = new Set(["READ-ONLY", "MUTATING", "DESTRUCTIVE", "EXTERNAL"]);

function normalizedText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function exactObject(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unexpected = Object.keys(value).find((name) => !allowedKeys.has(name));
  if (unexpected) throw new Error(`${label}.${unexpected} is not allowed`);
}

function normalizedClassificationList(values, allowed, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Tool description ${label} must be a nonempty array`);
  }
  if (values.some((value) => typeof value !== "string" || !allowed.has(value))) {
    throw new Error(`Tool description ${label} contains an unsupported value`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`Tool description ${label} must contain unique values`);
  }
  return [...values];
}

function normalizedOperation(operation) {
  exactObject(operation, new Set([
    "name", "title", "summary", "actionClasses", "effectClassifications",
  ]), "Tool description operation");
  const name = normalizedText(operation?.name);
  const title = normalizedText(operation?.title);
  const summary = normalizedText(operation?.summary);
  if (!name || name.length > 120) throw new Error("Tool operation name is required and must not exceed 120 characters");
  if (!title || title.length > 120) throw new Error(`Tool operation ${name} title is required and must not exceed 120 characters`);
  if (!summary || summary.length > 240) throw new Error(`Tool operation ${name} summary is required and must not exceed 240 characters`);
  return {
    name,
    title,
    summary,
    actionClasses: normalizedClassificationList(operation.actionClasses, allowedActions, `${name}.actionClasses`),
    effectClassifications: normalizedClassificationList(
      operation.effectClassifications,
      allowedEffects,
      `${name}.effectClassifications`,
    ),
  };
}

export function defineToolDescription(value) {
  exactObject(value, new Set([
    "protocol", "version", "summary", "actionClasses", "effectClassifications", "operations",
  ]), "Tool description");
  const { summary, actionClasses, effectClassifications } = value;
  const normalizedSummary = normalizedText(summary);
  if (!normalizedSummary || normalizedSummary.length > 320) {
    throw new Error("Tool description summary is required and must not exceed 320 characters");
  }
  const description = {
    protocol: toolDescriptionProtocol,
    version: toolDescriptionVersion,
    summary: normalizedSummary,
    actionClasses: normalizedClassificationList(actionClasses, allowedActions, "actionClasses"),
    effectClassifications: normalizedClassificationList(
      effectClassifications,
      allowedEffects,
      "effectClassifications",
    ),
  };
  if (Object.hasOwn(value, "operations")) {
    const { operations } = value;
    if (!operations || typeof operations !== "object" || Array.isArray(operations)
      || typeof operations.exhaustive !== "boolean") {
      throw new Error("Tool description operations requires an exhaustive boolean");
    }
    exactObject(operations, new Set(["exhaustive", "entries"]), "Tool description operations");
    if (!Array.isArray(operations.entries) || operations.entries.length === 0 || operations.entries.length > 40) {
      throw new Error("Tool description operations requires 1 through 40 entries");
    }
    const entries = operations.entries.map(normalizedOperation);
    if (new Set(entries.map(({ name }) => name)).size !== entries.length) {
      throw new Error("Tool description operation names must be unique");
    }
    description.operations = { exhaustive: operations.exhaustive, entries };
  }
  return description;
}

export function validateToolDescription(value, { annotations = null, label = "tool" } = {}) {
  let description;
  try {
    if (value?.protocol !== toolDescriptionProtocol || value?.version !== toolDescriptionVersion) {
      throw new Error(`protocol must be ${toolDescriptionProtocol} version ${toolDescriptionVersion}`);
    }
    description = defineToolDescription(value);
  } catch (error) {
    throw new Error(`${label} has an invalid _meta[\"${toolDescriptionMetadataKey}\"]: ${error.message}`);
  }
  const readOnly = annotations?.readOnlyHint === true;
  if (readOnly !== description.effectClassifications.includes("READ-ONLY")) {
    throw new Error(`${label} tool-description effects conflict with readOnlyHint`);
  }
  if (readOnly && description.effectClassifications.length !== 1) {
    throw new Error(`${label} read-only tool cannot declare mutating, destructive, or external effects`);
  }
  if (annotations?.destructiveHint === true && !description.effectClassifications.includes("DESTRUCTIVE")) {
    throw new Error(`${label} destructiveHint requires the DESTRUCTIVE effect`);
  }
  const suffix = toolDescriptionSuffix(description);
  if (`${description.summary} ${suffix}`.length > 400) {
    throw new Error(`${label} selection summary and generated suffix exceed 400 characters`);
  }
  return description;
}

export function toolDescriptionSuffix(description) {
  return `Actions: ${description.actionClasses.join(", ")}. Effects: ${description.effectClassifications.join(", ")}.`;
}

export function catalogToolDescription(tool) {
  const published = tool.metadata?.[toolDescriptionMetadataKey];
  if (published) {
    const description = validateToolDescription(published, {
      annotations: tool.annotations,
      label: tool.name,
    });
    return {
      summary: `${description.summary} ${toolDescriptionSuffix(description)}`,
      ...(description.operations ? { operations: description.operations } : {}),
      status: "validated",
    };
  }
  const source = String(tool.source ?? "local");
  const external = source.startsWith("mcp:");
  return {
    summary: external
      ? "This external MCP has not published Agent Slayer Tool Description metadata. Its exact provider description and schema remain available only if the tool is selected for execution."
      : "This local test or extension tool has not published validated Tool Description metadata. Its exact description and schema remain available only if selected for execution.",
    status: external ? "external_metadata_missing" : "local_metadata_missing",
  };
}

export function toolMetadataWithDescription(metadata, description) {
  return { ...(metadata ?? {}), [toolDescriptionMetadataKey]: defineToolDescription(description) };
}

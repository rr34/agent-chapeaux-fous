const completionModes = new Set(["response_valid", "user_advances", "tool_receipt"]);
const inputTypes = new Set(["string", "number", "integer", "boolean"]);
const keyPattern = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const toolPattern = /^[A-Za-z][A-Za-z0-9_]{0,199}$/;

function plainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function optionalText(value, label, maximum) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) throw new Error(`${label} cannot be empty`);
  if (text.length > maximum) throw new Error(`${label} cannot exceed ${maximum} characters`);
  return text;
}

function contractArray(value, label, maximum) {
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array`);
  if (value.length > maximum) throw new Error(`${label} cannot contain more than ${maximum} items`);
  return value;
}

function validateTemplate(value, inputKeys, label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateTemplate(item, inputKeys, `${label}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const keys = Object.keys(value);
  if (keys.some((key) => key.startsWith("$"))) {
    if (keys.length !== 1) throw new Error(`${label} binding must contain exactly one $ field`);
    if ("$answer" in value) {
      if (!inputKeys.has(value.$answer)) throw new Error(`${label} references an undeclared answer key`);
      return;
    }
    if ("$runtime" in value) {
      if (value.$runtime !== "request_received_at_utc") {
        throw new Error(`${label} has an unknown runtime value`);
      }
      return;
    }
    if ("$format" in value) {
      const format = optionalText(value.$format, `${label} format`, 10_000);
      for (const match of format.matchAll(/\{([A-Za-z][A-Za-z0-9_]{0,99})\}/g)) {
        if (!inputKeys.has(match[1])) throw new Error(`${label} format references an undeclared answer key`);
      }
      return;
    }
    throw new Error(`${label} has an unknown binding`);
  }
  for (const [key, child] of Object.entries(value)) {
    validateTemplate(child, inputKeys, `${label}.${key}`);
  }
}

export function defaultInteractionGuideContract() {
  return {
    version: 1,
    instructions: null,
    inputs: [],
    operations: [],
    recoveryReads: [],
    completion: { mode: "response_valid" },
  };
}

export function normalizeInteractionGuideContract(value) {
  const contract = plainObject(value, "Briefing exchange contract");
  const allowed = new Set([
    "version", "instructions", "inputs", "operations", "recoveryReads", "completion",
  ]);
  for (const key of Object.keys(contract)) {
    if (!allowed.has(key)) throw new Error(`Unknown briefing exchange contract field: ${key}`);
  }
  if (contract.version !== 1) throw new Error("Briefing exchange contract version must be 1");
  const instructions = optionalText(contract.instructions, "Briefing exchange instructions", 50_000);
  const inputKeys = new Set();
  const inputs = contractArray(contract.inputs, "Briefing exchange inputs", 100).map((input, index) => {
    plainObject(input, `Briefing exchange input ${index + 1}`);
    const keys = Object.keys(input);
    if (keys.some((key) => !["key", "type", "required", "description"].includes(key))) {
      throw new Error(`Briefing exchange input ${index + 1} has an unknown field`);
    }
    if (!keyPattern.test(input.key ?? "")) throw new Error(`Briefing exchange input ${index + 1} has an invalid key`);
    if (inputKeys.has(input.key)) throw new Error(`Duplicate briefing exchange input key: ${input.key}`);
    inputKeys.add(input.key);
    if (!inputTypes.has(input.type)) throw new Error(`Briefing exchange input ${input.key} has an unknown type`);
    if (typeof input.required !== "boolean") throw new Error(`Briefing exchange input ${input.key} required must be true or false`);
    return {
      key: input.key,
      type: input.type,
      required: input.required,
      description: optionalText(input.description, `Briefing exchange input ${input.key} description`, 1_000),
    };
  });
  const operationIds = new Set();
  const operations = contractArray(contract.operations, "Briefing exchange operations", 100).map((operation, index) => {
    plainObject(operation, `Briefing exchange operation ${index + 1}`);
    if (Object.keys(operation).some((key) => !["id", "tool", "arguments"].includes(key))) {
      throw new Error(`Briefing exchange operation ${index + 1} has an unknown field`);
    }
    if (!keyPattern.test(operation.id ?? "")) throw new Error(`Briefing exchange operation ${index + 1} has an invalid ID`);
    if (operationIds.has(operation.id)) throw new Error(`Duplicate briefing exchange operation ID: ${operation.id}`);
    operationIds.add(operation.id);
    if (!toolPattern.test(operation.tool ?? "")) throw new Error(`Briefing exchange operation ${operation.id} has an invalid tool`);
    const argumentsTemplate = plainObject(operation.arguments, `Briefing exchange operation ${operation.id} arguments`);
    validateTemplate(argumentsTemplate, inputKeys, `Briefing exchange operation ${operation.id} arguments`);
    return { id: operation.id, tool: operation.tool, arguments: argumentsTemplate };
  });
  const recoveryReads = contractArray(contract.recoveryReads, "Briefing exchange recovery reads", 100).map((read, index) => {
    plainObject(read, `Briefing exchange recovery read ${index + 1}`);
    if (Object.keys(read).some((key) => !["tool", "arguments", "purpose"].includes(key))) {
      throw new Error(`Briefing exchange recovery read ${index + 1} has an unknown field`);
    }
    if (!toolPattern.test(read.tool ?? "")) throw new Error(`Briefing exchange recovery read ${index + 1} has an invalid tool`);
    const argumentsTemplate = plainObject(read.arguments, `Briefing exchange recovery read ${index + 1} arguments`);
    validateTemplate(argumentsTemplate, inputKeys, `Briefing exchange recovery read ${index + 1} arguments`);
    return {
      tool: read.tool,
      arguments: argumentsTemplate,
      purpose: optionalText(read.purpose, `Briefing exchange recovery read ${index + 1} purpose`, 2_000),
    };
  });
  const completion = plainObject(contract.completion, "Briefing exchange completion");
  if (Object.keys(completion).some((key) => key !== "mode")) {
    throw new Error("Briefing exchange completion has an unknown field");
  }
  if (!completionModes.has(completion.mode)) throw new Error(`Unknown completion mode: ${completion.mode}`);
  const normalized = {
    version: 1,
    instructions,
    inputs,
    operations,
    recoveryReads,
    completion: { mode: completion.mode },
  };
  const serialized = JSON.stringify(normalized);
  if (serialized.length > 200_000) throw new Error("Briefing exchange contract cannot exceed 200000 JSON characters");
  return { value: JSON.parse(serialized), serialized };
}

export const interactionGuideContractSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "integer", const: 1 },
    instructions: { type: ["string", "null"], minLength: 1, maxLength: 50_000 },
    inputs: {
      type: "array", maxItems: 100,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          key: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,99}$" },
          type: { type: "string", enum: ["string", "number", "integer", "boolean"] },
          required: { type: "boolean" },
          description: { type: ["string", "null"], minLength: 1, maxLength: 1_000 },
        },
        required: ["key", "type", "required", "description"],
      },
    },
    operations: {
      type: "array", maxItems: 100,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,99}$" },
          tool: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,199}$" },
          arguments: { type: "object" },
        },
        required: ["id", "tool", "arguments"],
      },
    },
    recoveryReads: {
      type: "array", maxItems: 100,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          tool: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,199}$" },
          arguments: { type: "object" },
          purpose: { type: ["string", "null"], minLength: 1, maxLength: 2_000 },
        },
        required: ["tool", "arguments", "purpose"],
      },
    },
    completion: {
      type: "object", additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["response_valid", "user_advances", "tool_receipt"] },
      },
      required: ["mode"],
    },
  },
  required: ["version", "instructions", "inputs", "operations", "recoveryReads", "completion"],
});

export function contractDestinationTools(contract, { includeRecovery = false } = {}) {
  return [...new Set([
    ...contract.operations.map(({ tool }) => tool),
    ...(includeRecovery ? contract.recoveryReads.map(({ tool }) => tool) : []),
  ])];
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function contractArgumentsMatch(template, actual, answers) {
  if (Array.isArray(template)) {
    return Array.isArray(actual)
      && template.length === actual.length
      && template.every((item, index) => contractArgumentsMatch(item, actual[index], answers));
  }
  if (template === null || typeof template !== "object") return sameJson(template, actual);
  if ("$answer" in template) return sameJson(actual, answers[template.$answer]);
  if ("$runtime" in template) {
    return template.$runtime === "request_received_at_utc"
      && typeof actual === "string"
      && Number.isFinite(new Date(actual).getTime());
  }
  if ("$format" in template) {
    const formatted = template.$format.replace(
      /\{([A-Za-z][A-Za-z0-9_]{0,99})\}/g,
      (_match, key) => String(answers[key]),
    );
    return actual === formatted;
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
  const templateKeys = Object.keys(template);
  const actualKeys = Object.keys(actual);
  return templateKeys.length === actualKeys.length
    && templateKeys.every((key) => Object.hasOwn(actual, key)
      && contractArgumentsMatch(template[key], actual[key], answers));
}

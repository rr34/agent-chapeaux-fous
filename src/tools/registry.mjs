function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function schemaProblem(value, schema, path = "arguments") {
  if (!schema || typeof schema !== "object") return null;
  if (Array.isArray(schema.anyOf)) {
    if (schema.anyOf.some((candidate) => schemaProblem(value, candidate, path) === null)) return null;
    return `${path} does not match any allowed schema`;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      return `${path} must be ${types.join(" or ")}`;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return `${path} must be one of ${schema.enum.map(String).join(", ")}`;
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) return `${path} is too short`;
    if (schema.maxLength != null && value.length > schema.maxLength) return `${path} is too long`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} has an invalid format`;
  }
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
    if (schema.maximum != null && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) return `${path} has too few items`;
    if (schema.maxItems != null && value.length > schema.maxItems) return `${path} has too many items`;
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const problem = schemaProblem(value[index], schema.items, `${path}[${index}]`);
        if (problem) return problem;
      }
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) return `${path}.${name} is required`;
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      const extra = Object.keys(value).find((name) => !known.has(name));
      if (extra) return `${path}.${extra} is not allowed`;
    }
    for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (!Object.hasOwn(value, name)) continue;
      const problem = schemaProblem(value[name], propertySchema, `${path}.${name}`);
      if (problem) return problem;
    }
  }
  return null;
}

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool?.name || typeof tool.execute !== "function") throw new Error("A tool needs a name and execute function");
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    this.tools.set(tool.name, {
      strict: true,
      source: "local",
      ...tool,
    });
    return this;
  }

  unregister(name) {
    return this.tools.delete(name);
  }

  list() {
    return [...this.tools.values()].map(({ execute: _execute, source, ...tool }) => ({ ...tool, source }));
  }

  toolDefinitions() {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
      strict: tool.strict,
      source: tool.source,
      upstreamName: tool.upstreamName ?? null,
    }));
  }

  async execute(name, argumentsObject, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (tool.strict !== false) {
      const problem = schemaProblem(argumentsObject, tool.parameters);
      if (problem) throw new Error(`Invalid ${name} arguments: ${problem}`);
    }
    return tool.execute(argumentsObject, context);
  }
}

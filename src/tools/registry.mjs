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

  list() {
    return [...this.tools.values()].map(({ execute: _execute, source, ...tool }) => ({ ...tool, source }));
  }

  modelTools() {
    return [...this.tools.values()].map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict,
    }));
  }

  async execute(name, argumentsObject, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.execute(argumentsObject, context);
  }
}

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";

test("to-do contracts keep complete wording and request IDs in task text", () => {
  const registry = new ToolRegistry();
  registerTodoTools(registry, {}, {});
  const tools = Object.fromEntries(registry.toolDefinitions().map((tool) => [tool.name, tool]));
  const add = tools.todo_add.inputSchema.properties;
  const update = tools.todo_update.inputSchema.properties.updates.items.properties;
  for (const retired of ["planning_prompt_text", "clear_planning_prompt"]) {
    assert.equal(Object.hasOwn(add, retired), false);
    assert.equal(Object.hasOwn(update, retired), false);
  }
  assert.match(add.text.description, /exact request IDs/u);
  assert.equal(Object.hasOwn(tools.todo_add.outputSchema.properties.task.properties, "planning_prompt_text"), false);

  const guidance = fs.readFileSync(new URL("../config/capabilities/todos/guidance.md", import.meta.url), "utf8");
  assert.match(guidance, /complete task wording[\s\S]+exact request IDs/u);
  assert.doesNotMatch(guidance, /planning_prompt_text/u);
});

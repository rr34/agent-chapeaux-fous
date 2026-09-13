import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry, schemaProblem } from "../src/tools/registry.mjs";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { registerContactTools } from "../src/tools/contact-tools.mjs";
import { registerJournalTools } from "../src/tools/journal-tools.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { registerProfileFactTools } from "../src/tools/profile-fact-tools.mjs";
import { registerInteractionGuideTools } from "../src/tools/interaction-guide-tools.mjs";

test("owning tool contracts explain inputs and results without a database or schema catalog", () => {
  const registry = new ToolRegistry();
  registerCalendarTools(registry, {}, {}, {});
  registerContactTools(registry, {}, {}, {});
  registerJournalTools(registry, {}, {});
  registerTodoTools(registry, {}, {});
  registerInteractionGuideTools(registry, {});
  const definitions = Object.fromEntries(registry.toolDefinitions().map(tool => [tool.name, tool]));
  assert.match(definitions.journal_add.inputSchema.properties.number_value.description, /parent tracker's canonical unit/);
  assert.match(definitions.journal_list.outputSchema.properties.entries.items.properties.external_id.description, /idempotent/);
  assert.match(definitions.calendar_event_update.inputSchema.properties.planning_prompt_text.description, /Null leaves it unchanged/);
  assert.match(definitions.calendar_event_add.inputSchema.properties.is_all_day.description, /^True when/);
  assert.match(definitions.interaction_guide_get.outputSchema.properties.guide.properties.steps.items.properties.answers_json.description, /actually supplied/);
  assert.equal(Object.hasOwn(definitions.todo_update.inputSchema.properties.updates.items.properties, "duration_minutes"), false);
  assert.equal(Object.hasOwn(definitions.todo_add.inputSchema.properties, "scheduled_at_utc"), false);
  assert.match(definitions.calendar_routine_add.description, /generates concrete calendar events only/);
  assert.match(definitions.calendar_event_todo_links_set.description, /multiple to-dos/);
  assert.ok(definitions.contact_search.outputSchema.properties.matches.items.properties.display_name.description);
  assert.equal(schemaProblem({ updated_count: 1, items: [{ task: { text: "Updated task" } }] }, definitions.todo_update.outputSchema), null);
});

test("profile tool returns its owning function's result without schema metadata or an extra trace", async () => {
  const registry = new ToolRegistry();
  let calls = 0;
  registerProfileFactTools(registry, {
    list({ status, factTypes }) {
      calls++;
      assert.equal(status, "active");
      assert.deepEqual(factTypes, ["vehicle"]);
      return { status, count: 1, facts: [{ id: 42, factType: "vehicle", text: "My car is blue.", status: "active" }] };
    },
  });
  const result = await registry.execute("profile_fact_list", { status: "active", fact_types: ["vehicle"] });
  assert.equal(calls, 1);
  assert.equal(result.facts[0].fact_text, "My car is blue.");
  assert.equal(Object.hasOwn(result, "schemaProjection"), false);
  const schema = registry.toolDefinitions()[0].outputSchema;
  assert.match(schema.properties.facts.items.properties.fact_text.description, /Self-contained/);
  assert.equal(schemaProblem(result, schema), null);
});

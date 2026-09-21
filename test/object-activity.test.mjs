import assert from "node:assert/strict";
import test from "node:test";
import { interactionObjectActivity, interactionObjectReferences } from "../src/ledger.mjs";

test("object activity prefers the exact mutation event over its matching tool result", () => {
  const activity = interactionObjectActivity([
    {
      eventSeq: 10,
      type: "personal_todo.created",
      status: "complete",
      actorType: "tool",
      actorName: "todo_add",
      subjectType: "personal_task",
      subjectId: "42",
      content: "Buy coffee",
    },
    {
      eventSeq: 11,
      type: "tool.result",
      status: "complete",
      name: "todo_add",
      payload: { result: { task: { personal_task_id: 42, text: "Buy coffee", group_name: "Shopping" } } },
    },
  ]);

  assert.deepEqual(activity, [{
    type: "personal_task",
    id: "42",
    title: "Buy coffee",
    context: "Shopping",
    action: "created",
    symbol: "+",
    tool: "todo_add",
    eventSeq: 10,
  }]);
});

test("object activity exposes bounded objects returned by read tools", () => {
  const activity = interactionObjectActivity([{
    eventSeq: 20,
    type: "tool.result",
    status: "complete",
    name: "contact_search",
    payload: { result: { contacts: [
      { contact_id: 7, display_name: "Lucas Ruffing", email: "lucas@example.com" },
      { contact_id: 8, display_name: "Lindsey Ruffing" },
    ] } },
  }]);

  assert.deepEqual(activity.map(({ type, id, title, action, symbol }) => ({ type, id, title, action, symbol })), [
    { type: "contact", id: "7", title: "Lucas Ruffing", action: "used", symbol: "↗" },
    { type: "contact", id: "8", title: "Lindsey Ruffing", action: "used", symbol: "↗" },
  ]);
});

test("object activity recognizes provider-owned object identifiers without interpreting workflow", () => {
  const activity = interactionObjectActivity([{
    eventSeq: 30,
    type: "tool.result",
    status: "complete",
    name: "remote_accounting_list_accounts",
    payload: { result: { accounts: [{ account_id: "acct-5999", name: "Checking ending in 5999" }] } },
  }]);

  assert.equal(activity[0].type, "account");
  assert.equal(activity[0].id, "acct-5999");
  assert.equal(activity[0].title, "Checking ending in 5999");
  assert.equal(activity[0].action, "used");
});

test("canonical object bindings survive the ledger projection without being rebuilt from prose", () => {
  const binding = {
    mention: "that account", type: "accounting.account", source: "mcp:accounting",
    objects: [{ id: 178, ref: "accounting://accounts/178", display: "Operating Checking" }],
    sourceEventSeqs: [30_801],
  };
  assert.deepEqual(interactionObjectReferences([{
    eventSeq: 30_802, type: "object.references.observed", status: "complete",
    payload: { objectReferences: [binding] },
  }]), [binding]);
});

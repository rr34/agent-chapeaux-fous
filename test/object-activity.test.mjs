import assert from "node:assert/strict";
import test from "node:test";
import {
  interactionObjectActivity,
  interactionObjectReferences,
  interactionTaskOutcome,
  reusableInteractionObjectReferences,
} from "../src/ledger.mjs";

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
    role: "subject",
    objects: [{ id: 178, ref: "accounting://accounts/178", display: "Operating Checking" }],
    sourceEventSeqs: [30_801],
  };
  assert.deepEqual(interactionObjectReferences([{
    eventSeq: 30_802, type: "object.references.observed", status: "complete",
    payload: { objectReferences: [binding] },
  }]), [binding]);
});

test("exchange projection keeps exact canonical bindings but ignores trace copies", () => {
  const events = [
    {
      eventSeq: 40,
      type: "turn.brief",
      status: "complete",
      payload: { brief: { objectReferences: [{
        mention: "morning events selected before execution",
        role: "subject",
        type: "calendar.event",
        source: "native:calendar",
        objects: [
          { id: 3129, ref: "agent-slayer://calendar-events/3129", display: "Morning Exercise" },
          { id: 3136, ref: "agent-slayer://calendar-events/3136", display: "Meditate" },
          { id: 3150, ref: "agent-slayer://calendar-events/3150", display: "Morning Video Creation" },
        ],
        sourceEventSeqs: [39],
      }] } },
    },
    {
      eventSeq: 41,
      type: "object.references.observed",
      status: "complete",
      payload: { objectReferences: [{
        mention: "calendar events returned by calendar_event_list",
        role: "subject",
        type: "calendar.event",
        source: "native:calendar",
        objects: [
          { id: 3128, ref: "agent-slayer://calendar-events/3128", display: "Morning Exercise" },
          { id: 3135, ref: "agent-slayer://calendar-events/3135", display: "Meditate" },
          { id: 3149, ref: "agent-slayer://calendar-events/3149", display: "Morning Video Creation" },
        ],
        sourceEventSeqs: [41],
      }] },
    },
    {
      eventSeq: 42,
      type: "turn.brief.validation",
      status: "complete",
      payload: { objectReferences: [{
        mention: "validation copy that is not a new object observation",
        role: "subject",
        type: "contacts.contact",
        source: "native:contacts",
        objects: [{ id: 587, ref: "agent-slayer://contacts/587", display: "Luzia" }],
        sourceEventSeqs: [1, 2, 3, 42],
      }] },
    },
  ];
  const references = interactionObjectReferences(events);

  assert.deepEqual(
    references.flatMap(({ objects }) => objects.map(({ id }) => id)),
    [3129, 3136, 3150, 3128, 3135, 3149],
  );
  assert.equal(references.some(({ type }) => type === "contacts.contact"), false);
});

test("an incomplete exchange withholds every prior object binding from reuse", () => {
  const events = [
    {
      eventSeq: 50,
      type: "turn.brief",
      status: "complete",
      payload: { brief: { objectReferences: [{
        mention: "stale selected event",
        role: "subject",
        type: "calendar.event",
        source: "native:calendar",
        objects: [{ id: 3129, ref: "agent-slayer://calendar-events/3129", display: "Morning Exercise" }],
        sourceEventSeqs: [49],
      }] } },
    },
    {
      eventSeq: 51,
      type: "object.references.observed",
      status: "complete",
      payload: { objectReferences: [{
        mention: "fresh event read",
        role: "subject",
        type: "calendar.event",
        source: "native:calendar",
        objects: [{ id: 3128, ref: "agent-slayer://calendar-events/3128", display: "Morning Exercise" }],
        sourceEventSeqs: [51],
      }] },
    },
    {
      eventSeq: 52,
      type: "tool.retry.blocked",
      status: "error",
      error: "The requested update remains incomplete.",
    },
    { eventSeq: 53, type: "request.complete", status: "complete" },
  ];

  assert.equal(interactionTaskOutcome(events), "incomplete");
  assert.deepEqual(reusableInteractionObjectReferences(events), []);
  assert.equal(interactionObjectReferences(events).length, 2);
});

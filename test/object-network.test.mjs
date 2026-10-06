import assert from "node:assert/strict";
import test from "node:test";
import { ObjectNetworkService } from "../src/object-network.mjs";

const todoIdentity = {
  type: "todos.personal_task", source: "native:todos", id: 7,
  ref: "agent-slayer://todos/7",
};
const eventIdentity = {
  type: "calendar.event", source: "native:calendar", id: 9,
  ref: "agent-slayer://calendar-events/9",
};

function fixture({ relationshipKind = null } = {}) {
  let kind = relationshipKind;
  const calls = [];
  const database = { prepare(sql) {
    return {
      get(...parameters) {
        if (/SELECT personal_task_id, text, status/u.test(sql)) return {
          personal_task_id: 7, text: "Call the electrician", status: "todo", sequence: null,
          planning_prompt_text: null, billable_amount_minor: null, billable_currency: null,
        };
        if (/SELECT todo_group_id, related_contact_id/u.test(sql)) return {
          todo_group_id: 3, related_contact_id: null,
        };
        if (/SELECT todo_group_id, name/u.test(sql)) return {
          todo_group_id: 3, name: "Construction", uses_sequence: 0,
          daily_paper_pinned: 0, archived_at_utc: null,
        };
        if (/SELECT calendar_event_id, title/u.test(sql)) return {
          calendar_event_id: 9, title: "Kitchen walk-through", description: null,
          location_text: "Home", starts_at_utc: "2026-10-06 13:00:00.000",
          ends_at_utc: null, time_zone: "America/New_York", is_all_day: 0,
          status: "confirmed", recurrence_rule: null,
        };
        if (/SELECT relationship_kind FROM calendar_events_todo_join/u.test(sql)) {
          return kind ? { relationship_kind: kind } : undefined;
        }
        throw new Error(`Unexpected get: ${sql} ${parameters}`);
      },
      all() {
        if (/FROM calendar_events_todo_join/u.test(sql)) {
          return kind ? [{ id: 9, relationship_kind: kind }] : [];
        }
        if (/FROM todo_content_join|FROM payment_invoice_lines/u.test(sql)) return [];
        throw new Error(`Unexpected all: ${sql}`);
      },
    };
  } };
  const organizer = {
    placeTodoCalendarLinks(input) {
      calls.push(input);
      kind = input.placements[0].relationshipKind;
    },
    removeTodoCalendarLink() { kind = null; },
  };
  return {
    calls,
    service: new ObjectNetworkService({
      database,
      organizer,
      registry: { execute() { throw new Error("unexpected tool call"); } },
    }),
  };
}

test("the object network keeps exact bindings and presents real connected object cards without edge prose", () => {
  const { service } = fixture({ relationshipKind: "context" });
  const graph = service.graph(todoIdentity);
  assert.equal(graph.focus.display, "Call the electrician");
  assert.deepEqual(graph.connections.map(({ object, removable }) => ({
    ref: object.ref, display: object.display, removable,
  })), [{
    ref: "agent-slayer://todo-groups/3", display: "Construction", removable: false,
  }, {
    ref: "agent-slayer://calendar-events/9", display: "Kitchen walk-through", removable: true,
  }]);
  assert.deepEqual(graph.connectableTypes,
    ["contacts.contact", "calendar.event", "video.content_item"]);
  assert.equal("relationshipLabel" in graph.connections[1], false);
  assert.throws(() => service.graph({ ...todoIdentity, ref: "agent-slayer://todos/8" }),
    /does not match its owning source/u);
});

test("a one-click task/event connection uses the calendar domain's context relationship", async () => {
  const { service, calls } = fixture();
  const graph = await service.setConnection({ from: todoIdentity, to: eventIdentity, linked: true });
  assert.deepEqual(calls, [{ placements: [{ todoId: 7, eventId: 9, relationshipKind: "context" }] }]);
  assert.equal(graph.connections.find(({ object }) => object.ref === eventIdentity.ref)?.removable, true);
});

test("the simple network control cannot remove specialized calendar meaning", async () => {
  const { service } = fixture({ relationshipKind: "work" });
  await assert.rejects(
    service.setConnection({ from: todoIdentity, to: eventIdentity, linked: false }),
    /Open the calendar event to change a work or deadline relationship/u,
  );
});


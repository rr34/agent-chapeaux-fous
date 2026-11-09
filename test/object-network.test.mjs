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
const correspondenceIdentity = {
  type: "correspondence.item", source: "native:correspondence", id: 15,
  ref: "agent-slayer://correspondence/15",
};
const contactIdentity = {
  type: "contacts.contact", source: "native:contacts", id: 12,
  ref: "agent-slayer://contacts/12",
};
const physicalItemIdentity = {
  type: "things.physical_item", source: "native:things", id: 21,
  ref: "agent-slayer://physical-items/21",
};
const fileIdentity = {
  type: "files.file", source: "native:files", id: 31,
  ref: "agent-slayer://files/31",
};

function fixture() {
  const database = { prepare(sql) {
    return {
      get(...parameters) {
        if (/SELECT personal_task_id, text, status/u.test(sql)) return {
          personal_task_id: 7, text: "Call the electrician", status: "todo", sequence: null,
          billable_amount_minor: null, billable_currency: null,
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
        throw new Error(`Unexpected get: ${sql} ${parameters}`);
      },
      all() {
        if (/FROM todo_groups WHERE todo_group_id IN/u.test(sql)) return [{
          todo_group_id: 3, name: "Construction", uses_sequence: 0,
          daily_paper_pinned: 0, archived_at_utc: null,
        }];
        if (/FROM calendar_events WHERE calendar_event_id IN/u.test(sql)) return [{
          calendar_event_id: 9, title: "Kitchen walk-through", description: null,
          location_text: "Home", starts_at_utc: "2026-10-06 13:00:00.000",
          ends_at_utc: null, time_zone: "America/New_York", is_all_day: 0,
          status: "confirmed", recurrence_rule: null,
        }];
        if (/FROM object_relationship_edges/u.test(sql)) return [
          { relationship_type: "todo-group", related_id: "3", is_reverse: 1 },
        ];
        throw new Error(`Unexpected all: ${sql}`);
      },
    };
  } };
  return {
    service: new ObjectNetworkService({
      database,
      organizer: {},
      registry: { execute() { throw new Error("unexpected tool call"); } },
    }),
  };
}

test("the object network keeps exact bindings and presents real connected object cards without edge prose", () => {
  const { service } = fixture();
  const graph = service.graph(todoIdentity);
  assert.equal(graph.focus.display, "Call the electrician");
  assert.deepEqual(graph.connections.map(({ object, removable }) => ({
    ref: object.ref, display: object.display, removable,
  })), [{
    ref: "agent-slayer://todo-groups/3", display: "Construction", removable: false,
  }]);
  assert.deepEqual(graph.connectableTypes,
    ["contacts.contact", "video.content_item", "things.physical_item", "correspondence.item"]);
  assert.equal("relationshipLabel" in graph.connections[0], false);
  assert.throws(() => service.graph({ ...todoIdentity, ref: "agent-slayer://todos/8" }),
    /does not match its owning source/u);
});

test("a one-click correspondence/event connection uses the correspondence domain relationship", async () => {
  let linked = false;
  const calls = [];
  const database = { prepare(sql) {
    return {
      get() {
        if (/SELECT calendar_event_id, title/u.test(sql)) return {
          calendar_event_id: 9, title: "Kitchen walk-through", description: null,
          location_text: "Home", starts_at_utc: "2026-10-06 13:00:00.000",
          ends_at_utc: null, time_zone: "America/New_York", is_all_day: 0,
          status: "confirmed", recurrence_rule: null,
        };
        if (/FROM correspondence WHERE correspondence_id/u.test(sql)) return {
          correspondence_id: 15, medium: "email", direction: "inbound", subject: "Walk-through notes",
          body: null, delivery_status: "delivered", call_disposition: null,
          occurred_at_utc: "2026-10-05 12:00:00.000",
        };
        throw new Error(`Unexpected get: ${sql}`);
      },
      all() {
        if (/FROM correspondence WHERE correspondence_id IN/u.test(sql)) return [{
          correspondence_id: 15, medium: "email", direction: "inbound", subject: "Walk-through notes",
          body: null, delivery_status: "delivered", call_disposition: null,
          occurred_at_utc: "2026-10-05 12:00:00.000",
        }];
        if (/FROM object_relationship_edges/u.test(sql)) return linked
          ? [{ relationship_type: "event-correspondence", related_id: "15", is_reverse: 0 }]
          : [];
        throw new Error(`Unexpected all: ${sql}`);
      },
    };
  } };
  const registry = { async execute(name, input, context) {
    calls.push({ name, input, context });
    linked = input.links[0].linked;
  } };
  const service = new ObjectNetworkService({ database, organizer: {}, registry });
  const graph = await service.setConnection({
    from: eventIdentity, to: correspondenceIdentity, linked: true,
  }, { channel: "web" });
  assert.deepEqual(calls.map(({ name, input }) => ({ name, input })), [{
    name: "correspondence_calendar_event_link_set",
    input: { links: [{ correspondence_id: 15, calendar_event_id: 9, linked: true }] },
  }]);
  assert.deepEqual(graph.connectableTypes, ["contacts.contact", "correspondence.item"]);
  assert.equal(graph.connections[0].object.ref, correspondenceIdentity.ref);
  assert.equal(graph.connections[0].removable, true);
});

test("the simple network control preserves specialized physical-item meanings", async () => {
  const database = { prepare(sql) {
    return {
      get() {
        if (/FROM physical_items WHERE physical_item_id/u.test(sql)) return {
          physical_item_id: 21, name: "Cordless drill", description: null, personal_notes: null,
          quantity: 1, location_text: "Workshop", item_condition: "good", status: "active",
          manufacturer: null, model_number: null, serial_number: null, acquired_on: null,
        };
        if (/FROM files WHERE file_id/u.test(sql)) return {
          file_id: 31, display: "drill-warranty.pdf", description: null,
          original_filename: "drill-warranty.pdf", media_kind: "document",
          mime_type: "application/pdf", byte_size: 400,
        };
        throw new Error(`Unexpected get: ${sql}`);
      },
      all() {
        if (/SELECT relationship_type FROM object_relationship_edges/u.test(sql)) {
          return [{ relationship_type: "thing-file-owned" }];
        }
        throw new Error(`Unexpected all: ${sql}`);
      },
    };
  } };
  const service = new ObjectNetworkService({
    database, organizer: {}, registry: {},
    physicalItems: { setLinks() { throw new Error("specialized link must be preserved"); } },
  });
  await assert.rejects(
    service.setConnection({ from: physicalItemIdentity, to: fileIdentity, linked: false }),
    /Things relationship editor/u,
  );
});

test("contact cards carry their available communication actions with the object", () => {
  const database = { prepare(sql) {
    return {
      get() {
        if (/FROM contacts WHERE contact_id/u.test(sql)) return {
          contact_id: 12, display_name: "Brian Lesko", contact_kind: "person",
          organization_name: null, status: "active", birth_date: null, notes: "Eddie friend",
        };
        throw new Error(`Unexpected get: ${sql}`);
      },
      all() {
        if (/FROM contact_methods/u.test(sql)) return [
          { method_kind: "phone", label: "pref", value: "+14406227421" },
          { method_kind: "email", label: "work", value: "brian@example.com" },
        ];
        if (/FROM correspondence AS item/u.test(sql)) return [];
        if (/FROM object_relationship_edges/u.test(sql)) return [];
        throw new Error(`Unexpected all: ${sql}`);
      },
    };
  } };
  const service = new ObjectNetworkService({
    database,
    organizer: {},
    registry: { execute() { throw new Error("unexpected tool call"); } },
  });
  const graph = service.graph(contactIdentity);
  assert.equal(graph.focus.respondable, true);
  assert.deepEqual(graph.focus.links, [
    { label: "Call pref", href: "tel:+14406227421" },
    { label: "Text pref", href: "sms:+14406227421" },
    { label: "Email work", href: "mailto:brian@example.com" },
  ]);
});

test("a contact network includes its 20 newest correspondence items without indexing them as edges", () => {
  const recentIds = Array.from({ length: 20 }, (_, index) => 100 - index);
  let recentQuery = null;
  let correspondenceReads = 0;
  const database = { prepare(sql) {
    return {
      get() {
        if (/FROM contacts WHERE contact_id/u.test(sql)) return {
          contact_id: 12, display_name: "Brian Lesko", contact_kind: "person",
          organization_name: null, status: "active", birth_date: null, notes: null,
        };
        throw new Error(`Unexpected get: ${sql}`);
      },
      all(...parameters) {
        if (/FROM contact_methods/u.test(sql)) return [];
        if (/FROM correspondence AS item/u.test(sql)) {
          recentQuery = { sql, parameters };
          return recentIds.map((correspondence_id) => ({ correspondence_id }));
        }
        if (/FROM object_relationship_edges/u.test(sql)) return [];
        if (/FROM correspondence WHERE correspondence_id IN/u.test(sql)) {
          correspondenceReads += 1;
          return recentIds.map((correspondence_id) => ({
            correspondence_id, medium: "call", direction: "inbound", subject: null,
            body: null, delivery_status: null, call_disposition: "missed",
            occurred_at_utc: `2026-11-08 12:${String(correspondence_id % 60).padStart(2, "0")}:00.000`,
          }));
        }
        throw new Error(`Unexpected all: ${sql}`);
      },
    };
  } };
  const graph = new ObjectNetworkService({ database, organizer: {}, registry: {} }).graph(contactIdentity);
  assert.match(recentQuery.sql, /EXISTS[\s\S]*participant[.]contact_id = \?/u);
  assert.match(recentQuery.sql, /ORDER BY item[.]occurred_at_utc DESC, item[.]correspondence_id DESC/u);
  assert.deepEqual(recentQuery.parameters, [12, 20]);
  assert.equal(correspondenceReads, 1);
  assert.deepEqual(graph.connections.map(({ object, removable }) => [object.id, removable]),
    recentIds.map((id) => [id, false]));
});
